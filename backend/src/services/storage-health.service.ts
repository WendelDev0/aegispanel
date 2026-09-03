import path from 'path';
import { CONFIG } from '../config.js';
import { dbStorage } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { AppLogStore } from '../utils/app-log.store.js';
import { directorySizeBytes } from '../utils/build-disk.js';

export interface ExtendedStorageHealth {
  fileSizeBytes: number;
  fileSizeMB: number;
  recordCounts: Record<string, number>;
  builds: { bytes: number; mb: number };
  images: { bytes: number; mb: number };
  logs: { bytes: number; mb: number };
  backups: { bytes: number; mb: number };
  hostDisk: {
    totalBytes: number;
    freeBytes: number;
    usePercent: number;
  };
}

function mb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

export class StorageHealthService {
  static async snapshot(): Promise<ExtendedStorageHealth> {
    const base = dbStorage.getStorageHealth();
    const buildsBytes = directorySizeBytes(path.join(CONFIG.DATA_DIR, 'builds'));
    const backupsBytes = directorySizeBytes(path.join(CONFIG.DATA_DIR, 'backups'));
    const logsBytes = AppLogStore.totalBytes();
    let imagesBytes = 0;
    try {
      imagesBytes = await dockerService.appImageBytes();
    } catch {
      imagesBytes = 0;
    }

    let hostDisk = { totalBytes: 0, freeBytes: 0, usePercent: 0 };
    try {
      // Prefer the filesystem that holds DATA_DIR so a full data disk is
      // visible even when the root partition still has space.
      const { default: si } = await import('systeminformation');
      const disks = await si.fsSize();
      const dataDir = path.resolve(CONFIG.DATA_DIR);
      const match =
        disks
          .filter((d) => d.mount && dataDir.startsWith(d.mount))
          .sort((a, b) => b.mount.length - a.mount.length)[0] || disks[0];
      if (match) {
        const totalBytes = Number(match.size) || 0;
        const usedBytes = Number(match.used) || 0;
        const freeBytes = Math.max(0, totalBytes - usedBytes);
        hostDisk = {
          totalBytes,
          freeBytes,
          usePercent: totalBytes ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0,
        };
      }
    } catch {
      /* host disk is best-effort */
    }

    return {
      ...base,
      builds: { bytes: buildsBytes, mb: mb(buildsBytes) },
      images: { bytes: imagesBytes, mb: mb(imagesBytes) },
      logs: { bytes: logsBytes, mb: mb(logsBytes) },
      backups: { bytes: backupsBytes, mb: mb(backupsBytes) },
      hostDisk,
    };
  }
}
