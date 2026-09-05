import fs from 'fs';
import path from 'path';
import { parseAegisToml, type AegisToml } from './aegis-toml.js';
import {
  diffBuildConfig,
  mergeProcesses,
  resolveBuildConfig,
  type AppBuildConfig,
  type AppProcess,
  type ResolvedBuildConfig,
} from './app-build.js';
import { generateRecipe as renderRecipe, type RecipeProjectType } from './app-recipes.js';
import { resolveSafePath } from './safe-path.js';

export interface ResolvedDeployBuild {
  workDir: string;
  toml?: AegisToml;
  tomlError?: string;
  resolved: ResolvedBuildConfig;
  processes: AppProcess[];
  diffs: string[];
  dockerfile: string;
  dockerignore: string;
  internalPort: number;
  warnings: string[];
  usedNativeDockerfile: boolean;
}

export function readAegisTomlFile(repoDir: string): { toml?: AegisToml; error?: string } {
  const file = path.join(repoDir, 'aegis.toml');
  if (!fs.existsSync(file)) return {};
  const parsed = parseAegisToml(fs.readFileSync(file, 'utf8'));
  if (!parsed.ok) return { error: parsed.error };
  return { toml: parsed.value };
}

export function resolveWorkDir(repoDir: string, rootDir?: string): string {
  if (!rootDir) return repoDir;
  return resolveSafePath(repoDir, rootDir);
}

export function applyRecipeToDir(
  workDir: string,
  dockerfile: string,
  dockerignore: string,
  env: Record<string, string>,
  inject: (dockerfile: string, env: Record<string, string>) => string
): void {
  if (dockerfile.trim()) {
    fs.writeFileSync(path.join(workDir, 'Dockerfile'), inject(dockerfile, env), 'utf8');
  }
  const ignorePath = path.join(workDir, '.dockerignore');
  if (!fs.existsSync(ignorePath) && dockerignore) {
    fs.writeFileSync(ignorePath, `${dockerignore}\n`, 'utf8');
  }
}

export function recipeFromResolved(
  type: RecipeProjectType,
  resolved: ResolvedBuildConfig,
  internalPort: number,
  cpuWorkers?: number
) {
  return renderRecipe({
    type,
    runtime: resolved.runtime,
    version: resolved.version || '20',
    packageManager: resolved.packageManager || 'npm',
    outputDir: resolved.outputDir,
    installCommand: resolved.installCommand,
    buildCommand: resolved.buildCommand,
    startCommand: resolved.startCommand,
    internalPort,
    cpuWorkers,
  });
}

export function mergeResolvedConfig(
  manual: AppBuildConfig | undefined,
  toml: AegisToml | undefined,
  detected: Partial<AppBuildConfig>,
  previous?: Partial<AppBuildConfig>
): { resolved: ResolvedBuildConfig; diffs: string[] } {
  const resolved = resolveBuildConfig(manual, toml?.build, detected);
  return { resolved, diffs: diffBuildConfig(previous, resolved) };
}

export function mergeResolvedProcesses(
  manual: AppProcess[] | undefined,
  toml: AegisToml | undefined,
  detected: AppProcess[] | undefined
): AppProcess[] {
  return mergeProcesses(manual, toml?.processes, detected);
}
