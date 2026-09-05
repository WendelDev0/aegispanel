import { createHash } from 'node:crypto';
import type { ResourceLimits } from './resource-limits.js';

export const APP_RUNTIMES = [
  'node',
  'python',
  'static',
  'go',
  'rust',
  'php',
  'java',
  'ruby',
  'bun',
  'deno',
  'docker',
] as const;
export type AppRuntime = (typeof APP_RUNTIMES)[number];

export const PACKAGE_MANAGERS = [
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'pip',
  'poetry',
  'uv',
  'pipenv',
  'go',
  'cargo',
  'composer',
  'maven',
  'gradle',
  'bundler',
  'deno',
  'docker',
] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export const CONFIG_SOURCES = ['detected', 'toml', 'manual'] as const;
export type ConfigSource = (typeof CONFIG_SOURCES)[number];

export const PROCESS_TYPES = ['web', 'worker', 'cron', 'release'] as const;
export type ProcessType = (typeof PROCESS_TYPES)[number];

export const DEPLOY_STRATEGIES = ['blue-green', 'recreate'] as const;
export type DeployStrategy = (typeof DEPLOY_STRATEGIES)[number];

export const GIT_PROVIDERS = ['github', 'gitlab', 'gitea', 'bitbucket', 'generic'] as const;
export type GitProvider = (typeof GIT_PROVIDERS)[number];

export const RUNTIME_VERSIONS: Record<AppRuntime, readonly string[]> = {
  node: ['18', '20', '22'],
  python: ['3.10', '3.11', '3.12', '3.13'],
  static: ['alpine'],
  go: ['1.21', '1.22', '1.23', '1.24'],
  rust: ['stable'],
  php: ['8.1', '8.2', '8.3'],
  java: ['17', '21'],
  ruby: ['3.2', '3.3'],
  bun: ['1'],
  deno: ['2'],
  docker: ['native'],
};

export const DEFAULT_RUNTIME_VERSION: Record<AppRuntime, string> = {
  node: '20',
  python: '3.12',
  static: 'alpine',
  go: '1.23',
  rust: 'stable',
  php: '8.3',
  java: '21',
  ruby: '3.3',
  bun: '1',
  deno: '2',
  docker: 'native',
};

export interface AppBuildConfig {
  runtime: AppRuntime;
  version?: string;
  rootDir?: string;
  dockerfilePath?: string;
  outputDir?: string;
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  packageManager?: PackageManager;
  source: ConfigSource;
}

export interface AppProcess {
  name: string;
  type: ProcessType;
  command: string;
  schedule?: string;
  replicas?: number;
  limits?: ResourceLimits;
}

export interface AppDeployPreviewConfig {
  enabled: boolean;
  maxConcurrent: number;
  ttlHours: number;
  domainPattern: string;
}

export interface AppDeployConfig {
  strategy: DeployStrategy;
  onTag?: string;
  previews?: AppDeployPreviewConfig;
  hooks?: { preDeploy?: string; postDeploy?: string };
  cache: boolean;
}

export interface AppDeployKey {
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}

export interface AppPreviewRecord {
  id: string;
  appId: string;
  prNumber: number;
  branch: string;
  headSha: string;
  domain?: string;
  containerIds: string[];
  createdAt: string;
  expiresAt: string;
  status: 'building' | 'running' | 'error' | 'expired';
}

export type BuildConfigField = keyof Omit<AppBuildConfig, 'source'>;

export type ResolvedBuildConfig = AppBuildConfig & {
  sourceByField: Record<BuildConfigField, ConfigSource>;
};

export const BUILD_CONFIG_FIELDS: BuildConfigField[] = [
  'runtime',
  'version',
  'rootDir',
  'dockerfilePath',
  'outputDir',
  'installCommand',
  'buildCommand',
  'startCommand',
  'packageManager',
];

const PROCESS_NAME = /^[a-z][a-z0-9-]{0,23}$/;
const REL_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;

