import fs from 'fs';
import path from 'path';
import si from 'systeminformation';
import os from 'os';
import http from 'http';
import https from 'https';
import { CONFIG } from '../config.js';

let lastDiskSaveTime = 0;

export interface PrimaryDiskUsage {
  mount: string;
  sizeBytes: number;
  availableBytes: number;
  usePercent: number;
  freePercent: number;
}

/**
 * Usage of the filesystem the panel writes to.
 *
 * Read on its own rather than from the realtime metrics loop, which skips
 * every sample while no client is connected — the disk fills on an unattended
 * server just as fast, and the panel needs the number to warn about it.
 */
export async function primaryDiskUsage(): Promise<PrimaryDiskUsage | null> {
  try {
    const sizes = await si.fsSize();
    if (!sizes.length) return null;

    // The mount that actually holds DATA_DIR, not simply the first entry: on a
    // VPS with a separate data volume those are different disks, and warning
    // about the wrong one is worse than not warning.
    const target = path.resolve(CONFIG.DATA_DIR);
    const candidates = sizes
      .filter((disk) => disk.mount && target.startsWith(disk.mount))
      .sort((a, b) => b.mount.length - a.mount.length);
    const disk = candidates[0] || sizes[0];

    const usePercent = Math.round((disk.use ?? 0) * 10) / 10;
    return {
      mount: disk.mount,
      sizeBytes: disk.size,
      availableBytes: disk.available,
      usePercent,
      freePercent: Math.round((100 - usePercent) * 10) / 10,
    };
  } catch {
    return null;
  }
}

export interface SystemStats {
  cpu: {
    usagePercent: number;
    cores: number;
    brand: string;
    speedGhz: number;
    temperature?: number;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usedPercent: number;
  };
  disks: Array<{
    fs: string;
    type: string;
    sizeBytes: number;
    usedBytes: number;
    availableBytes: number;
    usePercent: number;
    mount: string;
  }>;
  network: {
    rxBytesPerSec: number;
    txBytesPerSec: number;
    interfaces: string[];
  };
  osInfo: {
    platform: string;
    distro: string;
    release: string;
    hostname: string;
    publicIp?: string;
    uptimeSeconds: number;
    arch: string;
  };
}

export interface MetricHistoryPoint {
  time: string;
  cpu: number;
  memory: number;
  disk: number;
  rxMbps: number;
  txMbps: number;
}

export interface SpeedtestResult {
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number;
  jitterMs: number;
  serverLocation: string;
  isp: string;
  testedAt: string;
}

let lastNetworkStats: { rx_sec: number; tx_sec: number } = { rx_sec: 0, tx_sec: 0 };
const metricsHistory: MetricHistoryPoint[] = [];
let cachedPublicIp: string = '';

// Resolve Public IP in background
async function fetchPublicIp(): Promise<string> {
  return new Promise((resolve) => {
    https.get('https://api.ipify.org?format=json', { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.ip || '');
        } catch {
          resolve('');
        }
      });
    }).on('error', () => {
      resolve('');
    });
  });
}

// Initial fetch
fetchPublicIp().then(ip => {
  if (ip) cachedPublicIp = ip;
});

export class SystemService {
  /**
   * Public address of this server, used to tell whether a domain's A record
   * actually points here. Resolved lazily and cached.
   */
  static async getPublicIp(): Promise<string> {
    if (!cachedPublicIp) {
      const ip = await fetchPublicIp();
      if (ip) cachedPublicIp = ip;
    }
    return cachedPublicIp;
  }

