import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';
import type { UserRole } from '../middleware/auth.js';
import { DeployLogStore } from '../utils/deploy-log.store.js';
import { AppLogStore } from '../utils/app-log.store.js';
import { acquirePanelLock } from '../utils/panel-lock.js';
import {
  DEFAULT_APP_LIMITS,
  DEFAULT_DATABASE_LIMITS,
  normalizeLimits,
  type ResourceLimits,
} from '../utils/resource-limits.js';
import type { AppHealth, HealthcheckConfig } from '../utils/health-probe.js';
import {
  StateHistory,
  collectionDelta,
  type SnapshotFile,
  type SnapshotReason,
} from '../utils/state-history.js';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  email?: string;
  role: UserRole;
  /** Incremented whenever the user's credentials or permissions change. */
  tokenVersion?: number;
  /** Encrypted TOTP secret (`aegis.v1:`). Never returned by the API. */
  totpSecret?: string;
  totpEnabled?: boolean;
  /** bcrypt hashes of one-time recovery codes. */
  totpRecoveryHashes?: string[];
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip?: string;
  userAgent?: string;
  revokedAt?: string;
}

export interface DatabaseRecord {
  id: string;
  name: string;
  type: 'postgres' | 'mysql' | 'mariadb' | 'redis' | 'mongodb';
  containerId?: string;
  port: number;
  internalPort: number;
  dbUser: string;
  dbPassword: string;
  dbName: string;
  status: 'running' | 'stopped' | 'creating' | 'error';
  connectionString: string;
  /** Absent means settings.defaultDatabaseLimits applies. */
  limits?: ResourceLimits;
  withGui?: boolean;
  guiContainerId?: string;
  guiPort?: number;
  createdAt: string;
}

export interface DeploymentRecord {
  id: string;
  appId: string;
  appName: string;
  commitHash?: string;
  commitMessage?: string;
  authorName?: string;
  branch: string;
  status: 'queued' | 'building' | 'success' | 'failed';
  /**
   * In-memory / streaming only. Persisted under DATA_DIR/deploy-logs so
   * panel_db.json stays small. List endpoints return an empty string.
   */
  buildLogs: string;
  durationSeconds: number;
  triggeredBy: 'webhook' | 'manual' | 'github_action';
  createdAt: string;
  finishedAt?: string;
}

export interface AppRecord {
  id: string;
  name: string;
  sourceType: 'git' | 'dockerfile' | 'image';
  gitUrl?: string;
  branch?: string;
  imageName?: string;
  containerId?: string;
  port: number;
  internalPort: number;
  /**
   * True when the host port was assigned automatically. Such a port may be
   * reassigned on a later deploy if it has been taken; a port the user chose
   * explicitly is never moved without telling them.
   */
  autoPort?: boolean;
  /**
   * Per-app resource ceiling. Absent means settings.defaultAppLimits applies,
   * which is also what every app created before limits existed gets on its
   * next deploy.
   */
  limits?: ResourceLimits;
  /**
   * Probe settings. Absent means the panel's own defaults are used; setting
   * this also enables Docker's in-container healthcheck, which is opt-in
   * because a distroless image has no wget or curl to run it with.
   */
  healthcheck?: HealthcheckConfig;
  /** Last observed health. Written by the watchdog, never by the user. */
  health?: AppHealth;
  env: Record<string, string>;
  domain?: string;
  webhookSecret?: string;
  githubToken?: string;
  autoDeploy?: boolean;
  deployBranch?: string;
  /** Optional remote node target. Absent / local node = this machine. */
  nodeId?: string;
  status: 'running' | 'stopped' | 'building' | 'error';
  lastDeployAt?: string;
  lastCommitHash?: string;
  lastCommitMessage?: string;
  lastCommitAuthor?: string;
  lastCommitAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CronJobRecord {
  id: string;
  name: string;
  schedule: string; // e.g. "0 3 * * *"
  type: 'shell' | 'backup' | 'webhook' | 'restore-drill';
  command?: string;
  webhookUrl?: string;
  enabled: boolean;
  lastRunAt?: string;
  lastStatus?: 'success' | 'failed';
  lastOutput?: string;
  createdAt: string;
}

export interface DomainRecord {
  id: string;
  domain: string;
  targetPort: number;
  targetContainer?: string;
  sslEnabled: boolean;
  status: 'active' | 'pending' | 'error';
  createdAt: string;
}

export interface BackupRecord {
  id: string;
  targetType: 'database' | 'app' | 'full';
  targetId: string;
  targetName: string;
  filename: string;
  sizeBytes: number;
  status: 'completed' | 'in_progress' | 'failed' | 'completed_local_only';
  createdAt: string;
  sha256?: string;
  offsiteKey?: string;
  offsiteUploadedAt?: string;
  drill?: { at: string; ok: boolean; durationMs: number; error?: string };
}

export interface BackupTarget {
  provider: 's3';
  endpoint?: string;
  region: string;
  bucket: string;
  prefix?: string;
  accessKeyId: string;
  /** Encrypted at rest. Never returned by the API. */
  secretAccessKey?: string;
  lastUploadAt?: string;
  lastError?: string;
}

export interface FirewallRule {
  id: string;
  port: number;
  protocol: 'tcp' | 'udp' | 'both';
  action: 'allow' | 'deny';
  comment: string;
  createdAt: string;
}

export interface AlertHistoryRecord {
  id: string;
  title: string;
  message: string;
  type: 'deploy' | 'alert' | 'backup';
  isError: boolean;
  appId?: string;
  createdAt: string;
}

export interface ActivityRecord {
  id: string;
  type: 'deploy' | 'domain' | 'database' | 'backup' | 'alert' | 'system' | 'rollback';
  title: string;
  description: string;
  status: 'success' | 'warning' | 'error' | 'info';
  user?: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface AlertConfig {
  enabled: boolean;
  discordWebhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  // Evolution API (WhatsApp)
  whatsappEnabled?: boolean;
  whatsappApiUrl?: string;
  whatsappApiKey?: string;
  whatsappInstance?: string;
  whatsappRecipientNumber?: string;
  // Alert options
  notifyOnDeploySuccess?: boolean;
  notifyOnDeployFail?: boolean;
  notifyOnHighResource?: boolean;
  notifyOnBackup?: boolean;
  cpuThresholdPercent: number;
  memThresholdPercent: number;
  diskThresholdPercent: number;
  lastAlertSentAt?: string;
}

export interface ServerNode {
  id: string;
  name: string;
  type: 'vps' | 'local' | 'cloud';
  hostIp: string;
  /** True for the machine this process runs on; it needs no SSH transport. */
  isLocal?: boolean;
  isCurrent: boolean;
  status: 'online' | 'offline' | 'unknown' | 'error';
  location?: string;