export function defaultBuildConfig(runtime: AppRuntime = 'node'): AppBuildConfig {
  return {
    runtime,
    version: DEFAULT_RUNTIME_VERSION[runtime],
    source: 'detected',
  };
}

export function defaultDeployConfig(): AppDeployConfig {
  return { strategy: 'recreate', cache: true };
}

export function isAppRuntime(value: unknown): value is AppRuntime {
  return typeof value === 'string' && (APP_RUNTIMES as readonly string[]).includes(value);
}

export function isPackageManager(value: unknown): value is PackageManager {
  return typeof value === 'string' && (PACKAGE_MANAGERS as readonly string[]).includes(value);
}

export function isProcessType(value: unknown): value is ProcessType {
  return typeof value === 'string' && (PROCESS_TYPES as readonly string[]).includes(value);
}

export function isDeployStrategy(value: unknown): value is DeployStrategy {
  return typeof value === 'string' && (DEPLOY_STRATEGIES as readonly string[]).includes(value);
}

export function isGitProvider(value: unknown): value is GitProvider {
  return typeof value === 'string' && (GIT_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Versions are chosen from a fixed list so a free-form tag cannot pull an
 * arbitrary image from a public registry.
 */
export function assertRuntimeVersion(runtime: AppRuntime, version: string | undefined): string {
  const allowed = RUNTIME_VERSIONS[runtime];
  const resolved = (version || DEFAULT_RUNTIME_VERSION[runtime]).trim();
  if (!allowed.includes(resolved)) {
    throw new Error(
      `Versão "${resolved}" não é permitida para ${runtime}. Use: ${allowed.join(', ')}.`
    );
  }
  return resolved;
}

/**
 * Segment comparison, not startsWith: a value like "../etc" or "/etc" used to
 * walk out of the clone and into the panel data directory.
 */
export function assertSafeRelPath(value: string, label = 'caminho'): string {
  const trimmed = value.trim().replace(/\\/g, '/');
  if (!trimmed) throw new Error(`${label} não pode ser vazio.`);
  if (trimmed.startsWith('/') || /^[A-Za-z]:/.test(trimmed)) {
    throw new Error(`${label} deve ser relativo ao repositório.`);
  }
  const segments = trimmed.replace(/^\/+/, '').split('/').filter(Boolean);
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || !REL_PATH_SEGMENT.test(segment)) {
      throw new Error(`${label} contém um segmento inválido: "${segment}".`);
    }
  }
  return segments.join('/');
}

export function assertProcessName(name: string): string {
  const value = name.trim().toLowerCase();
  if (!PROCESS_NAME.test(value)) {
    throw new Error(
      'Nome de processo inválido. Use 1–24 caracteres: letra minúscula, depois letras, números ou hífen.'
    );
  }
  return value;
}

export function normalizeProcess(input: AppProcess): AppProcess {
  const name = assertProcessName(input.name);
  if (!isProcessType(input.type)) {
    throw new Error(`Tipo de processo inválido: ${String(input.type)}.`);
  }
  const command = String(input.command || '').trim();
  if (!command) throw new Error(`Processo "${name}" precisa de um comando.`);
  if (input.type === 'cron' && !String(input.schedule || '').trim()) {
    throw new Error(`Processo cron "${name}" precisa de um schedule.`);
  }
  const replicas = input.type === 'worker' ? clampReplicas(input.replicas) : undefined;
  return {
    name,
    type: input.type,
    command,
    schedule: input.type === 'cron' ? String(input.schedule).trim() : undefined,
    replicas,
    limits: input.limits,
  };
}

function clampReplicas(value: number | undefined): number {
  const n = Number(value ?? 1);
  if (!Number.isInteger(n) || n < 1 || n > 4) {
    throw new Error('Réplicas de worker devem ser um inteiro entre 1 e 4.');
  }
  return n;
}

/** Glob with a single trailing `*` (`v*` matches v1.2.0, not release-v1). */
export function matchTagGlob(tag: string, glob: string): boolean {
  const pattern = glob.trim();
  const value = tag.trim();
  if (!pattern || !value) return false;
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
  return value === pattern;
}

