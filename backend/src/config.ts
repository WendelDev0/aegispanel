import path from 'path';
import os from 'os';
import crypto from 'crypto';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Resolves a required secret.
 *
 * In production the process refuses to boot without an explicit value: a
 * hardcoded fallback would be identical on every installation, which makes
 * every token forgeable and every encrypted record readable.
 *
 * In development a value is generated once and persisted to .env.local so
 * local sessions survive a restart without shipping a shared default.
 */
function requireSecret(name: string, minLength = 32): string {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.length >= minLength) {
    return fromEnv;
  }

  if (IS_PRODUCTION) {
    console.error(
      `\n❌ FATAL: variável de ambiente ${name} ausente ou curta demais (mínimo ${minLength} caracteres).\n` +
        `   Gere uma com:  openssl rand -hex 32\n` +
        `   e defina no arquivo .env ao lado do docker-compose.yml.\n` +
        `   O painel NÃO inicia com segredo padrão em produção.\n`
    );
    process.exit(1);
  }

  const devEnvPath = path.join(process.cwd(), '.env.local');
  try {
    if (fs.existsSync(devEnvPath)) {
      const parsed = dotenv.parse(fs.readFileSync(devEnvPath, 'utf-8'));
      if (parsed[name] && parsed[name].length >= minLength) {
        process.env[name] = parsed[name];
        return parsed[name];
      }
    }
  } catch {
    // fall through and regenerate
  }

  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.appendFileSync(devEnvPath, `${name}=${generated}\n`, 'utf-8');
    console.warn(`⚠️  ${name} gerada automaticamente para desenvolvimento e salva em .env.local`);
  } catch {
    console.warn(`⚠️  ${name} gerada em memória (não foi possível escrever .env.local)`);
  }
  process.env[name] = generated;
  return generated;
}

export const CONFIG = {
  PORT: process.env.PORT ? parseInt(process.env.PORT) : 4000,
  IS_PRODUCTION,
  JWT_SECRET: requireSecret('JWT_SECRET'),
  /**
   * Distinct from JWT_SECRET on purpose: rotating session signing keys must not
   * destroy every password encrypted at rest.
   */
  ENCRYPTION_KEY: requireSecret('ENCRYPTION_KEY'),
  DATA_DIR: process.env.DATA_DIR || path.join(process.cwd(), 'data'),
  IS_WINDOWS: os.platform() === 'win32',
  DOCKER_SOCKET: process.env.DOCKER_SOCKET || (os.platform() === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock'),
  CADDY_CONFIG_PATH: process.env.CADDY_CONFIG_PATH || path.join(process.cwd(), 'data', 'caddy', 'Caddyfile'),
  /** Caddy's shared JSON access log, the source for per-application analytics. */
  ACCESS_LOG_PATH: process.env.ACCESS_LOG_PATH || path.join(process.cwd(), 'data', 'caddy-logs', 'access.log'),
  /** Sends visitor IPs to ip-api.com to resolve country and city. */
  GEOIP_ENABLED: process.env.GEOIP_ENABLED !== 'false',

  /**
   * Local mode: this instance is a development copy, not the server that owns
   * the domains and integrations in its database.
   *
   * Defaults to on outside production, because the dangerous direction is the
   * silent one: a developer copies the panel state from a live VPS to debug
   * something, and the local copy starts requesting TLS certificates for
   * domains it does not control and firing alerts into the team's real
   * channels. Turning the guard on by default makes the safe case the one that
   * needs no thought.
   */
  LOCAL_MODE:
    process.env.AEGIS_LOCAL_MODE === 'true' ||
    (process.env.AEGIS_LOCAL_MODE !== 'false' && process.env.NODE_ENV !== 'production'),

  /** Escape hatch to send real notifications from a local instance. */
  ALLOW_OUTBOUND_ALERTS: process.env.AEGIS_ALLOW_OUTBOUND_ALERTS === 'true',
  /** Comma-separated list of allowed browser origins. Empty means same-origin only. */
  CORS_ORIGINS: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};
