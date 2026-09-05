import React, { useState, useEffect, useMemo } from 'react';
import {
  Layers,
  Plus,
  Play,
  Square,
  RefreshCw,
  Trash2,
  ExternalLink,
  FileText,
  Code,
  Globe,
  GitBranch,
  Webhook,
  Zap,
  Clock,
  FileCode2,
  Sliders,
  Lock,
  Search,
  FolderTree,
  Settings2,
  GitCommit,
  User,
  Globe2,
  Sparkles,
  Activity,
  LayoutGrid,
  List,
  Copy,
  Check,
  MoreVertical,
  AlertCircle,
  CheckCircle2,
  ArrowUpRight,
  HardDrive,
} from 'lucide-react';
import { api } from '../services/api.js';
import { useToast } from '../components/Toast.js';
import { socket } from '../services/socket.js';
import { AppRecord, AppMetricsSnapshot, DeploymentRecord, ServerNode } from '../types/index.js';
import { DeployHistoryModal } from '../components/apps/DeployHistoryModal.js';
import { BuildLogsModal } from '../components/apps/BuildLogsModal.js';
import { CreateAppModal } from '../components/apps/CreateAppModal.js';
import { EditAppModal } from '../components/apps/EditAppModal.js';
import { AppFilesModal } from '../components/apps/AppFilesModal.js';
import { EnvModal } from '../components/apps/EnvModal.js';
import { DomainModal } from '../components/apps/DomainModal.js';
import { WebhookModal } from '../components/apps/WebhookModal.js';
import { WorkflowModal } from '../components/apps/WorkflowModal.js';
import { AppLogsModal } from '../components/apps/AppLogsModal.js';
import { LiveDeployModal, type LiveDeployState } from '../components/apps/LiveDeployModal.js';
import { AiHelpModal } from '../components/apps/AiHelpModal.js';
import { AppObservabilityModal } from '../components/apps/AppObservabilityModal.js';