  // --- SSH transport -----------------------------------------------------
  // Remote nodes are reached with dockerode's SSH transport, which runs
  // `docker system dial-stdio` over an ordinary SSH session. No Docker port is
  // ever exposed on the node.
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  /**
   * Private key, encrypted at rest with ENCRYPTION_KEY.
   *
   * This key grants membership of the remote `docker` group, which is
   * equivalent to root on that machine. It is never returned by the API - only
   * a boolean saying whether one is stored.
   */
  sshPrivateKey?: string;
  /** Passphrase for the key above, encrypted with the same key. */
  sshPassphrase?: string;
  /** SHA256 fingerprint of the SSH host key, required to prevent MITM. */
  sshHostFingerprint?: string;

  /**
   * Last probe result.
   *
   * Free host RAM and disk are deliberately absent: the Docker API does not
   * expose them, and the only way to get them is to run a container on the node
   * to read /proc — which turns a read-only health probe into a workload the
   * panel schedules without being asked. What Docker does report is here, and
   * nothing is invented to fill the gap.
   */
  health?: {
    at: string;
    sshMs: number;
    dockerOk: boolean;
    containersRunning: number;
    /** Containers on that node carrying the `aegis.managed` label. */
    aegisRunning: number;
    memTotalBytes?: number;
    cpuCount?: number;
    /** Bytes Docker itself holds there (images, containers, volumes). */
    dockerDiskBytes?: number;
    /** Consecutive failed probes. The node is `error` from three onwards. */
    consecutiveFailures: number;
    lastError?: string;
  };

