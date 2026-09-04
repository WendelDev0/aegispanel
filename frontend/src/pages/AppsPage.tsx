import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { api } from '../services/api.js';
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

/**
 * The badge an app card shows.
 *
 * A container can be `running` and serving nothing — that is exactly what a
 * crash loop looks like — so a card that reported only the container state told
 * the operator the app was fine while the site returned errors. Health takes
 * precedence when the panel has probed it; `unknown` (every app right after a
 * panel restart) falls back to the container state rather than claiming a
 * problem nobody has observed.
 */
function appStatusBadge(
  app: AppRecord,
  nodes: ServerNode[] = [],
): {
  label: string;
  title: string;
  className: string;
  dotClassName: string;
} {
  // A node the panel cannot reach says nothing about the container it hosts.
  // Reporting "Online" there is a guess based on the last successful deploy,
  // and it is the guess that sends someone debugging the app instead of the
  // link to it.
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

interface AppsPageProps {
  /** Opens the analytics view already focused on this application. */
  onOpenAnalytics?: (appId: string) => void;
}

export const AppsPage: React.FC<AppsPageProps> = ({ onOpenAnalytics }) => {
  const [apps, setApps] = useState<AppRecord[]>([]);
  // Only to grey out apps whose node is unreachable; failure is not worth
  // blocking the page over, so an empty list simply disables that signal.
  const [nodes, setNodes] = useState<ServerNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Modals state
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
      .catch(() => {
        /* the node signal is optional; the page renders without it */
      });

    const handleStream = (data: any) => {
      setLiveDeployModal(prev => {
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
      alert('Erro ao disparar deploy: ' + (err.response?.data?.error || err.message));
    } finally {
      setTimeout(() => setDeployingId(null), 1000);
    }
  };

  const handleRollback = async (appId: string, deploymentId: string) => {
    if (!confirm('Deseja realmente reverter a aplicação para esta versão anterior? O contêiner será restaurado em segundos.')) return;
    try {
      setRollingBackId(deploymentId);
      const res = await api.post(`/apps/${appId}/rollback/${deploymentId}`);
      alert('✅ ' + res.data.message);
      fetchApps();
      if (selectedDeploymentsApp) {
        openDeploymentsHistory(selectedDeploymentsApp);
      }
    } catch (err: any) {
      alert('Erro ao executar rollback: ' + (err.response?.data?.error || err.message));
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
      alert('Erro ao carregar histórico: ' + err.message);
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
      fetchApps();
    } catch (err: any) {
      alert('Erro ao iniciar app: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleStop = async (id: string) => {
    try {
      await api.post(`/apps/${id}/stop`);
      fetchApps();
    } catch (err: any) {
      alert('Erro ao parar app: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleRestart = async (id: string) => {
    try {
      await api.post(`/apps/${id}/restart`);
      fetchApps();
    } catch (err: any) {
      alert('Erro ao reiniciar app: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Tem certeza que deseja deletar a aplicação "${name}"?`)) return;
    try {
      await api.delete(`/apps/${id}`);
      fetchApps();
    } catch (err: any) {
      alert('Erro ao deletar app: ' + (err.response?.data?.error || err.message));
    }
  };

  const filteredApps = apps.filter(a =>
    a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (a.domain && a.domain.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (a.gitUrl && a.gitUrl.toLowerCase().includes(searchTerm.toLowerCase())) ||
    a.port.toString().includes(searchTerm)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Layers className="w-6 h-6 text-primary" />
            Aplicações & CI/CD — Experiência Cloud Profissional (Aegis Style)
          </h2>
          <p className="text-sm text-on-surface-variant mt-1">
            Controle de ponta a ponta dos seus projetos com deploy em tempo real, rollback instantâneo, repositórios públicos e privados do GitHub e domínios com SSL.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowAiHelpModal(true)}
            title="Copie o prompt para a sua IA (ChatGPT, Claude, Cursor, v0) preparar o projeto para o AegisPanel"
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 font-semibold text-xs border border-purple-500/40 transition-all active:scale-95 shrink-0"
          >
            <Sparkles className="w-4 h-4 text-purple-400" />
            <span>Prompt para IA ✨</span>
          </button>

          <button
            onClick={() => setShowCreateModal(true)}
            title="Fazer deploy de um novo projeto do GitHub (Público ou Privado) ou Imagem Docker"
            className="flex items-center gap-2 px-4 py-2.5 rounded bg-primary-container hover:bg-primary text-white font-semibold text-sm transition-all active:scale-95 shrink-0"
          >
            <Plus className="w-4 h-4" />
            Novo Deploy / Projeto
          </button>
        </div>
      </div>

      {/* Search & Stats Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-on-surface-variant absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por nome do app, domínio, branch ou porta..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-surface-container border border-outline-variant rounded-lg pl-10 pr-4 py-2.5 text-xs text-white placeholder-on-surface-variant/50 focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        <div className="flex items-center gap-3 text-xs font-mono text-on-surface-variant">
          <span className="bg-surface-container-low border border-outline-variant px-3 py-1.5 rounded flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Online: <strong className="text-white">{apps.filter(a => a.status === 'running').length}</strong>
          </span>
          <span className="bg-surface-container-low border border-outline-variant px-3 py-1.5 rounded">
            Total Apps: <strong className="text-white">{apps.length}</strong>
          </span>
        </div>
      </div>

      {/* Apps Grid */}
      {loading ? (
        <div className="flex items-center justify-center p-16 text-on-surface-variant">
          <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : filteredApps.length === 0 ? (
        <div className="bg-surface-container rounded-lg p-12 border border-outline-variant text-center">
          <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
            <Layers className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white mb-1">Nenhuma aplicação encontrada</h3>
          <p className="text-sm text-on-surface-variant max-w-md mx-auto mb-6">
            Conecte seu repositório do GitHub ou escolha uma imagem Docker para fazer seu primeiro deploy.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-5 py-2.5 rounded bg-primary-container hover:bg-primary text-white font-semibold text-sm inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Criar Primeiro Deploy
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {filteredApps.map((app) => (
            <div
              key={app.id}
              className="bg-surface-container rounded-lg p-6 border border-outline-variant hover:border-primary/50 transition-all flex flex-col justify-between space-y-4"
            >
              <div>
                {/* Header: Title + Status + Branch */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary border border-primary/25 flex items-center justify-center font-bold">
                      <Code className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-white text-lg">
                          {app.name}
                        </h3>
                        {app.sourceType === 'git' ? (
                          <span className="text-[10px] font-mono text-primary bg-primary/20 px-2 py-0.5 rounded-md flex items-center gap-1 border border-primary/30">
                            <GitBranch className="w-3 h-3" /> {app.branch || 'main'}
                            {app.hasGithubToken && (
                              <span title="Repositório Privado com Token">
                                <Lock className="w-2.5 h-2.5 text-warn" />
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono text-warn bg-warn/10 px-2 py-0.5 rounded-md border border-warn/30">
                            Docker Image
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-mono text-on-surface-variant truncate max-w-xs mt-0.5">
                        {app.gitUrl || app.imageName}
                      </p>
                    </div>
                  </div>

                  {(() => {
                    // "running" only says the container exists. A crash-looping
                    // app is running and serving nothing, so the badge reports
                    // whether it actually answers when the panel knows.
                    const badge = appStatusBadge(app, nodes);
                    return (
                      <span
                        title={badge.title}
                        className={`text-xs px-3 py-1 rounded-full font-semibold flex items-center gap-1.5 shrink-0 ${badge.className}`}
                      >
                        <span className={`w-2 h-2 rounded-full ${badge.dotClassName}`}></span>
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>

                {/* Direct VPS IP + Port Access Banner */}
                <div className="mb-4">
                  {(() => {
                    const currentHost = window.location.hostname || 'localhost';
                    const directUrl = `http://${currentHost}:${app.port}`;
                    return (
                      <a
                        href={directUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg bg-emerald-950/40 hover:bg-emerald-950/60 text-ok border border-ok/30 transition-all group"
                      >
                        <div className="flex items-center gap-2 text-xs font-mono font-bold">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                          <span className="text-ok">🌐 Acesso Direto (IP:Porta):</span>
                          <span className="text-white underline underline-offset-2">{directUrl}</span>
                        </div>
                        <span className="text-xs flex items-center gap-1 font-sans font-semibold text-ok group-hover:translate-x-0.5 transition-transform">
                          Abrir Site &rarr;
                        </span>
                      </a>
                    );
                  })()}
                </div>

                {/* Domain & Network Section */}
                <div className="bg-surface-container-lowest/80 rounded-lg p-4 border border-outline-variant space-y-2.5 text-xs font-mono mb-4">
                  {/* Assigned Domain */}
                  <div className="flex items-center justify-between">
                    <span className="text-on-surface-variant flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-primary" /> Domínio Hostinger / SSL:
                    </span>
                    {app.domain ? (
                      <div className="flex items-center gap-2">
                        <a
                          href={`https://${app.domain}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-ok hover:underline flex items-center gap-1 font-bold"
                        >
                          <Lock className="w-3 h-3 text-ok" />
                          {app.domain}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        <button
                          onClick={() => setSelectedDomainApp(app)}
                          title="Alterar domínio ou subdomínio"
                          className="text-[10px] text-on-surface-variant/70 hover:text-white"
                        >
                          (Editar)
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setSelectedDomainApp(app)}
                        className="text-primary hover:text-primary hover:underline font-sans text-xs flex items-center gap-1"
                      >
                        + Vincular Domínio Hostinger
                      </button>
                    )}
                  </div>

                  {/* Public host port; internal listen port only when it differs. */}
                  <div className="flex items-center justify-between text-on-surface-variant">
                    <span>Porta:</span>
                    <div className="flex items-center gap-2">
                      <span className="text-on-surface font-semibold select-all">
                        <strong className="text-ok">:{app.port}</strong>
                        {app.internalPort && app.internalPort !== app.port && (
                          <span className="text-on-surface-variant font-normal">
                            {' '}
                            (app :{app.internalPort})
                          </span>
                        )}
                      </span>
                      <button
                        onClick={() => setSelectedEditApp(app)}
                        title="Mudar porta"
                        className="text-[11px] text-primary hover:underline font-sans"
                      >
                        (Mudar)
                      </button>
                    </div>
                  </div>

                  {appMetrics[app.id] && (
                    <button
                      type="button"
                      onClick={() => setSelectedObservabilityApp(app)}
                      className="w-full grid grid-cols-2 gap-2 text-[11px] font-mono bg-surface-container-low/60 border border-outline-variant rounded-lg px-3 py-2 text-left hover:border-primary/40"
                      title="Métricas, logs retidos e histórico de alertas"
                    >
                      <span className="text-on-surface-variant">
                        CPU <strong className="text-white">{appMetrics[app.id].cpuPercent}%</strong>
                      </span>
                      <span className="text-on-surface-variant">
                        RAM <strong className="text-white">{formatRam(appMetrics[app.id].memoryUsedBytes)}</strong>
                      </span>
                    </button>
                  )}

                  {/* Environment Variables Count */}
                  <div className="flex items-center justify-between text-on-surface-variant pt-1 border-t border-outline-variant">
                    <span className="flex items-center gap-1">
                      <Sliders className="w-3.5 h-3.5 text-warn" /> Variáveis de Ambiente:
                    </span>
                    <button
                      onClick={() => setSelectedEnvApp(app)}
                      className="text-warn hover:underline font-sans text-xs font-semibold flex items-center gap-1"
                    >
                      {Object.keys(app.env || {}).length} variável(is) .env &rarr; Editar
                    </button>
                  </div>
                </div>

                {/* Vercel-Style Git Commit & Deploy Status Card */}
                {app.sourceType === 'git' && (
                  <div className="bg-surface-container-lowest/90 rounded-lg p-3.5 border border-primary/25 space-y-2 mb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs">
                        <GitCommit className="w-4 h-4 text-primary" />
                        <span className="font-bold text-white">Último Commit Real:</span>
                      </div>
                      {app.lastCommitHash && (
                        <span className="text-[10px] font-mono font-bold bg-primary/20 text-primary px-2 py-0.5 rounded border border-primary/30">
                          #{app.lastCommitHash}
                        </span>
                      )}
                    </div>
                    
                    <div className="text-xs text-on-surface font-medium line-clamp-2 pl-5 border-l-2 border-primary/40">
                      "{app.lastCommitMessage || 'Deploy inicial realizado com sucesso'}"
                    </div>
                    
                    <div className="flex items-center justify-between text-[11px] text-on-surface-variant pl-5 pt-0.5">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3 text-on-surface-variant/70" /> {app.lastCommitAuthor || 'Wendel Dev'}
                      </span>
                      <span className="text-[10px] text-on-surface-variant/70 font-mono">
                        {app.lastDeployAt ? new Date(app.lastDeployAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'Recente'}
                      </span>
                    </div>
                  </div>
                )}

                {/* CI/CD Quick Action Pills */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1">
                  <button
                    onClick={() => openDeploymentsHistory(app)}
                    title="Ver histórico de todos os builds e deploys anteriores"
                    className="text-ok hover:underline flex items-center gap-1 font-mono text-[11px]"
                  >
                    <Clock className="w-3.5 h-3.5" /> Histórico de Builds
                  </button>

                  <button
                    onClick={() => setSelectedWorkflowApp(app)}
                    title="Ver arquivo de configuração do GitHub Actions"
                    className="text-primary hover:underline flex items-center gap-1 font-mono text-[11px]"
                  >
                    <FileCode2 className="w-3.5 h-3.5" /> GitHub Actions YAML
                  </button>

                                    <button
                    onClick={() => onOpenAnalytics?.(app.id)}
                    title="Ver analytics: visitas, países de origem e erros"
                    className="p-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant hover:text-ok transition-colors"
                  >
                    <Globe2 className="w-4 h-4" />
                  </button>
<button
                    onClick={() => setSelectedWebhookApp(app)}
                    title="Copiar URL de Webhook para Auto-Deploy"
                    className="text-tertiary hover:underline flex items-center gap-1 font-mono text-[11px]"
                  >
                    <Webhook className="w-3.5 h-3.5" /> Webhook URL
                  </button>
                </div>
              </div>

              {/* Action Buttons Row */}
              <div className="pt-4 border-t border-outline-variant flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Deploy Button */}
                  <button
                    onClick={() => handleTriggerDeploy(app)}
                    disabled={deployingId === app.id}
                    title="Disparar novo deploy agora (Git Pull & Rebuild)"
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded bg-primary-container hover:bg-primary text-white text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
                  >
                    <Zap className={`w-3.5 h-3.5 ${deployingId === app.id ? 'animate-bounce' : ''}`} />
                    <span>{deployingId === app.id ? 'Buildando...' : 'Deploy'}</span>
                  </button>

                  {/* Edit Config / Port */}
                  <button
                    onClick={() => setSelectedEditApp(app)}
                    title="Editar configurações (Porta, Nome, Imagem, Token GitHub)"
                    className="p-2 rounded bg-surface-container-high text-on-surface-variant hover:text-white hover:bg-surface-container-highest transition-colors"
                  >
                    <Settings2 className="w-4 h-4" />
                  </button>

                  {/* View Files Explorer Button */}
                  <button
                    onClick={() => setSelectedFileApp(app)}
                    title="Explorar e editar arquivos do código-fonte da aplicação"
                    className="flex items-center gap-1.5 px-3 py-2 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-xs font-semibold border border-outline-variant transition-colors"
                  >
                    <FolderTree className="w-3.5 h-3.5 text-warn" />
                    <span>Arquivos</span>
                  </button>

                  {/* Start / Stop */}
                  {app.status === 'running' ? (
                    <button
                      onClick={() => handleStop(app.id)}
                      title="Parar aplicação"
                      className="p-2 rounded bg-warn/10 text-warn hover:bg-warn/15 transition-colors"
                    >
                      <Square className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleStart(app.id)}
                      title="Iniciar aplicação"
                      className="p-2 rounded bg-ok/10 text-ok hover:bg-ok/15 transition-colors"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}

                  {/* Restart */}
                  <button
                    onClick={() => handleRestart(app.id)}
                    title="Reiniciar contêiner da aplicação"
                    className="p-2 rounded bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>

                  {/* Logs Button */}
                  <button
                    onClick={() => setSelectedLogsApp(app)}
                    title="Visualizar logs em tempo real da aplicação"
                    className="flex items-center gap-1.5 px-3 py-2 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant hover:text-white text-xs font-medium transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5 text-primary" />
                    Logs
                  </button>
                  <button
                    onClick={() => setSelectedObservabilityApp(app)}
                    title="CPU, memória, logs retidos e histórico de alertas"
                    className="flex items-center gap-1.5 px-3 py-2 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant hover:text-white text-xs font-medium transition-colors"
                  >
                    <Activity className="w-3.5 h-3.5 text-ok" />
                    Métricas
                  </button>
                </div>

                {/* Delete */}
                <button
                  onClick={() => handleDelete(app.id, app.name)}
                  title="Deletar aplicação permanentemente"
                  className="p-2 rounded text-crit hover:bg-crit/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

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
