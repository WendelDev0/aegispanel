import si from 'systeminformation';
import os from 'os';
import http from 'http';
import https from 'https';

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

    // Record history
    const nowStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    metricsHistory.push({
      time: nowStr,
      cpu: cpuUsage,
      memory: memUsage,
      disk: diskUsage,
    });
    if (metricsHistory.length > 25) {
      metricsHistory.shift();
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
}
