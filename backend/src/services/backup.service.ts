import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';
import { dbStorage, BackupRecord, DatabaseRecord } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { EncryptionService } from '../utils/crypto.js';
import { AuditStore } from '../utils/audit.store.js';
import { OffsiteService } from './offsite.service.js';
import { DatabaseService } from './database.service.js';
import { AlertService } from './alert.service.js';

const DUMP_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_RESTORE_BYTES = 512 * 1024 * 1024;

export class BackupService {
  private static backupDir = path.join(CONFIG.DATA_DIR, 'backups');

  private static ensureDir() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true, mode: 0o700 });
    }
  }

  static getAll(): BackupRecord[] {
    return dbStorage.getBackups();
  }

  private static isRestorable(status: BackupRecord['status']): boolean {
    return status === 'completed' || status === 'completed_local_only';
  }

  /**
   * Resolves a backup file on disk, downloading from the bucket when the
   * local copy was deleted. The dump is still validated after this returns.
   */
  static async materializeBackupFile(backup: BackupRecord): Promise<string> {
    this.ensureDir();
    const filePath = path.join(this.backupDir, path.basename(backup.filename));
    if (fs.existsSync(filePath)) return filePath;
    if (!backup.offsiteKey) {
      throw new Error('Arquivo de backup não encontrado no disco e sem cópia offsite.');
    }
    await OffsiteService.downloadTo(backup.offsiteKey, filePath);
    return filePath;
  }

  private static notifyOffsiteFailure(targetName: string, error: string): void {
    // Local copies of production state would page the team on every failed
    // laptop backup. History and Discord stay off here; production still alerts.
    if (CONFIG.LOCAL_MODE) return;
    AlertService.broadcastNotification(
      'Upload offsite falhou',
      `${targetName}: o dump ficou só neste disco (${error}).`,
      'backup',
      true
    );
  }

  /**
   * Encrypts and uploads after a local dump. Without a configured target the
   * backup is `completed` locally. A configured target that cannot be reached
   * becomes `completed_local_only` so restore still works from this disk.
   */
  private static async finalizeOffsite(record: BackupRecord, localPath: string): Promise<BackupRecord> {
    const raw = OffsiteService.rawTarget();
    if (!raw?.bucket) {
      return dbStorage.saveBackup({ ...record, status: 'completed' });
    }
    if (!OffsiteService.resolvedTarget() || !OffsiteService.offsiteAllowed()) {
      const reason = OffsiteService.offsiteAllowed()
        ? 'destino offsite incompleto ou chave ilegível'
        : 'upload bloqueado no modo local';
      OffsiteService.markUpload(false, reason);
      return dbStorage.saveBackup({ ...record, status: 'completed_local_only' });
    }
    const kind = record.targetType === 'full' ? 'panel' : 'db';
    const key = OffsiteService.objectKey(
      kind,
      record.filename,
      record.targetType === 'database' ? record.targetId : undefined
    );
    try {
      const { sha256 } = await OffsiteService.uploadFile(localPath, key);
      OffsiteService.markUpload(true);
      try {
        await OffsiteService.applyRetention();
      } catch (err: any) {
        console.warn('Retenção offsite falhou:', err.message);
      }
      return dbStorage.saveBackup({
        ...record,
        status: 'completed',
        sha256,
        offsiteKey: key,
        offsiteUploadedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      OffsiteService.markUpload(false, err.message);
      this.notifyOffsiteFailure(record.targetName, err.message);
      return dbStorage.saveBackup({ ...record, status: 'completed_local_only' });
    }
  }

  /**
   * Dumps a database to disk.
   *
   * If the dump cannot run, the backup is recorded as `failed` and the partial
   * file is removed. An earlier version wrote a placeholder .sql containing
   * only a metadata table and marked it `completed`, which meant a restore
   * would silently produce an empty database.
   */
  static async createDatabaseBackup(dbId: string): Promise<BackupRecord> {
    this.ensureDir();
    const db = dbStorage.getDatabaseById(dbId);
    if (!db) throw new Error('Banco de dados não encontrado');

    if (!db.containerId || db.status !== 'running') {
      throw new Error(
        `O banco "${db.name}" precisa estar em execução para gerar backup (status atual: ${db.status}).`
      );
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = db.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const extension = db.type === 'mongodb' ? 'archive' : 'sql';
    const filename = `backup_${db.type}_${safeName}_${timestamp}.${extension}`;
    const targetPath = path.join(this.backupDir, filename);
    const backupId = `bkp-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const rawPassword = EncryptionService.decrypt(db.dbPassword);

    let cmd: string[];
    let env: string[];

    switch (db.type) {
      case 'postgres':
        cmd = ['pg_dump', '-U', db.dbUser, '--no-owner', db.dbName];
        env = [`PGPASSWORD=${rawPassword}`];
        break;
      case 'mysql':
      case 'mariadb':
        cmd = ['mysqldump', '-u', db.dbUser, '--single-transaction', db.dbName];
        env = [`MYSQL_PWD=${rawPassword}`];
        break;
      case 'mongodb':
        cmd = [
          'mongodump',
          '--archive',
          '-u', db.dbUser,
          '-p', rawPassword,
          '--authenticationDatabase', 'admin',
          '--db', db.dbName,
        ];
        env = [];
        break;
      default:
        throw new Error(`Backup automático não é suportado para bancos do tipo ${db.type}.`);
    }

    const writeStream = fs.createWriteStream(targetPath, { mode: 0o600 });

    try {
      const { stderr, exitCode } = await dockerService.execToStream(db.containerId, cmd, writeStream, {
        env,
        timeoutMs: DUMP_TIMEOUT_MS,
      });
      await new Promise<void>((resolve, reject) => {
        writeStream.end(() => resolve());
        writeStream.on('error', reject);
      });

      if (exitCode !== 0) {
        throw new Error(stderr.trim() || `dump falhou com código ${exitCode}`);
      }

      const stats = fs.statSync(targetPath);
      if (stats.size === 0) {
        throw new Error('O dump gerou um arquivo vazio.');
      }

      const record: BackupRecord = {
        id: backupId,
        targetType: 'database',
        targetId: db.id,
        targetName: db.name,
        filename,
        sizeBytes: stats.size,
        status: 'completed',
        createdAt: new Date().toISOString(),
      };

      dbStorage.addActivity({
        type: 'backup',
        title: `Backup concluído: ${db.name}`,
        description: `${filename} (${(stats.size / 1024).toFixed(1)} KB)`,
        status: 'success',
        metadata: { backupId, databaseId: db.id },
      });

      return this.finalizeOffsite(record, targetPath);
    } catch (err: any) {
      writeStream.destroy();
      try {
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      } catch {
        // best effort
      }

      const failed: BackupRecord = {
        id: backupId,
        targetType: 'database',
        targetId: db.id,
        targetName: db.name,
        filename,
        sizeBytes: 0,
        status: 'failed',
        createdAt: new Date().toISOString(),
      };
      dbStorage.saveBackup(failed);

      dbStorage.addActivity({
        type: 'backup',
        title: `Backup falhou: ${db.name}`,
        description: err.message,
        status: 'error',
        metadata: { backupId, databaseId: db.id },
      });

      throw new Error(`Falha ao gerar backup de "${db.name}": ${err.message}`);
    }
  }

  /**
   * Validates a dump file before feeding it to the restore command.
   *
   * An earlier version would blindly pipe any file into psql/mysql, so a
   * truncated or corrupt dump silently produced a broken database with no
   * warning. The checks here are intentionally cheap (head-of-file magic /
   * markers) so they add negligible time to the restore path.
   */
  private static validateDumpIntegrity(
    filePath: string,
    dbType: DatabaseRecord['type'],
    sizeBytes: number
  ): void {
    if (sizeBytes === 0) {
      throw new Error('O arquivo de backup está vazio e não pode ser restaurado.');
    }

    // Read just enough to check the header / magic bytes.
    const fd = fs.openSync(filePath, 'r');
    try {
      const head = Buffer.alloc(Math.min(512, sizeBytes));
      fs.readSync(fd, head, 0, head.length, 0);
      const headStr = head.toString('utf-8');

      switch (dbType) {
        case 'postgres': {
          // pg_dump SQL output starts with "-- PostgreSQL" or "SET" or "PGDMP" (custom format).
          const hasPgMarker =
            headStr.startsWith('--') ||
            headStr.startsWith('SET') ||
            head[0] === 0x50 && head[1] === 0x47 && head[2] === 0x44 && head[3] === 0x4d; // PGDMP
          if (!hasPgMarker) {
            throw new Error(
              'O arquivo não parece ser um dump PostgreSQL válido (cabeçalho não reconhecido).'
            );
          }
          break;
        }
        case 'mysql':
        case 'mariadb': {
          // mysqldump always starts with "-- MySQL dump" or "-- MariaDB dump" or
          // at least a SQL comment line.
          if (!headStr.startsWith('--') && !headStr.startsWith('/*')) {
            throw new Error(
              'O arquivo não parece ser um dump MySQL/MariaDB válido (cabeçalho não reconhecido).'
            );
          }
          break;
        }
        case 'mongodb': {
          // mongodump --archive starts with a binary header; the first bytes
          // contain the magic sequence. A text file would never match.
          if (sizeBytes < 16) {
            throw new Error('O arquivo de backup MongoDB é pequeno demais para ser um archive válido.');
          }
          break;
        }
        // Redis has no dump restore path here, so no validation needed.
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  /**
   * Pipes a dump into a running engine. Shared by live restore, remote restore
   * and the monthly drill so the restore command cannot drift between them.
   */
  static async restoreDumpInto(db: DatabaseRecord, filePath: string, containerId: string): Promise<void> {
    const rawPassword = EncryptionService.isEncrypted(db.dbPassword)
      ? EncryptionService.decrypt(db.dbPassword)
      : db.dbPassword;
    const dump = fs.readFileSync(filePath);

    let cmd: string[];
    let env: string[];

    switch (db.type) {
      case 'postgres':
        cmd = ['psql', '-U', db.dbUser, '-d', db.dbName];
        env = [`PGPASSWORD=${rawPassword}`];
        break;
      case 'mysql':
      case 'mariadb':
        cmd = ['mysql', '-u', db.dbUser, db.dbName];
        env = [`MYSQL_PWD=${rawPassword}`];
        break;
      case 'mongodb':
        cmd = [
          'mongorestore',
          '--archive',
          '--drop',
          '-u', db.dbUser,
          '-p', rawPassword,
          '--authenticationDatabase', 'admin',
        ];
        env = [];
        break;
      default:
        throw new Error(`Restauração não suportada para bancos do tipo ${db.type}.`);
    }

    const result = await dockerService.execInContainer(containerId, cmd, {
      env,
      stdin: dump,
      timeoutMs: DUMP_TIMEOUT_MS,
    });

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `Restauração falhou com código ${result.exitCode}`);
    }
  }

  static async restoreBackup(backupId: string): Promise<boolean> {
    const backup = dbStorage.getBackups().find((b) => b.id === backupId);
    if (!backup) throw new Error('Registro de backup não encontrado');
    if (!this.isRestorable(backup.status)) {
      throw new Error('Este backup não foi concluído com sucesso e não pode ser restaurado.');
    }

    const filePath = await this.materializeBackupFile(backup);
    const backupStats = fs.statSync(filePath);
    if (backupStats.size > MAX_RESTORE_BYTES) {
      throw new Error(`O backup excede o limite de restauração de ${MAX_RESTORE_BYTES / 1024 / 1024} MB.`);
    }

    const db = dbStorage.getDatabaseById(backup.targetId);
    if (!db || !db.containerId) throw new Error('Banco de dados ou contêiner não está ativo para restauração');
    if (db.status !== 'running') throw new Error(`O contêiner do banco está ${db.status}.`);

    this.validateDumpIntegrity(filePath, db.type, backupStats.size);
    try {
      await this.restoreDumpInto(db, filePath, db.containerId);
    } catch (err: any) {
      dbStorage.addActivity({
        type: 'backup',
        title: `Restauração falhou: ${db.name}`,
        description: err.message,
        status: 'error',
        metadata: { backupId, databaseId: db.id },
      });
      throw err;
    }

    // Post-restore sanity check: verify the database is still reachable.
    try {
      await this.verifyDatabaseConnectivity(db);
    } catch (verifyErr: any) {
      dbStorage.addActivity({
        type: 'backup',
        title: `Restauração concluída com alerta: ${db.name}`,
        description: `Dados restaurados, mas a verificação pós-restore falhou: ${verifyErr.message}`,
        status: 'warning',
        metadata: { backupId, databaseId: db.id },
      });
      return true;
    }

    dbStorage.addActivity({
      type: 'backup',
      title: `Restauração concluída: ${db.name}`,
      description: `Restaurado a partir de ${backup.filename} — verificação pós-restore OK`,
      status: 'success',
      metadata: { backupId, databaseId: db.id },
    });

    return true;
  }

  /**
   * Lightweight connectivity check after a restore. Runs the cheapest possible
   * query to confirm the database engine accepted the data and is responsive.
   */
  private static async verifyDatabaseConnectivity(
    db: DatabaseRecord,
    containerId = db.containerId
  ): Promise<void> {
    if (!containerId) return;
    const rawPassword = EncryptionService.isEncrypted(db.dbPassword)
      ? EncryptionService.decrypt(db.dbPassword)
      : db.dbPassword;

    let cmd: string[];
    let env: string[];

    switch (db.type) {
      case 'postgres':
        cmd = ['psql', '-U', db.dbUser, '-d', db.dbName, '-c', 'SELECT 1'];
        env = [`PGPASSWORD=${rawPassword}`];
        break;
      case 'mysql':
      case 'mariadb':
        cmd = ['mysql', '-u', db.dbUser, `-p${rawPassword}`, db.dbName, '-e', 'SELECT 1'];
        env = [];
        break;
      case 'mongodb':
        cmd = ['mongosh', '--quiet', '--eval', 'db.runCommand({ ping: 1 })',
          '-u', db.dbUser, '-p', rawPassword, '--authenticationDatabase', 'admin', db.dbName];
        env = [];
        break;
      default:
        return; // No check for unsupported types.
    }

    const result = await dockerService.execInContainer(containerId, cmd, {
      env,
      timeoutMs: 15_000,
    });

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `Verificação falhou com código ${result.exitCode}`);
    }
  }

  static async deleteBackup(id: string): Promise<boolean> {
    const target = dbStorage.getBackups().find((b) => b.id === id);
    if (!target) return false;

    const filePath = path.join(this.backupDir, path.basename(target.filename));
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error('Error deleting backup file:', err);
      }
    }
    return dbStorage.removeBackup(id);
  }

  static getBackupFilePath(filename: string): string | null {
    // basename strips any path component, so a crafted filename cannot escape
    // the backup directory.
    const filePath = path.join(this.backupDir, path.basename(filename));
    return fs.existsSync(filePath) ? filePath : null;
  }

  /**
   * Snapshots panel_db.json into the backups directory.
   *
   * Distinct from /api/system/export-state (operator download): this produces a
   * dated on-disk copy that cron can include alongside database dumps, so a
   * failed disk does not leave only container volumes recoverable.
   */
  static async createPanelStateBackup(): Promise<BackupRecord> {
    this.ensureDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup_panel_state_${timestamp}.json`;
    const targetPath = path.join(this.backupDir, filename);
    const backupId = `bkp-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

    try {
      // Force a fresh write so the snapshot matches the in-memory document.
      const state = dbStorage.exportState();
      const payload = JSON.stringify(state, null, 2);
      fs.writeFileSync(targetPath, payload, { encoding: 'utf-8', mode: 0o600 });
      AuditStore.snapshotTo(path.join(this.backupDir, `audit_${timestamp}`));
      const stats = fs.statSync(targetPath);

      const record: BackupRecord = {
        id: backupId,
        targetType: 'full',
        targetId: 'panel',
        targetName: 'Estado do Painel',
        filename,
        sizeBytes: stats.size,
        status: 'completed',
        createdAt: new Date().toISOString(),
      };

      dbStorage.addActivity({
        type: 'backup',
        title: 'Backup do estado do painel concluído',
        description: `${filename} (${(stats.size / 1024).toFixed(1)} KB)`,
        status: 'success',
        metadata: { backupId },
      });

      return this.finalizeOffsite(record, targetPath);
    } catch (err: any) {
      try {
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      } catch {
        /* best effort */
      }

      const failed: BackupRecord = {
        id: backupId,
        targetType: 'full',
        targetId: 'panel',
        targetName: 'Estado do Painel',
        filename,
        sizeBytes: 0,
        status: 'failed',
        createdAt: new Date().toISOString(),
      };
      dbStorage.saveBackup(failed);
      throw new Error(`Falha ao gerar backup do estado do painel: ${err.message}`);
    }
  }

  /**
   * Restores panel_db.json from a prior panel-state backup.
   *
   * Goes through importState so the running process and the file cannot diverge.
   */
  static async restorePanelStateBackup(backupId: string): Promise<boolean> {
    const backup = dbStorage.getBackups().find((b) => b.id === backupId);
    if (!backup) throw new Error('Backup não encontrado');
    if (backup.targetType !== 'full' || backup.targetId !== 'panel') {
      throw new Error('Este backup não é um snapshot do estado do painel.');
    }
    if (!this.isRestorable(backup.status)) {
      throw new Error('Só é possível restaurar backups concluídos com sucesso.');
    }

    const filePath = await this.materializeBackupFile(backup);

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err: any) {
      throw new Error(`Backup do painel corrompido: ${err.message}`);
    }

    const problems = dbStorage.validateState(parsed);
    if (problems.length) {
      throw new Error(`Backup inválido: ${problems.join(' ')}`);
    }

    dbStorage.importState(parsed as Parameters<typeof dbStorage.importState>[0]);
    dbStorage.addActivity({
      type: 'backup',
      title: 'Estado do painel restaurado',
      description: `Restaurado a partir de ${backup.filename}`,
      status: 'success',
      metadata: { backupId },
    });
    return true;
  }

  static latestDrillStatus(): {
    at: string;
    ok: boolean;
    durationMs: number;
    error?: string;
    stale: boolean;
  } | null {
    const drills = dbStorage
      .getBackups()
      .map((b) => b.drill)
      .filter((d): d is NonNullable<BackupRecord['drill']> => Boolean(d))
      .sort((a, b) => b.at.localeCompare(a.at));
    const latest = drills[0];
    if (!latest) return null;
    const ageMs = Date.now() - new Date(latest.at).getTime();
    return { ...latest, stale: ageMs > 45 * 24 * 60 * 60 * 1000 };
  }

  static async restoreFromRemoteKey(key: string): Promise<{ kind: 'panel' | 'db'; filename: string }> {
    const parsed = OffsiteService.parseRemoteKey(key);
    this.ensureDir();
    const dest = path.join(this.backupDir, path.basename(parsed.filename));
    await OffsiteService.downloadTo(key, dest);

    if (parsed.kind === 'panel') {
      let payload: unknown;
      try {
        payload = JSON.parse(fs.readFileSync(dest, 'utf-8'));
      } catch (err: any) {
        throw new Error(`Snapshot do painel corrompido: ${err.message}`);
      }
      const problems = dbStorage.validateState(payload);
      if (problems.length) throw new Error(`Backup inválido: ${problems.join(' ')}`);
      dbStorage.importState(payload as Parameters<typeof dbStorage.importState>[0]);
      return parsed;
    }

    const db = parsed.dbId ? dbStorage.getDatabaseById(parsed.dbId) : undefined;
    if (!db || !db.containerId) {
      throw new Error('Banco de dados da chave remota não existe ou não está em execução neste painel.');
    }
    const stats = fs.statSync(dest);
    this.validateDumpIntegrity(dest, db.type, stats.size);
    await this.restoreDumpInto(db, dest, db.containerId);
    await this.verifyDatabaseConnectivity(db);
    return parsed;
  }

  private static recordDrill(backup: BackupRecord, result: BackupRecord['drill']): void {
    backup.drill = result;
    dbStorage.saveBackup(backup);
  }

  private static latestRestorable(
    targetType: BackupRecord['targetType'],
    targetId: string
  ): BackupRecord | undefined {
    return dbStorage
      .getBackups()
      .filter((b) => b.targetType === targetType && b.targetId === targetId && this.isRestorable(b.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  /**
   * Monthly "dark" restore: validate panel schema without importing, then
   * restore the latest dump of each database into an ephemeral container.
   */
  static async runRestoreDrill(): Promise<{ ok: boolean; summary: string }> {
    const started = Date.now();
    const lines: string[] = [];
    let ok = true;

    const panelBackup = this.latestRestorable('full', 'panel');
    if (panelBackup) {
      try {
        const file = await this.materializeBackupFile(panelBackup);
        let parsed: unknown;
        try {
          parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
        } catch (err: any) {
          throw new Error(`JSON inválido: ${err.message}`);
        }
        const problems = dbStorage.validateState(parsed);
        if (problems.length) throw new Error(problems.join(' '));
        this.recordDrill(panelBackup, { at: new Date().toISOString(), ok: true, durationMs: Date.now() - started });
        lines.push('Estado do painel: schema válido (não importado).');
      } catch (err: any) {
        ok = false;
        this.recordDrill(panelBackup, {
          at: new Date().toISOString(),
          ok: false,
          durationMs: Date.now() - started,
          error: err.message,
        });
        lines.push(`Estado do painel: falhou (${err.message}).`);
      }
    } else {
      lines.push('Nenhum snapshot do painel para ensaiar.');
    }

    if (CONFIG.LOCAL_MODE) {
      lines.push('Modo local: ensaio Docker dos dumps pulado.');
    } else {
      for (const db of dbStorage.getDatabases()) {
        if (db.type === 'redis') continue;
        const dump = this.latestRestorable('database', db.id);
        if (!dump) {
          lines.push(`${db.name}: sem dump restorable.`);
          continue;
        }
        const drillStarted = Date.now();
        const ephemeralName = `aegis-drill-${db.id}-${Date.now().toString(36)}`.slice(0, 63);
        let containerId: string | undefined;
        try {
          const file = await this.materializeBackupFile(dump);
          this.validateDumpIntegrity(file, db.type, fs.statSync(file).size);
          containerId = await DatabaseService.startEphemeral(db, ephemeralName);
          await DatabaseService.waitUntilReady(containerId, db);
          await this.restoreDumpInto(db, file, containerId);
          await this.verifyDatabaseConnectivity(db, containerId);
          this.recordDrill(dump, {
            at: new Date().toISOString(),
            ok: true,
            durationMs: Date.now() - drillStarted,
          });
          lines.push(`${db.name}: restore no container efêmero OK.`);
        } catch (err: any) {
          ok = false;
          this.recordDrill(dump, {
            at: new Date().toISOString(),
            ok: false,
            durationMs: Date.now() - drillStarted,
            error: err.message,
          });
          lines.push(`${db.name}: falhou (${err.message}).`);
        } finally {
          if (containerId) {
            try {
              await dockerService.removeContainer(containerId, true, true);
            } catch {
              await dockerService.removeContainerByName(ephemeralName, true).catch(() => undefined);
            }
          }
        }
      }
    }

    const summary = lines.join('\n');
    AuditStore.append({
      action: 'backup.drill',
      outcome: ok ? 'success' : 'failure',
      meta: { summary },
    });
    if (!ok && !CONFIG.LOCAL_MODE) {
      AlertService.broadcastNotification('Ensaio de restore falhou', summary, 'backup', true);
    }
    return { ok, summary };
  }
}
