import { z } from 'zod';

const username = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/, 'usuário inválido');

const password = z.string().min(12).max(512);

/**
 * Resource ceiling for a container.
 *
 * Bounds are stated here as well as in normalizeLimits so a typo comes back as
 * a 400 naming the field, instead of being silently clamped to something the
 * user did not ask for. normalizeLimits stays the last line of defence for
 * records written by older versions.
 */
const resourceLimits = z.object({
  memoryMb: z.number().int().min(64).max(1024 * 1024),
  cpus: z.number().min(0.1).max(256),
  pidsLimit: z.number().int().min(16).max(32_768),
});

export const loginBodySchema = z
  .object({
    username: z.string().min(1),
    password: z.string().min(1).max(512),
  })
  .strict();

export const setupBodySchema = z
  .object({
    username,
    password,
    email: z.string().email().optional().or(z.literal('')),
    serverName: z.string().max(120).optional(),
  })
  .strict();

export const changePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1).max(512),
    newPassword: password,
  })
  .strict();

export const totpConfirmBodySchema = z
  .object({
    code: z.string().min(4).max(16),
  })
  .strict();

export const totpDisableBodySchema = z
  .object({
    password: z.string().min(1).max(512),
    code: z.string().min(4).max(16),
  })
  .strict();

export const createUserBodySchema = z.object({
  username,
  password,
  email: z.string().email().optional().or(z.literal('')),
  role: z.enum(['admin', 'developer', 'viewer']).optional(),
});

export const createAppBodySchema = z.object({
  name: z.string().min(1).max(64),
  sourceType: z.enum(['git', 'dockerfile', 'image']).optional(),
  gitUrl: z.string().optional(),
  branch: z.string().max(200).optional(),
  imageName: z.string().optional(),
  port: z.union([z.number(), z.string()]).optional().nullable(),
  internalPort: z.union([z.number(), z.string()]).optional().nullable(),
  env: z.record(z.string()).optional(),
  domain: z.string().optional(),
  githubToken: z.string().optional(),
  autoDeploy: z.boolean().optional(),
  deployBranch: z.string().optional(),
  nodeId: z.string().optional(),
  limits: resourceLimits.optional(),
});

export const updateAppBodySchema = z.object({
  name: z.string().min(1).max(64).optional(),
  port: z.union([z.number(), z.string(), z.literal('')]).optional().nullable(),
  internalPort: z.union([z.number(), z.string()]).optional().nullable(),
  imageName: z.string().optional(),
  gitUrl: z.string().optional(),
  branch: z.string().max(200).optional(),
  domain: z.string().optional().nullable(),
  githubToken: z.string().optional(),
  autoDeploy: z.boolean().optional(),
  deployBranch: z.string().optional(),
  nodeId: z.string().optional().nullable(),
  /** null clears the per-app ceiling and restores the global default. */
  limits: resourceLimits.optional().nullable(),
});

export const inspectRepoBodySchema = z.object({
  gitUrl: z.string().min(1),
  branch: z.string().optional(),
  githubToken: z.string().optional(),
});

export const updateEnvBodySchema = z.object({
  env: z.record(z.string()),
});

export const updateDomainBodySchema = z.object({
  domain: z.string().optional().nullable(),
});

export const deployAppBodySchema = z.object({
  commitMessage: z.string().max(500).optional(),
});

export const fileContentBodySchema = z.object({
  filePath: z.string().min(1),
  content: z.string(),
});

export const createDatabaseBodySchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/),
  type: z.enum(['postgres', 'mysql', 'mariadb', 'redis', 'mongodb']),
  port: z.union([z.number(), z.string()]).optional(),
  dbUser: z.string().optional(),
  dbPassword: z.string().optional(),
  dbName: z.string().optional(),
  withGui: z.boolean().optional(),
  limits: resourceLimits.optional(),
});

