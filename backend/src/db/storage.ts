import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';
import type { UserRole } from '../middleware/auth.js';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  email?: string;
  role: UserRole;
  createdAt: string;
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
  env: Record<string, string>;
  domain?: string;
  webhookSecret?: string;
  githubToken?: string;
  autoDeploy?: boolean;
  deployBranch?: string;
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
  type: 'shell' | 'backup' | 'webhook';
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
  status: 'completed' | 'in_progress' | 'failed';
  createdAt: string;
}

export interface FirewallRule {
  id: string;
  port: number;
  protocol: 'tcp' | 'udp' | 'both';
  action: 'allow' | 'deny';
  comment: string;
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
  settings: PanelSettings;
}

const DEFAULT_DATA: DatabaseSchema = {
  users: [],
  databases: [],
  apps: [],
  deployments: [],
  activities: [],
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
    { id: 'fw-3000', port: 3000, protocol: 'tcp', action: 'allow', comment: 'AegisPanel Web Dashboard', createdAt: new Date().toISOString() },
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
    alertConfig: {
      enabled: false,
      cpuThresholdPercent: 90,
      memThresholdPercent: 85,
      diskThresholdPercent: 90,
    }
  }
};

class JsonStorage {
  private filePath: string;
  private data: DatabaseSchema;

  constructor() {
    const dataDir = CONFIG.DATA_DIR;
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
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

    // Merge one level into the defaults so a file written by an older version
    // gains newly added collections, and nested settings gain new fields
    // instead of being replaced wholesale by the stored object.
    return {
      ...DEFAULT_DATA,
      ...parsed,
      settings: {
        ...DEFAULT_DATA.settings,
        ...(parsed.settings || {}),
        alertConfig: {
          ...DEFAULT_DATA.settings.alertConfig,
          ...(parsed.settings?.alertConfig || {}),
        },
      },
    };
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
  private save(data?: DatabaseSchema) {
    const toWrite = data || this.data;
    const payload = JSON.stringify(toWrite, null, 2);
    const tmpPath = path.join(
      path.dirname(this.filePath),
      `.panel_db.${process.pid}.${Date.now()}.tmp`
    );

    try {
      const fd = fs.openSync(tmpPath, 'w');
      try {
        fs.writeFileSync(fd, payload, 'utf-8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmpPath, this.filePath);
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
      },
    };
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
    const initialLen = this.data.apps.length;
    this.data.apps = this.data.apps.filter(a => a.id !== id);
    if (this.data.apps.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  // Deployments
  getDeployments(appId?: string): DeploymentRecord[] {
    if (!this.data.deployments) this.data.deployments = [];
    if (appId) {
      return this.data.deployments.filter(d => d.appId === appId);
    }
    return this.data.deployments;
  }

  saveDeployment(dep: DeploymentRecord): DeploymentRecord {
    if (!this.data.deployments) this.data.deployments = [];
    const idx = this.data.deployments.findIndex(d => d.id === dep.id);
    if (idx >= 0) {
      this.data.deployments[idx] = dep;
    } else {
      this.data.deployments.unshift(dep);
    }
    this.save();
    return dep;
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

  // Settings
  getSettings(): PanelSettings {
    return this.data.settings;
  }

  updateSettings(settings: Partial<PanelSettings>): PanelSettings {
    this.data.settings = { ...this.data.settings, ...settings };
    this.save();
    return this.data.settings;
  }
}

export const dbStorage = new JsonStorage();