export function recipeHash(dockerfile: string): string {
  return createHash('sha256').update(dockerfile).digest('hex').slice(0, 16);
}

function present<T>(value: T | undefined | null): value is T {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function pickField<K extends BuildConfigField>(
  key: K,
  manual: Partial<AppBuildConfig> | undefined,
  toml: Partial<AppBuildConfig> | undefined,
  detected: Partial<AppBuildConfig> | undefined
): { value: AppBuildConfig[K] | undefined; source: ConfigSource } {
  const manualValue = manual?.[key];
  if (present(manualValue)) return { value: manualValue, source: 'manual' };
  const tomlValue = toml?.[key];
  if (present(tomlValue)) return { value: tomlValue, source: 'toml' };
  const detectedValue = detected?.[key];
  if (present(detectedValue)) return { value: detectedValue, source: 'detected' };
  return { value: undefined, source: 'detected' };
}

export function resolveBuildConfig(
  manual: Partial<AppBuildConfig> | undefined,
  toml: Partial<AppBuildConfig> | undefined,
  detected: Partial<AppBuildConfig> | undefined
): ResolvedBuildConfig {
  const sourceByField = {} as Record<BuildConfigField, ConfigSource>;
  const picked: Partial<AppBuildConfig> = {};
  for (const key of BUILD_CONFIG_FIELDS) {
    const result = pickField(key, manual, toml, detected);
    sourceByField[key] = result.source;
    if (result.value !== undefined) {
      (picked as Record<string, unknown>)[key] = result.value;
    }
  }

  const runtime = picked.runtime && isAppRuntime(picked.runtime) ? picked.runtime : 'node';
  if (picked.rootDir) picked.rootDir = assertSafeRelPath(picked.rootDir, 'rootDir');
  if (picked.dockerfilePath) {
    picked.dockerfilePath = assertSafeRelPath(picked.dockerfilePath, 'dockerfilePath');
  }
  if (picked.outputDir) picked.outputDir = assertSafeRelPath(picked.outputDir, 'outputDir');
  if (picked.version) picked.version = assertRuntimeVersion(runtime, picked.version);
  else picked.version = DEFAULT_RUNTIME_VERSION[runtime];

  if (picked.packageManager && !isPackageManager(picked.packageManager)) {
    throw new Error(`Gerenciador de pacotes inválido: ${String(picked.packageManager)}.`);
  }

  const source: ConfigSource =
    sourceByField.runtime === 'manual' || manual?.source === 'manual'
      ? 'manual'
      : sourceByField.runtime === 'toml'
        ? 'toml'
        : 'detected';

  return {
    runtime,
    version: picked.version,
    rootDir: picked.rootDir,
    dockerfilePath: picked.dockerfilePath,
    outputDir: picked.outputDir,
    installCommand: picked.installCommand,
    buildCommand: picked.buildCommand,
    startCommand: picked.startCommand,
    packageManager: picked.packageManager,
    source,
    sourceByField,
  };
}

export function diffBuildConfig(
  previous: Partial<AppBuildConfig> | undefined,
  next: ResolvedBuildConfig
): string[] {
  const lines: string[] = [];
  for (const key of BUILD_CONFIG_FIELDS) {
    const before = previous?.[key];
    const after = next[key];
    if (String(before ?? '') !== String(after ?? '')) {
      lines.push(`${key}: ${before ?? '—'} → ${after ?? '—'} (${next.sourceByField[key]})`);
    }
  }
  return lines;
}

export function mergeProcesses(
  manual: AppProcess[] | undefined,
  toml: AppProcess[] | undefined,
  detected: AppProcess[] | undefined
): AppProcess[] {
  if (manual && manual.length > 0) return manual.map(normalizeProcess);
  if (toml && toml.length > 0) return toml.map(normalizeProcess);
  return (detected || []).map(normalizeProcess);
}

export function cacheImageName(appName: string): string {
  const slug = appName.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'app';
  return `aegis-cache-${slug}:deps`;
}
