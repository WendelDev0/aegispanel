import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  email?: string;
  role: 'admin' | 'user';
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
  env: Record<string, string>;
  domain?: string;
  webhookSecret?: string;
  githubToken?: string;
  autoDeploy?: boolean;
  deployBranch?: string;
  status: 'running' | 'stopped' | 'building' | 'error';
  lastDeployAt?: string;
  lastCommitMessage?: string;
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

export interface AlertConfig {
  enabled: boolean;
  discordWebhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
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
  isCurrent: boolean;
  status: 'online' | 'offline';
  location?: string;
}

export interface PanelSettings {
  serverName: string;
  caddyEnabled: boolean;
  publicIp?: string;
  notificationEmail?: string;
  autoBackup: boolean;
  backupIntervalHours: number;
  alertConfig: AlertConfig;
}

interface DatabaseSchema {
  users: User[];
  databases: DatabaseRecord[];
  apps: AppRecord[];
  deployments: DeploymentRecord[];
  cronJobs: CronJobRecord[];
  domains: DomainRecord[];
  backups: BackupRecord[];
  firewallRules: FirewallRule[];
  serverNodes: ServerNode[];
  settings: PanelSettings;
}

const DEFAULT_DATA: DatabaseSchema = {
  users: [],
  databases: [],
  apps: [],
  deployments: [],
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
    { id: 'fw-4000', port: 4000, protocol: 'tcp', action: 'allow', comment: 'AegisPanel API Daemon', createdAt: new Date().toISOString() },
  ],
  serverNodes: [
    { id: 'node-local', name: 'Nó Local (Esta Máquina)', type: 'local', hostIp: '127.0.0.1', isCurrent: true, status: 'online', location: 'On-Premise' },
    { id: 'node-contabo-vps', name: 'VPS Contabo Principal', type: 'vps', hostIp: 'Pendente IP', isCurrent: false, status: 'offline', location: 'Alemanha / EUA' },
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
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        return { ...DEFAULT_DATA, ...JSON.parse(raw) };
      }
    } catch (err) {
      console.error('Error loading database file, initializing default:', err);
    }
    this.save(DEFAULT_DATA);
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }

  private save(data?: DatabaseSchema) {
    try {
      const toWrite = data || this.data;
      fs.writeFileSync(this.filePath, JSON.stringify(toWrite, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save database file:', err);
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
