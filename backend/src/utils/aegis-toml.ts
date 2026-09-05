import {
  isAppRuntime,
  isDeployStrategy,
  isPackageManager,
  isProcessType,
  type AppBuildConfig,
  type AppDeployConfig,
  type AppProcess,
  type ProcessType,
} from './app-build.js';

export interface AegisToml {
  build?: Partial<AppBuildConfig>;
  processes?: AppProcess[];
  release?: { command: string };
  deploy?: Partial<AppDeployConfig>;
}

export type AegisTomlResult =
  | { ok: true; value: AegisToml }
  | { ok: false; error: string; line?: number };

type Table = Record<string, unknown>;

/**
 * Parser for the subset of TOML the panel accepts in aegis.toml.
 *
 * A full TOML library would accept inline tables, arrays of tables and dates
 * we never read; a bad file then failed with an English library message and
 * no line number. This parser only understands sections and scalar keys, and
 * names the line in Portuguese when it does not.
 */
export function parseAegisToml(text: string): AegisTomlResult {
  const tables = new Map<string, Table>();
  tables.set('', {});
  let current = '';

  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i];
    const line = stripComment(raw).trim();
    if (!line) continue;

    const section = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (section) {
      current = section[1];
      if (!tables.has(current)) tables.set(current, {});
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kv) {
      return { ok: false, error: `Linha ${lineNo}: esperado chave = valor ou [seção].`, line: lineNo };
    }

    let parsed: unknown;
    try {
      parsed = parseScalar(kv[2].trim(), lineNo);
    } catch (err: any) {
      return { ok: false, error: err.message, line: lineNo };
    }

    const table = tables.get(current) || {};
    table[kv[1]] = parsed;
    tables.set(current, table);
  }

  try {
    return { ok: true, value: interpret(tables) };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle && line[i - 1] !== '\\') inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) return line.slice(0, i);
  }
  return line;
}

function parseScalar(raw: string, lineNo: number): string | number | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (
    (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) ||
    (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)
  ) {
    return raw.slice(1, -1);
  }
  throw new Error(`Linha ${lineNo}: valor inválido. Use string entre aspas, número ou true/false.`);
}

function interpret(tables: Map<string, Table>): AegisToml {
  const result: AegisToml = {};
  const root = tables.get('') || {};
  const buildTable = { ...root, ...(tables.get('build') || {}) };
  const build = readBuild(buildTable);
  if (Object.keys(build).length) result.build = build;

  const processes: AppProcess[] = [];
  for (const [name, table] of tables) {
    if (!name.startsWith('processes.') && name !== 'processes') continue;
    if (name === 'processes') continue;
    const procName = name.slice('processes.'.length);
    processes.push(readProcess(procName, table));
  }
  const releaseTable = tables.get('release');
  if (releaseTable && typeof releaseTable.command === 'string' && releaseTable.command.trim()) {
    processes.push({
      name: 'release',
      type: 'release',
      command: releaseTable.command.trim(),
    });
    result.release = { command: releaseTable.command.trim() };
  }
  if (processes.length) result.processes = processes;

  const deployTable = tables.get('deploy');
  if (deployTable) result.deploy = readDeploy(deployTable);

  return result;
}

function readBuild(table: Table): Partial<AppBuildConfig> {
  const build: Partial<AppBuildConfig> = {};
  if (table.runtime !== undefined) {
    if (!isAppRuntime(table.runtime)) {
      throw new Error(`Runtime inválido em aegis.toml: ${String(table.runtime)}.`);
    }
    build.runtime = table.runtime;
  }
  if (typeof table.version === 'string' || typeof table.version === 'number') {
    build.version = String(table.version);
  }
  if (typeof table.root === 'string') build.rootDir = table.root;
  if (typeof table.rootDir === 'string') build.rootDir = table.rootDir;
  if (typeof table.dockerfile === 'string') build.dockerfilePath = table.dockerfile;
  if (typeof table.dockerfilePath === 'string') build.dockerfilePath = table.dockerfilePath;
  if (typeof table.output === 'string') build.outputDir = table.output;
  if (typeof table.outputDir === 'string') build.outputDir = table.outputDir;
  if (typeof table.install === 'string') build.installCommand = table.install;
  if (typeof table.build === 'string') build.buildCommand = table.build;
  if (typeof table.start === 'string') build.startCommand = table.start;
  if (table.packageManager !== undefined) {
    if (!isPackageManager(table.packageManager)) {
      throw new Error(`Gerenciador inválido em aegis.toml: ${String(table.packageManager)}.`);
    }
    build.packageManager = table.packageManager;
  }
  return build;
}

function readProcess(name: string, table: Table): AppProcess {
  const command = typeof table.command === 'string' ? table.command.trim() : '';
  if (!command) throw new Error(`Processo "${name}" em aegis.toml precisa de command.`);
  let type: ProcessType = name === 'release' ? 'release' : name === 'web' ? 'web' : 'worker';
  if (table.type !== undefined) {
    if (!isProcessType(table.type)) {
      throw new Error(`Tipo de processo inválido em [${name}]: ${String(table.type)}.`);
    }
    type = table.type;
  }
  const replicas = typeof table.replicas === 'number' ? table.replicas : undefined;
  const schedule = typeof table.schedule === 'string' ? table.schedule : undefined;
  return { name, type, command, replicas, schedule };
}

function readDeploy(table: Table): Partial<AppDeployConfig> {
  const deploy: Partial<AppDeployConfig> = {};
  if (table.strategy !== undefined) {
    if (!isDeployStrategy(table.strategy)) {
      throw new Error(`Estratégia de deploy inválida: ${String(table.strategy)}.`);
    }
    deploy.strategy = table.strategy;
  }
  if (typeof table.on_tag === 'string') deploy.onTag = table.on_tag;
  if (typeof table.onTag === 'string') deploy.onTag = table.onTag;
  if (typeof table.cache === 'boolean') deploy.cache = table.cache;
  if (typeof table.pre_deploy === 'string' || typeof table.post_deploy === 'string') {
    deploy.hooks = {
      preDeploy: typeof table.pre_deploy === 'string' ? table.pre_deploy : undefined,
      postDeploy: typeof table.post_deploy === 'string' ? table.post_deploy : undefined,
    };
  }
  return deploy;
}
