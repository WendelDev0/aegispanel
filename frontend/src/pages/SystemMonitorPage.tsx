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
            <Activity className="w-6 h-6 text-indigo-400" />
            Monitor Avançado de Recursos do Servidor
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Acompanhe o consumo de hardware, saúde dos discos e processos ativos da sua VPS / Homelab.
          </p>
        </div>

        <button
          onClick={fetchProcesses}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingProcs ? 'animate-spin' : ''}`} />
          Atualizar Processos
        </button>
      </div>

      {/* Hardware specs cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* CPU Details */}
        <div className="bg-[#0f172a]/80 rounded-2xl p-5 border border-slate-800">
          <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm mb-3">
            <Cpu className="w-4 h-4" />
            <span>Processador (CPU)</span>
          </div>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between text-slate-400">
              <span>Modelo:</span>
              <span className="text-slate-200 text-right truncate max-w-[160px]">
                {stats?.cpu.brand || 'N/A'}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Núcleos Virtuais:</span>
              <span className="text-slate-200 font-bold">{stats?.cpu.cores || 1} VCPU</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Frequência Base:</span>
              <span className="text-slate-200">{stats?.cpu.speedGhz || 0} GHz</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Carga Atual:</span>
              <span className="text-indigo-400 font-bold">{stats?.cpu.usagePercent || 0}%</span>
            </div>
          </div>
        </div>

        {/* Memory Details */}
        <div className="bg-[#0f172a]/80 rounded-2xl p-5 border border-slate-800">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm mb-3">
            <Activity className="w-4 h-4" />
            <span>Memória RAM</span>
          </div>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between text-slate-400">
              <span>Total Instalada:</span>
              <span className="text-slate-200">{formatBytes(stats?.memory.totalBytes || 0)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Em Uso Ativo:</span>
              <span className="text-emerald-400 font-bold">{formatBytes(stats?.memory.usedBytes || 0)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Disponível / Livre:</span>
              <span className="text-slate-200">{formatBytes(stats?.memory.freeBytes || 0)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Porcentagem:</span>
              <span className="text-emerald-400 font-bold">{stats?.memory.usedPercent || 0}%</span>
            </div>
          </div>
        </div>

        {/* OS & Host Details */}
        <div className="bg-[#0f172a]/80 rounded-2xl p-5 border border-slate-800">
          <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm mb-3">
            <Server className="w-4 h-4" />
            <span>Sistema Operacional</span>
          </div>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between text-slate-400">
              <span>Distribuição:</span>
              <span className="text-slate-200 font-bold">{stats?.osInfo.distro || 'Linux'}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Versão / Kernel:</span>
              <span className="text-slate-200 truncate max-w-[150px]">{stats?.osInfo.release || 'N/A'}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Arquitetura:</span>
              <span className="text-slate-200 uppercase">{stats?.osInfo.arch || 'x64'}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Hostname:</span>
              <span className="text-slate-200">{stats?.osInfo.hostname || 'localhost'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Disks partitions */}
      <div className="bg-[#0f172a]/80 rounded-2xl p-5 border border-slate-800">
        <h3 className="font-bold text-white text-base mb-4 flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-amber-400" />
          Partições e Discos do Sistema
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {stats?.disks.map((d, idx) => (
            <div key={idx} className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono font-bold text-slate-200">{d.mount} ({d.fs})</span>
                <span className="font-semibold text-amber-400">{Math.round(d.usePercent)}%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, d.usePercent))}%` }}
                ></div>
              </div>
              <div className="flex justify-between text-[11px] font-mono text-slate-400">
                <span>Usado: {formatBytes(d.usedBytes)}</span>
                <span>Total: {formatBytes(d.sizeBytes)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Processes Table */}
      <div className="bg-[#0f172a]/80 rounded-2xl border border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <h3 className="font-bold text-white text-sm flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            Top Processos em Execução (Consumo de CPU e RAM)
          </h3>
          <span className="text-xs text-slate-500 font-mono">Atualiza a cada 5s</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-900/90 text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">PID</th>
                <th className="py-3 px-4">Nome do Processo</th>
                <th className="py-3 px-4">Usuário</th>
                <th className="py-3 px-4">CPU %</th>
                <th className="py-3 px-4">Memória %</th>
                <th className="py-3 px-4">Comando</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {processes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-500">
                    Carregando lista de processos...
                  </td>
                </tr>
              ) : (
                processes.map((p) => (
                  <tr key={p.pid} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2.5 px-4 text-slate-400">{p.pid}</td>
                    <td className="py-2.5 px-4 font-bold text-slate-200">{p.name}</td>
                    <td className="py-2.5 px-4 text-slate-400">{p.user}</td>
                    <td className="py-2.5 px-4">
                      <span className={`font-semibold ${p.cpu > 20 ? 'text-rose-400' : 'text-slate-300'}`}>
                        {p.cpu}%
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-300">{p.mem}%</td>
                    <td className="py-2.5 px-4 text-slate-500 truncate max-w-xs">{p.command}</td>
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
