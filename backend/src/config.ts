import path from 'path';
import os from 'os';
import dotenv from 'dotenv';

dotenv.config();

export const CONFIG = {
  PORT: process.env.PORT ? parseInt(process.env.PORT) : 4000,
  JWT_SECRET: process.env.JWT_SECRET || 'aegis-vps-super-secret-jwt-key-2026',
  DATA_DIR: process.env.DATA_DIR || path.join(process.cwd(), 'data'),
  IS_WINDOWS: os.platform() === 'win32',
  DOCKER_SOCKET: process.env.DOCKER_SOCKET || (os.platform() === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock'),
  CADDY_CONFIG_PATH: process.env.CADDY_CONFIG_PATH || path.join(process.cwd(), 'data', 'caddy', 'Caddyfile'),
};