  // --- last health check --------------------------------------------------
  lastCheckedAt?: string;
  lastError?: string;
  dockerVersion?: string;
  containerCount?: number;
}

export interface PanelSettings {
  serverName: string;
  caddyEnabled: boolean;
  panelDomain?: string;
  publicIp?: string;
  notificationEmail?: string;
  autoBackup: boolean;
  backupIntervalHours: number;
  backupTarget?: BackupTarget;
  /**
   * Ceiling for `DATA_DIR/builds`. Reclaimable artifacts of the least recently
   * built apps are deleted after a deploy until the tree fits.
   */
  buildsDiskCapMb: number;
  /** Applied to any app whose record carries no explicit `limits`. */
  defaultAppLimits: ResourceLimits;
  /** Same, for provisioned database engines. */
  defaultDatabaseLimits: ResourceLimits;
  alertConfig: AlertConfig;
}

export interface DatabaseSchema {
  users: User[];
  databases: DatabaseRecord[];
  apps: AppRecord[];
  deployments: DeploymentRecord[];
  cronJobs: CronJobRecord[];
  domains: DomainRecord[];
  backups: BackupRecord[];
  firewallRules: FirewallRule[];
  serverNodes: ServerNode[];
  activities: ActivityRecord[];
  alertHistory: AlertHistoryRecord[];
  sessions: SessionRecord[];
  settings: PanelSettings;
}

const DEFAULT_DATA: DatabaseSchema = {
  users: [],
  databases: [],
  apps: [],
  deployments: [],
  activities: [],
  alertHistory: [],
  sessions: [],
  cronJobs: [
    {
      id: 'cron-daily-backup',
      name: 'Backup Noturno Automático',
      schedule: '0 3 * * *',
      type: 'backup',
      enabled: true,
      createdAt: new Date().toISOString(),
      lastStatus: 'success',
      lastOutput: 'Rotina de backup automático agendada para as 03:00'
    },
    {
      id: 'cron-restore-drill',
      name: 'Ensaio mensal de restore',
      schedule: '0 4 1 * *',
      type: 'restore-drill',
      enabled: false,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'cron-docker-prune',
      name: 'Limpeza de Cache Docker',
      schedule: '0 0 * * 0',
      type: 'shell',
      command: 'docker system prune -f',
      enabled: false,
      createdAt: new Date().toISOString()
    }
  ],
  domains: [],
  backups: [],
  firewallRules: [
    { id: 'fw-22', port: 22, protocol: 'tcp', action: 'allow', comment: 'SSH Access', createdAt: new Date().toISOString() },
    { id: 'fw-80', port: 80, protocol: 'tcp', action: 'allow', comment: 'HTTP Web Traffic', createdAt: new Date().toISOString() },
    { id: 'fw-443', port: 443, protocol: 'tcp', action: 'allow', comment: 'HTTPS Secure Web', createdAt: new Date().toISOString() },
  ],
  // Only the machine running this process. Additional nodes are registered by
  // the operator; shipping a placeholder for someone else's provider is noise.
  serverNodes: [
    { id: 'node-local', name: 'Este Servidor', type: 'local', hostIp: '127.0.0.1', isLocal: true, isCurrent: true, status: 'online', location: 'On-Premise' },
  ],
  settings: {
    serverName: 'Aegis Node 01',
    caddyEnabled: true,
    autoBackup: true,
    backupIntervalHours: 24,
    buildsDiskCapMb: 5120,
    defaultAppLimits: { ...DEFAULT_APP_LIMITS },
    defaultDatabaseLimits: { ...DEFAULT_DATABASE_LIMITS },
    alertConfig: {
      enabled: false,
      cpuThresholdPercent: 90,
      memThresholdPercent: 85,
      diskThresholdPercent: 90,
    }
  }
};

export class JsonStorage {
  private filePath: string;
  private data: DatabaseSchema;

  constructor() {
    const dataDir = CONFIG.DATA_DIR;
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    } else if (!CONFIG.IS_WINDOWS) {
      try { fs.chmodSync(dataDir, 0o700); } catch { /* best effort */ }
    }

    // Claimed before the document is read. A second writer over the same
    // DATA_DIR does not corrupt the file — every save is atomic — it keeps its
    // own copy in memory and rewrites the whole document from it, so whichever
    // process saves last silently discards the other's records.
    acquirePanelLock(dataDir);

    this.filePath = path.join(dataDir, 'panel_db.json');
    this.data = this.load();
  }

  private load(): DatabaseSchema {
    if (!fs.existsSync(this.filePath)) {
      const fresh = structuredClone(DEFAULT_DATA);
      this.data = fresh;
      this.save(fresh);
      return fresh;
    }

    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf-8');
    } catch (err: any) {
      throw new Error(`Não foi possível ler ${this.filePath}: ${err.message}`);
    }

    let parsed: Partial<DatabaseSchema>;
    try {
      parsed = JSON.parse(raw);
    } catch (err: any) {
      // A corrupt file is almost always a truncated write, not an empty panel.
      // Overwriting it with defaults here would silently destroy every user,
      // app and database record, so the file is preserved and startup aborts.
      const quarantine = `${this.filePath}.corrupt-${Date.now()}`;
      try {
        fs.copyFileSync(this.filePath, quarantine);
      } catch {
        // best effort
      }
      throw new Error(
        `panel_db.json está corrompido e NÃO foi sobrescrito. ` +
          `Cópia preservada em ${quarantine}. Erro: ${err.message}. ` +
          `Restaure um backup ou corrija o JSON antes de reiniciar o painel.`
      );
    }

    // Taken before the merge below, not after: a new panel version adds
    // collections and normalises settings, and the first save rewrites the file
    // in the new shape. Without a copy of the pre-migration document, a
    // downgrade or a bad migration has nothing to go back to.
    StateHistory.capture(this.filePath, this.historyDir(), 'boot');

