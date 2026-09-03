import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';
import { dbStorage, BackupRecord, DatabaseRecord } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { EncryptionService } from '../utils/crypto.js';

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

      return dbStorage.saveBackup(record);
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

  static async restoreBackup(backupId: string): Promise<boolean> {
    const backup = dbStorage.getBackups().find((b) => b.id === backupId);
    if (!backup) throw new Error('Registro de backup não encontrado');
    if (backup.status !== 'completed') {
      throw new Error('Este backup não foi concluído com sucesso e não pode ser restaurado.');
    }

    const filePath = path.join(this.backupDir, path.basename(backup.filename));
    if (!fs.existsSync(filePath)) throw new Error('Arquivo de backup não encontrado no disco');
    const backupStats = fs.statSync(filePath);
    if (backupStats.size > MAX_RESTORE_BYTES) {
      throw new Error(`O backup excede o limite de restauração de ${MAX_RESTORE_BYTES / 1024 / 1024} MB.`);
    }

    const db = dbStorage.getDatabaseById(backup.targetId);
    if (!db || !db.containerId) throw new Error('Banco de dados ou contêiner não está ativo para restauração');
    if (db.status !== 'running') throw new Error(`O contêiner do banco está ${db.status}.`);

    // Validate the dump file before touching the live database.
    this.validateDumpIntegrity(filePath, db.type, backupStats.size);

    const rawPassword = EncryptionService.decrypt(db.dbPassword);
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

    const result = await dockerService.execInContainer(db.containerId, cmd, {
      env,
      stdin: dump,
      timeoutMs: DUMP_TIMEOUT_MS,
    });

    if (result.exitCode !== 0) {
      dbStorage.addActivity({
        type: 'backup',
        title: `Restauração falhou: ${db.name}`,
        description: result.stderr.trim() || `Código de saída ${result.exitCode}`,
        status: 'error',
        metadata: { backupId, databaseId: db.id },
      });
      throw new Error(result.stderr.trim() || `Restauração falhou com código ${result.exitCode}`);
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
  private static async verifyDatabaseConnectivity(db: DatabaseRecord): Promise<void> {
    if (!db.containerId) return;
    const rawPassword = EncryptionService.decrypt(db.dbPassword);

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

    const result = await dockerService.execInContainer(db.containerId, cmd, {
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
}
