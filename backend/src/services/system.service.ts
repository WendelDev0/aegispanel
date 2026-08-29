import si from 'systeminformation';
import os from 'os';

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
    uptimeSeconds: number;
    arch: string;
  };
}

let lastNetworkStats: { rx_sec: number; tx_sec: number } = { rx_sec: 0, tx_sec: 0 };

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

    return {
      cpu: {
        usagePercent: Math.round(currentLoad.currentLoad * 10) / 10,
        cores: cpuInfo.cores || os.cpus().length,
        brand: `${cpuInfo.manufacturer} ${cpuInfo.brand}`.trim() || 'Generic CPU',
        speedGhz: cpuInfo.speed || 0,
        temperature: cpuTemp.main || undefined,
      },
      memory: {
        totalBytes: mem.total,
        usedBytes: mem.active || (mem.total - mem.available),
        freeBytes: mem.available,
        usedPercent: Math.round(((mem.active || (mem.total - mem.available)) / mem.total) * 100 * 10) / 10,
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
        uptimeSeconds: Math.floor(time.uptime || os.uptime()),
        arch: osInformation.arch || os.arch(),
      }
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
}
