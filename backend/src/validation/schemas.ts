import { z } from 'zod';

const username = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/, 'usuário inválido');

const password = z.string().min(12).max(512);

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
});

export const createDatabaseBodySchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/),
  type: z.enum(['postgres', 'mysql', 'mariadb', 'redis', 'mongodb']),
  port: z.union([z.number(), z.string()]).optional(),
  dbUser: z.string().optional(),
  dbPassword: z.string().optional(),
  dbName: z.string().optional(),
  withGui: z.boolean().optional(),
});

export const createCronBodySchema = z.object({
  name: z.string().min(1).max(120),
  schedule: z.string().min(1).max(120),
  type: z.enum(['shell', 'backup', 'webhook']),
  command: z.string().optional(),
  webhookUrl: z.string().optional(),
});