export const createCronBodySchema = z.object({
  name: z.string().min(1).max(120),
  schedule: z.string().min(1).max(120),
  type: z.enum(['shell', 'backup', 'webhook', 'restore-drill']),
  command: z.string().optional(),
  webhookUrl: z.string().optional(),
});

export const createNodeBodySchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(['vps', 'local', 'cloud']).optional(),
  hostIp: z.string().optional(),
  location: z.string().optional(),
  sshHost: z.string().optional(),
  sshPort: z.union([z.number(), z.string()]).optional(),
  sshUser: z.string().optional(),
  sshPrivateKey: z.string().optional(),
  sshPassphrase: z.string().optional(),
  sshHostFingerprint: z.string().optional(),
});

export const updateNodeBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  location: z.string().optional(),
  sshHost: z.string().optional(),
  sshPort: z.union([z.number(), z.string()]).optional(),
  sshUser: z.string().optional(),
  sshPrivateKey: z.string().optional(),
  sshPassphrase: z.string().optional(),
  sshHostFingerprint: z.string().optional(),
});

export const createDomainBodySchema = z.object({
  domain: z.string().min(1),
  targetPort: z.union([z.number(), z.string()]),
  targetContainer: z.string().optional(),
});

export const checkDnsBodySchema = z.object({
  domain: z.string().min(1),
});

export const createFirewallBodySchema = z.object({
  port: z.union([z.number(), z.string()]),
  protocol: z.enum(['tcp', 'udp', 'both']).optional(),
  action: z.enum(['allow', 'deny']).optional(),
  comment: z.string().max(200).optional(),
});

export const executeQueryBodySchema = z.object({
  databaseId: z.string().min(1),
  sql: z.string().min(1),
});

export const fileWriteBodySchema = z.object({
  path: z.string().min(1),
  content: z.string().optional(),
});

export const fileUploadBodySchema = z.object({
  path: z.string().min(1),
  base64: z.string().min(1),
});

export const fileFolderBodySchema = z.object({
  path: z.string().min(1),
});

export const installTemplateBodySchema = z.object({
  templateId: z.string().min(1),
  customPort: z.union([z.number(), z.string()]).optional(),
  customName: z.string().optional(),
  apiKey: z.string().optional(),
  postgresDbId: z.string().optional(),
  redisDbId: z.string().optional(),
  customEnv: z.record(z.string()).optional(),
});

export const upgradeAppBodySchema = z.object({
  appId: z.string().min(1),
});

export const testAlertBodySchema = z.object({
  channel: z.enum(['discord', 'telegram', 'whatsapp']),
  webhookUrl: z.string().optional(),
  botToken: z.string().optional(),
  chatId: z.string().optional(),
  apiUrl: z.string().optional(),
  apiKey: z.string().optional(),
  instance: z.string().optional(),
  recipientNumber: z.string().optional(),
});

/** Settings is a large nested patch; keep unknown keys for forward-compat. */
export const updateSettingsBodySchema = z.record(z.any());

/**
 * Import replaces the whole panel document. Shape is validated in-depth by
 * dbStorage.validateState after parse — Zod only ensures we received an object.
 */
export const importStateBodySchema = z.object({ users: z.array(z.any()).min(1) }).passthrough();

/**
 * Action routes (start/stop/restart/delete/run/toggle) must not accept a
 * payload. Clients often omit the body entirely; treat undefined/null as {}.
 */
export const emptyBodySchema = z.preprocess(
  (val) => (val === undefined || val === null ? {} : val),
  z.object({}).strict()
);

export const backupTargetBodySchema = z.object({
  provider: z.literal('s3').optional(),
  endpoint: z.string().max(500).optional(),
  region: z.string().min(1).max(80),
  bucket: z.string().min(1).max(255),
  prefix: z.string().max(200).optional(),
  accessKeyId: z.string().min(1).max(200),
  secretAccessKey: z.string().max(500).optional(),
});

export const remoteRestoreBodySchema = z.object({
  key: z.string().min(1).max(1024).refine((k) => !k.includes('..'), 'Chave inválida'),
});
