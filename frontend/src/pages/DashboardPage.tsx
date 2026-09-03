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
import { OverviewData, SystemStats, ActivityRecord, User } from '../types/index.js';
import { NavTab } from '../components/Sidebar.js';
import { api } from '../services/api.js';
import { toneForUsage } from '../components/ui.js';

interface DashboardPageProps {
  overview: OverviewData | null;
  realtimeStats: SystemStats | null;
  setActiveTab: (tab: NavTab) => void;
  currentUser?: User | null;
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

/**
 * One telemetry tile.
 *
 * Local to the dashboard rather than in ui.tsx because it carries the
 * selected-metric behaviour that only this page has; the visual treatment
 * follows the same tokens as the shared StatCard.
 */
const TelemetryCard: React.FC<{
  label: string;
  value: string;
  unit?: string;
  detail?: string;
  detailRight?: string;
  icon: React.ReactNode;
  percent: number;
  tone: 'ok' | 'warn' | 'crit';
  active: boolean;
  onClick: () => void;
}> = ({ label, value, unit, detail, detailRight, icon, percent, tone, active, onClick }) => {
  const bar = tone === 'crit' ? 'bg-crit' : tone === 'warn' ? 'bg-warn' : 'bg-primary-container';
  const accent = tone === 'crit' ? 'text-crit' : tone === 'warn' ? 'text-warn' : 'text-primary';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative text-left bg-surface-container border rounded-lg p-4 overflow-hidden transition-colors w-full ${
        active ? 'border-primary bg-surface-container-high' : 'border-outline-variant hover:bg-surface-container-high'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <span className="mono-label">{label}</span>
        <span className={`shrink-0 ${accent}`}>{icon}</span>
      </div>

      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[28px] leading-none font-bold text-on-surface tracking-[-0.02em] tabular-nums">
          {value}
        </span>
        {unit && <span className="font-mono text-xs text-on-surface-variant">{unit}</span>}
      </div>

      <div className="flex items-center justify-between gap-2 mt-2">
        {detail && <p className="font-mono text-2xs text-on-surface-variant/70 truncate">{detail}</p>}
        {detailRight && <span className="font-mono text-2xs text-warn shrink-0">{detailRight}</span>}
      </div>

      <span
        className={`absolute bottom-0 left-0 h-[3px] transition-all duration-500 ${bar}`}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        aria-hidden
      />
    </button>
  );
};

export const DashboardPage: React.FC<DashboardPageProps> = ({
  overview,
  realtimeStats,
  setActiveTab,
  currentUser,
}) => {
  const stats = realtimeStats || overview?.system;

  const [historyData, setHistoryData] = useState<MetricHistoryPoint[]>([]);
  const [historyMeta, setHistoryMeta] = useState<{ collectedSince: string | null; complete: boolean }>({
    collectedSince: null,
    complete: true,
  });
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
  const [httpsExpected, setHttpsExpected] = useState(false);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);

  useEffect(() => {
    api
      .get('/auth/status')
      .then((res) => setHttpsExpected(Boolean(res.data?.httpsExpected)))
      .catch(() => setHttpsExpected(false));
  }, []);
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

