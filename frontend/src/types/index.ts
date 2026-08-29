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

export interface ServerNode {
  id: string;
  name: string;
  type: 'vps' | 'local' | 'cloud';
  hostIp: string;
  isCurrent: boolean;
  status: 'online' | 'offline';
  location?: string;
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
  role: string;
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
  settings: {
    serverName: string;
    caddyEnabled: boolean;
  };
}
