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
  Radio,
  Calendar,
  Filter,
  SlidersHorizontal,
  TrendingUp,
  BarChart3
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from 'recharts';
import { OverviewData, SystemStats, ActivityRecord } from '../types/index.js';
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
  const [activeChartMetric, setActiveChartMetric] = useState<'all' | 'cpu' | 'memory' | 'network' | 'disk'>('all');
  const [activeTimeRange, setActiveTimeRange] = useState<'realtime' | '1d' | '2d' | '3d' | '7d' | 'custom'>('realtime');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [showCustomDateModal, setShowCustomDateModal] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Speedtest modal state
  const [showSpeedtestModal, setShowSpeedtestModal] = useState(false);
  const [runningSpeedtest, setRunningSpeedtest] = useState(false);
  const [speedtestResult, setSpeedtestResult] = useState<SpeedtestResult | null>(null);

  // Global Activity Timeline State
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [activityFilter, setActivityFilter] = useState<'all' | 'deploy' | 'domain' | 'database' | 'alert'>('all');
  const [loadingActivities, setLoadingActivities] = useState(false);

  const fetchActivities = async () => {
    try {
      setLoadingActivities(true);
      const res = await api.get('/system/activities');
      if (Array.isArray(res.data)) {
        setActivities(res.data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingActivities(false);
    }
  };

  const fetchHistory = async (range = activeTimeRange) => {
    try {
      const res = await api.get('/system/history', {
        params: {
          range,
          startDate: customStartDate || undefined,
          endDate: customEndDate || undefined,
        },
      });
      if (Array.isArray(res.data) && res.data.length > 0) {
        setHistoryData(res.data);
      }
    } catch {
      // fallback
    }
  };

  useEffect(() => {
    fetchHistory(activeTimeRange);
    fetchActivities();
    if (activeTimeRange === 'realtime') {
      const interval = setInterval(() => {
        fetchHistory('realtime');
        fetchActivities();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [activeTimeRange, customStartDate, customEndDate]);

  const handleTimeRangeChange = (range: 'realtime' | '1d' | '2d' | '3d' | '7d' | 'custom') => {
    if (range === 'custom') {
      setShowCustomDateModal(true);
      return;
    }
    setActiveTimeRange(range);
  };

  const handleApplyCustomDates = (e: React.FormEvent) => {
    e.preventDefault();
    setShowCustomDateModal(false);
    setActiveTimeRange('custom');
    fetchHistory('custom');
  };

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

  // Calculate summary metrics for the selected time range
  const avgCpu = historyData.length > 0
    ? Math.round((historyData.reduce((acc, curr) => acc + curr.cpu, 0) / historyData.length) * 10) / 10
    : cpuPercent;
  const maxCpu = historyData.length > 0
    ? Math.max(...historyData.map(h => h.cpu))
    : cpuPercent;
  const avgMem = historyData.length > 0
    ? Math.round((historyData.reduce((acc, curr) => acc + curr.memory, 0) / historyData.length) * 10) / 10
    : memPercent;
  const maxRx = historyData.length > 0
    ? Math.max(...historyData.map(h => h.rxMbps || 0))
    : rxMbps;

  return (
    <div className="space-y-6">
      {/* Header banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-indigo-950/70 via-slate-900/80 to-slate-900/80 p-6 rounded-3xl border border-indigo-500/20 shadow-2xl backdrop-blur">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Servidor Online
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

      {/* Real-time Rolling Multi-Metric & Timeframe Chart Container */}
      <div className="bg-[#0f172a]/90 rounded-3xl p-6 border border-slate-800 shadow-2xl space-y-5">
        {/* Top Controls: Metric Filter + Time Range Filter */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-indigo-500/10 text-indigo-400">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <span>Análise de Desempenho e Recursos</span>
                {activeTimeRange === 'realtime' && (
                  <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    Ao Vivo
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {activeTimeRange === 'realtime'
                  ? 'Visualizando métricas instantâneas em tempo real'
                  : `Histórico acumulado do período selecionado (${activeTimeRange.toUpperCase()})`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Metric Filter Tabs */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-2xl border border-slate-800">
              <button
                onClick={() => setActiveChartMetric('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  activeChartMetric === 'all' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                Todos
              </button>
              <button
                onClick={() => setActiveChartMetric('cpu')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  activeChartMetric === 'cpu' ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                CPU
              </button>
              <button
                onClick={() => setActiveChartMetric('memory')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  activeChartMetric === 'memory' ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                RAM
              </button>
              <button
                onClick={() => setActiveChartMetric('disk')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  activeChartMetric === 'disk' ? 'bg-amber-500/30 text-amber-300 border border-amber-500/40 shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                Disco
              </button>
              <button
                onClick={() => setActiveChartMetric('network')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  activeChartMetric === 'network' ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                Rede
              </button>
            </div>

            {/* Timeframe Filter Tabs: 1d, 2d, 3d, 7d, custom */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-2xl border border-slate-800">
              <button
                onClick={() => handleTimeRangeChange('realtime')}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  activeTimeRange === 'realtime' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                Tempo Real
              </button>
              <button
                onClick={() => handleTimeRangeChange('1d')}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  activeTimeRange === '1d' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                1 Dia
              </button>
              <button
                onClick={() => handleTimeRangeChange('2d')}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  activeTimeRange === '2d' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                2 Dias
              </button>
              <button
                onClick={() => handleTimeRangeChange('3d')}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  activeTimeRange === '3d' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                3 Dias
              </button>
              <button
                onClick={() => handleTimeRangeChange('7d')}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  activeTimeRange === '7d' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                7 Dias
              </button>
              <button
                onClick={() => handleTimeRangeChange('custom')}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1 ${
                  activeTimeRange === 'custom' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Calendar className="w-3 h-3" /> Personalizado
              </button>
            </div>
          </div>
        </div>

        {/* Statistical Summary Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-950/70 p-3 rounded-2xl border border-slate-800/80">
            <span className="text-[10px] font-mono text-slate-400 block uppercase">Média de CPU</span>
            <span className="text-lg font-extrabold text-indigo-400">{avgCpu}%</span>
          </div>
          <div className="bg-slate-950/70 p-3 rounded-2xl border border-slate-800/80">
            <span className="text-[10px] font-mono text-slate-400 block uppercase">Pico Máximo de CPU</span>
            <span className="text-lg font-extrabold text-rose-400">{maxCpu}%</span>
          </div>
          <div className="bg-slate-950/70 p-3 rounded-2xl border border-slate-800/80">
            <span className="text-[10px] font-mono text-slate-400 block uppercase">Média de Memória RAM</span>
            <span className="text-lg font-extrabold text-emerald-400">{avgMem}%</span>
          </div>
          <div className="bg-slate-950/70 p-3 rounded-2xl border border-slate-800/80">
            <span className="text-[10px] font-mono text-slate-400 block uppercase">Pico de Banda (Download)</span>
            <span className="text-lg font-extrabold text-cyan-400">{maxRx} Mbps</span>
          </div>
        </div>

        {/* Recharts Multi-Metric Area / Line Container */}
        <div className="h-72 w-full pt-2">
          {historyData.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-500 text-xs">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Carregando histórico de métricas...
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={historyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="diskGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10 }} tickLine={false} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickLine={false} domain={[0, 'auto']} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#090d16', borderColor: '#334155', borderRadius: '12px', fontSize: '11px' }}
                  itemStyle={{ color: '#e2e8f0' }}
                  labelStyle={{ color: '#94a3b8', fontWeight: 'bold' }}
                />
                <Legend
                  wrapperStyle={{ paddingTop: '10px', fontSize: '12px' }}
                  iconType="circle"
                />

                {/* Render specific metrics or all combined */}
                {(activeChartMetric === 'all' || activeChartMetric === 'cpu') && (
                  <Area
                    type="monotone"
                    dataKey="cpu"
                    name="CPU (%)"
                    stroke="#818cf8"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#cpuGrad)"
                    isAnimationActive={false}
                  />
                )}

                {(activeChartMetric === 'all' || activeChartMetric === 'memory') && (
                  <Area
                    type="monotone"
                    dataKey="memory"
                    name="Memória RAM (%)"
                    stroke="#34d399"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#memGrad)"
                    isAnimationActive={false}
                  />
                )}

                {(activeChartMetric === 'all' || activeChartMetric === 'disk') && (
                  <Area
                    type="monotone"
                    dataKey="disk"
                    name="Disco (%)"
                    stroke="#fbbf24"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#diskGrad)"
                    isAnimationActive={false}
                  />
                )}

                {(activeChartMetric === 'all' || activeChartMetric === 'network') && (
                  <Area
                    type="monotone"
                    dataKey="rxMbps"
                    name="Download (Mbps)"
                    stroke="#22d3ee"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#netGrad)"
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

      {/* Global Activity Timeline Widget */}
      <div className="bg-[#0f172a]/90 rounded-3xl p-6 border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Linha do Tempo de Atividades Recentes</span>
                <span className="text-[11px] font-normal text-slate-400">({activities.length} eventos registrados)</span>
              </h3>
              <p className="text-xs text-slate-400">
                Histórico em tempo real de deploys, recargas do Caddy, backups e eventos do servidor.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Filter buttons */}
            <div className="bg-slate-900/90 p-1 rounded-xl border border-slate-800 flex items-center gap-1 text-[11px]">
              {(['all', 'deploy', 'domain', 'database', 'alert'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActivityFilter(tab)}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                    activityFilter === tab
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tab === 'all' ? 'Todos' : tab === 'deploy' ? 'Deploys 🚀' : tab === 'domain' ? 'Domínios 🌐' : tab === 'database' ? 'Bancos 🗄️' : 'Alertas ⚠️'}
                </button>
              ))}
            </div>

            <button
              onClick={fetchActivities}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors"
              title="Atualizar atividades"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingActivities ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Activities List */}
        <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
          {activities.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs font-mono">
              Nenhuma atividade recente registrada ainda.
            </div>
          ) : (
            activities
              .filter(act => activityFilter === 'all' || act.type === activityFilter)
              .map(act => (
                <div
                  key={act.id}
                  className="flex items-start justify-between p-3 rounded-2xl bg-slate-950/70 border border-slate-800/80 hover:border-slate-700 transition-all text-xs"
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-xl mt-0.5 ${
                      act.status === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                      act.status === 'error' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                      act.status === 'warning' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                      'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                    }`}>
                      {act.type === 'deploy' ? <Zap className="w-4 h-4" /> :
                       act.type === 'rollback' ? <Clock className="w-4 h-4" /> :
                       act.type === 'domain' ? <Globe className="w-4 h-4" /> :
                       act.type === 'database' ? <Database className="w-4 h-4" /> :
                       <Activity className="w-4 h-4" />}
                    </div>
                    <div>
                      <div className="font-bold text-white flex items-center gap-2">
                        <span>{act.title}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-md font-mono ${
                          act.status === 'success' ? 'bg-emerald-500/15 text-emerald-300' :
                          act.status === 'error' ? 'bg-rose-500/15 text-rose-300' :
                          act.status === 'warning' ? 'bg-amber-500/15 text-amber-300' :
                          'bg-indigo-500/15 text-indigo-300'
                        }`}>
                          {act.status.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-slate-300 text-xs mt-0.5">{act.description}</p>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-500 font-mono shrink-0 ml-3 text-right">
                    {new Date(act.timestamp).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </div>
                </div>
              ))
          )}
        </div>
      </div>

      {/* Custom Date Range Modal */}
      {showCustomDateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-3xl border border-slate-800 w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <Calendar className="w-5 h-5 text-indigo-400" />
                <span>Selecionar Período Personalizado</span>
              </div>
              <button onClick={() => setShowCustomDateModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleApplyCustomDates} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Data e Hora Inicial
                </label>
                <input
                  type="datetime-local"
                  required
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Data e Hora Final
                </label>
                <input
                  type="datetime-local"
                  required
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCustomDateModal(false)}
                  className="px-4 py-2.5 text-slate-400 hover:text-white text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/30"
                >
                  Aplicar Filtro
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
