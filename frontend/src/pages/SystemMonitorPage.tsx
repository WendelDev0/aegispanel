import React, { useState, useEffect } from 'react';
import {
  Activity,
  Cpu,
  HardDrive,
  Globe,
  RefreshCw,
  Server,
  Layers,
  Zap
} from 'lucide-react';
import { api } from '../services/api.js';
import { SystemStats, ProcessItem } from '../types/index.js';

interface SystemMonitorPageProps {
  realtimeStats: SystemStats | null;
}

export const SystemMonitorPage: React.FC<SystemMonitorPageProps> = ({ realtimeStats }) => {
  const [processes, setProcesses] = useState<ProcessItem[]>([]);
  const [loadingProcs, setLoadingProcs] = useState(false);

  const fetchProcesses = async () => {
    try {
      setLoadingProcs(true);
      const res = await api.get('/system/processes?limit=15');
      setProcesses(res.data);
    } catch (err) {
      console.error('Failed to fetch processes:', err);
    } finally {
      setLoadingProcs(false);
    }
  };

  useEffect(() => {
    fetchProcesses();
    const interval = setInterval(fetchProcesses, 5000);
    return () => clearInterval(interval);
  }, []);

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const stats = realtimeStats;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" />
            Monitor Avançado de Recursos do Servidor
          </h2>
          <p className="text-sm text-on-surface-variant mt-1">
            Acompanhe o consumo de hardware, saúde dos discos e processos ativos da sua VPS / Homelab.
          </p>
        </div>

        <button
          onClick={fetchProcesses}
          className="flex items-center gap-2 px-3.5 py-2 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-xs font-medium border border-outline-variant transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingProcs ? 'animate-spin' : ''}`} />
          Atualizar Processos
        </button>
      </div>

      {/* Hardware specs cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* CPU Details */}
        <div className="bg-surface-container rounded-lg p-5 border border-outline-variant">
          <div className="flex items-center gap-2 text-primary font-bold text-sm mb-3">
            <Cpu className="w-4 h-4" />
            <span>Processador (CPU)</span>
          </div>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between text-on-surface-variant">
              <span>Modelo:</span>
              <span className="text-on-surface text-right truncate max-w-[160px]">
                {stats?.cpu.brand || 'N/A'}
              </span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>Núcleos Virtuais:</span>
              <span className="text-on-surface font-bold">{stats?.cpu.cores || 1} VCPU</span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>Frequência Base:</span>
              <span className="text-on-surface">{stats?.cpu.speedGhz || 0} GHz</span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>Carga Atual:</span>
              <span className="text-primary font-bold">{stats?.cpu.usagePercent || 0}%</span>
            </div>
          </div>
        </div>

        {/* Memory Details */}
        <div className="bg-surface-container rounded-lg p-5 border border-outline-variant">
          <div className="flex items-center gap-2 text-ok font-bold text-sm mb-3">
            <Activity className="w-4 h-4" />
            <span>Memória RAM</span>
          </div>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between text-on-surface-variant">
              <span>Total Instalada:</span>
              <span className="text-on-surface">{formatBytes(stats?.memory.totalBytes || 0)}</span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>Em Uso Ativo:</span>
              <span className="text-ok font-bold">{formatBytes(stats?.memory.usedBytes || 0)}</span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>Disponível / Livre:</span>
              <span className="text-on-surface">{formatBytes(stats?.memory.freeBytes || 0)}</span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>Porcentagem:</span>
              <span className="text-ok font-bold">{stats?.memory.usedPercent || 0}%</span>
            </div>
          </div>
        </div>

        {/* OS & Host Details */}
        <div className="bg-surface-container rounded-lg p-5 border border-outline-variant">
          <div className="flex items-center gap-2 text-tertiary font-bold text-sm mb-3">
            <Server className="w-4 h-4" />
            <span>Sistema Operacional</span>
          </div>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between text-on-surface-variant">
              <span>Distribuição:</span>
              <span className="text-on-surface font-bold">{stats?.osInfo.distro || 'Linux'}</span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>Versão / Kernel:</span>
              <span className="text-on-surface truncate max-w-[150px]">{stats?.osInfo.release || 'N/A'}</span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>Arquitetura:</span>
              <span className="text-on-surface uppercase">{stats?.osInfo.arch || 'x64'}</span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>Hostname:</span>
              <span className="text-on-surface">{stats?.osInfo.hostname || 'localhost'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Disks partitions */}
      <div className="bg-surface-container rounded-lg p-5 border border-outline-variant">
        <h3 className="font-bold text-white text-base mb-4 flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-warn" />
          Partições e Discos do Sistema
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {stats?.disks.map((d, idx) => (
            <div key={idx} className="bg-surface-container-low p-4 rounded border border-outline-variant space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono font-bold text-on-surface">{d.mount} ({d.fs})</span>
                <span className="font-semibold text-warn">{Math.round(d.usePercent)}%</span>
              </div>
              <div className="w-full bg-surface-container-high rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-warn rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, d.usePercent))}%` }}
                ></div>
              </div>
              <div className="flex justify-between text-[11px] font-mono text-on-surface-variant">
                <span>Usado: {formatBytes(d.usedBytes)}</span>
                <span>Total: {formatBytes(d.sizeBytes)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Processes Table */}
      <div className="bg-surface-container rounded-lg border border-outline-variant overflow-hidden">
        <div className="p-4 border-b border-outline-variant flex items-center justify-between bg-surface-container-low">
          <h3 className="font-bold text-white text-sm flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            Top Processos em Execução (Consumo de CPU e RAM)
          </h3>
          <span className="text-xs text-on-surface-variant/70 font-mono">Atualiza a cada 5s</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-surface-container-low/90 text-on-surface-variant font-semibold uppercase tracking-wider border-b border-outline-variant">
              <tr>
                <th className="py-3 px-4">PID</th>
                <th className="py-3 px-4">Nome do Processo</th>
                <th className="py-3 px-4">Usuário</th>
                <th className="py-3 px-4">CPU %</th>
                <th className="py-3 px-4">Memória %</th>
                <th className="py-3 px-4">Comando</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/60">
              {processes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-on-surface-variant/70">
                    Carregando lista de processos...
                  </td>
                </tr>
              ) : (
                processes.map((p) => (
                  <tr key={p.pid} className="hover:bg-surface-container-high/30 transition-colors">
                    <td className="py-2.5 px-4 text-on-surface-variant">{p.pid}</td>
                    <td className="py-2.5 px-4 font-bold text-on-surface">{p.name}</td>
                    <td className="py-2.5 px-4 text-on-surface-variant">{p.user}</td>
                    <td className="py-2.5 px-4">
                      <span className={`font-semibold ${p.cpu > 20 ? 'text-crit' : 'text-on-surface-variant'}`}>
                        {p.cpu}%
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-on-surface-variant">{p.mem}%</td>
                    <td className="py-2.5 px-4 text-on-surface-variant/70 truncate max-w-xs">{p.command}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
