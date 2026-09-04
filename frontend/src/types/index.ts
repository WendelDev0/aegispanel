export interface SystemStats {
  cpu: {
    usagePercent: number;
    cores: number;
    brand: string;
    speedGhz: number;
    temperature?: number;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usedPercent: number;
  };
  disks: Array<{
    fs: string;
    type: string;
    sizeBytes: number;
    usedBytes: number;
    availableBytes: number;
    usePercent: number;
    mount: string;
  }>;
  network: {
    rxBytesPerSec: number;
    txBytesPerSec: number;
    interfaces: string[];
  };
  osInfo: {
    platform: string;
    distro: string;
    release: string;
    hostname: string;
    publicIp?: string;
    uptimeSeconds: number;
    arch: string;
  };
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  created: number;
  ports: Array<{ ip?: string; privatePort: number; publicPort?: number; type: string }>;
  isPanelManaged?: boolean;
}

export interface DatabaseRecord {
  id: string;
  name: string;
  type: 'postgres' | 'mysql' | 'mariadb' | 'redis' | 'mongodb';
  containerId?: string;
  port: number;
  internalPort: number;
  dbUser: string;
  dbPassword?: string;
  dbName: string;
  status: 'running' | 'stopped' | 'creating' | 'error';
  connectionString: string;
  withGui?: boolean;
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

/** Container ceiling. Absent on a record means the global default applies. */
export interface ResourceLimits {
  memoryMb: number;
  cpus: number;
  pidsLimit: number;
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
  /**
   * Credentials are write-only. The API returns these booleans instead of the
   * values so a GitHub token or webhook secret never reaches the browser in a
   * list response; the webhook URL is fetched from /apps/:id/webhook on demand.
   */
  hasWebhookSecret?: boolean;
  hasGithubToken?: boolean;
  autoDeploy?: boolean;
  deployBranch?: string;
  /** Target node id. Absent = local panel machine. */
  nodeId?: string;
  /** Per-app ceiling. Absent = follows settings.defaultAppLimits. */
  limits?: ResourceLimits;
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
  schedule: string;
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

export interface BackupTargetPublic {
  provider: 's3';
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  hasSecret?: boolean;
  secretAccessKey?: string;
  lastUploadAt?: string;
  lastError?: string;
}

export interface RemoteBackupObject {
  key: string;
  sizeBytes: number;
  lastModified: string;
  sha256?: string;
}

export interface FirewallRule {
  id: string;
  port: number;
  protocol: 'tcp' | 'udp' | 'both';
  action: 'allow' | 'deny';
  comment: string;
  createdAt: string;
}

export interface ServerNode {
  id: string;
  name: string;
  type: 'vps' | 'local' | 'cloud';
  hostIp: string;
  isLocal?: boolean;
  isCurrent: boolean;
  status: 'online' | 'offline' | 'unknown' | 'error';
  location?: string;
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

export interface AlertHistoryRecord {
  id: string;
  title: string;
  message: string;
  type: 'deploy' | 'alert' | 'backup';
  isError: boolean;
  appId?: string;
  createdAt: string;
}

export interface AppMetricsSnapshot {
  appId: string;
  appName: string;
  status: AppRecord['status'];
  available: boolean;
  cpuPercent: number;
  memoryUsedBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  retainedLogBytes: number;
}

export interface AlertConfig {
  enabled: boolean;
  discordWebhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  whatsappEnabled?: boolean;
  whatsappApiUrl?: string;
  whatsappApiKey?: string;
  whatsappInstance?: string;
  whatsappRecipientNumber?: string;
  notifyOnDeploySuccess?: boolean;
  notifyOnDeployFail?: boolean;
  notifyOnHighResource?: boolean;
  notifyOnBackup?: boolean;
  cpuThresholdPercent: number;
  memThresholdPercent: number;
  diskThresholdPercent: number;
  lastAlertSentAt?: string;
}

export interface PanelSettings {
  serverName: string;
  caddyEnabled: boolean;
  panelDomain?: string;
  publicIp?: string;
  notificationEmail?: string;
  autoBackup: boolean;
  backupIntervalHours: number;
  backupTarget?: BackupTargetPublic;
  alertConfig: AlertConfig;
}

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  sizeBytes: number;
  modifiedAt: string;
  extension?: string;
}

export interface ProcessItem {
  pid: number;
  name: string;
  cpu: number;
  mem: number;
  user: string;
  command: string;
}

export interface User {
  id: string;
  username: string;
  email?: string;
  role: 'admin' | 'developer' | 'viewer';
  totpEnabled?: boolean;
  createdAt?: string;
}

export interface OverviewData {
  system: SystemStats;
  docker: {
    isAvailable: boolean;
    totalContainers: number;
    runningContainers: number;
  };
  counts: {
    apps: number;
    runningApps: number;
    databases: number;
    runningDatabases: number;
  };
  settings: PanelSettings;
  restoreDrill?: {
    at: string;
    ok: boolean;
    durationMs: number;
    error?: string;
    stale: boolean;
  } | null;
}
