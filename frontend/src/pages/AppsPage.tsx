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
  X,
  Code,
  Globe,
  GitBranch,
  Webhook,
  Copy,
  Check,
  Zap,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileCode2,
  Terminal,
  ArrowRight,
  Sliders,
  Lock,
  Eye,
  EyeOff,
  Search,
  Key,
  ShieldCheck,
  HelpCircle,
  FolderTree,
  Settings2,
  GitCommit,
  User,
  RotateCcw,
  Globe2,
  Sparkles,
  Save,
} from 'lucide-react';
import { api } from '../services/api.js';
import { socket } from '../services/socket.js';
import { AppRecord, DeploymentRecord } from '../types/index.js';
import { EnvEditor } from '../components/EnvEditor.js';
import { DeployHistoryModal } from '../components/apps/DeployHistoryModal.js';
import { BuildLogsModal } from '../components/apps/BuildLogsModal.js';
import { CreateAppModal } from '../components/apps/CreateAppModal.js';
import { EditAppModal } from '../components/apps/EditAppModal.js';
import { AppFilesModal } from '../components/apps/AppFilesModal.js';

interface AppsPageProps {
  /** Opens the analytics view already focused on this application. */
  onOpenAnalytics?: (appId: string) => void;
}

export const AppsPage: React.FC<AppsPageProps> = ({ onOpenAnalytics }) => {
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Modals state
  const [selectedLogsApp, setSelectedLogsApp] = useState<AppRecord | null>(null);
  const [selectedWebhookApp, setSelectedWebhookApp] = useState<AppRecord | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [selectedDeploymentsApp, setSelectedDeploymentsApp] = useState<AppRecord | null>(null);
  const [deploymentsList, setDeploymentsList] = useState<DeploymentRecord[]>([]);
  const [selectedWorkflowApp, setSelectedWorkflowApp] = useState<AppRecord | null>(null);
  const [workflowYaml, setWorkflowYaml] = useState('');
  const [selectedBuildLogs, setSelectedBuildLogs] = useState<DeploymentRecord | null>(null);

  // Settings / Port Edit Modal
  const [selectedEditApp, setSelectedEditApp] = useState<AppRecord | null>(null);

  // Env Editor modal
  const [selectedEnvApp, setSelectedEnvApp] = useState<AppRecord | null>(null);
  const [envRecordDraft, setEnvRecordDraft] = useState<Record<string, string>>({});
  const [loadingEnv, setLoadingEnv] = useState(false);
  const [savingEnv, setSavingEnv] = useState(false);
  const [redeployOnSave, setRedeployOnSave] = useState(true);

  // Domain Editor modal
  const [selectedDomainApp, setSelectedDomainApp] = useState<AppRecord | null>(null);
  const [domainInput, setDomainInput] = useState('');
  const [savingDomain, setSavingDomain] = useState(false);

  // File Explorer Modal
  const [selectedFileApp, setSelectedFileApp] = useState<AppRecord | null>(null);

  const [logsText, setLogsText] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedWorkflow, setCopiedWorkflow] = useState(false);
  const [deployingId, setDeployingId] = useState<string | null>(null);

  // Live Deploy Streaming Progress Modal State
  const [liveDeployModal, setLiveDeployModal] = useState<{
    app: AppRecord;
    step: number;
    stepName: string;
    logs: string;
    percentage: number;
    status: 'running' | 'success' | 'failed';
  } | null>(null);

  const [rollingBackId, setRollingBackId] = useState<string | null>(null);

  // AI Prompt Help Modal
  const [showAiHelpModal, setShowAiHelpModal] = useState(false);
  const [copiedAiPrompt, setCopiedAiPrompt] = useState(false);

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

  const openEnvModal = async (app: AppRecord) => {
    try {
      setLoadingEnv(true);
      setSelectedEnvApp(app);
      const res = await api.get(`/apps/${app.id}/env`);
      const loadedEnv = res.data.env || {};
      setEnvRecordDraft(loadedEnv);
    } catch (err: any) {
      alert('Erro ao carregar variáveis: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoadingEnv(false);
    }
  };

  const handleSaveEnv = async (redeploy: boolean = true) => {
    if (!selectedEnvApp) return;

    try {
      setSavingEnv(true);
      await api.put(`/apps/${selectedEnvApp.id}/env?redeploy=${redeploy}`, { env: envRecordDraft });
      setSelectedEnvApp(null);
      fetchApps();
      alert('✅ Variáveis de ambiente (.env) atualizadas e aplicadas com sucesso!');
    } catch (err: any) {
      alert('Erro ao salvar .env: ' + (err.response?.data?.error || err.message));
    } finally {
      setSavingEnv(false);
    }
  };

  const openDomainModal = (app: AppRecord) => {
    setSelectedDomainApp(app);
    setDomainInput(app.domain || '');
  };

  const handleSaveDomain = async () => {
    if (!selectedDomainApp) return;
    try {
      setSavingDomain(true);
      await api.put(`/apps/${selectedDomainApp.id}/domain`, { domain: domainInput });
      setSelectedDomainApp(null);
      fetchApps();
      alert('✅ Domínio e certificado SSL configurados com sucesso!');
    } catch (err: any) {
      alert('Erro ao salvar domínio: ' + (err.response?.data?.error || err.message));
    } finally {
      setSavingDomain(false);
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

  const openWorkflowModal = async (app: AppRecord) => {
    setSelectedWorkflowApp(app);
    try {
      const res = await api.get(`/apps/${app.id}/workflow`);
      setWorkflowYaml(res.data.yaml);
    } catch (err: any) {
      alert('Erro ao gerar workflow: ' + err.message);
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

  const openLogs = async (app: AppRecord) => {
    setSelectedLogsApp(app);
    setLogsLoading(true);
    setLogsText('');
    try {
      const res = await api.get(`/apps/${app.id}/logs`);
      setLogsText(res.data.logs || 'Sem logs disponíveis.');
    } catch (err: any) {
      setLogsText('Erro ao carregar logs: ' + err.message);
    } finally {
      setLogsLoading(false);
    }
  };

  /**
   * The webhook secret is never included in the apps listing: it is fetched
   * from a dedicated endpoint only when the user opens this modal.
   */
  const openWebhookModal = async (app: AppRecord) => {
    setSelectedWebhookApp(app);
    setWebhookUrl('');
    setWebhookLoading(true);
    try {
      const res = await api.get(`/apps/${app.id}/webhook`);
      setWebhookUrl(res.data.url);
    } catch (err: any) {
      setWebhookUrl('');
      alert('Não foi possível obter a URL do webhook: ' + (err.response?.data?.error || err.message));
    } finally {
      setWebhookLoading(false);
    }
  };

  const rotateWebhookSecret = async (app: AppRecord) => {
    if (!confirm('Gerar um novo segredo invalida a URL atual. Você precisará atualizá-la no GitHub. Continuar?')) {
      return;
    }
    setWebhookLoading(true);
    try {
      await api.post(`/apps/${app.id}/webhook-secret`);
      const res = await api.get(`/apps/${app.id}/webhook`);
      setWebhookUrl(res.data.url);
    } catch (err: any) {
      alert('Falha ao gerar novo segredo: ' + (err.response?.data?.error || err.message));
    } finally {
      setWebhookLoading(false);
    }
  };

  const copyWebhookUrl = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  const copyWorkflowYaml = () => {
    navigator.clipboard.writeText(workflowYaml);
    setCopiedWorkflow(true);
    setTimeout(() => setCopiedWorkflow(false), 2000);
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

                  <span
                    className={`text-xs px-3 py-1 rounded-full font-semibold flex items-center gap-1.5 shrink-0 ${
                      app.status === 'running'
                        ? 'bg-ok/10 text-ok border border-ok/30'
                        : 'bg-surface-container-high text-on-surface-variant border border-outline-variant'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        app.status === 'running' ? 'bg-emerald-400 animate-pulse' : 'bg-outline'
                      }`}
                    ></span>
                    {app.status === 'running' ? 'Online' : 'Parado'}
                  </span>
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
                          onClick={() => openDomainModal(app)}
                          title="Alterar domínio ou subdomínio"
                          className="text-[10px] text-on-surface-variant/70 hover:text-white"
                        >
                          (Editar)
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => openDomainModal(app)}
                        className="text-primary hover:text-primary hover:underline font-sans text-xs flex items-center gap-1"
                      >
                        + Vincular Domínio Hostinger
                      </button>
                    )}
                  </div>

                  {/* Port Mapping with Edit shortcut */}
                  <div className="flex items-center justify-between text-on-surface-variant">
                    <span>Mapeamento de Portas:</span>
                    <div className="flex items-center gap-2">
                      <span className="text-on-surface font-semibold select-all">
                        Host <strong className="text-ok">:{app.port}</strong> &rarr; Container :{app.internalPort}
                      </span>
                      <button
                        onClick={() => setSelectedEditApp(app)}
                        title="Mudar porta do host (ex: 5000, 8080)"
                        className="text-[11px] text-primary hover:underline font-sans"
                      >
                        (Mudar Porta)
                      </button>
                    </div>
                  </div>

                  {/* Environment Variables Count */}
                  <div className="flex items-center justify-between text-on-surface-variant pt-1 border-t border-outline-variant">
                    <span className="flex items-center gap-1">
                      <Sliders className="w-3.5 h-3.5 text-warn" /> Variáveis de Ambiente:
                    </span>
                    <button
                      onClick={() => openEnvModal(app)}
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
                    onClick={() => openWorkflowModal(app)}
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
                    onClick={() => openWebhookModal(app)}
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
                    onClick={() => openLogs(app)}
                    title="Visualizar logs em tempo real da aplicação"
                    className="flex items-center gap-1.5 px-3 py-2 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant hover:text-white text-xs font-medium transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5 text-primary" />
                    Logs
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

      {/* Modal: Editar Variáveis de Ambiente (.env) */}
      {selectedEnvApp && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-container rounded-xl border border-outline-variant w-full max-w-2xl overflow-hidden p-6 space-y-4 shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-warn/10 p-2 flex items-center justify-center text-warn">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Variáveis de Ambiente (.env)</h3>
                  <p className="text-[11px] text-on-surface-variant font-mono">Aplicação: {selectedEnvApp.name}</p>
                </div>
              </div>
              <button onClick={() => setSelectedEnvApp(null)} className="text-on-surface-variant hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto custom-scrollbar flex-1 pr-1">
              {loadingEnv ? (
                <div className="flex items-center justify-center p-12 text-on-surface-variant gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-primary" />
                  <span className="text-xs">Carregando variáveis do servidor...</span>
                </div>
              ) : (
                <EnvEditor
                  initialEnv={envRecordDraft}
                  onChange={(record) => {
                    setEnvRecordDraft(record);
                  }}
                  title="Variáveis em Produção"
                />
              )}
            </div>

            <div className="pt-3 border-t border-outline-variant flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-on-surface select-none">
                <input
                  type="checkbox"
                  checked={redeployOnSave}
                  onChange={(e) => setRedeployOnSave(e.target.checked)}
                  className="rounded border-outline-variant text-primary focus:ring-primary w-4 h-4"
                />
                <span>Reiniciar contêiner e aplicar alterações imediatamente</span>
              </label>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedEnvApp(null)}
                  className="px-4 py-2 text-on-surface-variant hover:text-white text-xs font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveEnv(redeployOnSave)}
                  disabled={savingEnv || loadingEnv}
                  className="px-5 py-2.5 bg-primary-container hover:bg-primary text-white rounded-lg text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 shadow-md flex items-center gap-1.5"
                >
                  {savingEnv ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Salvando & Aplicando...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Salvar Variáveis (.env)</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Vincular Domínio & Subdomínio */}
      {selectedDomainApp && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-container rounded-lg border border-outline-variant w-full max-w-md overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-primary" />
                <h3 className="font-bold text-white text-base">Domínio / Subdomínio (Hostinger)</h3>
              </div>
              <button onClick={() => setSelectedDomainApp(null)} className="text-on-surface-variant hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-on-surface-variant">
              Digite o domínio ou subdomínio que deseja apontar para este app (ex: <code className="text-primary">api.meusite.com.br</code> ou <code className="text-primary">meusite.com</code>):
            </p>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant uppercase mb-1.5">
                Nome do Domínio *
              </label>
              <input
                type="text"
                required
                placeholder="ex: app.meusite.com.br"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-primary"
              />
              <p className="text-[10px] text-on-surface-variant mt-1">
                🔒 O Caddy emitirá o certificado SSL (HTTPS com cadeado) automaticamente.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedDomainApp(null)}
                className="px-4 py-2 text-on-surface-variant hover:text-white text-xs font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveDomain}
                disabled={savingDomain}
                className="px-5 py-2.5 bg-primary-container hover:bg-primary text-white rounded text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
              >
                {savingDomain ? 'Configurando SSL...' : 'Salvar Domínio'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Histórico de Deploys */}
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

      {/* Modal: GitHub Actions Workflow YAML */}
      {selectedWorkflowApp && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-container rounded-lg border border-outline-variant w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-5 bg-surface-container-low/90 border-b border-outline-variant flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCode2 className="w-5 h-5 text-primary" />
                <span className="font-bold text-white text-sm">GitHub Actions CI/CD Workflow</span>
              </div>
              <button onClick={() => setSelectedWorkflowApp(null)} className="text-on-surface-variant hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <p className="text-xs text-on-surface-variant">
                Salve este código no seu repositório GitHub dentro de <code className="text-primary bg-surface-container-low px-1.5 py-0.5 rounded font-mono">.github/workflows/deploy.yml</code>:
              </p>

              <div className="relative bg-surface-container-lowest p-4 rounded-lg border border-outline-variant font-mono text-xs text-ok overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-72">
                {workflowYaml}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={copyWorkflowYaml}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary-container hover:bg-primary text-white rounded text-xs font-semibold shadow transition-all active:scale-95"
                >
                  {copiedWorkflow ? <Check className="w-4 h-4 text-ok" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedWorkflow ? 'Código Copiado!' : 'Copiar YAML'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Build Logs Output */}
      {selectedBuildLogs && (
        <BuildLogsModal
          deployment={selectedBuildLogs}
          onClose={() => setSelectedBuildLogs(null)}
        />
      )}

      {/* Modal: AI Prompt Generator (Vercel to AegisPanel) */}
      {showAiHelpModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-container rounded-lg border border-purple-500/40 w-full max-w-2xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded bg-purple-500/20 text-purple-400">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Prompt Mágico para IAs (Vercel ➔ AegisPanel)</h3>
                  <p className="text-xs text-on-surface-variant">Envie este prompt para sua IA (ChatGPT, Claude, Cursor, v0) preparar seu código.</p>
                </div>
              </div>
              <button onClick={() => setShowAiHelpModal(false)} className="text-on-surface-variant hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <textarea
              readOnly
              rows={10}
              className="w-full bg-surface-container-lowest/90 border border-outline-variant rounded-lg p-4 text-xs font-mono text-on-surface focus:outline-none select-all custom-scrollbar leading-relaxed"
              value={`Estou hospedando meu projeto no painel AegisPanel (uma plataforma Cloud PaaS que roda em VPS Linux com Docker e Caddy).
A maioria dos meus projetos foi inicialmente desenvolvida para a Vercel, mas agora preciso que você adapte e prepare todo o código para rodar no AegisPanel sem nenhum erro de build ou deploy:

1. SCRIPTS NO PACKAGE.JSON:
   - Certifique-se de que os scripts "build" e "start" existem e funcionam corretamente.
   - O script "start" deve iniciar o servidor de produção (ex: "next start", "node dist/index.js", etc.).
   - Se for uma SPA (Vite/React), certifique-se de que "build" gera a pasta "dist".

2. HOST E PORTA (BINDING):
   - O servidor DEVE escutar no host '0.0.0.0' (e NÃO apenas em 'localhost').
   - Use a porta fornecida pela variável de ambiente: process.env.PORT || 3000.

3. DEPENDÊNCIAS:
   - Mova ferramentas de build essenciais para "dependencies" ou garanta que rodem no build.
   - Substitua quaisquer dependências exclusivas da Vercel Edge por equivalentes universais Node.js.

Revise meus arquivos de configuração e me entregue o código pronto para deploy!`}
            />

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-on-surface-variant flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                <span>Compatível com ChatGPT, Claude 3.5, Cursor e v0.</span>
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowAiHelpModal(false)}
                  className="px-4 py-2 text-on-surface-variant hover:text-white text-xs font-semibold"
                >
                  Fechar
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`Estou hospedando meu projeto no painel AegisPanel (uma plataforma Cloud PaaS que roda em VPS Linux com Docker e Caddy).
A maioria dos meus projetos foi inicialmente desenvolvida para a Vercel, mas agora preciso que você adapte e prepare todo o código para rodar no AegisPanel sem nenhum erro de build ou deploy:

1. SCRIPTS NO PACKAGE.JSON:
   - Certifique-se de que os scripts "build" e "start" existem e funcionam corretamente.
   - O script "start" deve iniciar o servidor de produção (ex: "next start", "node dist/index.js", etc.).
   - Se for uma SPA (Vite/React), certifique-se de que "build" gera a pasta "dist".

2. HOST E PORTA (BINDING):
   - O servidor DEVE escutar no host '0.0.0.0' (e NÃO apenas em 'localhost').
   - Use a porta fornecida pela variável de ambiente: process.env.PORT || 3000.

3. DEPENDÊNCIAS:
   - Mova ferramentas de build essenciais para "dependencies" ou garanta que rodem no build.
   - Substitua quaisquer dependências exclusivas da Vercel Edge por equivalentes universais Node.js.

Revise meus arquivos de configuração e me entregue o código pronto para deploy!`);
                    setCopiedAiPrompt(true);
                    setTimeout(() => setCopiedAiPrompt(false), 2000);
                  }}
                  className="flex items-center gap-1.5 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded text-xs font-semibold transition-all active:scale-95"
                >
                  {copiedAiPrompt ? <Check className="w-4 h-4 text-ok" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedAiPrompt ? 'Copiado com Sucesso!' : 'Copiar Prompt para Minha IA'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Webhook Info */}
      {selectedWebhookApp && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-container rounded-lg border border-outline-variant w-full max-w-lg overflow-hidden p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Webhook className="w-5 h-5 text-primary" />
                Webhook de Auto-Deploy do GitHub
              </h3>
              <button onClick={() => setSelectedWebhookApp(null)} className="text-on-surface-variant hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-on-surface-variant mb-4">
              No seu repositório GitHub, vá em <strong>Settings &rarr; Webhooks &rarr; Add Webhook</strong> e cole a Payload URL abaixo:
            </p>

            <div className="space-y-2 mb-4">
              <label className="text-[11px] font-semibold text-on-surface-variant uppercase">Payload URL</label>
              <div className="flex items-center gap-2 bg-surface-container-lowest p-3 rounded border border-outline-variant font-mono text-xs text-primary">
                <span className="truncate flex-1 select-all">
                  {webhookLoading ? 'Carregando...' : webhookUrl || 'Indisponível'}
                </span>
                <button
                  onClick={copyWebhookUrl}
                  title="Copiar URL do Webhook"
                  className="p-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface"
                >
                  {copiedWebhook ? <Check className="w-4 h-4 text-ok" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <p className="text-[11px] text-on-surface-variant mb-4">
              Trate esta URL como uma senha: quem a possui pode disparar deploys desta aplicação.
              Se ela vazar, gere um novo segredo e atualize o webhook no GitHub.
            </p>

            <div className="flex justify-between items-center gap-2">
              <button
                onClick={() => rotateWebhookSecret(selectedWebhookApp)}
                disabled={webhookLoading}
                className="px-4 py-2.5 bg-surface-container-high hover:bg-surface-container-highest disabled:opacity-50 text-on-surface rounded text-xs font-semibold"
              >
                Gerar novo segredo
              </button>
              <button
                onClick={() => setSelectedWebhookApp(null)}
                className="px-5 py-2.5 bg-primary-container hover:bg-primary text-white rounded text-xs font-semibold"
              >
                Concluído
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Live Deploy Streaming Progress Tracker (Aegis Style) */}
      {liveDeployModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest rounded-lg border border-primary/40 w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="p-5 bg-surface-container-low/90 border-b border-outline-variant flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded ${
                  liveDeployModal.status === 'success' ? 'bg-ok/15 text-ok' :
                  liveDeployModal.status === 'failed' ? 'bg-crit/15 text-crit' :
                  'bg-primary/20 text-primary'
                }`}>
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base flex items-center gap-2">
                    <span>Deploy em Tempo Real: {liveDeployModal.app.name}</span>
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-mono font-semibold ${
                      liveDeployModal.status === 'success' ? 'bg-ok/15 text-ok' :
                      liveDeployModal.status === 'failed' ? 'bg-crit/15 text-crit' :
                      'bg-primary/20 text-primary animate-pulse'
                    }`}>
                      {liveDeployModal.status.toUpperCase()}
                    </span>
                  </h3>
                  <p className="text-xs text-on-surface-variant">
                    Step {liveDeployModal.step}/5: {liveDeployModal.stepName}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setLiveDeployModal(null)}
                className="text-on-surface-variant hover:text-white p-2 rounded hover:bg-surface-container-high transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-surface-container-lowest h-2">
              <div
                className={`h-full transition-all duration-300 ${
                  liveDeployModal.status === 'failed' ? 'bg-crit' :
                  liveDeployModal.status === 'success' ? 'bg-ok' :
                  'bg-primary-container'
                }`}
                style={{ width: `${liveDeployModal.percentage}%` }}
              />
            </div>

            {/* 5-Step Visual Stepper */}
            <div className="p-4 bg-surface-container-lowest/80 border-b border-outline-variant grid grid-cols-5 gap-2 text-center text-[11px]">
              {[
                { num: 1, label: 'Auth & Repo' },
                { num: 2, label: 'Git Clone' },
                { num: 3, label: 'Detector' },
                { num: 4, label: 'Build Docker' },
                { num: 5, label: 'Online' },
              ].map(st => {
                const isPassed = liveDeployModal.step > st.num || liveDeployModal.status === 'success';
                const isCurrent = liveDeployModal.step === st.num && liveDeployModal.status === 'running';
                return (
                  <div
                    key={st.num}
                    className={`p-2 rounded border transition-all ${
                      isPassed ? 'bg-ok/10 border-ok/30 text-ok font-semibold' :
                      isCurrent ? 'bg-primary/20 border-primary text-white font-bold animate-pulse' :
                      'bg-surface-container-low/40 border-outline-variant text-on-surface-variant/70'
                    }`}
                  >
                    <div className="text-[10px] font-mono mb-0.5">PASSO {st.num}</div>
                    <div className="truncate">{st.label}</div>
                  </div>
                );
              })}
            </div>

            {/* Live Streaming Logs Terminal */}
            <div className="p-4 bg-black/95 flex-1 overflow-y-auto font-mono text-xs text-ok leading-relaxed custom-scrollbar whitespace-pre-wrap min-h-[250px] max-h-[350px]">
              {liveDeployModal.logs || 'Aguardando saída de build do servidor...'}
            </div>

            {/* Footer */}
            <div className="p-4 bg-surface-container-low/90 border-t border-outline-variant flex items-center justify-between">
              <span className="text-xs text-on-surface-variant flex items-center gap-2">
                {liveDeployModal.status === 'running' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary" />
                    <span>Compilando contêiner isolado...</span>
                  </>
                ) : liveDeployModal.status === 'success' ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-ok" />
                    <span>Aplicação compilada e online com sucesso!</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3.5 h-3.5 text-crit" />
                    <span>O processo de build foi interrompido com erro.</span>
                  </>
                )}
              </span>
              <button
                onClick={() => setLiveDeployModal(null)}
                className="px-5 py-2 rounded bg-primary-container hover:bg-primary text-white font-semibold text-xs transition-all"
              >
                {liveDeployModal.status === 'running' ? 'Minimizar' : 'Fechar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <CreateAppModal
          onCancel={() => setShowCreateModal(false)}
          onCreated={handleAppCreated}
        />
      )}

      {/* Modal: Live Logs */}
      {selectedLogsApp && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0a0f1c] rounded-lg border border-outline-variant w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-4 bg-surface-container-low/90 border-b border-outline-variant flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                <span className="font-bold text-white text-sm">Logs da Aplicação: {selectedLogsApp.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openLogs(selectedLogsApp)}
                  className="p-1.5 rounded-lg text-on-surface-variant hover:text-white bg-surface-container-high hover:bg-surface-container-highest"
                  title="Atualizar logs"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setSelectedLogsApp(null)}
                  className="text-on-surface-variant hover:text-white p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-5 flex-1 overflow-auto font-mono text-xs text-ok bg-black/90 whitespace-pre-wrap leading-relaxed custom-scrollbar">
              {logsLoading ? 'Carregando logs...' : logsText}
            </div>
          </div>
        </div>
      )}

      {selectedFileApp && (
        <AppFilesModal
          app={selectedFileApp}
          onClose={() => setSelectedFileApp(null)}
        />
      )}
    </div>
  );
};
