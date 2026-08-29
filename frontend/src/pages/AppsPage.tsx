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
  Folder,
  FolderOpen,
  File,
  Save,
  ChevronRight,
  ArrowLeft,
  Sparkles,
  Cpu,
  RotateCcw
} from 'lucide-react';
import { api } from '../services/api.js';
import { socket } from '../services/socket.js';
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

  // File Explorer Modal State
  const [selectedFileApp, setSelectedFileApp] = useState<AppRecord | null>(null);
  const [currentSubPath, setCurrentSubPath] = useState('');
  const [appFiles, setAppFiles] = useState<Array<{ name: string; path: string; isDirectory: boolean; sizeBytes: number; modifiedAt: string; extension?: string }>>([]);
  const [selectedFileContent, setSelectedFileContent] = useState<{ filename: string; path: string; content: string; sizeBytes: number } | null>(null);
  const [fileContentDraft, setFileContentDraft] = useState('');
  const [savingFile, setSavingFile] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [fileFilterSearch, setFileFilterSearch] = useState('');
  const [copiedFileCode, setCopiedFileCode] = useState(false);

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

  // Pre-Deploy Inspector State (Vercel Style)
  const [inspectingRepo, setInspectingRepo] = useState(false);
  const [inspectionResult, setInspectionResult] = useState<{
    inspection: {
      type: string;
      frameworkName: string;
      packageManager: string;
      hasDockerfile: boolean;
      buildCommand: string;
      outputDir: string;
      startCommand: string;
      recommendedPort: number;
      recommendedInternalPort: number;
    };
    commit?: {
      hash: string;
      message: string;
      author: string;
      date: string;
    };
  } | null>(null);

  // AI Prompt Help Modal
  const [showAiHelpModal, setShowAiHelpModal] = useState(false);
  const [copiedAiPrompt, setCopiedAiPrompt] = useState(false);

  const handleInspectRepo = async (urlToInspect?: string) => {
    const targetUrl = urlToInspect || gitUrl;
    if (!targetUrl || targetUrl.includes('usuario/meu-app')) return;

    try {
      setInspectingRepo(true);
      setInspectionResult(null);
      const res = await api.post('/apps/inspect-repo', {
        gitUrl: targetUrl.trim(),
        branch: branch || 'main',
        githubToken: githubToken || undefined,
      });

      if (res.data?.success && res.data.inspection) {
        setInspectionResult(res.data);
        if (res.data.inspection.recommendedInternalPort) {
          setInternalPort(res.data.inspection.recommendedInternalPort.toString());
        }
        if (!appName || appName.includes('meu-app')) {
          const cleanName = targetUrl.split('/').pop()?.replace('.git', '') || '';
          if (cleanName) setAppName(cleanName.toLowerCase().replace(/[^a-z0-9_-]/g, '-'));
        }
      }
    } catch (err: any) {
      console.warn('Repo inspection notice:', err.message);
    } finally {
      setInspectingRepo(false);
    }
  };

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

      const res = await api.post('/apps', {
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

      const createdApp = res.data;
      setShowCreateModal(false);
      setAppName('');
      setGithubToken('');
      setCreateDomain('');
      setInspectionResult(null);
      fetchApps();

      // Instantly open Live Streaming Build Progress Modal
      setLiveDeployModal({
        app: createdApp,
        step: 1,
        stepName: 'Inicializando Pipeline',
        logs: `[${new Date().toLocaleTimeString('pt-BR')}] 🚀 Disparando build inicial para "${createdApp.name}"...\n`,
        percentage: 10,
        status: 'running',
      });
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

  const openFilesModal = async (app: AppRecord, subPath = '') => {
    setSelectedFileApp(app);
    setCurrentSubPath(subPath);
    setSelectedFileContent(null);
    setFileFilterSearch('');
    try {
      setLoadingFiles(true);
      const res = await api.get(`/apps/${app.id}/files`, { params: { subPath } });
      setAppFiles(res.data.items || []);
    } catch (err: any) {
      alert('Erro ao listar arquivos da aplicação: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleOpenFileContent = async (app: AppRecord, filePath: string) => {
    try {
      setLoadingFiles(true);
      const res = await api.get(`/apps/${app.id}/files/content`, { params: { filePath } });
      setSelectedFileContent(res.data);
      setFileContentDraft(res.data.content);
    } catch (err: any) {
      alert('Erro ao ler arquivo: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleSaveFileContent = async () => {
    if (!selectedFileApp || !selectedFileContent) return;
    try {
      setSavingFile(true);
      await api.put(`/apps/${selectedFileApp.id}/files/content`, {
        filePath: selectedFileContent.path,
        content: fileContentDraft,
      });
      alert('✅ Arquivo salvo com sucesso!');
      setSelectedFileContent(prev => prev ? { ...prev, content: fileContentDraft } : null);
    } catch (err: any) {
      alert('Erro ao salvar arquivo: ' + (err.response?.data?.error || err.message));
    } finally {
      setSavingFile(false);
    }
  };

  const handleCopyFileCode = () => {
    if (!fileContentDraft) return;
    navigator.clipboard.writeText(fileContentDraft);
    setCopiedFileCode(true);
    setTimeout(() => setCopiedFileCode(false), 2000);
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
            Aplicações & CI/CD — Experiência Cloud Profissional (Aegis Style)
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Controle de ponta a ponta dos seus projetos com deploy em tempo real, rollback instantâneo, repositórios públicos e privados do GitHub e domínios com SSL.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowAiHelpModal(true)}
            title="Copie o prompt para a sua IA (ChatGPT, Claude, Cursor, v0) preparar o projeto para o AegisPanel"
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 font-semibold text-xs border border-purple-500/40 shadow-lg shadow-purple-600/10 transition-all active:scale-95 shrink-0"
          >
            <Sparkles className="w-4 h-4 text-purple-400" />
            <span>Prompt para IA ✨</span>
          </button>

          <button
            onClick={() => setShowCreateModal(true)}
            title="Fazer deploy de um novo projeto do GitHub (Público ou Privado) ou Imagem Docker"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all active:scale-95 shrink-0"
          >
            <Plus className="w-4 h-4" />
            Novo Deploy / Projeto
          </button>
        </div>
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

                {/* Direct VPS IP + Port Access Banner */}
                <div className="mb-4">
                  {(() => {
                    const currentHost = window.location.hostname || '13.140.41.82';
                    const directUrl = `http://${currentHost}:${app.port}`;
                    return (
                      <a
                        href={directUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="w-full flex items-center justify-between px-4 py-2.5 rounded-2xl bg-emerald-950/40 hover:bg-emerald-950/60 text-emerald-300 border border-emerald-500/30 transition-all group shadow-lg"
                      >
                        <div className="flex items-center gap-2 text-xs font-mono font-bold">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                          <span className="text-emerald-400">🌐 Acesso Direto (IP:Porta):</span>
                          <span className="text-white underline underline-offset-2">{directUrl}</span>
                        </div>
                        <span className="text-xs flex items-center gap-1 font-sans font-semibold text-emerald-400 group-hover:translate-x-0.5 transition-transform">
                          Abrir Site &rarr;
                        </span>
                      </a>
                    );
                  })()}
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

                {/* Vercel-Style Git Commit & Deploy Status Card */}
                {app.sourceType === 'git' && (
                  <div className="bg-slate-950/90 rounded-2xl p-3.5 border border-indigo-500/20 space-y-2 mb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs">
                        <GitCommit className="w-4 h-4 text-indigo-400" />
                        <span className="font-bold text-white">Último Commit Real:</span>
                      </div>
                      {app.lastCommitHash && (
                        <span className="text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/30">
                          #{app.lastCommitHash}
                        </span>
                      )}
                    </div>
                    
                    <div className="text-xs text-slate-200 font-medium line-clamp-2 pl-5 border-l-2 border-indigo-500/40">
                      "{app.lastCommitMessage || 'Deploy inicial realizado com sucesso'}"
                    </div>
                    
                    <div className="flex items-center justify-between text-[11px] text-slate-400 pl-5 pt-0.5">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3 text-slate-500" /> {app.lastCommitAuthor || 'Wendel Dev'}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
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

                  {/* View Files Explorer Button */}
                  <button
                    onClick={() => openFilesModal(app)}
                    title="Explorar e editar arquivos do código-fonte da aplicação"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors"
                  >
                    <FolderTree className="w-3.5 h-3.5 text-amber-400" />
                    <span>Arquivos</span>
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

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSelectedBuildLogs(dep)}
                        title="Ver saída de logs deste build"
                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-indigo-300 text-xs font-semibold transition-colors"
                      >
                        Ver Logs
                      </button>

                      {dep.status === 'success' && (
                        <button
                          onClick={() => handleRollback(selectedDeploymentsApp.id, dep.id)}
                          disabled={rollingBackId === dep.id}
                          title="Reverter a aplicação para este commit/versão instantaneamente em 2 segundos"
                          className="px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold transition-colors flex items-center gap-1 active:scale-95 disabled:opacity-50"
                        >
                          <Clock className={`w-3.5 h-3.5 ${rollingBackId === dep.id ? 'animate-spin' : ''}`} />
                          <span>{rollingBackId === dep.id ? 'Revertendo...' : '⏪ Rollback'}</span>
                        </button>
                      )}
                    </div>
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

      {/* Modal: AI Prompt Generator (Vercel to AegisPanel) */}
      {showAiHelpModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-3xl border border-purple-500/40 w-full max-w-2xl overflow-hidden shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-purple-500/20 text-purple-400">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Prompt Mágico para IAs (Vercel ➔ AegisPanel)</h3>
                  <p className="text-xs text-slate-400">Envie este prompt para sua IA (ChatGPT, Claude, Cursor, v0) preparar seu código.</p>
                </div>
              </div>
              <button onClick={() => setShowAiHelpModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <textarea
              readOnly
              rows={10}
              className="w-full bg-slate-950/90 border border-slate-800 rounded-2xl p-4 text-xs font-mono text-slate-200 focus:outline-none select-all custom-scrollbar leading-relaxed"
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
              <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                <span>Compatível com ChatGPT, Claude 3.5, Cursor e v0.</span>
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowAiHelpModal(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white text-xs font-semibold"
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
                  className="flex items-center gap-1.5 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-purple-600/30 transition-all active:scale-95"
                >
                  {copiedAiPrompt ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
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

      {/* Modal: Live Deploy Streaming Progress Tracker (Aegis Style) */}
      {liveDeployModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#090d16] rounded-3xl border border-indigo-500/40 w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="p-5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl ${
                  liveDeployModal.status === 'success' ? 'bg-emerald-500/20 text-emerald-400' :
                  liveDeployModal.status === 'failed' ? 'bg-rose-500/20 text-rose-400' :
                  'bg-indigo-500/20 text-indigo-400'
                }`}>
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base flex items-center gap-2">
                    <span>Deploy em Tempo Real: {liveDeployModal.app.name}</span>
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-mono font-semibold ${
                      liveDeployModal.status === 'success' ? 'bg-emerald-500/20 text-emerald-300' :
                      liveDeployModal.status === 'failed' ? 'bg-rose-500/20 text-rose-300' :
                      'bg-indigo-500/20 text-indigo-300 animate-pulse'
                    }`}>
                      {liveDeployModal.status.toUpperCase()}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Step {liveDeployModal.step}/5: {liveDeployModal.stepName}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setLiveDeployModal(null)}
                className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-slate-950 h-2">
              <div
                className={`h-full transition-all duration-300 ${
                  liveDeployModal.status === 'failed' ? 'bg-rose-500' :
                  liveDeployModal.status === 'success' ? 'bg-emerald-500' :
                  'bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-500'
                }`}
                style={{ width: `${liveDeployModal.percentage}%` }}
              />
            </div>

            {/* 5-Step Visual Stepper */}
            <div className="p-4 bg-slate-950/80 border-b border-slate-800/80 grid grid-cols-5 gap-2 text-center text-[11px]">
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
                    className={`p-2 rounded-xl border transition-all ${
                      isPassed ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 font-semibold' :
                      isCurrent ? 'bg-indigo-500/20 border-indigo-500 text-white font-bold animate-pulse' :
                      'bg-slate-900/40 border-slate-800/60 text-slate-500'
                    }`}
                  >
                    <div className="text-[10px] font-mono mb-0.5">PASSO {st.num}</div>
                    <div className="truncate">{st.label}</div>
                  </div>
                );
              })}
            </div>

            {/* Live Streaming Logs Terminal */}
            <div className="p-4 bg-black/95 flex-1 overflow-y-auto font-mono text-xs text-emerald-300 leading-relaxed custom-scrollbar whitespace-pre-wrap min-h-[250px] max-h-[350px]">
              {liveDeployModal.logs || 'Aguardando saída de build do servidor...'}
            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between">
              <span className="text-xs text-slate-300 flex items-center gap-2">
                {liveDeployModal.status === 'running' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                    <span>Compilando contêiner isolado...</span>
                  </>
                ) : liveDeployModal.status === 'success' ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Aplicação compilada e online com sucesso!</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                    <span>O processo de build foi interrompido com erro.</span>
                  </>
                )}
              </span>
              <button
                onClick={() => setLiveDeployModal(null)}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg transition-all"
              >
                {liveDeployModal.status === 'running' ? 'Minimizar' : 'Fechar'}
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
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                        URL do Repositório GitHub *
                      </label>
                      <button
                        type="button"
                        onClick={() => handleInspectRepo()}
                        disabled={inspectingRepo || !gitUrl || gitUrl.includes('usuario/meu-app')}
                        className="text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40"
                      >
                        <Cpu className={`w-3.5 h-3.5 ${inspectingRepo ? 'animate-spin' : ''}`} />
                        <span>{inspectingRepo ? 'Inspecionando...' : 'Auto-Detectar Stack'}</span>
                      </button>
                    </div>
                    <input
                      type="text"
                      required
                      placeholder="https://github.com/usuario/meu-projeto.git"
                      value={gitUrl}
                      onChange={(e) => setGitUrl(e.target.value)}
                      onBlur={() => handleInspectRepo()}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>

                  {/* Framework Auto-Detection Preview Card (Aegis Style) */}
                  {inspectingRepo ? (
                    <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center gap-3 animate-pulse text-xs text-indigo-300">
                      <RefreshCw className="w-4 h-4 animate-spin text-indigo-400 shrink-0" />
                      <span>Inspecionando arquivos do repositório e identificando framework...</span>
                    </div>
                  ) : inspectionResult ? (
                    <div className="p-4 rounded-2xl bg-slate-950 border border-indigo-500/40 shadow-inner space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-amber-400" />
                          <span className="text-xs font-bold text-white uppercase tracking-wider">Framework Detectado</span>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-[11px] font-bold font-mono">
                          {inspectionResult.inspection.frameworkName}
                        </span>
                      </div>

                      {inspectionResult.commit && (
                        <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] font-mono text-slate-300 space-y-1">
                          <div className="text-slate-400 flex items-center justify-between">
                            <span>Último commit ({inspectionResult.commit.hash}):</span>
                            <span>{inspectionResult.commit.author}</span>
                          </div>
                          <div className="text-emerald-400 font-semibold truncate">"{inspectionResult.commit.message}"</div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-400">
                        <div className="p-2 rounded-xl bg-slate-900/50 border border-slate-800/80">
                          <span className="text-slate-500 block text-[10px] uppercase">Package Manager</span>
                          <span className="text-white font-bold">{inspectionResult.inspection.packageManager.toUpperCase()}</span>
                        </div>
                        <div className="p-2 rounded-xl bg-slate-900/50 border border-slate-800/80">
                          <span className="text-slate-500 block text-[10px] uppercase">Comando de Build</span>
                          <span className="text-white font-bold truncate">{inspectionResult.inspection.buildCommand || 'N/A'}</span>
                        </div>
                      </div>
                    </div>
                  ) : null}

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
                    <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>Para repositórios privados, informe seu Personal Access Token (PAT).</span>
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
                  Domínio ou Subdomínio (Opcional)
                </label>
                <input
                  type="text"
                  placeholder="ex: app.meusite.com.br (pode deixar vazio e vincular depois)"
                  value={createDomain}
                  onChange={(e) => setCreateDomain(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
                />
                <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                  <Globe className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span>O domínio é opcional. Você pode testar pelo IP:Porta e vincular o domínio Hostinger depois.</span>
                </p>
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

      {/* Modal: Application File Explorer & Code Editor */}
      {selectedFileApp && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0b0f19] rounded-3xl border border-slate-800 w-full max-w-5xl h-[85vh] overflow-hidden shadow-2xl flex flex-col">
            {/* Header */}
            <div className="p-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
                  <FolderTree className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base flex items-center gap-2">
                    <span>Arquivos da Aplicação: {selectedFileApp.name}</span>
                    <span className="text-[10px] font-mono text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded border border-indigo-500/30">
                      {selectedFileApp.branch || 'main'}
                    </span>
                  </h3>
                  {/* Breadcrumbs */}
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono mt-0.5">
                    <button
                      onClick={() => openFilesModal(selectedFileApp, '')}
                      className="hover:text-white underline"
                    >
                      raiz
                    </button>
                    {currentSubPath &&
                      currentSubPath.split('/').map((seg, idx, arr) => {
                        const sub = arr.slice(0, idx + 1).join('/');
                        return (
                          <React.Fragment key={sub}>
                            <ChevronRight className="w-3 h-3 text-slate-600" />
                            <button
                              onClick={() => openFilesModal(selectedFileApp, sub)}
                              className="hover:text-white underline"
                            >
                              {seg}
                            </button>
                          </React.Fragment>
                        );
                      })}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => openFilesModal(selectedFileApp, currentSubPath)}
                  title="Atualizar lista de arquivos"
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingFiles ? 'animate-spin text-amber-400' : ''}`} />
                </button>
                <button
                  onClick={() => setSelectedFileApp(null)}
                  className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Split Pane: Sidebar File Tree & Main Code Editor */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left Column: Files & Directories */}
              <div className="w-72 bg-slate-950/90 border-r border-slate-800 flex flex-col">
                {/* Search in files */}
                <div className="p-3 border-b border-slate-800/80">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      placeholder="Buscar arquivo..."
                      value={fileFilterSearch}
                      onChange={(e) => setFileFilterSearch(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                    />
                  </div>
                </div>

                {/* Back button if inside subfolder */}
                {currentSubPath && (
                  <button
                    onClick={() => {
                      const parent = currentSubPath.split('/').slice(0, -1).join('/');
                      openFilesModal(selectedFileApp, parent);
                    }}
                    className="flex items-center gap-2 px-4 py-2.5 text-xs font-mono text-amber-400 hover:bg-slate-900 border-b border-slate-800/60 transition-colors text-left"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> .. (Voltar pasta)
                  </button>
                )}

                {/* File list */}
                <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                  {loadingFiles && appFiles.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500">
                      <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-2 text-amber-400" />
                      Carregando arquivos...
                    </div>
                  ) : appFiles.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500">
                      Nenhum arquivo encontrado após o deploy.
                    </div>
                  ) : (
                    appFiles
                      .filter((f) => f.name.toLowerCase().includes(fileFilterSearch.toLowerCase()))
                      .map((f) => {
                        const isSelected = selectedFileContent?.path === f.path;
                        return (
                          <div
                            key={f.path}
                            onClick={() => {
                              if (f.isDirectory) {
                                openFilesModal(selectedFileApp, f.path);
                              } else {
                                handleOpenFileContent(selectedFileApp, f.path);
                              }
                            }}
                            className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-mono cursor-pointer transition-all ${
                              isSelected
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold'
                                : f.isDirectory
                                ? 'text-slate-200 hover:bg-slate-900 hover:text-white'
                                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              {f.isDirectory ? (
                                <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                              ) : (
                                <File className="w-4 h-4 text-indigo-400 shrink-0" />
                              )}
                              <span className="truncate">{f.name}</span>
                            </div>
                            {!f.isDirectory && f.sizeBytes > 0 && (
                              <span className="text-[10px] text-slate-600 shrink-0 ml-1">
                                {(f.sizeBytes / 1024).toFixed(1)}k
                              </span>
                            )}
                          </div>
                        );
                      })
                  )}
                </div>
              </div>

              {/* Right Column: Code Viewer / Editor */}
              <div className="flex-1 bg-[#090d16] flex flex-col overflow-hidden">
                {selectedFileContent ? (
                  <>
                    {/* Toolbar */}
                    <div className="p-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-mono text-slate-300 truncate">
                        <File className="w-4 h-4 text-indigo-400 shrink-0" />
                        <span className="font-bold text-white">{selectedFileContent.path}</span>
                        <span className="text-[11px] text-slate-500">
                          ({(selectedFileContent.sizeBytes / 1024).toFixed(2)} KB)
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={handleCopyFileCode}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono transition-colors"
                        >
                          {copiedFileCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedFileCode ? 'Copiado!' : 'Copiar'}</span>
                        </button>

                        <button
                          onClick={handleSaveFileContent}
                          disabled={savingFile}
                          className="flex items-center gap-1 px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-lg shadow-amber-500/20 transition-all disabled:opacity-50"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>{savingFile ? 'Salvando...' : 'Salvar Alterações'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Code Editor */}
                    <div className="flex-1 p-4 overflow-auto">
                      <textarea
                        value={fileContentDraft}
                        onChange={(e) => setFileContentDraft(e.target.value)}
                        spellCheck={false}
                        className="w-full h-full bg-transparent text-emerald-300 font-mono text-xs leading-relaxed focus:outline-none resize-none selection:bg-indigo-500/40 custom-scrollbar"
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
                    <FolderTree className="w-12 h-12 text-slate-700 mb-3" />
                    <h4 className="font-bold text-white text-sm mb-1">Nenhum arquivo selecionado</h4>
                    <p className="text-xs text-slate-400 max-w-sm">
                      Navegue pelas pastas à esquerda e clique em qualquer arquivo de código-fonte (HTML, JS, TS, JSON, .env) para visualizar e editar.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