function formatRam(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function appStatusBadge(
  app: AppRecord,
  nodes: ServerNode[] = [],
): {
  label: string;
  title: string;
  className: string;
  dotClassName: string;
} {
  const node = app.nodeId ? nodes.find((n) => n.id === app.nodeId) : undefined;
  if (node && !node.isLocal && node.status === 'error') {
    return {
      label: 'Nó inacessível',
      title: `O painel não consegue falar com o nó "${node.name}". O estado real desta aplicação é desconhecido.`,
      className: 'bg-surface-container-high text-on-surface-variant border border-outline-variant opacity-70',
      dotClassName: 'bg-outline',
    };
  }

  if (app.status !== 'running') {
    return {
      label: app.status === 'building' ? 'Publicando' : app.status === 'error' ? 'Erro' : 'Parado',
      title: 'O contêiner não está em execução.',
      className: 'bg-surface-container-high text-on-surface-variant border border-outline-variant',
      dotClassName: 'bg-outline',
    };
  }

  const health = app.health?.status;
  if (health === 'unhealthy') {
    return {
      label: 'Não responde',
      title: app.health?.lastError
        ? `O contêiner está de pé, mas não responde: ${app.health.lastError}`
        : 'O contêiner está de pé, mas não responde na porta da aplicação.',
      className: 'bg-crit/10 text-crit border border-crit/30',
      dotClassName: 'bg-crit animate-pulse',
    };
  }
  if (health === 'starting') {
    return {
      label: 'Subindo',
      title: 'Ainda não respondeu; aguardando os próximos ciclos antes de agir.',
      className: 'bg-warn/10 text-warn border border-warn/30',
      dotClassName: 'bg-warn animate-pulse',
    };
  }

  return {
    label: 'Online',
    title:
      health === 'healthy'
        ? 'Respondendo normalmente na última verificação.'
        : 'Contêiner em execução; ainda sem verificação de saúde.',
    className: 'bg-ok/10 text-ok border border-ok/30',
    dotClassName: 'bg-emerald-400 animate-pulse',
  };
}

type FilterStatus = 'all' | 'running' | 'stopped' | 'error' | 'git' | 'image';
type ViewMode = 'grid' | 'table';

interface AppsPageProps {
  onOpenAnalytics?: (appId: string) => void;
  onOpenApp?: (appId: string) => void;
}

export const AppsPage: React.FC<AppsPageProps> = ({ onOpenAnalytics, onOpenApp }) => {
  const toast = useToast();
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [nodes, setNodes] = useState<ServerNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [copiedPortId, setCopiedPortId] = useState<string | null>(null);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedLogsApp, setSelectedLogsApp] = useState<AppRecord | null>(null);
  const [selectedWebhookApp, setSelectedWebhookApp] = useState<AppRecord | null>(null);
  const [selectedDeploymentsApp, setSelectedDeploymentsApp] = useState<AppRecord | null>(null);
  const [deploymentsList, setDeploymentsList] = useState<DeploymentRecord[]>([]);
  const [selectedWorkflowApp, setSelectedWorkflowApp] = useState<AppRecord | null>(null);
  const [selectedBuildLogs, setSelectedBuildLogs] = useState<DeploymentRecord | null>(null);
  const [selectedEditApp, setSelectedEditApp] = useState<AppRecord | null>(null);
  const [selectedEnvApp, setSelectedEnvApp] = useState<AppRecord | null>(null);
  const [selectedDomainApp, setSelectedDomainApp] = useState<AppRecord | null>(null);
  const [selectedFileApp, setSelectedFileApp] = useState<AppRecord | null>(null);
  const [selectedObservabilityApp, setSelectedObservabilityApp] = useState<AppRecord | null>(null);
  const [appMetrics, setAppMetrics] = useState<Record<string, AppMetricsSnapshot>>({});
  const [deployingId, setDeployingId] = useState<string | null>(null);
  const [liveDeployModal, setLiveDeployModal] = useState<LiveDeployState | null>(null);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);
  const [redeployingId, setRedeployingId] = useState<string | null>(null);
  const [showAiHelpModal, setShowAiHelpModal] = useState(false);

  const fetchApps = async () => {
    try {
      setLoading(true);
      const res = await api.get('/apps');
      setApps(res.data);
    } catch (err) {
      console.error('Failed to fetch apps:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApps();
    api
      .get('/nodes')
      .then((res) => setNodes(Array.isArray(res.data) ? res.data : []))
      .catch(() => {});

    const handleStream = (data: any) => {
      setLiveDeployModal((prev) => {
        if (!prev || prev.app.id !== data.appId) return prev;
        return {
          ...prev,
          step: data.step || prev.step,
          stepName: data.stepName || prev.stepName,
          logs: prev.logs + (data.line || ''),
          percentage: data.percentage || prev.percentage,
          status: data.status || prev.status,
        };
      });
    };

    socket.on('deploy:stream', handleStream);
    return () => {
      socket.off('deploy:stream', handleStream);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadMetrics = async () => {
      try {
        const res = await api.get('/apps/metrics');
        if (cancelled || !Array.isArray(res.data)) return;
        const next: Record<string, AppMetricsSnapshot> = {};
        for (const row of res.data as AppMetricsSnapshot[]) next[row.appId] = row;
        setAppMetrics(next);
      } catch (err) {
        console.error('Failed to load app metrics:', err);
      }
    };
    void loadMetrics();
    const timer = setInterval(() => void loadMetrics(), 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleDocumentClick = () => setOpenDropdownId(null);
    if (openDropdownId) {
      document.addEventListener('click', handleDocumentClick);
      return () => document.removeEventListener('click', handleDocumentClick);
    }
  }, [openDropdownId]);

  const handleAppCreated = (createdApp: AppRecord) => {
    setShowCreateModal(false);
    fetchApps();
    setLiveDeployModal({
      app: createdApp,
      step: 1,
      stepName: 'Inicializando Pipeline',
      logs: `[${new Date().toLocaleTimeString('pt-BR')}] 🚀 Disparando build inicial para "${createdApp.name}"...\n`,
      percentage: 10,
      status: 'running',
    });
  };

  const handleTriggerDeploy = async (app: AppRecord) => {
    try {
      setDeployingId(app.id);
      setLiveDeployModal({
        app,
        step: 1,
        stepName: 'Inicializando Pipeline',
        logs: `[${new Date().toLocaleTimeString('pt-BR')}] 🚀 Disparando pipeline de build em tempo real...\n`,
        percentage: 15,
        status: 'running',
      });
      await api.post(`/apps/${app.id}/deploy`, {
        commitMessage: 'Deploy manual acionado pelo painel',
      });
      fetchApps();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao disparar deploy');
    } finally {
      setTimeout(() => setDeployingId(null), 1000);
    }
  };

  const handleRedeploy = async (appId: string, dep: DeploymentRecord) => {
    const alvo = dep.commitHash ? `#${dep.commitHash}` : 'este deploy';
    if (
      !confirm(
        `Reconstruir ${alvo} do zero com a configuração atual? O build leva o mesmo tempo de um deploy normal.`,
      )
    ) {
      return;
    }
    try {
      setRedeployingId(dep.id);
      await api.post(`/apps/${appId}/deployments/${dep.id}/redeploy`);
      toast.info('O build começou. Acompanhe pelos logs em tempo real.', 'Redeploy disparado');
      setSelectedDeploymentsApp(null);
      fetchApps();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao redeployar');
    } finally {
      setRedeployingId(null);
    }
  };

  const handleRollback = async (appId: string, deploymentId: string) => {
    if (!confirm('Deseja realmente reverter a aplicação para esta versão anterior? O contêiner será restaurado em segundos.')) return;
    try {
      setRollingBackId(deploymentId);
      const res = await api.post(`/apps/${appId}/rollback/${deploymentId}`);
      toast.success(res.data.message);
      fetchApps();
      if (selectedDeploymentsApp) {
        openDeploymentsHistory(selectedDeploymentsApp);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao executar rollback');
    } finally {
      setRollingBackId(null);
    }
  };

  const openDeploymentsHistory = async (app: AppRecord) => {
    setSelectedDeploymentsApp(app);
    try {
      const res = await api.get(`/apps/${app.id}/deployments`);
      setDeploymentsList(res.data);
    } catch (err: any) {
      toast.error(err.message, 'Erro ao carregar histórico');
    }
  };

  const openBuildLogs = async (dep: DeploymentRecord) => {
    if (!selectedDeploymentsApp) return;
    try {
      setSelectedBuildLogs({ ...dep, buildLogs: 'Carregando logs…' });
      const res = await api.get(`/apps/${selectedDeploymentsApp.id}/deployments/${dep.id}/logs`);
      setSelectedBuildLogs({ ...dep, buildLogs: res.data.buildLogs || '' });
    } catch (err: any) {
      setSelectedBuildLogs({
        ...dep,
        buildLogs: `Erro ao carregar logs: ${err.response?.data?.error || err.message}`,
      });
    }
  };

  const handleStart = async (id: string) => {
    try {
      await api.post(`/apps/${id}/start`);
      toast.success('Aplicação iniciada.');
      fetchApps();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao iniciar app');
    }
  };

  const handleStop = async (id: string) => {
    try {
      await api.post(`/apps/${id}/stop`);
      toast.success('Aplicação parada.');
      fetchApps();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao parar app');
    }
  };

  const handleRestart = async (id: string) => {
    try {
      await api.post(`/apps/${id}/restart`);
      toast.success('Aplicação reiniciada.');
      fetchApps();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao reiniciar app');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Tem certeza que deseja deletar a aplicação "${name}"?`)) return;
    try {
      await api.delete(`/apps/${id}`);
      toast.success(`Aplicação "${name}" excluída.`);
      fetchApps();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao deletar app');
    }
  };

  const handleCopyDirectUrl = (e: React.MouseEvent, port: number, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    const host = window.location.hostname || 'localhost';
    const url = `http://${host}:${port}`;
    void navigator.clipboard.writeText(url);
    setCopiedPortId(id);
    toast.success(`Link direto copiado: ${url}`);
    setTimeout(() => setCopiedPortId(null), 2000);
  };

  // Fleet KPIs
  const fleetKpis = useMemo(() => {
    const total = apps.length;
    const running = apps.filter((a) => a.status === 'running');
    const healthy = running.filter((a) => !a.health || a.health.status === 'healthy').length;
    const buildingOrStarting = apps.filter(
      (a) => a.status === 'building' || (a.status === 'running' && a.health?.status === 'starting'),
    ).length;
    const stoppedOrError = apps.filter(
      (a) => a.status === 'stopped' || a.status === 'error' || a.health?.status === 'unhealthy',
    ).length;

    let totalRamBytes = 0;
    for (const snap of Object.values(appMetrics)) {
      if (snap.available && snap.memoryUsedBytes) {
        totalRamBytes += snap.memoryUsedBytes;
      }
    }

    return {
      total,
      healthy,
      buildingOrStarting,
      stoppedOrError,
      totalRamStr: formatRam(totalRamBytes),
    };
  }, [apps, appMetrics]);

  // Filtering
  const filteredApps = useMemo(() => {
    return apps.filter((app) => {
      if (filterStatus === 'running' && app.status !== 'running') return false;
      if (filterStatus === 'stopped' && app.status !== 'stopped') return false;
      if (filterStatus === 'error' && app.status !== 'error' && app.health?.status !== 'unhealthy') {
        return false;
      }
      if (filterStatus === 'git' && app.sourceType !== 'git' && app.sourceType !== 'dockerfile') {
        return false;
      }
      if (filterStatus === 'image' && app.sourceType !== 'image') return false;

      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return (
        app.name.toLowerCase().includes(term) ||
        (app.domain && app.domain.toLowerCase().includes(term)) ||
        (app.gitUrl && app.gitUrl.toLowerCase().includes(term)) ||
        (app.imageName && app.imageName.toLowerCase().includes(term)) ||
        (app.branch && app.branch.toLowerCase().includes(term)) ||
        app.port.toString().includes(term)
      );
    });
  }, [apps, filterStatus, searchTerm]);

  return (
    <div className="space-y-6">
      {/* Executive Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/10 text-primary border border-primary/20">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-[-0.01em]">
                Aplicações & CI/CD
              </h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Plataforma PaaS Cloud com automação de builds, rollback instantâneo e domínios com SSL.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() => setShowAiHelpModal(true)}
            title="Copie o prompt para sua IA preparar o projeto para o AegisPanel"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 font-semibold text-xs border border-purple-500/30 transition-all active:scale-95"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>Prompt para IA ✨</span>
          </button>

          <button
            onClick={() => setShowCreateModal(true)}
            title="Fazer deploy de um novo projeto do GitHub ou imagem Docker"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-on-primary font-semibold text-xs transition-all hover:bg-primary/90 active:scale-95 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Projeto / Deploy</span>
          </button>
        </div>
      </div>

      {/* Fleet Telemetry KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-lg bg-surface-container border border-outline-variant">
          <div className="flex items-center justify-between text-on-surface-variant text-[11px] mb-1">
            <span>Total de Apps</span>
            <HardDrive className="w-3.5 h-3.5 text-on-surface-variant/60" />
          </div>
          <div className="text-xl font-bold text-white tabular-nums font-mono">
            {fleetKpis.total}
          </div>
        </div>

        <div className="p-3.5 rounded-lg bg-surface-container border border-outline-variant">
          <div className="flex items-center justify-between text-on-surface-variant text-[11px] mb-1">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-ok animate-pulse" />
              Online
            </span>
            <CheckCircle2 className="w-3.5 h-3.5 text-ok/80" />
          </div>
          <div className="text-xl font-bold text-ok tabular-nums font-mono">
            {fleetKpis.healthy}
          </div>
        </div>

        <div className="p-3.5 rounded-lg bg-surface-container border border-outline-variant">
          <div className="flex items-center justify-between text-on-surface-variant text-[11px] mb-1">
            <span>Parados ou Erro</span>
            <AlertCircle className="w-3.5 h-3.5 text-warn/80" />
          </div>
          <div className="text-xl font-bold text-on-surface-variant tabular-nums font-mono">
            {fleetKpis.stoppedOrError}
          </div>
        </div>

        <div className="p-3.5 rounded-lg bg-surface-container border border-outline-variant">
          <div className="flex items-center justify-between text-on-surface-variant text-[11px] mb-1">
            <span>RAM Total em Uso</span>
            <Activity className="w-3.5 h-3.5 text-tertiary/80" />
          </div>
          <div className="text-xl font-bold text-tertiary tabular-nums font-mono truncate">
            {fleetKpis.totalRamStr}
          </div>
        </div>
      </div>

      {/* Control Toolbar: Search + Filter Pills + View Switch */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-surface-container-low p-2 rounded-lg border border-outline-variant">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-on-surface-variant absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por nome, domínio, porta, repo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-surface-container border border-outline-variant rounded-md pl-8 pr-3 py-1.5 text-xs text-white placeholder-on-surface-variant/50 focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar text-xs">
          {[
            { id: 'all', label: 'Todos', count: apps.length },
            { id: 'running', label: 'Online', count: apps.filter((a) => a.status === 'running').length },
            { id: 'stopped', label: 'Parados', count: apps.filter((a) => a.status === 'stopped').length },
            {
              id: 'error',
              label: 'Problemas',
              count: apps.filter((a) => a.status === 'error' || a.health?.status === 'unhealthy').length,
            },
            {
              id: 'git',
              label: 'Git',
              count: apps.filter((a) => a.sourceType === 'git' || a.sourceType === 'dockerfile').length,
            },
            { id: 'image', label: 'Docker', count: apps.filter((a) => a.sourceType === 'image').length },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilterStatus(f.id as FilterStatus)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                filterStatus === f.id
                  ? 'bg-primary/20 text-primary border border-primary/30 font-semibold'
                  : 'text-on-surface-variant hover:text-white hover:bg-surface-container'
              }`}
            >
              <span>{f.label}</span>
              <span className="text-[10px] font-mono opacity-70">({f.count})</span>
            </button>
          ))}
        </div>

        {/* Right: Layout Switch & Refresh */}
        <div className="flex items-center gap-1.5 shrink-0 self-end md:self-auto">
          <div className="flex items-center bg-surface-container rounded border border-outline-variant p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              title="Modo Grade (Cards)"
              className={`p-1 rounded ${viewMode === 'grid' ? 'bg-primary/20 text-primary' : 'text-on-surface-variant hover:text-white'}`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('table')}
              title="Modo Tabela (Compacto)"
              className={`p-1 rounded ${viewMode === 'table' ? 'bg-primary/20 text-primary' : 'text-on-surface-variant hover:text-white'}`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={fetchApps}
            title="Recarregar aplicações"
            className="p-1.5 rounded bg-surface-container hover:bg-surface-container-high border border-outline-variant text-on-surface-variant hover:text-white transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Content: Grid vs Table */}
      {loading && apps.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-16 text-on-surface-variant gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-primary" />
          <span className="text-xs">Carregando aplicações...</span>
        </div>
      ) : filteredApps.length === 0 ? (
        <div className="bg-surface-container rounded-lg p-12 border border-outline-variant text-center">
          <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4 border border-primary/20">
            <Layers className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-white mb-1">
            {apps.length === 0 ? 'Nenhuma aplicação hospedada' : 'Nenhuma aplicação com estes filtros'}
          </h3>
          <p className="text-xs text-on-surface-variant max-w-md mx-auto mb-5">
            {apps.length === 0
              ? 'Conecte seu repositório do GitHub (público ou privado) ou forneça uma imagem Docker para iniciar seu primeiro deploy.'
              : 'Tente ajustar os termos de busca ou mudar a categoria de filtro selecionada.'}
          </p>
          {apps.length === 0 && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 rounded-lg bg-primary text-on-primary font-semibold text-xs inline-flex items-center gap-2 hover:bg-primary/90 transition-all active:scale-95"
            >
              <Plus className="w-4 h-4" />
              Criar Primeiro Deploy
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        /* Bento Grid View */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredApps.map((app) => {
            const badge = appStatusBadge(app, nodes);
            const currentHost = window.location.hostname || 'localhost';
            const directUrl = `http://${currentHost}:${app.port}`;
            const metrics = appMetrics[app.id];

            return (
              <div
                key={app.id}
                className="bg-surface-container rounded-lg border border-outline-variant hover:border-primary/40 transition-all duration-200 flex flex-col justify-between overflow-hidden group shadow-sm hover:shadow-md"
              >
                <div className="p-5 space-y-4">
                  {/* Card Header: Icon + Name + Branch + Status */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-surface-container-high border border-outline-variant flex items-center justify-center font-bold text-primary shrink-0 mt-0.5">
                        {app.sourceType === 'git' || app.sourceType === 'dockerfile' ? (
                          <GitBranch className="w-5 h-5 text-primary" />
                        ) : (
                          <Code className="w-5 h-5 text-warn" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-white text-base truncate">
                            {onOpenApp ? (
                              <button
                                onClick={() => onOpenApp(app.id)}
                                title="Abrir painel detalhado desta aplicação"
                                className="hover:text-primary transition-colors text-left flex items-center gap-1 group-hover:text-primary"
                              >
                                {app.name}
                                <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </button>
                            ) : (
                              app.name
                            )}
                          </h3>

                          {app.sourceType === 'git' ? (
                            <span className="text-[10px] font-mono text-primary bg-primary/15 px-2 py-0.5 rounded border border-primary/30 flex items-center gap-1">
                              <GitBranch className="w-2.5 h-2.5" />
                              {app.branch || 'main'}
                              {app.hasGithubToken && (
                                <span title="Repositório Privado">
                                  <Lock className="w-2.5 h-2.5 text-warn" />
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-[10px] font-mono text-warn bg-warn/10 px-2 py-0.5 rounded border border-warn/30">
                              Docker
                            </span>
                          )}
                          {app.buildConfig?.runtime && (
                            <span className="text-[10px] font-mono text-on-surface bg-surface-container-high px-2 py-0.5 rounded border border-outline-variant">
                              {app.buildConfig.runtime}
                              {app.buildConfig.version ? ` ${app.buildConfig.version}` : ''}
                            </span>
                          )}
                        </div>

                        <p className="text-[11px] font-mono text-on-surface-variant truncate mt-0.5 max-w-sm">
                          {app.gitUrl || app.imageName}
                        </p>
                      </div>
                    </div>

                    {/* Status badge */}
                    <span
                      title={badge.title}
                      className={`text-[11px] px-2.5 py-1 rounded-full font-medium flex items-center gap-1.5 shrink-0 ${badge.className}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${badge.dotClassName}`} />
                      {badge.label}
                    </span>
                  </div>

                  {/* Network & Access Bar: Domain + Direct Port */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                    {/* Domain */}
                    <div className="p-2.5 rounded-md bg-surface-container-low border border-outline-variant flex items-center justify-between gap-2 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Globe className="w-3.5 h-3.5 text-primary shrink-0" />
                        {app.domain ? (
                          <a
                            href={`https://${app.domain}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-ok hover:underline truncate font-semibold flex items-center gap-1"
                          >
                            {app.domain}
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-on-surface-variant/70 text-[11px] truncate">
                            Sem domínio SSL
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => setSelectedDomainApp(app)}
                        className="text-[10px] text-on-surface-variant hover:text-white shrink-0 font-sans px-1 py-0.5 rounded hover:bg-surface-container"
                      >
                        {app.domain ? 'Editar' : '+ Vincular'}
                      </button>
                    </div>

                    {/* Direct IP:Port Access */}
                    <div className="p-2.5 rounded-md bg-surface-container-low border border-outline-variant flex items-center justify-between gap-2 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                        <span className="text-on-surface-variant text-[11px]">Porta:</span>
                        <span className="text-white font-bold truncate">:{app.port}</span>
                        {app.internalPort && app.internalPort !== app.port && (
                          <span className="text-[10px] text-on-surface-variant/70">
                            (app :{app.internalPort})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={(e) => handleCopyDirectUrl(e, app.port, app.id)}
                          title="Copiar link IP:Porta"
                          className="p-1 rounded text-on-surface-variant hover:text-white hover:bg-surface-container"
                        >
                          {copiedPortId === app.id ? (
                            <Check className="w-3 h-3 text-ok" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                        <a
                          href={directUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="Abrir diretamente no navegador"
                          className="p-1 rounded text-ok hover:bg-ok/10"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  </div>

                  {/* Resource Telemetry Bar */}
                  {metrics && metrics.available ? (
                    <button
                      type="button"
                      onClick={() => setSelectedObservabilityApp(app)}
                      className="w-full grid grid-cols-2 gap-3 p-2.5 rounded-md bg-surface-container-low border border-outline-variant text-left hover:border-primary/40 transition-colors"
                      title="Clique para ver métricas e histórico completo"
                    >
                      <div>
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-on-surface-variant">CPU</span>
                          <span className="font-mono text-white font-semibold">
                            {metrics.cpuPercent}%
                          </span>
                        </div>
                        <div className="h-1 bg-surface-container-high rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              metrics.cpuPercent >= 80
                                ? 'bg-crit'
                                : metrics.cpuPercent >= 50
                                  ? 'bg-warn'
                                  : 'bg-primary'
                            }`}
                            style={{ width: `${Math.min(100, metrics.cpuPercent)}%` }}
                          />
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-on-surface-variant">RAM</span>
                          <span className="font-mono text-white font-semibold">
                            {formatRam(metrics.memoryUsedBytes)}
                          </span>
                        </div>
                        <div className="h-1 bg-surface-container-high rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              metrics.memoryPercent >= 85
                                ? 'bg-crit'
                                : metrics.memoryPercent >= 65
                                  ? 'bg-warn'
                                  : 'bg-ok'
                            }`}
                            style={{ width: `${Math.min(100, metrics.memoryPercent)}%` }}
                          />
                        </div>
                      </div>
                    </button>
                  ) : null}

                  {/* Git Commit Snippet (Vercel Style) */}
                  {app.sourceType === 'git' && (
                    <div className="p-2.5 rounded-md bg-surface-container-low/70 border border-outline-variant/60 flex items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <GitCommit className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="font-mono text-primary font-bold">
                          {app.lastCommitHash ? `#${app.lastCommitHash.substring(0, 7)}` : 'Commit'}
                        </span>
                        <span className="text-on-surface truncate">
                          "{app.lastCommitMessage || 'Deploy inicial'}"
                        </span>
                      </div>
                      <span className="text-on-surface-variant/70 font-mono text-[10px] shrink-0">
                        {app.lastCommitAuthor || 'Aegis'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Footer Action Row */}
                <div className="px-5 py-3 bg-surface-container-low border-t border-outline-variant flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {/* Primary Deploy Button */}
                    <button
                      onClick={() => handleTriggerDeploy(app)}
                      disabled={deployingId === app.id}
                      title="Disparar novo deploy (Git Pull & Rebuild)"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-on-primary text-xs font-semibold hover:bg-primary/90 transition-all active:scale-95 disabled:opacity-50"
                    >
                      <Zap className={`w-3.5 h-3.5 ${deployingId === app.id ? 'animate-bounce' : ''}`} />
                      <span>{deployingId === app.id ? 'Buildando...' : 'Deploy'}</span>
                    </button>

                    {/* Dedicated Console Link */}
                    {onOpenApp && (
                      <button
                        onClick={() => onOpenApp(app.id)}
                        className="px-3 py-1.5 rounded-md bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-medium border border-outline-variant transition-colors"
                      >
                        Console &rarr;
                      </button>
                    )}

                    {/* Start / Stop Toggle */}
                    {app.status === 'running' ? (
                      <button
                        onClick={() => handleStop(app.id)}
                        title="Parar aplicação"
                        className="p-1.5 rounded-md text-on-surface-variant hover:text-warn hover:bg-surface-container transition-colors"
                      >
                        <Square className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStart(app.id)}
                        title="Iniciar aplicação"
                        className="p-1.5 rounded-md text-ok hover:bg-ok/10 transition-colors"
                      >
                        <Play className="w-4 h-4" />
                      </button>
                    )}

                    {/* Restart */}
                    <button
                      onClick={() => handleRestart(app.id)}
                      title="Reiniciar contêiner"
                      className="p-1.5 rounded-md text-on-surface-variant hover:text-white hover:bg-surface-container transition-colors"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>

                    {/* Logs */}
                    <button
                      onClick={() => setSelectedLogsApp(app)}
                      title="Ver logs da aplicação"
                      className="p-1.5 rounded-md text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors"
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Contextual More Dropdown */}
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenDropdownId(openDropdownId === app.id ? null : app.id);
                      }}
                      title="Mais opções"
                      className="p-1.5 rounded-md text-on-surface-variant hover:text-white hover:bg-surface-container transition-colors"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    {openDropdownId === app.id && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-0 bottom-full mb-1 w-52 bg-surface-container-high border border-outline-variant rounded-lg shadow-xl z-30 py-1 text-xs"
                      >
                        <button
                          onClick={() => {
                            setOpenDropdownId(null);
                            openDeploymentsHistory(app);
                          }}
                          className="w-full text-left px-3 py-2 text-on-surface hover:bg-surface-container flex items-center gap-2"
                        >
                          <Clock className="w-3.5 h-3.5 text-ok" />
                          <span>Histórico de Deploys</span>
                        </button>
                        <button
                          onClick={() => {
                            setOpenDropdownId(null);
                            setSelectedFileApp(app);
                          }}
                          className="w-full text-left px-3 py-2 text-on-surface hover:bg-surface-container flex items-center gap-2"
                        >
                          <FolderTree className="w-3.5 h-3.5 text-warn" />
                          <span>Explorar Arquivos</span>
                        </button>
                        <button
                          onClick={() => {
                            setOpenDropdownId(null);
                            setSelectedEnvApp(app);
                          }}
                          className="w-full text-left px-3 py-2 text-on-surface hover:bg-surface-container flex items-center gap-2"
                        >
                          <Sliders className="w-3.5 h-3.5 text-warn" />
                          <span>Variáveis (.env)</span>
                        </button>
                        <button
                          onClick={() => {
                            setOpenDropdownId(null);
                            setSelectedWebhookApp(app);
                          }}
                          className="w-full text-left px-3 py-2 text-on-surface hover:bg-surface-container flex items-center gap-2"
                        >
                          <Webhook className="w-3.5 h-3.5 text-tertiary" />
                          <span>Webhook Auto-Deploy</span>
                        </button>
                        <button
                          onClick={() => {
                            setOpenDropdownId(null);
                            setSelectedWorkflowApp(app);
                          }}
                          className="w-full text-left px-3 py-2 text-on-surface hover:bg-surface-container flex items-center gap-2"
                        >
                          <FileCode2 className="w-3.5 h-3.5 text-primary" />
                          <span>GitHub Actions YAML</span>
                        </button>
                        <button
                          onClick={() => {
                            setOpenDropdownId(null);
                            setSelectedEditApp(app);
                          }}
                          className="w-full text-left px-3 py-2 text-on-surface hover:bg-surface-container flex items-center gap-2"
                        >
                          <Settings2 className="w-3.5 h-3.5 text-on-surface-variant" />
                          <span>Configurações & Portas</span>
                        </button>
                        {onOpenAnalytics && (
                          <button
                            onClick={() => {
                              setOpenDropdownId(null);
                              onOpenAnalytics(app.id);
                            }}
                            className="w-full text-left px-3 py-2 text-on-surface hover:bg-surface-container flex items-center gap-2"
                          >
                            <Globe2 className="w-3.5 h-3.5 text-ok" />
                            <span>Analytics de Tráfego</span>
                          </button>
                        )}
                        <div className="my-1 border-t border-outline-variant" />
                        <button
                          onClick={() => {
                            setOpenDropdownId(null);
                            handleDelete(app.id, app.name);
                          }}
                          className="w-full text-left px-3 py-2 text-crit hover:bg-crit/10 flex items-center gap-2 font-semibold"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Deletar Aplicação</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Dense Table / List View */
        <div className="bg-surface-container rounded-lg border border-outline-variant overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container-low text-on-surface-variant text-[11px] uppercase tracking-wider font-semibold">
                <th className="py-3 px-4">Aplicação & Origem</th>
                <th className="py-3 px-4">Status & Saúde</th>
                <th className="py-3 px-4">Acesso / Rede</th>
                <th className="py-3 px-4">Recursos (CPU/RAM)</th>
                <th className="py-3 px-4">Último Deploy</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {filteredApps.map((app) => {
                const badge = appStatusBadge(app, nodes);
                const metrics = appMetrics[app.id];
                return (
                  <tr
                    key={app.id}
                    className="hover:bg-surface-container-high/40 transition-colors group"
                  >
                    {/* App & Source */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded bg-surface-container-high flex items-center justify-center font-bold text-primary shrink-0">
                          {app.sourceType === 'git' ? (
                            <GitBranch className="w-4 h-4 text-primary" />
                          ) : (
                            <Code className="w-4 h-4 text-warn" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {onOpenApp ? (
                              <button
                                onClick={() => onOpenApp(app.id)}
                                className="font-bold text-white hover:text-primary transition-colors text-left"
                              >
                                {app.name}
                              </button>
                            ) : (
                              <span className="font-bold text-white">{app.name}</span>
                            )}
                            {app.sourceType === 'git' && (
                              <span className="text-[10px] font-mono text-primary bg-primary/10 px-1.5 py-0.2 rounded border border-primary/30">
                                {app.branch || 'main'}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] font-mono text-on-surface-variant/70 truncate max-w-xs">
                            {app.gitUrl || app.imageName}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        title={badge.title}
                        className={`text-[11px] px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1.5 ${badge.className}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${badge.dotClassName}`} />
                        {badge.label}
                      </span>
                    </td>

                    {/* Networking */}
                    <td className="py-3 px-4">
                      <div className="space-y-0.5 font-mono text-[11px]">
                        {app.domain ? (
                          <a
                            href={`https://${app.domain}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-ok hover:underline flex items-center gap-1 font-semibold"
                          >
                            <Globe className="w-3 h-3 shrink-0" />
                            {app.domain}
                          </a>
                        ) : (
                          <span className="text-on-surface-variant/70">:{app.port}</span>
                        )}
                        <span className="text-on-surface-variant/70 text-[10px] block">
                          porta :{app.port}
                        </span>
                      </div>
                    </td>

                    {/* CPU & RAM */}
                    <td className="py-3 px-4 font-mono text-[11px] whitespace-nowrap">
                      {metrics && metrics.available ? (
                        <div>
                          <span className="text-white">CPU {metrics.cpuPercent}%</span> ·{' '}
                          <span className="text-white">{formatRam(metrics.memoryUsedBytes)}</span>
                        </div>
                      ) : (
                        <span className="text-on-surface-variant/60">—</span>
                      )}
                    </td>

                    {/* Last deploy */}
                    <td className="py-3 px-4 font-mono text-[11px] whitespace-nowrap">
                      <div className="text-on-surface truncate max-w-[180px]">
                        {app.lastCommitMessage || 'Deploy inicial'}
                      </div>
                      <div className="text-on-surface-variant/70 text-[10px]">
                        {app.lastDeployAt
                          ? new Date(app.lastDeployAt).toLocaleDateString('pt-BR')
                          : 'Recente'}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleTriggerDeploy(app)}
                          disabled={deployingId === app.id}
                          className="px-2.5 py-1 rounded bg-primary text-on-primary font-semibold text-xs hover:bg-primary/90 transition-all disabled:opacity-50"
                        >
                          Deploy
                        </button>
                        {onOpenApp && (
                          <button
                            onClick={() => onOpenApp(app.id)}
                            className="px-2.5 py-1 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-xs font-medium border border-outline-variant"
                          >
                            Console
                          </button>
                        )}
                        <button
                          onClick={() => handleRestart(app.id)}
                          title="Reiniciar"
                          className="p-1 rounded text-on-surface-variant hover:text-white hover:bg-surface-container-high"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setSelectedLogsApp(app)}
                          title="Logs"
                          className="p-1 rounded text-on-surface-variant hover:text-primary hover:bg-surface-container-high"
                        >
                          <FileText className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(app.id, app.name)}
                          title="Excluir"
                          className="p-1 rounded text-crit hover:bg-crit/10"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals Container */}
      {selectedEditApp && (
        <EditAppModal
          app={selectedEditApp}
          onClose={() => setSelectedEditApp(null)}
          onSaved={() => {
            setSelectedEditApp(null);
            fetchApps();
          }}
        />
      )}

      {selectedEnvApp && (
        <EnvModal
          app={selectedEnvApp}
          onClose={() => setSelectedEnvApp(null)}
          onSaved={() => {
            setSelectedEnvApp(null);
            fetchApps();
          }}
        />
      )}

      {selectedDomainApp && (
        <DomainModal
          app={selectedDomainApp}
          onClose={() => setSelectedDomainApp(null)}
          onSaved={() => {
            setSelectedDomainApp(null);
            fetchApps();
          }}
        />
      )}

      {selectedDeploymentsApp && (
        <DeployHistoryModal
          app={selectedDeploymentsApp}
          deployments={deploymentsList}
          rollingBackId={rollingBackId}
          redeployingId={redeployingId}
          onRedeploy={handleRedeploy}
          onClose={() => setSelectedDeploymentsApp(null)}
          onOpenLogs={openBuildLogs}
          onRollback={handleRollback}
        />
      )}

      {selectedWorkflowApp && (
        <WorkflowModal app={selectedWorkflowApp} onClose={() => setSelectedWorkflowApp(null)} />
      )}

      {selectedBuildLogs && (
        <BuildLogsModal deployment={selectedBuildLogs} onClose={() => setSelectedBuildLogs(null)} />
      )}

      {showAiHelpModal && <AiHelpModal onClose={() => setShowAiHelpModal(false)} />}

      {selectedWebhookApp && (
        <WebhookModal app={selectedWebhookApp} onClose={() => setSelectedWebhookApp(null)} />
      )}

      {liveDeployModal && (
        <LiveDeployModal state={liveDeployModal} onClose={() => setLiveDeployModal(null)} />
      )}

      {showCreateModal && (
        <CreateAppModal onCancel={() => setShowCreateModal(false)} onCreated={handleAppCreated} />
      )}

      {selectedLogsApp && (
        <AppLogsModal app={selectedLogsApp} onClose={() => setSelectedLogsApp(null)} />
      )}

      {selectedObservabilityApp && (
        <AppObservabilityModal
          app={selectedObservabilityApp}
          onClose={() => setSelectedObservabilityApp(null)}
        />
      )}

      {selectedFileApp && (
        <AppFilesModal app={selectedFileApp} onClose={() => setSelectedFileApp(null)} />
      )}
    </div>
  );
};
