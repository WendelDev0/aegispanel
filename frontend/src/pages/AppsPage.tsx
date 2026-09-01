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
  RotateCcw,
  Globe2,
} from 'lucide-react';
import { api } from '../services/api.js';
import { socket } from '../services/socket.js';
import { AppRecord, DeploymentRecord } from '../types/index.js';
import { EnvEditor } from '../components/EnvEditor.js';

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
  const [envRecordDraft, setEnvRecordDraft] = useState<Record<string, string>>({});
  const [loadingEnv, setLoadingEnv] = useState(false);
  const [savingEnv, setSavingEnv] = useState(false);
  const [redeployOnSave, setRedeployOnSave] = useState(true);

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
  const [port, setPort] = useState('');
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
        if (res.data.inspection.suggestedEnv && Object.keys(res.data.inspection.suggestedEnv).length > 0) {
          const envLines = Object.entries(res.data.inspection.suggestedEnv)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n');
          setCreateEnvString(envLines);
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
    // Only the name is required. The port field is optional by design - left
    // blank, the server allocates a free one - and requiring it here made the
    // button do nothing at all for the case the field itself recommends.
    if (!appName) return;

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
        // Omitted when blank, so the server assigns a free host port.
        port: port ? parseInt(port) : undefined,
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
    // Write-only: the stored token is never sent to the browser, so the field
    // starts empty and only overwrites the stored value when filled in.
    setEditGithubToken('');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEditApp) return;

    try {
      setSavingEdit(true);
      // An empty field is sent as '' so the server hands the app back to
      // automatic assignment, rather than being dropped as "unchanged".
      const res = await api.put(`/apps/${selectedEditApp.id}`, {
        name: editName,
        port: editPort === '' ? '' : parseInt(editPort),
        internalPort: parseInt(editInternalPort || '3000'),
        imageName: editImageName || undefined,
        gitUrl: editGitUrl || undefined,
        branch: editBranch || undefined,
        githubToken: editGithubToken || undefined,
      });

      setSelectedEditApp(null);
      fetchApps();
      alert(`🎉 Aplicação atualizada. Porta no host: :${res.data?.port ?? editPort}`);
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
                        onClick={() => openEditModal(app)}
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
                    onClick={() => openEditModal(app)}
                    title="Editar configurações (Porta, Nome, Imagem, Token GitHub)"
                    className="p-2 rounded bg-surface-container-high text-on-surface-variant hover:text-white hover:bg-surface-container-highest transition-colors"
                  >
                    <Settings2 className="w-4 h-4" />
                  </button>

                  {/* View Files Explorer Button */}
                  <button
                    onClick={() => openFilesModal(app)}
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

      {/* Modal: Editar Configurações & Porta da Aplicação */}
      {selectedEditApp && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-container rounded-lg border border-outline-variant w-full max-w-lg overflow-hidden p-6 space-y-4 max-h-[85vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-primary" />
                <h3 className="font-bold text-white text-base">Configurações: {selectedEditApp.name}</h3>
              </div>
              <button onClick={() => setSelectedEditApp(null)} className="text-on-surface-variant hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Nome da Aplicação *
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                    Porta no Host
                  </label>
                  <input
                    type="number"
                    placeholder="Automática"
                    value={editPort}
                    onChange={(e) => setEditPort(e.target.value)}
                    className="w-full bg-surface-container-lowest border border-outline-variant rounded px-3.5 py-2.5 text-on-surface font-mono text-sm focus:outline-none focus:border-primary"
                  />
                  <p className="text-[10px] text-on-surface-variant/70 mt-1">
                    Vazio = automática. Um valor fixa a porta e o painel nunca a move sozinho.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                    Porta Interna
                  </label>
                  <input
                    type="number"
                    required
                    value={editInternalPort}
                    onChange={(e) => setEditInternalPort(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              {selectedEditApp.sourceType === 'git' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                      URL do Repositório GitHub
                    </label>
                    <input
                      type="text"
                      required
                      value={editGitUrl}
                      onChange={(e) => setEditGitUrl(e.target.value)}
                      className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white font-mono text-xs focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-warn uppercase tracking-wider mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" /> GitHub Token (PAT para Repositórios Privados)
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowTokenEdit(!showTokenEdit)}
                        className="text-[10px] text-on-surface-variant hover:text-white"
                      >
                        {showTokenEdit ? 'Ocultar' : 'Mostrar'}
                      </button>
                    </label>
                    <input
                      type={showTokenEdit ? 'text' : 'password'}
                      placeholder="ghp_seu_token_aqui (necessário para repos privados)"
                      value={editGithubToken}
                      onChange={(e) => setEditGithubToken(e.target.value)}
                      className="w-full bg-surface-container-lowest border border-warn/30 rounded px-3.5 py-2.5 text-warn font-mono text-xs focus:outline-none focus:border-amber-500"
                    />
                    <p className="text-[10px] text-on-surface-variant/70 mt-1">
                      💡 Para repositórios privados, crie um token em GitHub &rarr; Settings &rarr; Developer Settings &rarr; Personal Access Tokens (classic) com permissão <code>repo</code>.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                      Branch de Deploy
                    </label>
                    <input
                      type="text"
                      required
                      value={editBranch}
                      onChange={(e) => setEditBranch(e.target.value)}
                      className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white font-mono text-xs focus:outline-none focus:border-primary"
                    />
                  </div>
                </>
              )}

              {selectedEditApp.sourceType === 'image' && (
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                    Imagem Docker *
                  </label>
                  <input
                    type="text"
                    required
                    value={editImageName}
                    onChange={(e) => setEditImageName(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white font-mono text-xs focus:outline-none focus:border-primary"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedEditApp(null)}
                  className="px-4 py-2 text-on-surface-variant hover:text-white text-xs font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-5 py-2.5 bg-ok/90 hover:bg-ok text-white rounded text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-container rounded-lg border border-outline-variant w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-5 bg-surface-container-low/90 border-b border-outline-variant flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-ok" />
                <span className="font-bold text-white text-sm">Histórico de Deploys: {selectedDeploymentsApp.name}</span>
              </div>
              <button onClick={() => setSelectedDeploymentsApp(null)} className="text-on-surface-variant hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto space-y-3 custom-scrollbar">
              {deploymentsList.length === 0 ? (
                <div className="text-center py-8 text-on-surface-variant/70 text-xs">
                  Nenhum registro de build anterior encontrado.
                </div>
              ) : (
                deploymentsList.map((dep) => (
                  <div
                    key={dep.id}
                    className="p-4 rounded-lg bg-surface-container-low border border-outline-variant flex items-center justify-between hover:border-outline-variant transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {dep.status === 'success' ? (
                          <CheckCircle2 className="w-4 h-4 text-ok" />
                        ) : dep.status === 'building' ? (
                          <RefreshCw className="w-4 h-4 text-warn animate-spin" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-crit" />
                        )}
                        <span className="font-bold text-on-surface text-xs">{dep.commitMessage || 'Deploy'}</span>
                        <span className="text-[10px] font-mono text-primary bg-primary/20 px-2 py-0.5 rounded">
                          {dep.branch}
                        </span>
                      </div>
                      <p className="text-[11px] text-on-surface-variant font-mono">
                        Por {dep.authorName} • {new Date(dep.createdAt).toLocaleString('pt-BR')} • {dep.durationSeconds}s
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSelectedBuildLogs(dep)}
                        title="Ver saída de logs deste build"
                        className="px-3 py-1.5 rounded bg-surface-container-high hover:bg-surface-container-highest text-primary text-xs font-semibold transition-colors"
                      >
                        Ver Logs
                      </button>

                      {dep.status === 'success' && (
                        <button
                          onClick={() => handleRollback(selectedDeploymentsApp.id, dep.id)}
                          disabled={rollingBackId === dep.id}
                          title="Reverter a aplicação para este commit/versão instantaneamente em 2 segundos"
                          className="px-3 py-1.5 rounded bg-warn/10 hover:bg-warn/15 text-warn border border-warn/30 text-xs font-semibold transition-colors flex items-center gap-1 active:scale-95 disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0a0f1c] rounded-lg border border-outline-variant w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-4 bg-surface-container-low/90 border-b border-outline-variant flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-ok" />
                <span className="font-bold text-white text-sm">Build Output: {selectedBuildLogs.appName}</span>
              </div>
              <button onClick={() => setSelectedBuildLogs(null)} className="text-on-surface-variant hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 flex-1 overflow-auto font-mono text-xs text-ok bg-black/90 whitespace-pre-wrap leading-relaxed">
              {selectedBuildLogs.buildLogs || 'Nenhum log gravado para este build.'}
            </div>
          </div>
        </div>
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

      {/* Modal: Novo Deploy */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-container rounded-lg border border-outline-variant w-full max-w-lg overflow-hidden">
            <div className="p-5 border-b border-outline-variant flex items-center justify-between bg-surface-container-low">
              <h3 className="font-bold text-white text-lg flex items-center gap-2">
                <Plus className="w-5 h-5 text-primary" />
                Novo Deploy de Aplicação
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-on-surface-variant hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateApp} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto custom-scrollbar">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Nome da Aplicação *
                </label>
                <input
                  type="text"
                  required
                  placeholder="ex: minha-api-node ou frontend-react"
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                    Origem do Projeto
                  </label>
                  <select
                    value={sourceType}
                    onChange={(e: any) => setSourceType(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="git">GitHub / Repositório Git</option>
                    <option value="image">Imagem Docker / Hub</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                    Porta no Host
                  </label>
                  <input
                    type="number"
                    placeholder="Automática"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    className="w-full bg-surface-container-lowest border border-outline-variant rounded px-3.5 py-2.5 text-on-surface text-sm focus:outline-none focus:border-primary font-mono"
                  />
                  <p className="text-[10px] text-on-surface-variant/70 mt-1">
                    Deixe vazio: o painel escolhe uma porta livre. Seu site é servido pelo domínio, não por esta porta.
                  </p>
                </div>
              </div>

              {sourceType === 'git' ? (
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                        URL do Repositório GitHub *
                      </label>
                      <button
                        type="button"
                        onClick={() => handleInspectRepo()}
                        disabled={inspectingRepo || !gitUrl || gitUrl.includes('usuario/meu-app')}
                        className="text-[11px] text-primary hover:text-primary font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40"
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
                      className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary font-mono"
                    />
                  </div>

                  {/* Framework Auto-Detection Preview Card (Aegis Style) */}
                  {inspectingRepo ? (
                    <div className="p-4 rounded-lg bg-primary/10 border border-primary/30 flex items-center gap-3 animate-pulse text-xs text-primary">
                      <RefreshCw className="w-4 h-4 animate-spin text-primary shrink-0" />
                      <span>Inspecionando arquivos do repositório e identificando framework...</span>
                    </div>
                  ) : inspectionResult ? (
                    <div className="p-4 rounded-lg bg-surface-container-lowest border border-primary/40 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-warn" />
                          <span className="text-xs font-bold text-white uppercase tracking-wider">Framework Detectado</span>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full bg-primary/20 border border-primary/40 text-primary text-[11px] font-bold font-mono">
                          {inspectionResult.inspection.frameworkName}
                        </span>
                      </div>

                      {inspectionResult.commit && (
                        <div className="p-2.5 rounded bg-surface-container-low border border-outline-variant text-[11px] font-mono text-on-surface-variant space-y-1">
                          <div className="text-on-surface-variant flex items-center justify-between">
                            <span>Último commit ({inspectionResult.commit.hash}):</span>
                            <span>{inspectionResult.commit.author}</span>
                          </div>
                          <div className="text-ok font-semibold truncate">"{inspectionResult.commit.message}"</div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-on-surface-variant">
                        <div className="p-2 rounded bg-surface-container-low border border-outline-variant">
                          <span className="text-on-surface-variant/70 block text-[10px] uppercase">Package Manager</span>
                          <span className="text-white font-bold">{inspectionResult.inspection.packageManager.toUpperCase()}</span>
                        </div>
                        <div className="p-2 rounded bg-surface-container-low border border-outline-variant">
                          <span className="text-on-surface-variant/70 block text-[10px] uppercase">Comando de Build</span>
                          <span className="text-white font-bold truncate">{inspectionResult.inspection.buildCommand || 'N/A'}</span>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <label className="block text-xs font-semibold text-warn uppercase tracking-wider mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" /> GitHub Token (Para Repositórios Privados)
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowTokenCreate(!showTokenCreate)}
                        className="text-[10px] text-on-surface-variant hover:text-white"
                      >
                        {showTokenCreate ? 'Ocultar' : 'Mostrar'}
                      </button>
                    </label>
                    <input
                      type={showTokenCreate ? 'text' : 'password'}
                      placeholder="ghp_seu_token_aqui (apenas se o repositório for PRIVADO)"
                      value={githubToken}
                      onChange={(e) => setGithubToken(e.target.value)}
                      className="w-full bg-surface-container-lowest border border-warn/30 rounded px-3.5 py-2.5 text-warn font-mono text-xs focus:outline-none focus:border-amber-500"
                    />
                    <p className="text-[10px] text-on-surface-variant mt-1 flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-warn shrink-0" />
                      <span>Para repositórios privados, informe seu Personal Access Token (PAT).</span>
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                      Branch de Deploy
                    </label>
                    <input
                      type="text"
                      placeholder="main"
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary font-mono"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                    Imagem Docker *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="nginx:alpine ou node:20-alpine"
                    value={imageName}
                    onChange={(e) => setImageName(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary font-mono"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Domínio ou Subdomínio (Opcional)
                </label>
                <input
                  type="text"
                  placeholder="ex: app.meusite.com.br (pode deixar vazio e vincular depois)"
                  value={createDomain}
                  onChange={(e) => setCreateDomain(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary font-mono"
                />
                <p className="text-[11px] text-on-surface-variant/70 mt-1 flex items-center gap-1">
                  <Globe className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span>O domínio é opcional. Você pode testar pelo IP:Porta e vincular o domínio Hostinger depois.</span>
                </p>
              </div>

              <div className="pt-2">
                <EnvEditor
                  initialEnv={createEnvString}
                  onChange={(_, str) => setCreateEnvString(str)}
                  compact={true}
                  title="Variáveis de Ambiente Iniciais (.env)"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2.5 rounded text-on-surface-variant hover:text-white text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded bg-primary-container hover:bg-primary text-white font-semibold text-sm transition-all disabled:opacity-50"
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

      {/* Modal: Application File Explorer & Code Editor */}
      {selectedFileApp && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-surface rounded-lg border border-outline-variant w-full max-w-5xl h-[85vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-4 bg-surface-container-low/90 border-b border-outline-variant flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded bg-warn/10 text-warn">
                  <FolderTree className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base flex items-center gap-2">
                    <span>Arquivos da Aplicação: {selectedFileApp.name}</span>
                    <span className="text-[10px] font-mono text-primary bg-primary/20 px-2 py-0.5 rounded border border-primary/30">
                      {selectedFileApp.branch || 'main'}
                    </span>
                  </h3>
                  {/* Breadcrumbs */}
                  <div className="flex items-center gap-1.5 text-xs text-on-surface-variant font-mono mt-0.5">
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
                            <ChevronRight className="w-3 h-3 text-outline" />
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
                  className="p-2 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingFiles ? 'animate-spin text-warn' : ''}`} />
                </button>
                <button
                  onClick={() => setSelectedFileApp(null)}
                  className="p-2 rounded text-on-surface-variant hover:text-white hover:bg-surface-container-high transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Split Pane: Sidebar File Tree & Main Code Editor */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left Column: Files & Directories */}
              <div className="w-72 bg-surface-container-lowest/90 border-r border-outline-variant flex flex-col">
                {/* Search in files */}
                <div className="p-3 border-b border-outline-variant">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/70" />
                    <input
                      type="text"
                      placeholder="Buscar arquivo..."
                      value={fileFilterSearch}
                      onChange={(e) => setFileFilterSearch(e.target.value)}
                      className="w-full bg-surface-container-low border border-outline-variant rounded pl-8 pr-3 py-1.5 text-xs text-on-surface focus:outline-none focus:border-amber-500 font-mono"
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
                    className="flex items-center gap-2 px-4 py-2.5 text-xs font-mono text-warn hover:bg-surface-container-low border-b border-outline-variant transition-colors text-left"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> .. (Voltar pasta)
                  </button>
                )}

                {/* File list */}
                <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                  {loadingFiles && appFiles.length === 0 ? (
                    <div className="p-6 text-center text-xs text-on-surface-variant/70">
                      <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-2 text-warn" />
                      Carregando arquivos...
                    </div>
                  ) : appFiles.length === 0 ? (
                    <div className="p-6 text-center text-xs text-on-surface-variant/70">
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
                            className={`flex items-center justify-between px-3 py-2 rounded text-xs font-mono cursor-pointer transition-all ${
                              isSelected
                                ? 'bg-warn/15 text-warn border border-warn/30 font-bold'
                                : f.isDirectory
                                ? 'text-on-surface hover:bg-surface-container-low hover:text-white'
                                : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              {f.isDirectory ? (
                                <Folder className="w-4 h-4 text-warn shrink-0" />
                              ) : (
                                <File className="w-4 h-4 text-primary shrink-0" />
                              )}
                              <span className="truncate">{f.name}</span>
                            </div>
                            {!f.isDirectory && f.sizeBytes > 0 && (
                              <span className="text-[10px] text-outline shrink-0 ml-1">
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
              <div className="flex-1 bg-surface-container-lowest flex flex-col overflow-hidden">
                {selectedFileContent ? (
                  <>
                    {/* Toolbar */}
                    <div className="p-3 bg-surface-container-lowest/80 border-b border-outline-variant flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-mono text-on-surface-variant truncate">
                        <File className="w-4 h-4 text-primary shrink-0" />
                        <span className="font-bold text-white">{selectedFileContent.path}</span>
                        <span className="text-[11px] text-on-surface-variant/70">
                          ({(selectedFileContent.sizeBytes / 1024).toFixed(2)} KB)
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={handleCopyFileCode}
                          className="flex items-center gap-1 px-3 py-1.5 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-xs font-mono transition-colors"
                        >
                          {copiedFileCode ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedFileCode ? 'Copiado!' : 'Copiar'}</span>
                        </button>

                        <button
                          onClick={handleSaveFileContent}
                          disabled={savingFile}
                          className="flex items-center gap-1 px-4 py-1.5 rounded bg-warn hover:bg-amber-400 text-surface font-bold text-xs transition-all disabled:opacity-50"
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
                        className="w-full h-full bg-transparent text-ok font-mono text-xs leading-relaxed focus:outline-none resize-none selection:bg-primary-container/40 custom-scrollbar"
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-on-surface-variant/70">
                    <FolderTree className="w-12 h-12 text-outline-variant mb-3" />
                    <h4 className="font-bold text-white text-sm mb-1">Nenhum arquivo selecionado</h4>
                    <p className="text-xs text-on-surface-variant max-w-sm">
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
