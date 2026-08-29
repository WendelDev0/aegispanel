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
  Settings2
} from 'lucide-react';
import { api } from '../services/api.js';
import { AppRecord, DeploymentRecord } from '../types/index.js';

export const AppsPage: React.FC = () => {
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Modals state
  const [selectedLogsApp, setSelectedLogsApp] = useState<AppRecord | null>(null);
  const [selectedWebhookApp, setSelectedWebhookApp] = useState<AppRecord | null>(null);
  const [selectedDeploymentsApp, setSelectedDeploymentsApp] = useState<AppRecord | null>(null);
  const [deploymentsList, setDeploymentsList] = useState<DeploymentRecord[]>([]);
  const [selectedWorkflowApp, setSelectedWorkflowApp] = useState<AppRecord | null>(null);
  const [workflowYaml, setWorkflowYaml] = useState('');
  const [selectedBuildLogs, setSelectedBuildLogs] = useState<DeploymentRecord | null>(null);

  // Settings / Port Edit Modal
  const [selectedEditApp, setSelectedEditApp] = useState<AppRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editPort, setEditPort] = useState('');
  const [editInternalPort, setEditInternalPort] = useState('');
  const [editImageName, setEditImageName] = useState('');
  const [editGitUrl, setEditGitUrl] = useState('');
  const [editBranch, setEditBranch] = useState('');
  const [editGithubToken, setEditGithubToken] = useState('');
  const [showTokenEdit, setShowTokenEdit] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  // Env Editor modal
  const [selectedEnvApp, setSelectedEnvApp] = useState<AppRecord | null>(null);
  const [envString, setEnvString] = useState('');
  const [savingEnv, setSavingEnv] = useState(false);

  // Domain Editor modal
  const [selectedDomainApp, setSelectedDomainApp] = useState<AppRecord | null>(null);
  const [domainInput, setDomainInput] = useState('');
  const [savingDomain, setSavingDomain] = useState(false);

  const [logsText, setLogsText] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedWorkflow, setCopiedWorkflow] = useState(false);
  const [deployingId, setDeployingId] = useState<string | null>(null);

  // Create Form state
  const [appName, setAppName] = useState('');
  const [sourceType, setSourceType] = useState<'image' | 'git'>('git');
  const [imageName, setImageName] = useState('nginx:alpine');
  const [gitUrl, setGitUrl] = useState('https://github.com/usuario/meu-app.git');
  const [branch, setBranch] = useState('main');
  const [githubToken, setGithubToken] = useState('');
  const [showTokenCreate, setShowTokenCreate] = useState(false);
  const [port, setPort] = useState('5000');
  const [internalPort, setInternalPort] = useState('3000');
  const [createDomain, setCreateDomain] = useState('');
  const [createEnvString, setCreateEnvString] = useState('NODE_ENV=production\nPORT=3000');
  const [submitting, setSubmitting] = useState(false);

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
  }, []);

  const handleCreateApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appName || !port) return;

    try {
      setSubmitting(true);
      const envObj: Record<string, string> = {};
      createEnvString.split('\n').forEach(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
          const key = parts[0].trim();
          const val = parts.slice(1).join('=').trim();
          if (key) envObj[key] = val;
        }
      });

      await api.post('/apps', {
        name: appName,
        sourceType,
        imageName: sourceType === 'image' ? imageName : undefined,
        gitUrl: sourceType === 'git' ? gitUrl : undefined,
        branch: sourceType === 'git' ? branch : undefined,
        githubToken: sourceType === 'git' && githubToken ? githubToken : undefined,
        port: parseInt(port),
        internalPort: parseInt(internalPort),
        domain: createDomain.trim() || undefined,
        env: envObj,
      });

      setShowCreateModal(false);
      setAppName('');
      setGithubToken('');
      setCreateDomain('');
      fetchApps();
    } catch (err: any) {
      alert('Erro ao criar aplicação: ' + (err.response?.data?.error || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const openEditModal = (app: AppRecord) => {
    setSelectedEditApp(app);
    setEditName(app.name);
    setEditPort(app.port.toString());
    setEditInternalPort(app.internalPort.toString());
    setEditImageName(app.imageName || '');
    setEditGitUrl(app.gitUrl || '');
    setEditBranch(app.branch || 'main');
    setEditGithubToken(app.githubToken || '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEditApp || !editPort) return;

    try {
      setSavingEdit(true);
      await api.put(`/apps/${selectedEditApp.id}`, {
        name: editName,
        port: parseInt(editPort),
        internalPort: parseInt(editInternalPort || '3000'),
        imageName: editImageName || undefined,
        gitUrl: editGitUrl || undefined,
        branch: editBranch || undefined,
        githubToken: editGithubToken || undefined,
      });

      setSelectedEditApp(null);
      fetchApps();
      alert(`🎉 Aplicação atualizada para a porta :${editPort} com sucesso!`);
    } catch (err: any) {
      alert('Erro ao atualizar: ' + (err.response?.data?.error || err.message));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleTriggerDeploy = async (app: AppRecord) => {
    try {
      setDeployingId(app.id);
      await api.post(`/apps/${app.id}/deploy`, {
        message: 'Deploy manual acionado pelo painel',
      });
      fetchApps();
    } catch (err: any) {
      alert('Erro ao disparar deploy: ' + (err.response?.data?.error || err.message));
    } finally {
      setTimeout(() => setDeployingId(null), 1000);
    }
  };

  const openEnvModal = (app: AppRecord) => {
    setSelectedEnvApp(app);
    const envLines = Object.entries(app.env || {}).map(([k, v]) => `${k}=${v}`).join('\n');
    setEnvString(envLines);
  };

  const handleSaveEnv = async (redeploy: boolean = true) => {
    if (!selectedEnvApp) return;

    const envObj: Record<string, string> = {};
    envString.split('\n').forEach(line => {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const val = parts.slice(1).join('=').trim();
        if (key) envObj[key] = val;
      }
    });

    try {
      setSavingEnv(true);
      await api.put(`/apps/${selectedEnvApp.id}/env?redeploy=${redeploy}`, { env: envObj });
      setSelectedEnvApp(null);
      fetchApps();
      alert('✅ Variáveis de ambiente atualizadas com sucesso!');
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

  const openWorkflowModal = async (app: AppRecord) => {
    setSelectedWorkflowApp(app);
    try {
      const res = await api.get(`/apps/${app.id}/github-workflow`);
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

  const copyWebhookUrl = (app: AppRecord) => {
    const host = window.location.origin;
    const url = `${host}/api/webhooks/deploy/${app.id}?secret=${app.webhookSecret || 'aegis_default_secret'}`;
    navigator.clipboard.writeText(url);
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
            <Layers className="w-6 h-6 text-indigo-400" />
            Aplicações & CI/CD Pipeline (PaaS Dashboard)
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Controle de ponta a ponta dos seus projetos: repositórios públicos e privados do GitHub, URLs localhost e domínios com SSL.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          title="Fazer deploy de um novo projeto do GitHub (Público ou Privado) ou Imagem Docker"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all active:scale-95 shrink-0"
        >
          <Plus className="w-4 h-4" />
          Novo Deploy / Projeto
        </button>
      </div>

      {/* Search & Stats Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por nome do app, domínio, branch ou porta..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#0f172a] border border-slate-800 rounded-2xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
          <span className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Online: <strong className="text-white">{apps.filter(a => a.status === 'running').length}</strong>
          </span>
          <span className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl">
            Total Apps: <strong className="text-white">{apps.length}</strong>
          </span>
        </div>
      </div>

      {/* Apps Grid */}
      {loading ? (
        <div className="flex items-center justify-center p-16 text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
        </div>
      ) : filteredApps.length === 0 ? (
        <div className="bg-[#0f172a]/60 rounded-3xl p-12 border border-slate-800 text-center">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto mb-4">
            <Layers className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white mb-1">Nenhuma aplicação encontrada</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto mb-6">
            Conecte seu repositório do GitHub ou escolha uma imagem Docker para fazer seu primeiro deploy.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm inline-flex items-center gap-2 shadow-lg shadow-indigo-600/30"
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
              className="bg-[#0f172a]/90 rounded-3xl p-6 border border-slate-800 hover:border-indigo-500/50 transition-all flex flex-col justify-between shadow-xl space-y-4"
            >
              <div>
                {/* Header: Title + Status + Branch */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center font-bold shadow-inner">
                      <Code className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-white text-lg">
                          {app.name}
                        </h3>
                        {app.sourceType === 'git' ? (
                          <span className="text-[10px] font-mono text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded-md flex items-center gap-1 border border-indigo-500/30">
                            <GitBranch className="w-3 h-3" /> {app.branch || 'main'}
                            {app.githubToken && (
                              <span title="Repositório Privado com Token">
                                <Lock className="w-2.5 h-2.5 text-amber-400" />
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                            Docker Image
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-mono text-slate-400 truncate max-w-xs mt-0.5">
                        {app.gitUrl || app.imageName}
                      </p>
                    </div>
                  </div>

                  <span
                    className={`text-xs px-3 py-1 rounded-full font-semibold flex items-center gap-1.5 shrink-0 ${
                      app.status === 'running'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        app.status === 'running' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                      }`}
                    ></span>
                    {app.status === 'running' ? 'Online' : 'Parado'}
                  </span>
                </div>

                {/* Direct Localhost Open Banner */}
                <div className="mb-4">
                  <a
                    href={`http://localhost:${app.port}`}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full flex items-center justify-between px-4 py-2.5 rounded-2xl bg-emerald-950/40 hover:bg-emerald-950/60 text-emerald-300 border border-emerald-500/30 transition-all group"
                  >
                    <div className="flex items-center gap-2 text-xs font-mono font-bold">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                      <span>URL Localhost:</span>
                      <span className="text-white underline underline-offset-2">http://localhost:{app.port}</span>
                    </div>
                    <span className="text-xs flex items-center gap-1 font-sans font-semibold text-emerald-400 group-hover:translate-x-0.5 transition-transform">
                      Abrir Site &rarr;
                    </span>
                  </a>
                </div>

                {/* Domain & Network Section */}
                <div className="bg-slate-950/80 rounded-2xl p-4 border border-slate-800/80 space-y-2.5 text-xs font-mono mb-4">
                  {/* Assigned Domain */}
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-indigo-400" /> Domínio Hostinger / SSL:
                    </span>
                    {app.domain ? (
                      <div className="flex items-center gap-2">
                        <a
                          href={`https://${app.domain}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-400 hover:underline flex items-center gap-1 font-bold"
                        >
                          <Lock className="w-3 h-3 text-emerald-400" />
                          {app.domain}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        <button
                          onClick={() => openDomainModal(app)}
                          title="Alterar domínio ou subdomínio"
                          className="text-[10px] text-slate-500 hover:text-white"
                        >
                          (Editar)
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => openDomainModal(app)}
                        className="text-indigo-400 hover:text-indigo-300 hover:underline font-sans text-xs flex items-center gap-1"
                      >
                        + Vincular Domínio Hostinger
                      </button>
                    )}
                  </div>

                  {/* Port Mapping with Edit shortcut */}
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Mapeamento de Portas:</span>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-200 font-semibold select-all">
                        Host <strong className="text-emerald-400">:{app.port}</strong> &rarr; Container :{app.internalPort}
                      </span>
                      <button
                        onClick={() => openEditModal(app)}
                        title="Mudar porta do host (ex: 5000, 8080)"
                        className="text-[11px] text-indigo-400 hover:underline font-sans"
                      >
                        (Mudar Porta)
                      </button>
                    </div>
                  </div>

                  {/* Last Commit Info */}
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Último Deploy:</span>
                    <span className="text-slate-300 truncate max-w-[200px]" title={app.lastCommitMessage}>
                      {app.lastCommitMessage || 'Deploy inicial'}
                    </span>
                  </div>

                  {/* Environment Variables Count */}
                  <div className="flex items-center justify-between text-slate-400 pt-1 border-t border-slate-800/60">
                    <span className="flex items-center gap-1">
                      <Sliders className="w-3.5 h-3.5 text-amber-400" /> Variáveis de Ambiente:
                    </span>
                    <button
                      onClick={() => openEnvModal(app)}
                      className="text-amber-400 hover:underline font-sans text-xs font-semibold flex items-center gap-1"
                    >
                      {Object.keys(app.env || {}).length} variável(is) .env &rarr; Editar
                    </button>
                  </div>
                </div>

                {/* CI/CD Quick Action Pills */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1">
                  <button
                    onClick={() => openDeploymentsHistory(app)}
                    title="Ver histórico de todos os builds e deploys anteriores"
                    className="text-emerald-400 hover:underline flex items-center gap-1 font-mono text-[11px]"
                  >
                    <Clock className="w-3.5 h-3.5" /> Histórico de Builds
                  </button>

                  <button
                    onClick={() => openWorkflowModal(app)}
                    title="Ver arquivo de configuração do GitHub Actions"
                    className="text-indigo-400 hover:underline flex items-center gap-1 font-mono text-[11px]"
                  >
                    <FileCode2 className="w-3.5 h-3.5" /> GitHub Actions YAML
                  </button>

                  <button
                    onClick={() => setSelectedWebhookApp(app)}
                    title="Copiar URL de Webhook para Auto-Deploy"
                    className="text-cyan-400 hover:underline flex items-center gap-1 font-mono text-[11px]"
                  >
                    <Webhook className="w-3.5 h-3.5" /> Webhook URL
                  </button>
                </div>
              </div>

              {/* Action Buttons Row */}
              <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Deploy Button */}
                  <button
                    onClick={() => handleTriggerDeploy(app)}
                    disabled={deployingId === app.id}
                    title="Disparar novo deploy agora (Git Pull & Rebuild)"
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all active:scale-95 disabled:opacity-50"
                  >
                    <Zap className={`w-3.5 h-3.5 ${deployingId === app.id ? 'animate-bounce' : ''}`} />
                    <span>{deployingId === app.id ? 'Buildando...' : 'Deploy'}</span>
                  </button>

                  {/* Edit Config / Port */}
                  <button
                    onClick={() => openEditModal(app)}
                    title="Editar configurações (Porta, Nome, Imagem, Token GitHub)"
                    className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                  >
                    <Settings2 className="w-4 h-4" />
                  </button>

                  {/* Start / Stop */}
                  {app.status === 'running' ? (
                    <button
                      onClick={() => handleStop(app.id)}
                      title="Parar aplicação"
                      className="p-2 rounded-xl bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
                    >
                      <Square className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleStart(app.id)}
                      title="Iniciar aplicação"
                      className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}

                  {/* Restart */}
                  <button
                    onClick={() => handleRestart(app.id)}
                    title="Reiniciar contêiner da aplicação"
                    className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>

                  {/* Logs Button */}
                  <button
                    onClick={() => openLogs(app)}
                    title="Visualizar logs em tempo real da aplicação"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5 text-indigo-400" />
                    Logs
                  </button>
                </div>

                {/* Delete */}
                <button
                  onClick={() => handleDelete(app.id, app.name)}
                  title="Deletar aplicação permanentemente"
                  className="p-2 rounded-xl text-rose-400 hover:bg-rose-500/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Editar Configurações & Porta da Aplicação */}
      {selectedEditApp && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-3xl border border-slate-800 w-full max-w-lg overflow-hidden shadow-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold text-white text-base">Configurações: {selectedEditApp.name}</h3>
              </div>
              <button onClick={() => setSelectedEditApp(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Nome da Aplicação *
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-1.5">
                    Porta no Host *
                  </label>
                  <input
                    type="number"
                    required
                    placeholder="ex: 5000, 5050, 8080"
                    value={editPort}
                    onChange={(e) => setEditPort(e.target.value)}
                    className="w-full bg-slate-950 border border-emerald-500/40 rounded-xl px-3.5 py-2.5 text-emerald-300 font-mono text-sm focus:outline-none focus:border-emerald-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Use 5000, 5050 ou 8080.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Porta Interna
                  </label>
                  <input
                    type="number"
                    required
                    value={editInternalPort}
                    onChange={(e) => setEditInternalPort(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {selectedEditApp.sourceType === 'git' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                      URL do Repositório GitHub
                    </label>
                    <input
                      type="text"
                      required
                      value={editGitUrl}
                      onChange={(e) => setEditGitUrl(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-amber-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" /> GitHub Token (PAT para Repositórios Privados)
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowTokenEdit(!showTokenEdit)}
                        className="text-[10px] text-slate-400 hover:text-white"
                      >
                        {showTokenEdit ? 'Ocultar' : 'Mostrar'}
                      </button>
                    </label>
                    <input
                      type={showTokenEdit ? 'text' : 'password'}
                      placeholder="ghp_seu_token_aqui (necessário para repos privados)"
                      value={editGithubToken}
                      onChange={(e) => setEditGithubToken(e.target.value)}
                      className="w-full bg-slate-950 border border-amber-500/40 rounded-xl px-3.5 py-2.5 text-amber-300 font-mono text-xs focus:outline-none focus:border-amber-500"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      💡 Para repositórios privados, crie um token em GitHub &rarr; Settings &rarr; Developer Settings &rarr; Personal Access Tokens (classic) com permissão <code>repo</code>.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                      Branch de Deploy
                    </label>
                    <input
                      type="text"
                      required
                      value={editBranch}
                      onChange={(e) => setEditBranch(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </>
              )}

              {selectedEditApp.sourceType === 'image' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Imagem Docker *
                  </label>
                  <input
                    type="text"
                    required
                    value={editImageName}
                    onChange={(e) => setEditImageName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedEditApp(null)}
                  className="px-4 py-2 text-slate-400 hover:text-white text-xs font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-600/30 transition-all active:scale-95 disabled:opacity-50"
                >
                  {savingEdit ? 'Salvando & Aplicando...' : 'Salvar & Fazer Deploy'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Editar Variáveis de Ambiente (.env) */}
      {selectedEnvApp && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-3xl border border-slate-800 w-full max-w-lg overflow-hidden shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-white text-base">Variáveis de Ambiente (.env): {selectedEnvApp.name}</h3>
              </div>
              <button onClick={() => setSelectedEnvApp(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Edite as chaves e valores no formato <code className="text-amber-300 font-mono">CHAVE=VALOR</code> (uma por linha):
            </p>

            <textarea
              rows={8}
              value={envString}
              onChange={(e) => setEnvString(e.target.value)}
              placeholder="DATABASE_URL=postgresql://...&#10;JWT_SECRET=...&#10;NODE_ENV=production"
              className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 text-xs font-mono text-emerald-300 focus:outline-none focus:border-indigo-500 leading-relaxed"
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedEnvApp(null)}
                className="px-4 py-2 text-slate-400 hover:text-white text-xs font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleSaveEnv(true)}
                disabled={savingEnv}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all active:scale-95 disabled:opacity-50"
              >
                {savingEnv ? 'Salvando & Reiniciando...' : 'Salvar & Aplicar (.env)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Vincular Domínio & Subdomínio */}
      {selectedDomainApp && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-3xl border border-slate-800 w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold text-white text-base">Domínio / Subdomínio (Hostinger)</h3>
              </div>
              <button onClick={() => setSelectedDomainApp(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Digite o domínio ou subdomínio que deseja apontar para este app (ex: <code className="text-indigo-300">api.meusite.com.br</code> ou <code className="text-indigo-300">meusite.com</code>):
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                Nome do Domínio *
              </label>
              <input
                type="text"
                required
                placeholder="ex: app.meusite.com.br"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-indigo-500"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                🔒 O Caddy emitirá o certificado SSL (HTTPS com cadeado) automaticamente.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedDomainApp(null)}
                className="px-4 py-2 text-slate-400 hover:text-white text-xs font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveDomain}
                disabled={savingDomain}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all active:scale-95 disabled:opacity-50"
              >
                {savingDomain ? 'Configurando SSL...' : 'Salvar Domínio'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Histórico de Deploys */}
      {selectedDeploymentsApp && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-3xl border border-slate-800 w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-emerald-400" />
                <span className="font-bold text-white text-sm">Histórico de Deploys: {selectedDeploymentsApp.name}</span>
              </div>
              <button onClick={() => setSelectedDeploymentsApp(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto space-y-3 custom-scrollbar">
              {deploymentsList.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-xs">
                  Nenhum registro de build anterior encontrado.
                </div>
              ) : (
                deploymentsList.map((dep) => (
                  <div
                    key={dep.id}
                    className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center justify-between hover:border-slate-700 transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {dep.status === 'success' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        ) : dep.status === 'building' ? (
                          <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-rose-400" />
                        )}
                        <span className="font-bold text-slate-200 text-xs">{dep.commitMessage || 'Deploy'}</span>
                        <span className="text-[10px] font-mono text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded">
                          {dep.branch}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 font-mono">
                        Por {dep.authorName} • {new Date(dep.createdAt).toLocaleString('pt-BR')} • {dep.durationSeconds}s
                      </p>
                    </div>

                    <button
                      onClick={() => setSelectedBuildLogs(dep)}
                      title="Ver saída de logs deste build"
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-indigo-300 text-xs font-semibold transition-colors"
                    >
                      Ver Logs
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: GitHub Actions Workflow YAML */}
      {selectedWorkflowApp && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-3xl border border-slate-800 w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCode2 className="w-5 h-5 text-indigo-400" />
                <span className="font-bold text-white text-sm">GitHub Actions CI/CD Workflow</span>
              </div>
              <button onClick={() => setSelectedWorkflowApp(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-300">
                Salve este código no seu repositório GitHub dentro de <code className="text-indigo-300 bg-slate-900 px-1.5 py-0.5 rounded font-mono">.github/workflows/deploy.yml</code>:
              </p>

              <div className="relative bg-slate-950 p-4 rounded-2xl border border-slate-800 font-mono text-xs text-emerald-400 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-72">
                {workflowYaml}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={copyWorkflowYaml}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow transition-all active:scale-95"
                >
                  {copiedWorkflow ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedWorkflow ? 'Código Copiado!' : 'Copiar YAML'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Build Logs Output */}
      {selectedBuildLogs && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0a0f1c] rounded-3xl border border-slate-800 w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-emerald-400" />
                <span className="font-bold text-white text-sm">Build Output: {selectedBuildLogs.appName}</span>
              </div>
              <button onClick={() => setSelectedBuildLogs(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 flex-1 overflow-auto font-mono text-xs text-emerald-300 bg-black/90 whitespace-pre-wrap leading-relaxed">
              {selectedBuildLogs.buildLogs || 'Nenhum log gravado para este build.'}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Webhook Info */}
      {selectedWebhookApp && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-3xl border border-slate-800 w-full max-w-lg overflow-hidden shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Webhook className="w-5 h-5 text-indigo-400" />
                Webhook de Auto-Deploy do GitHub
              </h3>
              <button onClick={() => setSelectedWebhookApp(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300 mb-4">
              No seu repositório GitHub, vá em <strong>Settings &rarr; Webhooks &rarr; Add Webhook</strong> e cole a Payload URL abaixo:
            </p>

            <div className="space-y-2 mb-4">
              <label className="text-[11px] font-semibold text-slate-400 uppercase">Payload URL</label>
              <div className="flex items-center gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-xs text-indigo-300">
                <span className="truncate flex-1 select-all">
                  {`${window.location.origin}/api/webhooks/deploy/${selectedWebhookApp.id}?secret=${selectedWebhookApp.webhookSecret || 'aegis_default_secret'}`}
                </span>
                <button
                  onClick={() => copyWebhookUrl(selectedWebhookApp)}
                  title="Copiar URL do Webhook"
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
                >
                  {copiedWebhook ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setSelectedWebhookApp(null)}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold"
              >
                Concluído
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Novo Deploy */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-3xl border border-slate-800 w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
              <h3 className="font-bold text-white text-lg flex items-center gap-2">
                <Plus className="w-5 h-5 text-indigo-400" />
                Novo Deploy de Aplicação
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateApp} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto custom-scrollbar">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Nome da Aplicação *
                </label>
                <input
                  type="text"
                  required
                  placeholder="ex: minha-api-node ou frontend-react"
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Origem do Projeto
                  </label>
                  <select
                    value={sourceType}
                    onChange={(e: any) => setSourceType(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500"
                  >
                    <option value="git">GitHub / Repositório Git</option>
                    <option value="image">Imagem Docker / Hub</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-1.5">
                    Porta no Host *
                  </label>
                  <input
                    type="number"
                    required
                    placeholder="5000"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    className="w-full bg-slate-950 border border-emerald-500/40 rounded-xl px-3.5 py-2.5 text-emerald-300 text-sm focus:outline-none focus:border-emerald-500 font-mono"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Recomendado: 5000, 5050 ou 8080</p>
                </div>
              </div>

              {sourceType === 'git' ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                      URL do Repositório GitHub *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="https://github.com/usuario/meu-projeto.git"
                      value={gitUrl}
                      onChange={(e) => setGitUrl(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-amber-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" /> GitHub Token (Para Repositórios Privados)
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowTokenCreate(!showTokenCreate)}
                        className="text-[10px] text-slate-400 hover:text-white"
                      >
                        {showTokenCreate ? 'Ocultar' : 'Mostrar'}
                      </button>
                    </label>
                    <input
                      type={showTokenCreate ? 'text' : 'password'}
                      placeholder="ghp_seu_token_aqui (apenas se o repositório for PRIVADO)"
                      value={githubToken}
                      onChange={(e) => setGithubToken(e.target.value)}
                      className="w-full bg-slate-950 border border-amber-500/40 rounded-xl px-3.5 py-2.5 text-amber-300 font-mono text-xs focus:outline-none focus:border-amber-500"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      💡 Se seu repositório for privado no GitHub, cole aqui o Personal Access Token (PAT).
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                      Branch de Deploy
                    </label>
                    <input
                      type="text"
                      placeholder="main"
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Imagem Docker *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="nginx:alpine ou node:20-alpine"
                    value={imageName}
                    onChange={(e) => setImageName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Domínio / Subdomínio (Hostinger Opcional)
                </label>
                <input
                  type="text"
                  placeholder="ex: api.meusite.com.br"
                  value={createDomain}
                  onChange={(e) => setCreateDomain(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Variáveis de Ambiente Iniciais (.env)
                </label>
                <textarea
                  rows={3}
                  placeholder="CHAVE=VALOR&#10;PORT=3000"
                  value={createEnvString}
                  onChange={(e) => setCreateEnvString(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white text-xs font-mono focus:outline-none focus:border-indigo-500"
                ></textarea>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2.5 rounded-xl text-slate-400 hover:text-white text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50"
                >
                  {submitting ? 'Criando pipeline...' : 'Iniciar Deploy'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Live Logs */}
      {selectedLogsApp && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0a0f1c] rounded-3xl border border-slate-800 w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-400" />
                <span className="font-bold text-white text-sm">Logs da Aplicação: {selectedLogsApp.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openLogs(selectedLogsApp)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700"
                  title="Atualizar logs"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setSelectedLogsApp(null)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-5 flex-1 overflow-auto font-mono text-xs text-emerald-300 bg-black/90 whitespace-pre-wrap leading-relaxed custom-scrollbar">
              {logsLoading ? 'Carregando logs...' : logsText}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