  static async getRealtimeStats(): Promise<SystemStats> {
    const [
      currentLoad,
      cpuInfo,
      mem,
      fsSize,
      networkStats,
      osInformation,
      time,
      cpuTemp
    ] = await Promise.all([
      si.currentLoad(),
      si.cpu(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
      si.osInfo(),
      si.time(),
      si.cpuTemperature().catch(() => ({ main: 0 }))
    ]);

    if (!cachedPublicIp) {
      fetchPublicIp().then(ip => {
        if (ip) cachedPublicIp = ip;
      });
    }

    const net = networkStats[0] || { rx_sec: 0, tx_sec: 0 };
    if (net.rx_sec !== undefined && net.tx_sec !== undefined) {
      lastNetworkStats = { rx_sec: Math.max(0, net.rx_sec), tx_sec: Math.max(0, net.tx_sec) };
    }

    const disks = fsSize.map(disk => ({
      fs: disk.fs,
      type: disk.type,
      sizeBytes: disk.size,
      usedBytes: disk.used,
      availableBytes: disk.available,
      usePercent: disk.use,
      mount: disk.mount,
    }));

    const cpuUsage = Math.round(currentLoad.currentLoad * 10) / 10;
    const memUsed = mem.active || (mem.total - mem.available);
    const memUsage = Math.round((memUsed / mem.total) * 100 * 10) / 10;
    const diskUsage = disks[0] ? Math.round(disks[0].usePercent) : 0;
    const rxMbps = Math.round(((lastNetworkStats.rx_sec * 8) / 1_000_000) * 100) / 100;
    const txMbps = Math.round(((lastNetworkStats.tx_sec * 8) / 1_000_000) * 100) / 100;

    // Record history (Brasília Time UTC-3)
    const nowTimestamp = Date.now();
    const nowStr = new Date(nowTimestamp).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const point: MetricHistoryPoint = {
      time: nowStr,
      cpu: cpuUsage,
      memory: memUsage,
      disk: diskUsage,
      rxMbps,
      txMbps,
    };

    metricsHistory.push(point);
    if (metricsHistory.length > 50) {
      metricsHistory.shift();
    }

    // Persist to disk periodically (every 30 seconds)
    try {
      const metricsFilePath = path.join(CONFIG.DATA_DIR, 'metrics_persistent.json');
      if (nowTimestamp - lastDiskSaveTime > 30000) {
        lastDiskSaveTime = nowTimestamp;
        let persistentList: Array<MetricHistoryPoint & { timestamp: number }> = [];
        if (fs.existsSync(metricsFilePath)) {
          try {
            persistentList = JSON.parse(fs.readFileSync(metricsFilePath, 'utf-8'));
          } catch {
            persistentList = [];
          }
        }
        persistentList.push({ ...point, timestamp: nowTimestamp });
        // One point every 30s: 20160 points is roughly a week of history.
        if (persistentList.length > 20160) {
          persistentList = persistentList.slice(-20160);
        }
        // Written through a temporary file: this rewrites the whole history
        // every 30 seconds, and a crash mid-write would otherwise leave a
        // truncated file that the next read discards entirely.
        const tmpPath = `${metricsFilePath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(persistentList), 'utf-8');
        fs.renameSync(tmpPath, metricsFilePath);
      }
    } catch {
      // ignore
    }

    return {
      cpu: {
        usagePercent: cpuUsage,
        cores: cpuInfo.cores || os.cpus().length,
        brand: `${cpuInfo.manufacturer} ${cpuInfo.brand}`.trim() || 'Generic CPU',
        speedGhz: cpuInfo.speed || 0,
        temperature: cpuTemp.main || undefined,
      },
      memory: {
        totalBytes: mem.total,
        usedBytes: memUsed,
        freeBytes: mem.available,
        usedPercent: memUsage,
      },
      disks,
      network: {
        rxBytesPerSec: lastNetworkStats.rx_sec || 0,
        txBytesPerSec: lastNetworkStats.tx_sec || 0,
        interfaces: networkStats.map(n => n.iface),
      },
      osInfo: {
        platform: osInformation.platform,
        distro: osInformation.distro || os.type(),
        release: osInformation.release || os.release(),
        hostname: osInformation.hostname || os.hostname(),
        publicIp: cachedPublicIp || undefined,
        uptimeSeconds: Math.floor(time.uptime || os.uptime()),
        arch: osInformation.arch || os.arch(),
      }
    };
  }

  static getMetricsHistory(): MetricHistoryPoint[] {
    return metricsHistory;
  }

  /**
   * Historical metrics actually measured by this server.
   *
   * Returns only recorded points. An earlier version synthesised a plausible
   * looking series with sin/cos around the latest reading whenever there was
   * not enough history, so a freshly installed panel showed a full week of
   * invented CPU and network activity that a user could not tell from real
   * measurements.
   */
  static getHistoricalMetrics(
    range: string = 'realtime',
    startDate?: string,
    endDate?: string
  ): { points: MetricHistoryPoint[]; collectedSince: string | null; complete: boolean } {
    if (range === 'realtime') {
      return { points: metricsHistory, collectedSince: null, complete: true };
    }

    let list: Array<MetricHistoryPoint & { timestamp: number }> = [];
    try {
      const metricsFilePath = path.join(CONFIG.DATA_DIR, 'metrics_persistent.json');
      if (fs.existsSync(metricsFilePath)) {
        const parsed = JSON.parse(fs.readFileSync(metricsFilePath, 'utf-8'));
        if (Array.isArray(parsed)) list = parsed;
      }
    } catch {
      // A damaged history file is not worth failing the request over.
      list = [];
    }

    if (list.length === 0) {
      return { points: [], collectedSince: null, complete: false };
    }

    const now = Date.now();
    const windowMs: Record<string, number> = {
      '1d': 24 * 3600 * 1000,
      '2d': 48 * 3600 * 1000,
      '3d': 72 * 3600 * 1000,
      '7d': 7 * 24 * 3600 * 1000,
    };

    let points: Array<MetricHistoryPoint & { timestamp: number }>;
    let cutoff: number;

    if (range === 'custom' && startDate && endDate) {
      const startMs = new Date(startDate).getTime();
      const endMs = new Date(endDate).getTime();
      cutoff = startMs;
      points = list.filter((p) => p.timestamp >= startMs && p.timestamp <= endMs);
    } else {
      cutoff = now - (windowMs[range] ?? windowMs['1d']);
      points = list.filter((p) => p.timestamp >= cutoff);
    }

    const oldest = list[0]?.timestamp ?? now;

    return {
      points: points.map(({ timestamp, ...rest }) => rest),
      collectedSince: new Date(oldest).toISOString(),
      // False when collection started after the requested window began, so the
      // chart can say "coletando desde X" instead of implying a gap in traffic.
      complete: oldest <= cutoff,
    };
  }

  static async getTopProcesses(limit = 10) {
    try {
      const processes = await si.processes();
      return processes.list
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, limit)
        .map(p => ({
          pid: p.pid,
          name: p.name,
          cpu: Math.round(p.cpu * 10) / 10,
          mem: Math.round(p.mem * 10) / 10,
          user: p.user,
          command: p.command,
        }));
    } catch (err) {
      console.error('Error fetching processes:', err);
      return [];
    }
  }

  /**
   * Real Network Speedtest Engine
   * Measures Latency (Ping), Jitter, Download Speed (Mbps) and Upload Speed (Mbps)
   */
  /**
   * Measures the server's own bandwidth against Cloudflare.
   *
   * Reports what was actually measured. The previous version floored the
   * result with Math.max(downloadMbps, 120.5) and returned a hardcoded ISP and
   * location, so a saturated or throttled link always looked healthy, and the
   * error paths invented byte counts to keep the numbers plausible.
   */
  static async runSpeedtest(): Promise<SpeedtestResult> {
    // 1. Latency and jitter, plus the edge location Cloudflare answered from.
    const pings: number[] = [];
    let colo = '';

    for (let i = 0; i < 4; i++) {
      const start = Date.now();
      const body = await new Promise<string>((resolve) => {
        https
          .get('https://speed.cloudflare.com/cdn-cgi/trace', { timeout: 3000 }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve(data));
          })
          .on('error', () => resolve(''))
          .on('timeout', function (this: any) {
            this.destroy();
            resolve('');
          });
      });

      if (body) {
        pings.push(Date.now() - start);
        const match = body.match(/^colo=(.+)$/m);
        if (match) colo = match[1].trim();
      }
    }

    if (pings.length === 0) {
      throw new Error(
        'Não foi possível alcançar o servidor de teste. Verifique a conectividade de saída deste servidor.'
      );
    }

    const avgPing = Math.round(pings.reduce((a, b) => a + b, 0) / pings.length);
    const jitter =
      pings.length > 1
        ? Math.round(
            pings.reduce((acc, p) => acc + Math.abs(p - avgPing), 0) / pings.length
          )
        : 0;

    // 2. Download.
    const download = await new Promise<{ bytes: number; seconds: number } | null>((resolve) => {
      let bytes = 0;
      const start = Date.now();
      const req = https.get(
        'https://speed.cloudflare.com/__down?bytes=10000000',
        { timeout: 20000 },
        (res) => {
          res.on('data', (chunk) => (bytes += chunk.length));
          res.on('end', () => resolve({ bytes, seconds: (Date.now() - start) / 1000 }));
        }
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
    });

    if (!download || download.bytes === 0) {
      throw new Error('Falha ao medir a velocidade de download.');
    }

    // 3. Upload.
    const uploadPayload = Buffer.alloc(3 * 1024 * 1024, 'a');
    const upload = await new Promise<{ bytes: number; seconds: number } | null>((resolve) => {
      const start = Date.now();
      const req = https.request(
        'https://speed.cloudflare.com/__up',
        {
          method: 'POST',
          timeout: 20000,
          headers: { 'Content-Length': uploadPayload.length },
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve({ bytes: uploadPayload.length, seconds: (Date.now() - start) / 1000 }));
        }
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.write(uploadPayload);
      req.end();
    });

    const toMbps = (bytes: number, seconds: number) =>
      Math.round(((bytes * 8) / (Math.max(seconds, 0.001) * 1_000_000)) * 10) / 10;

    return {
      downloadMbps: toMbps(download.bytes, download.seconds),
      uploadMbps: upload ? toMbps(upload.bytes, upload.seconds) : 0,
      pingMs: avgPing,
      jitterMs: jitter,
      serverLocation: colo ? `Cloudflare ${colo}` : 'Cloudflare (edge não identificado)',
      isp: cachedPublicIp ? `IP público ${cachedPublicIp}` : 'desconhecido',
      testedAt: new Date().toISOString(),
    };
  }
}
