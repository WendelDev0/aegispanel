import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';
import { dbStorage } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import {
  directorySizeBytes,
  measureBuildDirs,
  planArtifactEviction,
  planImagePrune,
} from '../utils/disk-usage.js';

/**
 * Keeps DATA_DIR from filling with build leftovers.
 *
 * Two unbounded growers, neither of which anything running depends on:
 *
 *  - `builds/<appId>`: a full working copy plus whatever the package manager
 *    installed. The image was built from it and the container runs from the
 *    image; the tree is only kept so a rollback can check out an older commit.
 *  - `aegis-app-*:<deploymentId>` images: one per deploy, forever. Rollback can
 *    only reach the deployments still recorded in panel state, so the rest are
 *    unreachable by construction.
 *
 * A full disk on this host is not a degraded panel, it is a stopped one: the
 * atomic save writes a temp file first, so the panel cannot even record that it
 * ran out of space.
 */

const VERSIONED_TAG = /^(aegis-app-[a-z0-9_-]+):([A-Za-z0-9_-]{6,})$/;

export interface CleanupResult {
  freedBytes: number;
  removed: string[];
  totalBytesAfter: number;
  stillOverCap: boolean;
}

export class BuildsCleanupService {
  static buildsRoot(): string {
    return path.join(CONFIG.DATA_DIR, 'builds');
  }

  static capBytes(): number {
    const settings = dbStorage.getSettings();
    const mb = Number(settings.buildsDiskCapMb);
    // A cap of 0 or a corrupt value must not read as "no limit": that is the
    // state this service exists to prevent.
    return (Number.isFinite(mb) && mb > 0 ? mb : 5120) * 1024 * 1024;
  }

  /**
   * Removes reclaimable build artifacts until the builds tree fits the cap.
   *
   * @param skipAppId the app currently deploying; deleting its node_modules
   *        mid-build would fail the deploy that triggered this cleanup.
   */
  static enforceCap(skipAppId?: string): CleanupResult {
    const root = this.buildsRoot();
    if (!fs.existsSync(root)) {
      return { freedBytes: 0, removed: [], totalBytesAfter: 0, stillOverCap: false };
    }

    const usage = measureBuildDirs(root);
    const plan = planArtifactEviction(usage, this.capBytes(), skipAppId);

    const removed: string[] = [];
    let freed = 0;
    for (const target of plan.remove) {
      try {
        const size = directorySizeBytes(target);
        fs.rmSync(target, { recursive: true, force: true });
        removed.push(path.relative(root, target));
        freed += size;
      } catch (err: any) {
        console.warn(`Não foi possível remover ${target}: ${err?.message}`);
      }
    }

    if (removed.length) {
      console.log(
        `🧹 Limpeza de builds: ${removed.length} diretório(s) removido(s), ` +
          `${Math.round(freed / 1024 / 1024)} MB liberados.`
      );
    }

    return {
      freedBytes: freed,
      removed,
      totalBytesAfter: Math.max(0, plan.projectedBytes),
      stillOverCap: plan.stillOverCap,
    };
  }

  /**
   * Deletes versioned app images no rollback can reach.
   *
   * The three newest per app are kept even when their deployment record was
   * pruned: those are the entries the rollback UI offers, and an image missing
   * behind a visible button is worse than a few hundred MB.
   */
  static async pruneOrphanImages(): Promise<string[]> {
    const images = await dockerService.listImages();
    const liveDeploymentIds = new Set(dbStorage.getDeployments().map((d) => d.id));

    const candidates: Array<{ tag: string; appTag: string; deploymentId: string; createdMs: number }> = [];
    for (const image of images) {
      for (const tag of image.repoTags || []) {
        const match = VERSIONED_TAG.exec(tag);
        if (!match) continue;
        candidates.push({
          tag,
          appTag: match[1],
          deploymentId: match[2],
          // Docker reports seconds; everything else here is milliseconds.
          createdMs: Number(image.created) * 1000,
        });
      }
    }

    const removed: string[] = [];
    for (const tag of planImagePrune(candidates, liveDeploymentIds)) {
      try {
        await dockerService.removeImage(tag);
        removed.push(tag);
      } catch (err: any) {
        // An image still referenced by a container cannot be removed. That is
        // the daemon protecting a running workload, not a failure worth raising.
        console.warn(`Imagem ${tag} não removida: ${err?.message}`);
      }
    }

    if (removed.length) {
      console.log(`🧹 Prune de imagens: ${removed.length} tag(s) órfã(s) removida(s).`);
    }
    return removed;
  }

  /** Bytes held by each area of DATA_DIR the panel is responsible for. */
  static directoryUsage(): {
    buildsBytes: number;
    deployLogsBytes: number;
    appLogsBytes: number;
    backupsBytes: number;
    auditBytes: number;
  } {
    const at = (...segments: string[]) => path.join(CONFIG.DATA_DIR, ...segments);
    return {
      buildsBytes: directorySizeBytes(at('builds')),
      deployLogsBytes: directorySizeBytes(at('deploy-logs')),
      appLogsBytes: directorySizeBytes(at('app-logs')),
      backupsBytes: directorySizeBytes(at('backups')),
      auditBytes: directorySizeBytes(at('audit')),
    };
  }
}
