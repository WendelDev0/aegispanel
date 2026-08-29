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
  ArrowRight
} from 'lucide-react';
import { api } from '../services/api.js';
import { AppRecord, DeploymentRecord } from '../types/index.js';

export const AppsPage: React.FC = () => {
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedLogsApp, setSelectedLogsApp] = useState<AppRecord | null>(null);
  const [selectedWebhookApp, setSelectedWebhookApp] = useState<AppRecord | null>(null);
  const [selectedDeploymentsApp, setSelectedDeploymentsApp] = useState<AppRecord | null>(null);
  const [deploymentsList, setDeploymentsList] = useState<DeploymentRecord[]>([]);
  const [selectedWorkflowApp, setSelectedWorkflowApp] = useState<AppRecord | null>(null);
  const [workflowYaml, setWorkflowYaml] = useState('');
  const [selectedBuildLogs, setSelectedBuildLogs] = useState<DeploymentRecord | null>(null);

  const [logsText, setLogsText] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedWorkflow, setCopiedWorkflow] = useState(false);
  const [deployingId, setDeployingId] = useState<string | null>(null);

  // Form state
  const [appName, setAppName] = useState('');
  const [sourceType, setSourceType] = useState<'image' | 'git'>('git');
  const [imageName, setImageName] = useState('node:20-alpine');
  const [gitUrl, setGitUrl] = useState('https://github.com/usuario/meu-app.git');
  const [branch, setBranch] = useState('main');
  const [port, setPort] = useState('3000');
  const [internalPort, setInternalPort] = useState('3000');
  const [domain, setDomain] = useState('');
  const [envString, setEnvString] = useState('NODE_ENV=production\nPORT=3000');
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
      envString.split('\n').forEach(line => {
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
        port: parseInt(port),
        internalPort: parseInt(internalPort),
        domain: domain.trim() || undefined,
        env: envObj,
      });

      setShowCreateModal(false);
      setAppName('');
      setDomain('');
      fetchApps();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erro ao criar aplicação');
    } finally {
      setSubmitting(false);
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Layers className="w-6 h-6 text-indigo-400" />
            Aplicações & CI/CD Pipeline (GitHub Integration)
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Faça deploy contínuo das suas aplicações direto do GitHub com suporte a Webhooks e GitHub Actions.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          title="Fazer deploy de um novo projeto do GitHub ou Imagem Docker"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all active:scale-95 shrink-0"
        >
          <Plus className="w-4 h-4" />
          Novo Deploy / Projeto
        </button>
      </div>

      {/* Apps List */}
      {loading ? (
        <div className="flex items-center justify-center p-12 text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
        </div>
      ) : apps.length === 0 ? (
        <div className="bg-[#0f172a]/60 rounded-2xl p-12 border border-slate-800 text-center">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto mb-4">
            <Layers className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white mb-1">Nenhuma aplicação criada</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto mb-6">
            Conecte seu repositório GitHub e ative o pipeline de CI/CD em segundos.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm inline-flex items-center gap-2 shadow-lg shadow-indigo-600/30"
          >
            <Plus className="w-4 h-4" />
            Criar Primeiro Deploy com GitHub
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {apps.map((app) => (
            <div
              key={app.id}
              className="bg-[#0f172a]/80 rounded-2xl p-5 border border-slate-800 hover:border-slate-700/80 transition-all flex flex-col justify-between"
            >
              <div>
                {/* Header row */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold">
                      <Code className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-base flex items-center gap-2">
                        {app.name}
                        {app.sourceType === 'git' && (
                          <span className="text-[10px] font-mono text-indigo-300 bg-indigo-500/20 px-1.5 py-0.5 rounded flex items-center gap-1">
                            <GitBranch className="w-3 h-3" /> {app.branch || 'main'}
                          </span>
                        )}
                      </h3>
                      <p className="text-xs font-mono text-slate-400 truncate max-w-xs">
                        {app.gitUrl || app.imageName || 'Node.js App'}
                      </p>
                    </div>
                  </div>

                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-semibold flex items-center gap-1.5 ${
                      app.status === 'running'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        app.status === 'running' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                      }`}
                    ></span>
                    {app.status === 'running' ? 'Online' : 'Parado'}
                  </span>
                </div>

                {/* Details & CI/CD Status */}
                <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-800/80 space-y-2 text-xs font-mono mb-4">
                  <div className="flex justify-between text-slate-400">
                    <span>Porta no Servidor:</span>
                    <span className="text-slate-200 font-semibold">:{app.port} &rarr; :{app.internalPort}</span>
                  </div>
                  {app.domain && (
                    <div className="flex justify-between text-slate-400 items-center">
                      <span>Domínio com SSL:</span>
                      <a
                        href={`https://${app.domain}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-400 hover:underline flex items-center gap-1"
                      >
                        {app.domain}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}

                  {/* Last Commit Info */}
                  {app.lastCommitMessage && (
                    <div className="flex justify-between text-slate-400 items-center">
                      <span>Último Deploy:</span>
                      <span className="text-slate-300 truncate max-w-[200px]" title={app.lastCommitMessage}>
                        {app.lastCommitMessage}
                      </span>
                    </div>
                  )}

                  {/* CI/CD Quick Shortcuts */}
                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between font-sans text-[11px]">
                    <button
                      onClick={() => openWorkflowModal(app)}
                      title="Ver arquivo de configuração do GitHub Actions"
                      className="text-indigo-400 hover:underline flex items-center gap-1"
                    >
                      <FileCode2 className="w-3.5 h-3.5" /> GitHub Actions YAML
                    </button>

                    <button
                      onClick={() => openDeploymentsHistory(app)}
                      title="Ver histórico de todos os builds e deploys anteriores"
                      className="text-emerald-400 hover:underline flex items-center gap-1"
                    >
                      <Clock className="w-3.5 h-3.5" /> Histórico de Deploys
                    </button>
                  </div>
                </div>
              </div>

              {/* Actions row with Tooltips */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleTriggerDeploy(app)}
                    disabled={deployingId === app.id}
                    title="Disparar novo deploy agora (Git Pull & Docker Rebuild)"
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow transition-all active:scale-95 disabled:opacity-50"
                  >
                    <Zap className={`w-3.5 h-3.5 ${deployingId === app.id ? 'animate-bounce' : ''}`} />
                    <span>{deployingId === app.id ? 'Buildando...' : 'Deploy'}</span>
                  </button>

                  {app.status === 'running' ? (
                    <button
                      onClick={() => handleStop(app.id)}
                      title="Parar container"
                      className="p-2 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
                    >
                      <Square className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleStart(app.id)}
                      title="Iniciar container"
                      className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}

                  <button
                    onClick={() => openLogs(app)}
                    title="Ver logs da aplicação em tempo real"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5 text-indigo-400" />
                    Logs
                  </button>

                  <button
                    onClick={() => setSelectedWebhookApp(app)}
                    title="Configurar Webhook URL no GitHub"
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  >
                    <Webhook className="w-4 h-4 text-emerald-400" />
                  </button>
                </div>

                <button
                  onClick={() => handleDelete(app.id, app.name)}
                  title="Deletar aplicação"
                  className="p-2 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Histórico de Deploys */}
      {selectedDeploymentsApp && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-2xl border border-slate-800 w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-emerald-400" />
                <span className="font-bold text-white text-sm">Histórico de Deploys: {selectedDeploymentsApp.name}</span>
              </div>
              <button onClick={() => setSelectedDeploymentsApp(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto space-y-3">
              {deploymentsList.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-xs">
                  Nenhum registro de build anterior encontrado.
                </div>
              ) : (
                deploymentsList.map((dep) => (
                  <div
                    key={dep.id}
                    className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between hover:border-slate-700 transition-colors"
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
                        <span className="text-[10px] font-mono text-slate-500 bg-slate-800 px-1.5 py-0.2 rounded">
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
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 text-xs font-semibold transition-colors"
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
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-2xl border border-slate-800 w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCode2 className="w-5 h-5 text-indigo-400" />
                <span className="font-bold text-white text-sm">GitHub Actions CI/CD Workflow</span>
              </div>
              <button onClick={() => setSelectedWorkflowApp(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <p className="text-xs text-slate-300">
                Salve este código no seu repositório GitHub dentro de <code className="text-indigo-300 bg-slate-900 px-1.5 py-0.5 rounded font-mono">.github/workflows/deploy.yml</code>:
              </p>

              <div className="relative bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs text-emerald-400 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-72">
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
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0a0f1c] rounded-2xl border border-slate-800 w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-emerald-400" />
                <span className="font-bold text-white text-sm">Build Output: {selectedBuildLogs.appName}</span>
              </div>
              <button onClick={() => setSelectedBuildLogs(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 flex-1 overflow-auto font-mono text-xs text-emerald-300 bg-black/90 whitespace-pre-wrap leading-relaxed">
              {selectedBuildLogs.buildLogs || 'Nenhum log gravado para este build.'}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Webhook Info */}
      {selectedWebhookApp && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-2xl border border-slate-800 w-full max-w-lg overflow-hidden shadow-2xl p-6">
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
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold"
              >
                Concluído
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Novo Deploy */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-2xl border border-slate-800 w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-white text-lg flex items-center gap-2">
                <Plus className="w-5 h-5 text-indigo-400" />
                Novo Deploy com CI/CD
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateApp} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Nome da Aplicação *
                </label>
                <input
                  type="text"
                  required
                  placeholder="ex: minha-api-node ou frontend-next"
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
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Porta no Servidor *
                  </label>
                  <input
                    type="number"
                    required
                    placeholder="3000"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
                  />
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
                    placeholder="node:20-alpine ou nginx:alpine"
                    value={imageName}
                    onChange={(e) => setImageName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Domínio (Opcional - Ativa HTTPS automático)
                </label>
                <input
                  type="text"
                  placeholder="ex: api.meusite.com.br"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Variáveis de Ambiente (.env)
                </label>
                <textarea
                  rows={4}
                  placeholder="CHAVE=VALOR&#10;DATABASE_URL=..."
                  value={envString}
                  onChange={(e) => setEnvString(e.target.value)}
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
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0a0f1c] rounded-2xl border border-slate-800 w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-400" />
                <span className="font-bold text-white text-sm">Logs em Execução: {selectedLogsApp.name}</span>
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

            <div className="p-4 flex-1 overflow-auto font-mono text-xs text-slate-300 bg-black/90 whitespace-pre-wrap leading-relaxed">
              {logsLoading ? 'Carregando logs...' : logsText}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