      // The endpoint reports only measured points, plus how far back collection
      // actually goes. An empty result now means "not collected yet" rather
      // than a gap, so it replaces the chart instead of leaving stale data.
      const points = Array.isArray(res.data?.points) ? res.data.points : [];
      setHistoryData(points);
      setHistoryMeta({
        collectedSince: res.data?.collectedSince ?? null,
        complete: res.data?.complete !== false,
      });
    } catch {
      setHistoryData([]);
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
      {currentUser?.role === 'admin' && !currentUser.totpEnabled && (
        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          className="w-full text-left flex items-start gap-3 p-4 rounded-lg border border-warn/40 bg-warn/10"
        >
          <AlertTriangle className="w-5 h-5 text-warn shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-warn">Ative a autenticação em dois fatores</p>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Contas admin sem 2FA não abrem o terminal do host. Configure em Configurações → Segurança.
            </p>
          </div>
        </button>
      )}
      {httpsExpected && window.location.protocol === 'http:' && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-crit/40 bg-crit/10">
          <AlertTriangle className="w-5 h-5 text-crit shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-crit">O painel está respondendo em HTTP</p>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Há um domínio configurado para HTTPS. Acesse pelo hostname do painel, não pela porta 3000.
            </p>
          </div>
        </div>
      )}
      {/* Header banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface-container p-5 rounded-lg border border-outline-variant">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-ok/15 text-ok border border-ok/30 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Servidor Online
            </span>
            <span className="text-xs text-on-surface-variant font-mono">
              {stats?.osInfo.distro} ({stats?.osInfo.arch}) • IP: {stats?.osInfo.publicIp || 'detectando...'}
            </span>
          </div>
          <h2 className="text-2xl font-extrabold text-white tracking-tight">
            Painel de Controle da Infraestrutura
          </h2>
          <p className="text-sm text-on-surface-variant mt-0.5">
            Métricas em tempo real, deploys automatizados e monitoramento completo de rede.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleRunSpeedtest}
            className="flex items-center gap-2 px-4 py-2.5 rounded bg-warn/15 hover:bg-warn/30 text-warn font-semibold text-xs border border-warn/30 transition-all active:scale-95"
          >
            <Zap className="w-4 h-4 text-warn" />
            Teste de Velocidade (Speedtest)
          </button>
          <button
            onClick={() => setActiveTab('apps')}
            className="flex items-center gap-2 px-4 py-2.5 rounded bg-primary-container hover:bg-primary text-white font-semibold text-xs transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            Novo Deploy
          </button>
        </div>
      </div>

      {/* External service links are configured per installation. */}
      <div className="bg-surface-container rounded-lg p-4 border border-outline-variant flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded bg-primary/10 text-primary border border-primary/20">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">Serviços da instalação</h4>
            <p className="text-xs text-on-surface-variant">
              Links de serviços externos devem ser configurados pela própria instalação do painel.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setActiveTab('databases')}
          className="flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container text-white font-semibold text-xs border border-outline-variant transition-all"
        >
          Gerenciar serviços
        </button>
      </div>

      {/* Real-time Metric Cards */}
      {/*
        Telemetry row.

        Follows the Aegis Command spec: micro mono label, large Inter value,
        monospaced unit, and a hairline fill bar on the bottom edge. Selection
        is shown by brightening the surface and colouring the border, not by a
        shadow or a ring, since depth in this system comes from tonal layering.
      */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <TelemetryCard
          label="Uso de CPU"
          icon={<Cpu className="w-4 h-4" />}
          value={`${cpuPercent}%`}
          unit={`${stats?.cpu.cores || 1} vCPUs`}
          detail={stats?.cpu.brand || 'Processador da VPS'}
          detailRight={stats?.cpu.temperature ? `${Math.round(stats.cpu.temperature)}°C` : undefined}
          percent={cpuPercent}
          tone={toneForUsage(cpuPercent)}
          active={activeChartMetric === 'cpu'}
          onClick={() => setActiveChartMetric('cpu')}
        />

        <TelemetryCard
          label="Memória RAM"
          icon={<Activity className="w-4 h-4" />}
          value={`${memPercent}%`}
          unit={`${formatBytes(stats?.memory.usedBytes || 0)} / ${formatBytes(stats?.memory.totalBytes || 0)}`}
          detail={`Livre: ${formatBytes(stats?.memory.freeBytes || 0)}`}
          percent={memPercent}
          tone={toneForUsage(memPercent)}
          active={activeChartMetric === 'memory'}
          onClick={() => setActiveChartMetric('memory')}
        />

        <TelemetryCard
          label="Disco"
          icon={<HardDrive className="w-4 h-4" />}
          value={`${diskPercent}%`}
          unit={`${formatBytes(disk?.usedBytes || 0)} / ${formatBytes(disk?.sizeBytes || 0)}`}
          detail={`Disponível: ${formatBytes(disk?.availableBytes || 0)}`}
          percent={diskPercent}
          tone={toneForUsage(diskPercent)}
          active={activeChartMetric === 'disk'}
          onClick={() => setActiveChartMetric('disk')}
        />

        <button
          type="button"
          onClick={() => setActiveChartMetric('network')}
          className={`relative text-left bg-surface-container border rounded-lg p-4 overflow-hidden transition-colors ${
            activeChartMetric === 'network'
              ? 'border-tertiary bg-surface-container-high'
              : 'border-outline-variant hover:bg-surface-container-high'
          }`}
        >
          <div className="flex items-start justify-between gap-2 mb-3">
            <span className="mono-label">Tráfego de Rede</span>
            <span className="text-tertiary shrink-0">
              <Wifi className="w-4 h-4" />
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 font-mono text-sm">
              <span className="flex items-center gap-1 text-on-surface-variant/80 text-xs">
                <ArrowDownRight className="w-3.5 h-3.5 text-ok" />
              </span>
              <span className="text-ok">{rxMbps} Mbps</span>
            </div>
            <div className="flex items-center justify-between gap-2 font-mono text-sm">
              <span className="flex items-center gap-1 text-on-surface-variant/80 text-xs">
                <ArrowUpRight className="w-3.5 h-3.5 text-primary" />
              </span>
              <span className="text-primary">{txMbps} Mbps</span>
            </div>
          </div>

          <p className="font-mono text-2xs text-on-surface-variant/70 mt-2 truncate">
            {stats?.osInfo.publicIp || stats?.network.interfaces[0] || 'rede'}
          </p>
        </button>
      </div>

      {/* Real-time Rolling Multi-Metric & Timeframe Chart Container */}
      <div className="bg-surface-container rounded-lg p-5 border border-outline-variant space-y-5">
        {/* Top Controls: Metric Filter + Time Range Filter */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-outline-variant pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-primary/10 text-primary">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <span>Análise de Desempenho e Recursos</span>
                {activeTimeRange === 'realtime' && (
                  <span className="text-[10px] font-mono font-bold text-ok bg-ok/10 px-2 py-0.5 rounded-full border border-ok/30 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    Ao Vivo
                  </span>
                )}
              </h3>
              <p className="text-xs text-on-surface-variant mt-0.5">
                {activeTimeRange === 'realtime'
                  ? 'Visualizando métricas instantâneas em tempo real'
                  : `Histórico acumulado do período selecionado (${activeTimeRange.toUpperCase()})`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Metric Filter Tabs */}
            <div className="flex items-center gap-1 bg-surface-container-lowest p-1 rounded border border-outline-variant">
              <button
                onClick={() => setActiveChartMetric('all')}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                  activeChartMetric === 'all' ? 'bg-primary-container text-white shadow' : 'text-on-surface-variant hover:text-white'
                }`}
              >
                Todos
              </button>
              <button
                onClick={() => setActiveChartMetric('cpu')}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                  activeChartMetric === 'cpu' ? 'bg-primary/25 text-primary border border-primary/40 shadow' : 'text-on-surface-variant hover:text-white'
                }`}
              >
                CPU
              </button>
              <button
                onClick={() => setActiveChartMetric('memory')}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                  activeChartMetric === 'memory' ? 'bg-ok/30 text-ok border border-emerald-500/40 shadow' : 'text-on-surface-variant hover:text-white'
                }`}
              >
                RAM
              </button>
              <button
                onClick={() => setActiveChartMetric('disk')}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                  activeChartMetric === 'disk' ? 'bg-warn/30 text-warn border border-warn/30 shadow' : 'text-on-surface-variant hover:text-white'
                }`}
              >
                Disco
              </button>
              <button
                onClick={() => setActiveChartMetric('network')}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                  activeChartMetric === 'network' ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 shadow' : 'text-on-surface-variant hover:text-white'
                }`}
              >
                Rede
              </button>
            </div>

            {/* Timeframe Filter Tabs: 1d, 2d, 3d, 7d, custom */}
            <div className="flex items-center gap-1 bg-surface-container-lowest p-1 rounded border border-outline-variant">
              <button
                onClick={() => handleTimeRangeChange('realtime')}
                className={`px-2.5 py-1.5 rounded text-xs font-semibold transition-all ${
                  activeTimeRange === 'realtime' ? 'bg-surface-container-high text-white font-bold' : 'text-on-surface-variant hover:text-white'
                }`}
              >
                Tempo Real
              </button>
              <button
                onClick={() => handleTimeRangeChange('1d')}
                className={`px-2.5 py-1.5 rounded text-xs font-semibold transition-all ${
                  activeTimeRange === '1d' ? 'bg-surface-container-high text-white font-bold' : 'text-on-surface-variant hover:text-white'
                }`}
              >
                1 Dia
              </button>
              <button
                onClick={() => handleTimeRangeChange('2d')}
                className={`px-2.5 py-1.5 rounded text-xs font-semibold transition-all ${
                  activeTimeRange === '2d' ? 'bg-surface-container-high text-white font-bold' : 'text-on-surface-variant hover:text-white'
                }`}
              >
                2 Dias
              </button>
              <button
                onClick={() => handleTimeRangeChange('3d')}
                className={`px-2.5 py-1.5 rounded text-xs font-semibold transition-all ${
                  activeTimeRange === '3d' ? 'bg-surface-container-high text-white font-bold' : 'text-on-surface-variant hover:text-white'
                }`}
              >
                3 Dias
              </button>
              <button
                onClick={() => handleTimeRangeChange('7d')}
                className={`px-2.5 py-1.5 rounded text-xs font-semibold transition-all ${
                  activeTimeRange === '7d' ? 'bg-surface-container-high text-white font-bold' : 'text-on-surface-variant hover:text-white'
                }`}
              >
                7 Dias
              </button>
              <button
                onClick={() => handleTimeRangeChange('custom')}
                className={`px-2.5 py-1.5 rounded text-xs font-semibold transition-all flex items-center gap-1 ${
                  activeTimeRange === 'custom' ? 'bg-primary-container text-white font-bold' : 'text-on-surface-variant hover:text-white'
                }`}
              >
                <Calendar className="w-3 h-3" /> Personalizado
              </button>
            </div>
          </div>
        </div>

        {/* Statistical Summary Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-surface-container-lowest/70 p-3 rounded-lg border border-outline-variant">
            <span className="text-[10px] font-mono text-on-surface-variant block uppercase">Média de CPU</span>
            <span className="text-lg font-extrabold text-primary">{avgCpu}%</span>
          </div>
          <div className="bg-surface-container-lowest/70 p-3 rounded-lg border border-outline-variant">
            <span className="text-[10px] font-mono text-on-surface-variant block uppercase">Pico Máximo de CPU</span>
            <span className="text-lg font-extrabold text-crit">{maxCpu}%</span>
          </div>
          <div className="bg-surface-container-lowest/70 p-3 rounded-lg border border-outline-variant">
            <span className="text-[10px] font-mono text-on-surface-variant block uppercase">Média de Memória RAM</span>
            <span className="text-lg font-extrabold text-ok">{avgMem}%</span>
          </div>
          <div className="bg-surface-container-lowest/70 p-3 rounded-lg border border-outline-variant">
            <span className="text-[10px] font-mono text-on-surface-variant block uppercase">Pico de Banda (Download)</span>
            <span className="text-lg font-extrabold text-tertiary">{maxRx} Mbps</span>
          </div>
        </div>

        {!historyMeta.complete && historyMeta.collectedSince && historyData.length > 0 && (
          <p className="text-[11px] text-warn/80 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Coletando métricas desde {new Date(historyMeta.collectedSince).toLocaleString('pt-BR')} — o período
            anterior a isso não foi medido.
          </p>
        )}

        {/* Recharts Multi-Metric Area / Line Container */}
        <div className="h-72 w-full pt-2">
          {historyData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <p className="text-on-surface-variant text-sm font-semibold">Ainda sem histórico para este período</p>
              <p className="text-on-surface-variant/70 text-xs mt-1.5 max-w-md">
                O painel grava um ponto a cada 30 segundos a partir do momento em que sobe. Períodos
                anteriores a isso ficam vazios porque não foram medidos.
              </p>
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
          className="bg-surface-container/70 p-5 rounded-lg border border-outline-variant hover:border-primary/50 cursor-pointer transition-all hover:bg-surface-container-high group"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 rounded bg-primary/10 text-primary flex items-center justify-center group-hover:scale-110 transition-transform">
              <Layers className="w-5 h-5" />
            </div>
            <span className="text-xs bg-primary/20 text-primary px-2.5 py-1 rounded-full font-semibold">
              {overview?.counts.runningApps || 0} Ativos
            </span>
          </div>
          <h3 className="text-lg font-bold text-white group-hover:text-primary transition-colors">
            Aplicações Web (PaaS)
          </h3>
          <p className="text-xs text-on-surface-variant mt-1">
            {overview?.counts.apps || 0} aplicações configuradas no servidor.
          </p>
        </div>

        <div
          onClick={() => setActiveTab('databases')}
          className="bg-surface-container/70 p-5 rounded-lg border border-outline-variant hover:border-emerald-500/50 cursor-pointer transition-all hover:bg-surface-container-high group"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 rounded bg-ok/10 text-ok flex items-center justify-center group-hover:scale-110 transition-transform">
              <Database className="w-5 h-5" />
            </div>
            <span className="text-xs bg-ok/15 text-ok px-2.5 py-1 rounded-full font-semibold">
              {overview?.counts.runningDatabases || 0} Rodando
            </span>
          </div>
          <h3 className="text-lg font-bold text-white group-hover:text-ok transition-colors">
            Bancos de Dados
          </h3>
          <p className="text-xs text-on-surface-variant mt-1">
            Postgres, MySQL, Redis persistentes e criptografados.
          </p>
        </div>

        <div
          onClick={() => setActiveTab('containers')}
          className="bg-surface-container/70 p-5 rounded-lg border border-outline-variant hover:border-cyan-500/50 cursor-pointer transition-all hover:bg-surface-container-high group"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 rounded bg-tertiary/10 text-tertiary flex items-center justify-center group-hover:scale-110 transition-transform">
              <Boxes className="w-5 h-5" />
            </div>
            <span className="text-xs bg-cyan-500/20 text-cyan-300 px-2.5 py-1 rounded-full font-semibold">
              {overview?.docker.runningContainers || 0} Contêineres
            </span>
          </div>
          <h3 className="text-lg font-bold text-white group-hover:text-tertiary transition-colors">
            Docker Engine
          </h3>
          <p className="text-xs text-on-surface-variant mt-1">
            {overview?.docker.totalContainers || 0} contêineres instalados no host.
          </p>
        </div>
      </div>

      {/* Global Activity Timeline Widget */}
      <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-outline-variant pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-primary/10 text-primary">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Linha do Tempo de Atividades Recentes</span>
                <span className="text-[11px] font-normal text-on-surface-variant">({activities.length} eventos registrados)</span>
              </h3>
              <p className="text-xs text-on-surface-variant">
                Histórico em tempo real de deploys, recargas do Caddy, backups e eventos do servidor.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Filter buttons */}
            <div className="bg-surface-container-low/90 p-1 rounded border border-outline-variant flex items-center gap-1 text-[11px]">
              {(['all', 'deploy', 'domain', 'database', 'alert'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActivityFilter(tab)}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                    activityFilter === tab
                      ? 'bg-primary-container text-white'
                      : 'text-on-surface-variant hover:text-white'
                  }`}
                >
                  {tab === 'all' ? 'Todos' : tab === 'deploy' ? 'Deploys 🚀' : tab === 'domain' ? 'Domínios 🌐' : tab === 'database' ? 'Bancos 🗄️' : 'Alertas ⚠️'}
                </button>
              ))}
            </div>

            <button
              onClick={fetchActivities}
              className="p-1.5 rounded-lg bg-surface-container-high text-on-surface-variant hover:text-white transition-colors"
              title="Atualizar atividades"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingActivities ? 'animate-spin text-primary' : ''}`} />
            </button>
          </div>
        </div>

        {/* Activities List */}
        <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
          {activities.length === 0 ? (
            <div className="p-8 text-center text-on-surface-variant/70 text-xs font-mono">
              Nenhuma atividade recente registrada ainda.
            </div>
          ) : (
            activities
              .filter(act => activityFilter === 'all' || act.type === activityFilter)
              .map(act => (
                <div
                  key={act.id}
                  className="flex items-start justify-between p-3 rounded-lg bg-surface-container-lowest/70 border border-outline-variant hover:border-outline-variant transition-all text-xs"
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded mt-0.5 ${
                      act.status === 'success' ? 'bg-ok/10 text-ok border border-ok/30' :
                      act.status === 'error' ? 'bg-crit/10 text-crit border border-crit/25' :
                      act.status === 'warning' ? 'bg-warn/10 text-warn border border-warn/30' :
                      'bg-primary/10 text-primary border border-primary/25'
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
                          act.status === 'success' ? 'bg-ok/10 text-ok' :
                          act.status === 'error' ? 'bg-crit/10 text-crit' :
                          act.status === 'warning' ? 'bg-warn/10 text-warn' :
                          'bg-primary/15 text-primary'
                        }`}>
                          {act.status.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-on-surface-variant text-xs mt-0.5">{act.description}</p>
                    </div>
                  </div>

                  <div className="text-[11px] text-on-surface-variant/70 font-mono shrink-0 ml-3 text-right">
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
          <div className="bg-surface-container rounded-lg border border-outline-variant w-full max-w-md overflow-hidden p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <Calendar className="w-5 h-5 text-primary" />
                <span>Selecionar Período Personalizado</span>
              </div>
              <button onClick={() => setShowCustomDateModal(false)} className="text-on-surface-variant hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleApplyCustomDates} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Data e Hora Inicial
                </label>
                <input
                  type="datetime-local"
                  required
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Data e Hora Final
                </label>
                <input
                  type="datetime-local"
                  required
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary font-mono"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCustomDateModal(false)}
                  className="px-4 py-2.5 text-on-surface-variant hover:text-white text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-primary-container hover:bg-primary text-white rounded text-xs font-semibold"
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
          <div className="bg-surface-container rounded-lg border border-outline-variant w-full max-w-lg overflow-hidden p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white font-bold text-lg">
                <Zap className="w-6 h-6 text-warn" />
                <span>Teste de Velocidade da VPS (Speedtest)</span>
              </div>
              <button
                onClick={() => setShowSpeedtestModal(false)}
                disabled={runningSpeedtest}
                className="text-on-surface-variant hover:text-white disabled:opacity-30"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {runningSpeedtest ? (
              <div className="py-12 text-center space-y-4">
                <RefreshCw className="w-12 h-12 text-warn animate-spin mx-auto" />
                <h4 className="font-bold text-white text-base">Testando velocidade da conexão...</h4>
                <p className="text-xs text-on-surface-variant max-w-sm mx-auto">
                  Enviando e recebendo pacotes de teste via CDN de alta velocidade para medir Latência, Download e Upload.
                </p>
              </div>
            ) : speedtestResult ? (
              <div className="space-y-5">
                {/* Result Gauges */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Download */}
                  <div className="bg-surface-container-lowest p-4 rounded-lg border border-ok/30 text-center space-y-1">
                    <span className="text-[10px] font-mono uppercase text-on-surface-variant flex items-center justify-center gap-1">
                      <ArrowDownRight className="w-3.5 h-3.5 text-ok" /> VELOCIDADE DOWNLOAD
                    </span>
                    <div className="text-3xl font-extrabold text-ok">
                      {speedtestResult.downloadMbps} <span className="text-xs font-normal">Mbps</span>
                    </div>
                  </div>

                  {/* Upload */}
                  <div className="bg-surface-container-lowest p-4 rounded-lg border border-primary/30 text-center space-y-1">
                    <span className="text-[10px] font-mono uppercase text-on-surface-variant flex items-center justify-center gap-1">
                      <ArrowUpRight className="w-3.5 h-3.5 text-primary" /> VELOCIDADE UPLOAD
                    </span>
                    <div className="text-3xl font-extrabold text-primary">
                      {speedtestResult.uploadMbps} <span className="text-xs font-normal">Mbps</span>
                    </div>
                  </div>
                </div>

                {/* Detailed Info */}
                <div className="bg-surface-container-lowest/80 p-4 rounded-lg border border-outline-variant space-y-2.5 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Ping (Latência):</span>
                    <span className="text-white font-bold">{speedtestResult.pingMs} ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Jitter:</span>
                    <span className="text-on-surface">{speedtestResult.jitterMs} ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Provedor / Backbone:</span>
                    <span className="text-warn">{speedtestResult.isp}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Localização do Servidor:</span>
                    <span className="text-on-surface">{speedtestResult.serverLocation}</span>
                  </div>
                </div>

                <div className="p-3 rounded bg-ok/10 border border-ok/30 text-ok text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-ok" />
                  <span>Velocidade excelente para hospedagem de aplicações e APIs de alto tráfego!</span>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={handleRunSpeedtest}
                    className="px-4 py-2.5 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded text-xs font-semibold"
                  >
                    Testar Novamente
                  </button>
                  <button
                    onClick={() => setShowSpeedtestModal(false)}
                    className="px-5 py-2.5 bg-primary-container hover:bg-primary text-white rounded text-xs font-semibold"
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
