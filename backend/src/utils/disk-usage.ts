import fs from 'fs';
import path from 'path';

/**
 * Disk accounting for DATA_DIR.
 *
 * Runtime logs already have a ceiling and panel_db.json is monitored, but
 * `builds/<appId>` had neither: every Git app keeps a full working copy plus
 * whatever its package manager installed, and nothing ever removed it. Twenty
 * deploys of a handful of Node apps is several GB of `node_modules` that no
 * running container depends on — the build that produced the image finished
 * long ago, and the next deploy reinstalls anyway.
 *
 * A leaf module: the eviction decision is pure so it can be tested without a
 * filesystem, and the measurement is plain fs with no service imports.
 */

/**
 * Directories a build leaves behind that can be recreated for free.
 *
 * Only package-manager and build output. The working copy itself stays: it
 * holds the git history the deploy pipeline needs to check out a specific
 * commit for a rollback.
 */
export const RECLAIMABLE_DIRS = [
  'node_modules',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.venv',
  'dist',
  'build',
  'target',
  'vendor',
] as const;

export interface ArtifactEntry {
  /** Absolute path of the reclaimable directory. */
  path: string;
  sizeBytes: number;
}

export interface BuildDirUsage {
  appId: string;
  path: string;
  sizeBytes: number;
  /** Epoch ms of the last write, used to evict the least recently built first. */
  lastUsedMs: number;
  artifacts: ArtifactEntry[];
}

export interface EvictionPlan {
  /** Absolute paths to delete, in the order they should be removed. */
  remove: string[];
  freedBytes: number;
  /** Total after the plan is applied. */
  projectedBytes: number;
  /** True when deleting every reclaimable directory still leaves us over. */
  stillOverCap: boolean;
}

/**
 * Chooses which build artifacts to delete to get under `capBytes`.
 *
 * Pure on purpose. The rules that matter are ordering rules, and they are the
 * easy thing to get wrong: evicting the app that is deploying right now would
 * delete `node_modules` out from under a running build, and evicting the most
 * recent build first would guarantee the next deploy is the slow one.
 *
 * @param skipAppId app currently deploying; its artifacts are never touched.
 */
export function planArtifactEviction(
  usage: BuildDirUsage[],
  capBytes: number,
  skipAppId?: string
): EvictionPlan {
  const total = usage.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  const plan: EvictionPlan = {
    remove: [],
    freedBytes: 0,
    projectedBytes: total,
    stillOverCap: false,
  };

  if (total <= capBytes) return plan;

  // Least recently built first: that copy is the one least likely to be
  // redeployed next, so it is the cheapest reinstall to pay for later.
  const candidates = usage
    .filter((entry) => entry.appId !== skipAppId)
    .sort((a, b) => a.lastUsedMs - b.lastUsedMs);

  for (const entry of candidates) {
    // Largest artifact first within an app, so we free the most per deletion
    // and stop touching directories sooner.
    const artifacts = [...entry.artifacts].sort((a, b) => b.sizeBytes - a.sizeBytes);
    for (const artifact of artifacts) {
      if (plan.projectedBytes <= capBytes) break;
      plan.remove.push(artifact.path);
      plan.freedBytes += artifact.sizeBytes;
      plan.projectedBytes -= artifact.sizeBytes;
    }
    if (plan.projectedBytes <= capBytes) break;
  }

  plan.stillOverCap = plan.projectedBytes > capBytes;
  return plan;
}

/**
 * Recursive size of a directory in bytes.
 *
 * Symlinks are counted as their own (tiny) entry and never followed: a cloned
 * repository can ship a link to `/` and following it would walk the host
 * filesystem — the same class of problem `resolveSafePath` guards against, met
 * here as an accounting loop instead of an access-control bypass.
 */
export function directorySizeBytes(dir: string, maxEntries = 200_000): number {
  let total = 0;
  let visited = 0;
  const stack: string[] = [dir];

  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue; // removed mid-walk, or unreadable
    }

    for (const entry of entries) {
      if (++visited > maxEntries) return total;
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      try {
        total += fs.statSync(full).size;
      } catch {
        // vanished between readdir and stat
      }
    }
  }

  return total;
}

/** Measures every `builds/<appId>` directory and the artifacts inside it. */
export function measureBuildDirs(buildsRoot: string): BuildDirUsage[] {
  let appDirs: fs.Dirent[];
  try {
    appDirs = fs.readdirSync(buildsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const usage: BuildDirUsage[] = [];
  for (const dir of appDirs) {
    if (!dir.isDirectory()) continue;
    const appPath = path.join(buildsRoot, dir.name);

    const artifacts: ArtifactEntry[] = [];
    for (const name of RECLAIMABLE_DIRS) {
      const artifactPath = path.join(appPath, name);
      try {
        if (!fs.lstatSync(artifactPath).isDirectory()) continue;
      } catch {
        continue;
      }
      artifacts.push({ path: artifactPath, sizeBytes: directorySizeBytes(artifactPath) });
    }

    let lastUsedMs = 0;
    try {
      lastUsedMs = fs.statSync(appPath).mtimeMs;
    } catch {
      // keep 0 so an unreadable directory is evicted first
    }

    usage.push({
      appId: dir.name,
      path: appPath,
      sizeBytes: directorySizeBytes(appPath),
      lastUsedMs,
      artifacts,
    });
  }

  return usage;
}

/**
 * Decides which versioned app images are safe to delete.
 *
 * Pure: the rule is "an image nothing can roll back to". Rollback restarts the
 * exact image tagged with a deployment id, so an image whose deployment record
 * is gone can never be reached again — but the three newest per app are kept
 * regardless, because those are the ones the rollback UI actually offers.
 *
 * @param tags versioned tags present on the daemon, newest first per app.
 * @param liveDeploymentIds deployment ids still recorded in panel state.
 */
export function planImagePrune(
  tags: Array<{ tag: string; appTag: string; deploymentId: string; createdMs: number }>,
  liveDeploymentIds: Set<string>,
  keepPerApp = 3
): string[] {
  const byApp = new Map<string, typeof tags>();
  for (const entry of tags) {
    const list = byApp.get(entry.appTag) || [];
    list.push(entry);
    byApp.set(entry.appTag, list);
  }

  const remove: string[] = [];
  for (const list of byApp.values()) {
    const newestFirst = [...list].sort((a, b) => b.createdMs - a.createdMs);
    for (const [index, entry] of newestFirst.entries()) {
      if (index < keepPerApp) continue;
      if (liveDeploymentIds.has(entry.deploymentId)) continue;
      remove.push(entry.tag);
    }
  }

  return remove;
}