    // Merge one level into the defaults so a file written by an older version
    // gains newly added collections, and nested settings gain new fields
    // instead of being replaced wholesale by the stored object.
    return {
      ...DEFAULT_DATA,
      ...parsed,
      cronJobs: this.withDefaultCronJobs(parsed.cronJobs),
      settings: {
        ...DEFAULT_DATA.settings,
        ...(parsed.settings || {}),
        alertConfig: {
          ...DEFAULT_DATA.settings.alertConfig,
          ...(parsed.settings?.alertConfig || {}),
        },
        // Same reason as alertConfig: a stored object carrying only memoryMb
        // would replace the whole default and leave cpus/pidsLimit undefined,
        // which reaches Docker as "unlimited".
        defaultAppLimits: normalizeLimits(
          parsed.settings?.defaultAppLimits,
          DEFAULT_APP_LIMITS
        ),
        defaultDatabaseLimits: normalizeLimits(
          parsed.settings?.defaultDatabaseLimits,
          DEFAULT_DATABASE_LIMITS
        ),
      },
    };
  }

  private withDefaultCronJobs(stored: CronJobRecord[] | undefined): CronJobRecord[] {
    const list = stored ? [...stored] : [...DEFAULT_DATA.cronJobs];
    for (const job of DEFAULT_DATA.cronJobs) {
      if (!list.some((j) => j.id === job.id)) list.push({ ...job });
    }
    return list;
  }

  /**
   * Persists the whole document.
   *
   * Written to a temporary file in the same directory and then renamed, which
   * is atomic on a single filesystem: a crash or a concurrent write can never
   * leave a half-written JSON behind. Writes are also serialised through a
   * simple in-process guard, since deploys and the metrics loop both mutate
   * state from different async paths.
   */
  /** Directory holding point-in-time copies of panel_db.json. */
  historyDir(): string {
    return path.join(CONFIG.DATA_DIR, 'state-history');
  }

  /**
   * Copies the current state file aside before a destructive change.
   *
   * The atomic write already stops a half-written file, and a corrupt one is
   * quarantined. Neither helps against the failure that actually happens: a
   * *valid* save that is wrong — an import from the wrong server, a delete of
   * the wrong app. The document is rewritten whole on every mutation, so
   * without this the previous contents are gone from disk in seconds.
   *
   * Never throws. Refusing a mutation because its safety net could not be
   * written would be a worse outcome than doing it without one.
   */
  snapshot(reason: SnapshotReason): SnapshotFile | null {
    const taken = StateHistory.capture(this.filePath, this.historyDir(), reason);
    if (taken) StateHistory.prune(this.historyDir());
    return taken;
  }

  listSnapshots(): SnapshotFile[] {
    return StateHistory.list(this.historyDir());
  }

  /**
   * What a snapshot would change if restored, counted per collection.
   *
   * Counts rather than a field-level diff: the question in front of a rollback
   * button is "does this still have my 12 apps".
   */
  snapshotDelta(name: string): Record<string, { before: number; after: number; delta: number }> {
    const stored = StateHistory.read(this.historyDir(), name) as Record<string, unknown>;
    return collectionDelta(this.data as unknown as Record<string, unknown>, stored);
  }

  /**
   * Restores a snapshot through importState, so it goes through the same
   * validation and the same in-memory instance as any other write — and takes
   * its own snapshot first, because rolling back to the wrong one has to be
   * undoable too.
   */
  restoreSnapshot(name: string): DatabaseSchema {
    const stored = StateHistory.read(this.historyDir(), name) as Partial<DatabaseSchema>;
    const problems = this.validateState(stored);
    if (problems.length) {
      throw new Error(`Snapshot inválido, restauração recusada: ${problems.join(' ')}`);
    }
    return this.importState(stored);
  }

  /**
   * Recent save durations, for the SQLite migration trigger.
   *
   * The decision to keep panel state in one JSON document is right for one
   * process, and wrong past some size — the whole document is serialised and
   * fsynced on every mutation, so cost grows with total state, not with the
   * change. Measuring it means the migration is triggered by evidence rather
   * than by someone's impression that the panel "feels slow".
   */
  private saveDurations: number[] = [];

  private recordSaveDuration(ms: number): void {
    this.saveDurations.push(ms);
    if (this.saveDurations.length > 200) this.saveDurations.shift();
  }

  /** p95 of the recent saves, in ms. Zero until enough samples exist. */
  saveP95Ms(): number {
    if (this.saveDurations.length < 5) return 0;
    const sorted = [...this.saveDurations].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return Math.round(sorted[index] * 100) / 100;
  }

  private save(data?: DatabaseSchema) {
    const startedAt = Date.now();
    const toWrite = data || this.data;
    const payload = JSON.stringify(toWrite, null, 2);
    const tmpPath = path.join(
      path.dirname(this.filePath),
      `.panel_db.${process.pid}.${Date.now()}.tmp`
    );

    try {
      const fd = fs.openSync(tmpPath, 'w', 0o600);
      try {
        fs.writeFileSync(fd, payload, 'utf-8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmpPath, this.filePath);
      if (!CONFIG.IS_WINDOWS) {
        try { fs.chmodSync(this.filePath, 0o600); } catch { /* best effort */ }
      }
      this.recordSaveDuration(Date.now() - startedAt);
    } catch (err) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // best effort
      }
      console.error('Failed to save database file:', err);
      throw err;
    }
  }

