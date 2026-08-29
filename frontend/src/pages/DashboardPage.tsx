import React, { useState, useEffect } from 'react';
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
  Globe,
  Gauge,
  Zap,
  Wifi,
  X,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Radio
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';
import { OverviewData, SystemStats } from '../types/index.js';
import { NavTab } from '../components/Sidebar.js';
import { api } from '../services/api.js';

interface DashboardPageProps {
  overview: OverviewData | null;
  realtimeStats: SystemStats | null;
  setActiveTab: (tab: NavTab) => void;
}

interface MetricHistoryPoint {
  time: string;
  cpu: number;
  memory: number;
  disk: number;
  rxMbps?: number;
  txMbps?: number;
}

interface SpeedtestResult {
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number;
  jitterMs: number;
  serverLocation: string;
  isp: string;
  testedAt: string;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  overview,
  realtimeStats,
  setActiveTab,
}) => {
  const stats = realtimeStats || overview?.system;

  const [historyData, setHistoryData] = useState<MetricHistoryPoint[]>([]);
  const [activeChartMetric, setActiveChartMetric] = useState<'cpu' | 'memory' | 'network' | 'disk'>('cpu');

  // Speedtest modal state
  const [showSpeedtestModal, setShowSpeedtestModal] = useState(false);
  const [runningSpeedtest, setRunningSpeedtest] = useState(false);
  const [speedtestResult, setSpeedtestResult] = useState<SpeedtestResult | null>(null);

  const fetchHistory = async () => {
    try {
      const res = await api.get('/system/history');
      if (Array.isArray(res.data) && res.data.length > 0) {
        setHistoryData(res.data);
      }
    } catch {
      // fallback
    }
  };

  useEffect(() => {
    fetchHistory();
    const interval = setInterval(fetchHistory, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleRunSpeedtest = async () => {
    try {
      setRunningSpeedtest(true);
      setShowSpeedtestModal(true);
      const res = await api.post('/system/speedtest');
      setSpeedtestResult(res.data);
    } catch (err: any) {
      alert('Erro ao executar teste de velocidade: ' + (err.response?.data?.error || err.message));
    } finally {
      setRunningSpeedtest(false);
    }
  };

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
  const rxMbps = stats?.network.rxBytesPerSec ? Math.round(((stats.network.rxBytesPerSec * 8) / 1_000_000) * 100) / 100 : 0;
  const txMbps = stats?.network.txBytesPerSec ? Math.round(((stats.network.txBytesPerSec * 8) / 1_000_000) * 100) / 100 : 0;

  // Chart configuration based on active tab
  const getChartConfig = () => {
    switch (activeChartMetric) {
      case 'cpu':
        return {
          title: 'Histórico de Uso de CPU (%)',
          color: '#6366f1',
          dataKey: 'cpu',
          unit: '%',
          gradientId: 'cpuGrad',
          strokeColor: '#818cf8',
        };
      case 'memory':
        return {
          title: 'Histórico de Memória RAM (%)',
          color: '#10b981',
          dataKey: 'memory',
          unit: '%',
          gradientId: 'memGrad',
          strokeColor: '#34d399',
        };
      case 'network':
        return {
          title: 'Tráfego de Rede em Tempo Real (Download & Upload em Mbps)',
          color: '#06b6d4',
          dataKey: 'rxMbps',
          unit: ' Mbps',
          gradientId: 'netGrad',
          strokeColor: '#22d3ee',
        };
      case 'disk':
        return {
          title: 'Histórico de Armazenamento Disco (%)',
          color: '#f59e0b',
          dataKey: 'disk',
          unit: '%',
          gradientId: 'diskGrad',
          strokeColor: '#fbbf24',
        };
    }
  };

  const chartConfig = getChartConfig();

  return (
    <div className="space-y-6">
      {/* Header banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-indigo-950/70 via-slate-900/80 to-slate-900/80 p-6 rounded-3xl border border-indigo-500/20 shadow-2xl backdrop-blur">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Servidor Contabo Online
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {stats?.osInfo.distro} ({stats?.osInfo.arch}) • IP: {stats?.osInfo.publicIp || '13.140.41.82'}
            </span>
          </div>
          <h2 className="text-2xl font-extrabold text-white tracking-tight">
            Painel de Controle da Infraestrutura
          </h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Métricas em tempo real, deploys automatizados e monitoramento completo de rede.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleRunSpeedtest}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-semibold text-xs border border-amber-500/30 shadow-lg transition-all active:scale-95"
          >
            <Zap className="w-4 h-4 text-amber-400" />
            Teste de Velocidade (Speedtest)
          </button>
          <button
            onClick={() => setActiveTab('apps')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            Novo Deploy
          </button>
        </div>
      </div>

      {/* Real-time Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* CPU */}
        <div
          onClick={() => setActiveChartMetric('cpu')}
          className={`bg-[#0f172a]/90 rounded-3xl p-5 border transition-all cursor-pointer relative overflow-hidden shadow-xl hover:shadow-2xl ${
            activeChartMetric === 'cpu' ? 'border-indigo-500 ring-2 ring-indigo-500/20 bg-indigo-950/20' : 'border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Uso de CPU</span>
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
              <Cpu className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-3xl font-extrabold text-white tracking-tight">{cpuPercent}%</span>
            <span className="text-xs font-mono text-slate-400">{stats?.cpu.cores || 1} Núcleos</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 rounded-full ${
                cpuPercent > 85 ? 'bg-rose-500' : cpuPercent > 60 ? 'bg-amber-500' : 'bg-indigo-500'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, cpuPercent))}%` }}
            ></div>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 truncate">{stats?.cpu.brand || 'Processador da VPS'}</p>
        </div>

        {/* RAM */}
        <div
          onClick={() => setActiveChartMetric('memory')}
          className={`bg-[#0f172a]/90 rounded-3xl p-5 border transition-all cursor-pointer relative overflow-hidden shadow-xl hover:shadow-2xl ${
            activeChartMetric === 'memory' ? 'border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-950/20' : 'border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Memória RAM</span>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-3xl font-extrabold text-white tracking-tight">{memPercent}%</span>
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
        <div
          onClick={() => setActiveChartMetric('disk')}
          className={`bg-[#0f172a]/90 rounded-3xl p-5 border transition-all cursor-pointer relative overflow-hidden shadow-xl hover:shadow-2xl ${
            activeChartMetric === 'disk' ? 'border-amber-500 ring-2 ring-amber-500/20 bg-amber-950/20' : 'border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Disco SSD NVMe</span>
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
              <HardDrive className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-3xl font-extrabold text-white tracking-tight">{diskPercent}%</span>
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

        {/* Rede / Download & Upload */}
        <div
          onClick={() => setActiveChartMetric('network')}
          className={`bg-[#0f172a]/90 rounded-3xl p-5 border transition-all cursor-pointer relative overflow-hidden shadow-xl hover:shadow-2xl ${
            activeChartMetric === 'network' ? 'border-cyan-500 ring-2 ring-cyan-500/20 bg-cyan-950/20' : 'border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Tráfego de Rede</span>
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
              <Wifi className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-1.5 mt-1">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="flex items-center gap-1 text-slate-400">
                <ArrowDownRight className="w-3.5 h-3.5 text-emerald-400" /> Download:
              </span>
              <span className="text-emerald-400 font-bold">{rxMbps} Mbps</span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="flex items-center gap-1 text-slate-400">
                <ArrowUpRight className="w-3.5 h-3.5 text-indigo-400" /> Upload:
              </span>
              <span className="text-indigo-300 font-bold">{txMbps} Mbps</span>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 mt-2 truncate flex items-center gap-1">
            <Radio className="w-3 h-3 text-emerald-400 animate-pulse" /> 1Gbps Backbone Ativo
          </p>
        </div>
      </div>

      {/* Real-time Rolling Interactive Chart */}
      <div className="bg-[#0f172a]/90 rounded-3xl p-6 border border-slate-800 shadow-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-indigo-500/10 text-indigo-400">
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <span>{chartConfig.title}</span>
                <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Tempo Real (2s)
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Histórico contínuo dos recursos do servidor.</p>
            </div>
          </div>

          {/* Metric Selector Buttons */}
          <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-2xl border border-slate-800">
            <button
              onClick={() => setActiveChartMetric('cpu')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                activeChartMetric === 'cpu' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              CPU
            </button>
            <button
              onClick={() => setActiveChartMetric('memory')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                activeChartMetric === 'memory' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              RAM
            </button>
            <button
              onClick={() => setActiveChartMetric('network')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                activeChartMetric === 'network' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Rede (Mbps)
            </button>
            <button
              onClick={() => setActiveChartMetric('disk')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                activeChartMetric === 'disk' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Disco
            </button>
          </div>
        </div>

        {/* Recharts Area Container */}
        <div className="h-64 w-full pt-2">
          {historyData.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-500 text-xs">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Coletando métricas em tempo real...
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={historyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id={chartConfig.gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartConfig.color} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={chartConfig.color} stopOpacity={0.0} />
                  </linearGradient>
                  {activeChartMetric === 'network' && (
                    <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#818cf8" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#818cf8" stopOpacity={0.0} />
                    </linearGradient>
                  )}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10 }} tickLine={false} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickLine={false} domain={[0, 'auto']} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#090d16', borderColor: '#334155', borderRadius: '12px', fontSize: '11px' }}
                  itemStyle={{ color: '#e2e8f0' }}
                  labelStyle={{ color: '#94a3b8', fontWeight: 'bold' }}
                />
                <Area
                  type="monotone"
                  dataKey={chartConfig.dataKey}
                  name={activeChartMetric === 'network' ? 'Download (Mbps)' : chartConfig.title}
                  stroke={chartConfig.strokeColor}
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill={`url(#${chartConfig.gradientId})`}
                  isAnimationActive={false}
                />
                {activeChartMetric === 'network' && (
                  <Area
                    type="monotone"
                    dataKey="txMbps"
                    name="Upload (Mbps)"
                    stroke="#a5b4fc"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#txGrad)"
                    isAnimationActive={false}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Services summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div
          onClick={() => setActiveTab('apps')}
          className="bg-[#0f172a]/70 p-5 rounded-2xl border border-slate-800 hover:border-indigo-500/50 cursor-pointer transition-all hover:bg-slate-800/40 group shadow-xl"
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

        <div
          onClick={() => setActiveTab('databases')}
          className="bg-[#0f172a]/70 p-5 rounded-2xl border border-slate-800 hover:border-emerald-500/50 cursor-pointer transition-all hover:bg-slate-800/40 group shadow-xl"
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
            Postgres, MySQL, Redis persistentes e criptografados.
          </p>
        </div>

        <div
          onClick={() => setActiveTab('containers')}
          className="bg-[#0f172a]/70 p-5 rounded-2xl border border-slate-800 hover:border-cyan-500/50 cursor-pointer transition-all hover:bg-slate-800/40 group shadow-xl"
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

      {/* Speedtest Modal */}
      {showSpeedtestModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-3xl border border-slate-800 w-full max-w-lg overflow-hidden shadow-2xl p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white font-bold text-lg">
                <Zap className="w-6 h-6 text-amber-400" />
                <span>Teste de Velocidade da VPS (Speedtest)</span>
              </div>
              <button
                onClick={() => setShowSpeedtestModal(false)}
                disabled={runningSpeedtest}
                className="text-slate-400 hover:text-white disabled:opacity-30"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {runningSpeedtest ? (
              <div className="py-12 text-center space-y-4">
                <RefreshCw className="w-12 h-12 text-amber-400 animate-spin mx-auto" />
                <h4 className="font-bold text-white text-base">Testando velocidade da conexão...</h4>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Enviando e recebendo pacotes de teste via CDN de alta velocidade para medir Latência, Download e Upload.
                </p>
              </div>
            ) : speedtestResult ? (
              <div className="space-y-5">
                {/* Result Gauges */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Download */}
                  <div className="bg-slate-950 p-4 rounded-2xl border border-emerald-500/30 text-center space-y-1">
                    <span className="text-[10px] font-mono uppercase text-slate-400 flex items-center justify-center gap-1">
                      <ArrowDownRight className="w-3.5 h-3.5 text-emerald-400" /> VELOCIDADE DOWNLOAD
                    </span>
                    <div className="text-3xl font-extrabold text-emerald-400">
                      {speedtestResult.downloadMbps} <span className="text-xs font-normal">Mbps</span>
                    </div>
                  </div>

                  {/* Upload */}
                  <div className="bg-slate-950 p-4 rounded-2xl border border-indigo-500/30 text-center space-y-1">
                    <span className="text-[10px] font-mono uppercase text-slate-400 flex items-center justify-center gap-1">
                      <ArrowUpRight className="w-3.5 h-3.5 text-indigo-400" /> VELOCIDADE UPLOAD
                    </span>
                    <div className="text-3xl font-extrabold text-indigo-400">
                      {speedtestResult.uploadMbps} <span className="text-xs font-normal">Mbps</span>
                    </div>
                  </div>
                </div>

                {/* Detailed Info */}
                <div className="bg-slate-950/80 p-4 rounded-2xl border border-slate-800 space-y-2.5 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Ping (Latência):</span>
                    <span className="text-white font-bold">{speedtestResult.pingMs} ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Jitter:</span>
                    <span className="text-slate-200">{speedtestResult.jitterMs} ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Provedor / Backbone:</span>
                    <span className="text-amber-400">{speedtestResult.isp}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Localização do Servidor:</span>
                    <span className="text-slate-200">{speedtestResult.serverLocation}</span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>Velocidade excelente para hospedagem de aplicações e APIs de alto tráfego!</span>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={handleRunSpeedtest}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold"
                  >
                    Testar Novamente
                  </button>
                  <button
                    onClick={() => setShowSpeedtestModal(false)}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
