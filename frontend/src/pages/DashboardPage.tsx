import React from 'react';
import {
  Cpu,
  HardDrive,
  Activity,
  Layers,
  Database,
  Boxes,
  ArrowUpRight,
  ArrowDownRight,
  Server,
  Plus,
  Play,
  Square,
  RefreshCw,
  Terminal,
  Globe
} from 'lucide-react';
import { OverviewData, SystemStats } from '../types/index.js';
import { NavTab } from '../components/Sidebar.js';

interface DashboardPageProps {
  overview: OverviewData | null;
  realtimeStats: SystemStats | null;
  setActiveTab: (tab: NavTab) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  overview,
  realtimeStats,
  setActiveTab,
}) => {
  const stats = realtimeStats || overview?.system;

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const cpuPercent = stats?.cpu.usagePercent || 0;
  const memPercent = stats?.memory.usedPercent || 0;
  const disk = stats?.disks[0];
  const diskPercent = disk ? Math.round(disk.usePercent) : 0;

  return (
    <div className="space-y-6">
      {/* Header banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-indigo-950/60 via-slate-900/60 to-slate-900/60 p-6 rounded-2xl border border-indigo-500/20 backdrop-blur">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Servidor Online
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {stats?.osInfo.distro} ({stats?.osInfo.arch})
            </span>
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Painel de Controle da Infraestrutura
          </h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Gerencie seus deploys, contêineres e bancos de dados sem intermediários.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('apps')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            Novo Deploy
          </button>
          <button
            onClick={() => setActiveTab('databases')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm border border-slate-700 transition-all active:scale-95"
          >
            <Database className="w-4 h-4 text-emerald-400" />
            Criar Banco
          </button>
        </div>
      </div>

      {/* Real-time Metric Gauges */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* CPU */}
        <div className="bg-[#0f172a]/70 rounded-2xl p-5 border border-slate-800 backdrop-blur relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Uso de CPU</span>
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
              <Cpu className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-3xl font-bold text-white tracking-tight">{cpuPercent}%</span>
            <span className="text-xs font-mono text-slate-400">{stats?.cpu.cores || 1} Núcleos</span>
          </div>
          {/* Progress bar */}
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 rounded-full ${
                cpuPercent > 85 ? 'bg-rose-500' : cpuPercent > 60 ? 'bg-amber-500' : 'bg-indigo-500'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, cpuPercent))}%` }}
            ></div>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 truncate">{stats?.cpu.brand || 'Processador do Servidor'}</p>
        </div>

        {/* RAM */}
        <div className="bg-[#0f172a]/70 rounded-2xl p-5 border border-slate-800 backdrop-blur relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Memória RAM</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-3xl font-bold text-white tracking-tight">{memPercent}%</span>
            <span className="text-xs font-mono text-slate-400">
              {formatBytes(stats?.memory.usedBytes || 0)} / {formatBytes(stats?.memory.totalBytes || 0)}
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 rounded-full ${
                memPercent > 85 ? 'bg-rose-500' : memPercent > 70 ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, memPercent))}%` }}
            ></div>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Livre: {formatBytes(stats?.memory.freeBytes || 0)}</p>
        </div>

        {/* Disco */}
        <div className="bg-[#0f172a]/70 rounded-2xl p-5 border border-slate-800 backdrop-blur relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Armazenamento Disco</span>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
              <HardDrive className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-3xl font-bold text-white tracking-tight">{diskPercent}%</span>
            <span className="text-xs font-mono text-slate-400">
              {formatBytes(disk?.usedBytes || 0)} / {formatBytes(disk?.sizeBytes || 0)}
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 rounded-full ${
                diskPercent > 85 ? 'bg-rose-500' : 'bg-amber-500'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, diskPercent))}%` }}
            ></div>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Disponível: {formatBytes(disk?.availableBytes || 0)}</p>
        </div>

        {/* Rede / Tráfego */}
        <div className="bg-[#0f172a]/70 rounded-2xl p-5 border border-slate-800 backdrop-blur relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Tráfego de Rede</span>
            <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
              <Globe className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-2 mt-1">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="flex items-center gap-1 text-slate-400">
                <ArrowDownRight className="w-3.5 h-3.5 text-emerald-400" /> Download:
              </span>
              <span className="text-slate-200 font-semibold">{formatBytes(stats?.network.rxBytesPerSec || 0)}/s</span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="flex items-center gap-1 text-slate-400">
                <ArrowUpRight className="w-3.5 h-3.5 text-indigo-400" /> Upload:
              </span>
              <span className="text-slate-200 font-semibold">{formatBytes(stats?.network.txBytesPerSec || 0)}/s</span>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-3 truncate">
            {stats?.network.interfaces.length || 1} interface(s) ativa(s)
          </p>
        </div>
      </div>

      {/* Services summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Apps Card */}
        <div
          onClick={() => setActiveTab('apps')}
          className="bg-[#0f172a]/70 p-5 rounded-2xl border border-slate-800 hover:border-indigo-500/50 cursor-pointer transition-all hover:bg-slate-800/40 group"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Layers className="w-5 h-5" />
            </div>
            <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2.5 py-1 rounded-full font-semibold">
              {overview?.counts.runningApps || 0} Ativos
            </span>
          </div>
          <h3 className="text-lg font-bold text-white group-hover:text-indigo-400 transition-colors">
            Aplicações Web (PaaS)
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            {overview?.counts.apps || 0} aplicações configuradas no servidor.
          </p>
        </div>

        {/* Databases Card */}
        <div
          onClick={() => setActiveTab('databases')}
          className="bg-[#0f172a]/70 p-5 rounded-2xl border border-slate-800 hover:border-emerald-500/50 cursor-pointer transition-all hover:bg-slate-800/40 group"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Database className="w-5 h-5" />
            </div>
            <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2.5 py-1 rounded-full font-semibold">
              {overview?.counts.runningDatabases || 0} Rodando
            </span>
          </div>
          <h3 className="text-lg font-bold text-white group-hover:text-emerald-400 transition-colors">
            Bancos de Dados
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Postgres, MySQL, Redis e Mongo persistentes com backup.
          </p>
        </div>

        {/* Docker Containers Card */}
        <div
          onClick={() => setActiveTab('containers')}
          className="bg-[#0f172a]/70 p-5 rounded-2xl border border-slate-800 hover:border-cyan-500/50 cursor-pointer transition-all hover:bg-slate-800/40 group"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Boxes className="w-5 h-5" />
            </div>
            <span className="text-xs bg-cyan-500/20 text-cyan-300 px-2.5 py-1 rounded-full font-semibold">
              {overview?.docker.runningContainers || 0} Contêineres
            </span>
          </div>
          <h3 className="text-lg font-bold text-white group-hover:text-cyan-400 transition-colors">
            Docker Engine
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            {overview?.docker.totalContainers || 0} contêineres instalados no host.
          </p>
        </div>
      </div>

      {/* Quick shortcuts / Architecture recommendations */}
      <div className="bg-[#0f172a]/60 rounded-2xl p-6 border border-slate-800">
        <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
          <Terminal className="w-4 h-4 text-indigo-400" />
          Ações Rápidas & Guia de Infraestrutura
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
          <div
            onClick={() => setActiveTab('terminal')}
            className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50 hover:bg-slate-800 cursor-pointer transition-colors"
          >
            <div className="font-semibold text-slate-200 mb-1">💻 Abrir Terminal Web SSH</div>
            <p className="text-slate-400">Acesse a linha de comando do servidor diretamente pelo navegador.</p>
          </div>

          <div
            onClick={() => setActiveTab('domains')}
            className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50 hover:bg-slate-800 cursor-pointer transition-colors"
          >
            <div className="font-semibold text-slate-200 mb-1">🔒 Configurar Domínio + SSL</div>
            <p className="text-slate-400">Apontamento automático de certificado HTTPS grátis via Caddy Proxy.</p>
          </div>

          <div
            onClick={() => setActiveTab('monitor')}
            className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50 hover:bg-slate-800 cursor-pointer transition-colors"
          >
            <div className="font-semibold text-slate-200 mb-1">📊 Monitor de Processos</div>
            <p className="text-slate-400">Veja quais programas ou containers estão usando mais CPU e memória.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