  // Users
  getUsers(): User[] {
    return this.data.users;
  }

  getUserByUsername(username: string): User | undefined {
    return this.data.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  }

  addUser(user: User): User {
    this.data.users.push(user);
    this.save();
    return user;
  }

  saveUser(user: User): User {
    const idx = this.data.users.findIndex(u => u.id === user.id);
    if (idx >= 0) {
      this.data.users[idx] = user;
    } else {
      this.data.users.push(user);
    }
    this.save();
    return user;
  }

  private ensureSessions(): SessionRecord[] {
    if (!this.data.sessions) this.data.sessions = [];
    return this.data.sessions;
  }

  createSession(entry: Omit<SessionRecord, 'id' | 'createdAt' | 'lastSeenAt'> & { id?: string }): SessionRecord {
    const now = new Date().toISOString();
    const session: SessionRecord = {
      id: entry.id || `ses-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
      userId: entry.userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: entry.expiresAt,
      ip: entry.ip,
      userAgent: entry.userAgent,
    };
    const list = this.ensureSessions();
    list.push(session);
    const mine = list.filter((s) => s.userId === entry.userId && !s.revokedAt);
    if (mine.length > 20) {
      const oldest = mine.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      oldest.revokedAt = now;
    }
    this.save();
    return session;
  }

  getSession(id: string): SessionRecord | undefined {
    return this.ensureSessions().find((s) => s.id === id);
  }

  listSessions(userId?: string): SessionRecord[] {
    const list = this.ensureSessions();
    return userId ? list.filter((s) => s.userId === userId) : [...list];
  }

  touchSession(id: string): void {
    const session = this.getSession(id);
    if (!session || session.revokedAt) return;
    const now = Date.now();
    if (now - Date.parse(session.lastSeenAt) < 60_000) return;
    session.lastSeenAt = new Date(now).toISOString();
    this.save();
  }

  revokeSession(id: string): SessionRecord | undefined {
    const session = this.getSession(id);
    if (!session || session.revokedAt) return session;
    session.revokedAt = new Date().toISOString();
    this.save();
    return session;
  }

  revokeUserSessions(userId: string, exceptId?: string): number {
    const now = new Date().toISOString();
    let n = 0;
    for (const session of this.ensureSessions()) {
      if (session.userId !== userId || session.revokedAt) continue;
      if (exceptId && session.id === exceptId) continue;
      session.revokedAt = now;
      n++;
    }
    if (n) this.save();
    return n;
  }

  pruneSessions(): number {
    const now = Date.now();
    const cutoff = now - 7 * 24 * 60 * 60 * 1000;
    const before = this.ensureSessions().length;
    this.data.sessions = this.ensureSessions().filter((s) => {
      if (s.revokedAt && Date.parse(s.revokedAt) < cutoff) return false;
      if (!s.revokedAt && Date.parse(s.expiresAt) < now) return false;
      return true;
    });
    const removed = before - this.data.sessions.length;
    if (removed) this.save();
    return removed;
  }

  extendSession(id: string, expiresAt: string): SessionRecord | undefined {
    const session = this.getSession(id);
    if (!session || session.revokedAt) return undefined;
    session.expiresAt = expiresAt;
    session.lastSeenAt = new Date().toISOString();
    this.save();
    return session;
  }

  /** Snapshot of the in-memory document, for the migration export. */
  exportState(): DatabaseSchema {
    return structuredClone(this.data);
  }

  /**
   * Checks that an imported document has the shape this panel expects.
   * Returns a list of problems; an empty list means the payload is usable.
   */
  validateState(candidate: unknown): string[] {
    const problems: string[] = [];

    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return ['O conteúdo enviado não é um objeto JSON válido.'];
    }

    const obj = candidate as Record<string, unknown>;
    const arrayKeys: Array<keyof DatabaseSchema> = [
      'users',
      'databases',
      'apps',
      'deployments',
      'cronJobs',
      'domains',
      'backups',
      'firewallRules',
      'serverNodes',
      'activities',
      'alertHistory',
      'sessions',
    ];

    for (const key of arrayKeys) {
      if (obj[key] !== undefined && !Array.isArray(obj[key])) {
        problems.push(`O campo "${key}" deveria ser uma lista.`);
      }
    }

    if (!Array.isArray(obj.users) || obj.users.length === 0) {
      problems.push('O campo "users" é obrigatório e deve conter ao menos um usuário.');
    } else {
      for (const [i, u] of (obj.users as any[]).entries()) {
        if (!u || typeof u.id !== 'string' || typeof u.username !== 'string' || typeof u.passwordHash !== 'string') {
          problems.push(`users[${i}] não possui id, username e passwordHash válidos.`);
        }
        if (u && !['admin', 'developer', 'viewer'].includes(u.role)) {
          problems.push(`users[${i}] possui um perfil inválido: ${u?.role}`);
        }
      }
    }

    if (obj.settings !== undefined && (typeof obj.settings !== 'object' || obj.settings === null)) {
      problems.push('O campo "settings" deveria ser um objeto.');
    }

    return problems;
  }

  /**
   * Replaces the entire document after validation.
   *
   * Applied through the same in-memory instance and atomic write as any other
   * mutation, so the running process and the file on disk cannot diverge -
   * writing panel_db.json directly used to leave the process serving stale
   * state until the next restart.
   */
  importState(candidate: Partial<DatabaseSchema>): DatabaseSchema {
    this.snapshot('import-state');
    this.data = {
      ...DEFAULT_DATA,
      ...candidate,
      settings: {
        ...DEFAULT_DATA.settings,
        ...(candidate.settings || {}),
        alertConfig: {
          ...DEFAULT_DATA.settings.alertConfig,
          ...(candidate.settings?.alertConfig || {}),
        },
        defaultAppLimits: normalizeLimits(
          candidate.settings?.defaultAppLimits,
          DEFAULT_APP_LIMITS
        ),
        defaultDatabaseLimits: normalizeLimits(
          candidate.settings?.defaultDatabaseLimits,
          DEFAULT_DATABASE_LIMITS
        ),
      },
    };
    // Imported state may contain users from a previous installation. Bump the
    // session version so tokens issued before the import cannot survive it.
    this.data.users = this.data.users.map((user) => ({
      ...user,
      tokenVersion: (user.tokenVersion ?? 0) + 1,
    }));
    const now = new Date().toISOString();
    this.data.sessions = (this.data.sessions || []).map((s) =>
      s.revokedAt ? s : { ...s, revokedAt: now }
    );
    this.save();
    return this.data;
  }

  // Databases
  getDatabases(): DatabaseRecord[] {
    return this.data.databases;
  }

  getDatabaseById(id: string): DatabaseRecord | undefined {
    return this.data.databases.find(d => d.id === id);
  }

  saveDatabase(db: DatabaseRecord): DatabaseRecord {
    const idx = this.data.databases.findIndex(d => d.id === db.id);
    if (idx >= 0) {
      this.data.databases[idx] = db;
    } else {
      this.data.databases.push(db);
    }
    this.save();
    return db;
  }

  removeDatabase(id: string): boolean {
    this.snapshot('remove-database');
    const initialLen = this.data.databases.length;
    this.data.databases = this.data.databases.filter(d => d.id !== id);
    if (this.data.databases.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  // Apps
  getApps(): AppRecord[] {
    return this.data.apps;
  }

  getAppById(id: string): AppRecord | undefined {
    return this.data.apps.find(a => a.id === id);
  }

  saveApp(app: AppRecord): AppRecord {
    const idx = this.data.apps.findIndex(a => a.id === app.id);
    if (idx >= 0) {
      this.data.apps[idx] = app;
    } else {
      this.data.apps.push(app);
    }
    this.save();
    return app;
  }

  removeApp(id: string): boolean {
    this.snapshot('remove-app');
    const initialLen = this.data.apps.length;
    this.data.apps = this.data.apps.filter(a => a.id !== id);
    if (this.data.apps.length !== initialLen) {
      // Drop deployment metadata and file-backed logs for this app together.
      const deps = (this.data.deployments || []).filter((d) => d.appId === id);
      for (const d of deps) DeployLogStore.remove(d.appId, d.id);
      this.data.deployments = (this.data.deployments || []).filter((d) => d.appId !== id);
      DeployLogStore.removeApp(id);
      AppLogStore.removeApp(id);
      this.data.alertHistory = (this.data.alertHistory || []).filter((a) => a.appId !== id);
      this.save();
      return true;
    }
    return false;
  }

  // Deployments
  getDeployments(appId?: string): DeploymentRecord[] {
    if (!this.data.deployments) this.data.deployments = [];
    const list = appId
      ? this.data.deployments.filter(d => d.appId === appId)
      : this.data.deployments;
    // Never ship full build logs in list payloads — they live on disk now.
    return list.map((d) => ({ ...d, buildLogs: '' }));
  }

  getDeploymentById(appId: string, deploymentId: string): DeploymentRecord | undefined {
    if (!this.data.deployments) this.data.deployments = [];
    return this.data.deployments.find((d) => d.id === deploymentId && d.appId === appId);
  }

  /**
   * Returns the build log for one deployment.
   *
   * Prefers the file store; falls back to any legacy inline buildLogs left in
   * panel_db.json from before the migration, then migrates that content out.
   */
  getDeploymentLogs(appId: string, deploymentId: string): string {
    const fromFile = DeployLogStore.read(appId, deploymentId);
    if (fromFile !== null) return fromFile;

    const dep = this.getDeploymentById(appId, deploymentId);
    if (dep?.buildLogs) {
      DeployLogStore.write(appId, deploymentId, dep.buildLogs);
      dep.buildLogs = '';
      this.save();
      return DeployLogStore.read(appId, deploymentId) || '';
    }
    return '';
  }

  saveDeployment(dep: DeploymentRecord): DeploymentRecord {
    if (!this.data.deployments) this.data.deployments = [];

    // Persist logs to disk first so a crash between write and JSON save still
    // leaves the log recoverable; the JSON copy stays empty on purpose.
    if (dep.buildLogs) {
      DeployLogStore.write(dep.appId, dep.id, dep.buildLogs);
    }

    const stored: DeploymentRecord = { ...dep, buildLogs: '' };
    const idx = this.data.deployments.findIndex(d => d.id === dep.id);
    if (idx >= 0) {
      this.data.deployments[idx] = stored;
    } else {
      this.data.deployments.unshift(stored);
    }
    this.save();
    return { ...stored, buildLogs: dep.buildLogs };
  }

  // Cron Jobs
  getCronJobs(): CronJobRecord[] {
    return this.data.cronJobs || [];
  }

  saveCronJob(job: CronJobRecord): CronJobRecord {
    if (!this.data.cronJobs) this.data.cronJobs = [];
    const idx = this.data.cronJobs.findIndex(j => j.id === job.id);
    if (idx >= 0) {
      this.data.cronJobs[idx] = job;
    } else {
      this.data.cronJobs.push(job);
    }
    this.save();
    return job;
  }

  removeCronJob(id: string): boolean {
    if (!this.data.cronJobs) return false;
    const initialLen = this.data.cronJobs.length;
    this.data.cronJobs = this.data.cronJobs.filter(j => j.id !== id);
    if (this.data.cronJobs.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  // Domains
  getDomains(): DomainRecord[] {
    return this.data.domains;
  }

  saveDomain(domain: DomainRecord): DomainRecord {
    const idx = this.data.domains.findIndex(d => d.id === domain.id);
    if (idx >= 0) {
      this.data.domains[idx] = domain;
    } else {
      this.data.domains.push(domain);
    }
    this.save();
    return domain;
  }

  removeDomain(id: string): boolean {
    const initialLen = this.data.domains.length;
    this.data.domains = this.data.domains.filter(d => d.id !== id);
    if (this.data.domains.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  // Backups
  getBackups(): BackupRecord[] {
    return this.data.backups || [];
  }

  saveBackup(backup: BackupRecord): BackupRecord {
    if (!this.data.backups) this.data.backups = [];
    const idx = this.data.backups.findIndex(b => b.id === backup.id);
    if (idx >= 0) {
      this.data.backups[idx] = backup;
    } else {
      this.data.backups.unshift(backup);
    }
    this.save();
    return backup;
  }

  removeBackup(id: string): boolean {
    if (!this.data.backups) return false;
    const initialLen = this.data.backups.length;
    this.data.backups = this.data.backups.filter(b => b.id !== id);
    if (this.data.backups.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  // Firewall Rules
  getFirewallRules(): FirewallRule[] {
    return this.data.firewallRules || [];
  }

  saveFirewallRule(rule: FirewallRule): FirewallRule {
    if (!this.data.firewallRules) this.data.firewallRules = [];
    const idx = this.data.firewallRules.findIndex(r => r.id === rule.id);
    if (idx >= 0) {
      this.data.firewallRules[idx] = rule;
    } else {
      this.data.firewallRules.push(rule);
    }
    this.save();
    return rule;
  }

  removeFirewallRule(id: string): boolean {
    if (!this.data.firewallRules) return false;
    const initialLen = this.data.firewallRules.length;
    this.data.firewallRules = this.data.firewallRules.filter(r => r.id !== id);
    if (this.data.firewallRules.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  // Server Nodes (Multi-Server)
  getServerNodes(): ServerNode[] {
    return this.data.serverNodes || [];
  }

  saveServerNode(node: ServerNode): ServerNode {
    if (!this.data.serverNodes) this.data.serverNodes = [];
    const idx = this.data.serverNodes.findIndex(n => n.id === node.id);
    if (idx >= 0) {
      this.data.serverNodes[idx] = node;
    } else {
      this.data.serverNodes.push(node);
    }
    this.save();
    return node;
  }

  removeServerNode(id: string): boolean {
    if (!this.data.serverNodes) return false;
    const initialLen = this.data.serverNodes.length;
    this.data.serverNodes = this.data.serverNodes.filter(n => n.id !== id);
    if (this.data.serverNodes.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  // Users
  removeUser(id: string): boolean {
    const initialLen = this.data.users.length;
    this.data.users = this.data.users.filter(u => u.id !== id);
    if (this.data.users.length !== initialLen) {
      this.revokeUserSessions(id);
      this.save();
      return true;
    }
    return false;
  }

  // Activities (Global Timeline)
  getActivities(limit = 30): ActivityRecord[] {
    if (!this.data.activities) this.data.activities = [];
    return [...this.data.activities].reverse().slice(0, limit);
  }

  addActivity(activity: Omit<ActivityRecord, 'id' | 'timestamp'>): ActivityRecord {
    if (!this.data.activities) this.data.activities = [];
    const newRecord: ActivityRecord = {
      ...activity,
      id: `act-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
    };
    this.data.activities.push(newRecord);
    // Keep max 500 activities
    if (this.data.activities.length > 500) {
      this.data.activities = this.data.activities.slice(-500);
    }
    this.save();
    return newRecord;
  }

  getAlertHistory(appId?: string, limit = 50): AlertHistoryRecord[] {
    if (!this.data.alertHistory) this.data.alertHistory = [];
    const list = appId
      ? this.data.alertHistory.filter((a) => a.appId === appId)
      : this.data.alertHistory;
    return [...list].reverse().slice(0, limit);
  }

  addAlertHistory(entry: Omit<AlertHistoryRecord, 'id' | 'createdAt'>): AlertHistoryRecord {
    if (!this.data.alertHistory) this.data.alertHistory = [];
    const record: AlertHistoryRecord = {
      ...entry,
      id: `alrt-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      createdAt: new Date().toISOString(),
    };
    this.data.alertHistory.push(record);
    if (this.data.alertHistory.length > 200) {
      this.data.alertHistory = this.data.alertHistory.slice(-200);
    }
    this.save();
    return record;
  }

  // Storage health
  /**
   * Returns the on-disk size of the panel database and record counts.
   *
   * Used by the metrics loop to alert when the file grows beyond a threshold,
   * which would indicate unbounded growth in deployments or activities.
   */
  getStorageHealth(): {
    fileSizeBytes: number;
    fileSizeMB: number;
    recordCounts: Record<string, number>;
  } {
    let fileSizeBytes = 0;
    try {
      fileSizeBytes = fs.statSync(this.filePath).size;
    } catch { /* file may not exist yet */ }

    return {
      fileSizeBytes,
      fileSizeMB: Math.round((fileSizeBytes / 1024 / 1024) * 100) / 100,
      recordCounts: {
        users: this.data.users.length,
        apps: this.data.apps.length,
        databases: this.data.databases.length,
        deployments: this.data.deployments?.length ?? 0,
        cronJobs: this.data.cronJobs?.length ?? 0,
        domains: this.data.domains.length,
        backups: this.data.backups?.length ?? 0,
        firewallRules: this.data.firewallRules?.length ?? 0,
        serverNodes: this.data.serverNodes?.length ?? 0,
        activities: this.data.activities?.length ?? 0,
        alertHistory: this.data.alertHistory?.length ?? 0,
        sessions: this.data.sessions?.length ?? 0,
      },
    };
  }

  /**
   * Trims old deployment logs that are the main cause of unbounded growth.
   *
   * Build logs can be several hundred KB each; with frequent deploys the file
   * balloons. This keeps the most recent N per app and truncates logs on
   * older entries to a short summary.
   */
  pruneDeployments(maxPerApp: number = 30, _logTruncateLength: number = 500): number {
    this.pruneSessions();
    if (!this.data.deployments?.length) return 0;

    const byApp = new Map<string, DeploymentRecord[]>();
    for (const d of this.data.deployments) {
      const list = byApp.get(d.appId) || [];
      list.push(d);
      byApp.set(d.appId, list);
    }

    let pruned = 0;
    for (const [, deploys] of byApp) {
      // Sort newest first.
      deploys.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
      for (let i = 0; i < deploys.length; i++) {
        if (i >= maxPerApp) {
          DeployLogStore.remove(deploys[i].appId, deploys[i].id);
          this.data.deployments = this.data.deployments.filter(d => d.id !== deploys[i].id);
          pruned++;
        } else if (deploys[i].buildLogs) {
          // Migrate any leftover inline logs out of the JSON document.
          DeployLogStore.write(deploys[i].appId, deploys[i].id, deploys[i].buildLogs);
          deploys[i].buildLogs = '';
          pruned++;
        }
      }
    }

    if (pruned > 0) this.save();
    return pruned;
  }

  // Settings
  getSettings(): PanelSettings {
    return this.data.settings;
  }

  updateSettings(settings: Partial<PanelSettings>): PanelSettings {
    const merged = { ...this.data.settings, ...settings };
    // The settings route accepts an open patch, so a client sending only
    // `{ defaultAppLimits: { memoryMb: 256 } }` would drop cpus and pidsLimit.
    // Undefined there reaches Docker as "unlimited", which is the one value the
    // whole feature exists to avoid.
    merged.defaultAppLimits = normalizeLimits(merged.defaultAppLimits, DEFAULT_APP_LIMITS);
    merged.defaultDatabaseLimits = normalizeLimits(
      merged.defaultDatabaseLimits,
      DEFAULT_DATABASE_LIMITS
    );
    this.data.settings = merged;
    this.save();
    return this.data.settings;
  }
}

export const dbStorage = new JsonStorage();

