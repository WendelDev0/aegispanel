import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  ArrowLeft,
  Clock,
  ExternalLink,
  Play,
  RefreshCw,
  Rocket,
  Square,
  Activity,
  Variable,
  CheckCircle2,
  AlertCircle,
  Terminal,
  Globe,
  Lock,
  Settings2,
  Sliders,
  Webhook,
  FileCode2,
  FolderTree,
  Trash2,
  Copy,
  Check,
  Download,
  Search,
  FileText,
  ChevronRight,
  Folder,
  File,
  Save,
  HardDrive,
  ShieldCheck,
  Cpu,
  Zap,
} from 'lucide-react';
import { api } from '../services/api.js';
import { useToast } from '../components/Toast.js';
import { socket } from '../services/socket.js';
import { EnvEditor } from '../components/EnvEditor.js';
import { LiveDeployModal, type LiveDeployState } from '../components/apps/LiveDeployModal.js';
import { BuildLogsModal } from '../components/apps/BuildLogsModal.js';
import type {
  AppRecord,
  DeploymentRecord,
  AppMetricsSnapshot,
  AlertHistoryRecord,
} from '../types/index.js';

type Tab =
  | 'overview'
  | 'deploys'
  | 'logs'
  | 'env'
  | 'network'
  | 'cicd'
  | 'files'
  | 'settings';

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'overview', label: 'Visão Geral', icon: <Activity className="w-3.5 h-3.5" /> },
  { id: 'deploys', label: 'Deploys & CI/CD', icon: <Clock className="w-3.5 h-3.5" /> },
  { id: 'logs', label: 'Logs ao Vivo', icon: <Terminal className="w-3.5 h-3.5" /> },
  { id: 'env', label: 'Variáveis .env', icon: <Variable className="w-3.5 h-3.5" /> },
  { id: 'network', label: 'Domínio & Rede', icon: <Globe className="w-3.5 h-3.5" /> },
  { id: 'cicd', label: 'Automação & Webhooks', icon: <Webhook className="w-3.5 h-3.5" /> },
  { id: 'files', label: 'Arquivos do App', icon: <FolderTree className="w-3.5 h-3.5" /> },
  { id: 'settings', label: 'Configurações', icon: <Settings2 className="w-3.5 h-3.5" /> },
];

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AppFileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  sizeBytes: number;
  modifiedAt: string;
  extension?: string;
}

interface AppDetailPageProps {
  appId: string;
  onBack: () => void;
}

export const AppDetailPage: React.FC<AppDetailPageProps> = ({ appId, onBack }) => {
  const toast = useToast();
  const [app, setApp] = useState<AppRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState<string | null>(null);

  // Deploys state
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [selectedBuildLogs, setSelectedBuildLogs] = useState<DeploymentRecord | null>(null);
  const [liveDeployModal, setLiveDeployModal] = useState<LiveDeployState | null>(null);

  // Metrics & Health
  const [metrics, setMetrics] = useState<AppMetricsSnapshot | null>(null);
  const [alerts, setAlerts] = useState<AlertHistoryRecord[]>([]);

  // Logs state
  const [logsText, setLogsText] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsAutoScroll, setLogsAutoScroll] = useState(true);
  const [logsSearchTerm, setLogsSearchTerm] = useState('');

  // Env state
  const [envLoaded, setEnvLoaded] = useState<Record<string, string> | null>(null);
  const [envDraft, setEnvDraft] = useState<Record<string, string> | null>(null);

  // Networking state
  const [domainDraft, setDomainDraft] = useState('');
  const [portDraft, setPortDraft] = useState('');
  const [internalPortDraft, setInternalPortDraft] = useState('');
  const [copiedUrl, setCopiedUrl] = useState(false);

  // CI/CD state
  const [webhookUrl, setWebhookUrl] = useState('');
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [workflowYaml, setWorkflowYaml] = useState('');
  const [copiedYaml, setCopiedYaml] = useState(false);

  // Files explorer state
  const [currentSubPath, setCurrentSubPath] = useState('');
  const [appFiles, setAppFiles] = useState<AppFileItem[]>([]);
  const [selectedFileContent, setSelectedFileContent] = useState<{
    filename: string;
    path: string;
    content: string;
    sizeBytes: number;
  } | null>(null);
  const [fileContentDraft, setFileContentDraft] = useState('');
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [savingFile, setSavingFile] = useState(false);

  // Settings state
  const [settingsName, setSettingsName] = useState('');
  const [settingsMemoryMb, setSettingsMemoryMb] = useState(512);
  const [settingsCpus, setSettingsCpus] = useState(1);

  const load = useCallback(async () => {
    try {
      try {
        const res = await api.get(`/apps/${appId}`);
        setApp(res.data);
        setDomainDraft(res.data.domain || '');
        setPortDraft(res.data.port ? res.data.port.toString() : '');
        setInternalPortDraft(res.data.internalPort ? res.data.internalPort.toString() : '3000');
        setSettingsName(res.data.name);
        if (res.data.limits) {
          setSettingsMemoryMb(res.data.limits.memoryMb || 512);
          setSettingsCpus(res.data.limits.cpus || 1);
        }
      } catch {
        // Fallback for list
        const res = await api.get('/apps');
        const found = (res.data as AppRecord[]).find((a) => a.id === appId) || null;
        setApp(found);
        if (found) {
          setDomainDraft(found.domain || '');
          setPortDraft(found.port ? found.port.toString() : '');
          setInternalPortDraft(found.internalPort ? found.internalPort.toString() : '3000');
          setSettingsName(found.name);
          if (found.limits) {
            setSettingsMemoryMb(found.limits.memoryMb || 512);
            setSettingsCpus(found.limits.cpus || 1);
          }
        }
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Falha ao carregar a aplicação');
    } finally {
      setLoading(false);
    }
  }, [appId, toast]);

  useEffect(() => {
    load();

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
  }, [load]);

  // Load Deploys
  useEffect(() => {
    if (tab !== 'deploys' && tab !== 'overview') return;
    api
      .get(`/apps/${appId}/deployments`)
      .then((res) => setDeployments(Array.isArray(res.data) ? res.data : []))
      .catch(() => setDeployments([]));
  }, [appId, tab]);

  // Load Metrics & Alerts
  useEffect(() => {
    if (tab !== 'overview') return;
    api
      .get(`/apps/${appId}/metrics`)
      .then((res) => setMetrics(res.data))
      .catch(() => setMetrics(null));

    api
      .get(`/apps/${appId}/alerts`)
      .then((res) => setAlerts(Array.isArray(res.data) ? res.data : []))
      .catch(() => setAlerts([]));
  }, [appId, tab]);

  // Load Live Logs
  const loadLogs = useCallback(async () => {
    try {
      setLogsLoading(true);
      const res = await api.get(`/apps/${appId}/logs`);
      setLogsText(res.data.logs || 'Sem logs disponíveis.');
    } catch (err: any) {
      setLogsText('Erro ao carregar logs: ' + err.message);
    } finally {
      setLogsLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    if (tab !== 'logs') return;
    void loadLogs();
    const interval = setInterval(loadLogs, 5000);
    return () => clearInterval(interval);
  }, [tab, loadLogs]);

  // Load Env
  useEffect(() => {
    if (tab !== 'env' || envLoaded) return;
    api
      .get(`/apps/${appId}/env`)
      .then((res) => {
        setEnvLoaded(res.data?.env || {});
        setEnvDraft(res.data?.env || {});
      })
      .catch((err) => toast.error(err.response?.data?.error || err.message, 'Falha ao ler variáveis'));
  }, [appId, tab, envLoaded, toast]);

  // Load Webhook & Workflow
  useEffect(() => {
    if (tab !== 'cicd') return;
    api
      .get(`/apps/${appId}/webhook`)
      .then((res) => setWebhookUrl(res.data.url))
      .catch(() => setWebhookUrl(''));

    api
      .get(`/apps/${appId}/workflow`)
      .then((res) => setWorkflowYaml(res.data.yaml))
      .catch(() => setWorkflowYaml(''));
  }, [appId, tab]);

  // Load Files
  const loadFiles = useCallback(
    async (subPath = '') => {
      setCurrentSubPath(subPath);
      setSelectedFileContent(null);
      try {
        setLoadingFiles(true);
        const res = await api.get(`/apps/${appId}/files`, { params: { subPath } });
        setAppFiles(res.data.items || []);
      } catch (err: any) {
        toast.error(err.response?.data?.error || err.message, 'Erro ao listar arquivos');
      } finally {
        setLoadingFiles(false);
      }
    },
    [appId, toast],
  );

  useEffect(() => {
    if (tab !== 'files') return;
    void loadFiles('');
  }, [tab, loadFiles]);

  const handleOpenFileContent = async (filePath: string) => {
    try {
      setLoadingFiles(true);
      const res = await api.get(`/apps/${appId}/files/content`, { params: { filePath } });
      setSelectedFileContent(res.data);
      setFileContentDraft(res.data.content);
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao ler arquivo');
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleSaveFileContent = async () => {
    if (!selectedFileContent) return;
    try {
      setSavingFile(true);
      await api.put(`/apps/${appId}/files/content`, {
        filePath: selectedFileContent.path,
        content: fileContentDraft,
      });
      toast.success('Arquivo salvo com sucesso!');
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao salvar arquivo');
    } finally {
      setSavingFile(false);
    }
  };

  // Actions
  const act = async (action: string, label: string) => {
    try {
      setBusy(action);
      await api.post(`/apps/${appId}/${action}`);
      toast.success(`${label} concluído.`);
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, `Erro ao ${label.toLowerCase()}`);
    } finally {
      setBusy(null);
    }
  };

  const deployNow = async () => {
    if (!app) return;
    try {
      setBusy('deploy');
      setLiveDeployModal({
        app,
        step: 1,
        stepName: 'Inicializando Pipeline',
        logs: `[${new Date().toLocaleTimeString('pt-BR')}] 🚀 Disparando build em tempo real...\n`,
        percentage: 15,
        status: 'running',
      });
      await api.post(`/apps/${appId}/deploy`, {
        commitMessage: 'Deploy manual acionado pelo painel',
      });
      toast.info('O build começou. Acompanhe pelos logs.', 'Deploy disparado');
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao disparar deploy');
    } finally {
      setBusy(null);
    }
  };

  const redeploy = async (dep: DeploymentRecord) => {
    const alvo = dep.commitHash ? `#${dep.commitHash}` : 'este deploy';
    if (!confirm(`Reconstruir ${alvo} do zero com a configuração atual?`)) return;
    try {
      setBusy(dep.id);
      await api.post(`/apps/${appId}/deployments/${dep.id}/redeploy`);
      toast.info('O build começou. Acompanhe pelos logs.', 'Redeploy disparado');
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao redeployar');
    } finally {
      setBusy(null);
    }
  };

  const rollback = async (dep: DeploymentRecord) => {
    if (!confirm('Voltar para a imagem já construída deste deploy? Leva segundos, sem recompilar.')) {
      return;
    }
    try {
      setBusy(dep.id);
      const res = await api.post(`/apps/${appId}/rollback/${dep.id}`);
      toast.success(res.data.message);
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao reverter');
    } finally {
      setBusy(null);
    }
  };

  const saveEnv = async () => {
    if (!envDraft) return;
    try {
      setBusy('env');
      await api.put(`/apps/${appId}/env`, { env: envDraft });
      const temPublica = Object.keys(envDraft).some(
        (k) => k.startsWith('NEXT_PUBLIC_') || k.startsWith('VITE_'),
      );
      toast.success(
        temPublica
          ? 'Variáveis salvas. Variáveis públicas exigem Redeploy para serem assadas no bundle.'
          : 'Variáveis salvas. Reinicie a aplicação para aplicá-las.',
      );
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao salvar variáveis');
    } finally {
      setBusy(null);
    }
  };

  const saveDomain = async () => {
    try {
      setBusy('domain');
      await api.put(`/apps/${appId}/domain`, { domain: domainDraft.trim() || undefined });
      toast.success('Domínio atualizado com sucesso!');
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao salvar domínio');
    } finally {
      setBusy(null);
    }
  };

  const saveNetworkPorts = async () => {
    try {
      setBusy('ports');
      await api.put(`/apps/${appId}`, {
        port: portDraft ? parseInt(portDraft) : null,
        internalPort: internalPortDraft ? parseInt(internalPortDraft) : 3000,
      });
      toast.success('Portas atualizadas com sucesso!');
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao atualizar portas');
    } finally {
      setBusy(null);
    }
  };

  const rotateWebhookSecret = async () => {
    if (!confirm('Gerar um novo segredo invalida a URL atual. Continuar?')) return;
    try {
      setBusy('rotate-wh');
      await api.post(`/apps/${appId}/webhook-secret`);
      const res = await api.get(`/apps/${appId}/webhook`);
      setWebhookUrl(res.data.url);
      toast.success('Novo segredo gerado!');
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Falha ao girar segredo');
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = async () => {
    try {
      setBusy('settings');
      await api.put(`/apps/${appId}`, {
        name: settingsName.trim() || app?.name,
        limits: {
          memoryMb: settingsMemoryMb,
          cpus: settingsCpus,
          pidsLimit: 256,
        },
      });
      toast.success('Configurações salvas!');
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao salvar configurações');
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteApp = async () => {
    if (!app) return;
    if (!confirm(`TEM CERTEZA? Isso excluirá permanentemente a aplicação "${app.name}" e seus contêineres.`)) {
      return;
    }
    try {
      setBusy('delete');
      await api.delete(`/apps/${appId}`);
      toast.success(`Aplicação "${app.name}" excluída.`);
      onBack();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao deletar aplicação');
    } finally {
      setBusy(null);
    }
  };

  const filteredLogs = useMemo(() => {
    if (!logsSearchTerm) return logsText;
    const lines = logsText.split('\n');
    return lines.filter((l) => l.toLowerCase().includes(logsSearchTerm.toLowerCase())).join('\n');
  }, [logsText, logsSearchTerm]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-on-surface-variant gap-3">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        <span className="text-xs">Carregando painel da aplicação...</span>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="p-6 space-y-4 max-w-lg mx-auto text-center">
        <div className="w-12 h-12 rounded-lg bg-crit/10 text-crit flex items-center justify-center mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-white">Aplicação não encontrada</h3>
        <p className="text-xs text-on-surface-variant">
          O identificador informado não corresponde a nenhuma aplicação ativa no painel.
        </p>
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-lg bg-surface-container border border-outline-variant text-white text-xs font-semibold inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Voltar para Aplicações
        </button>
      </div>
    );
  }

  const health = app.health?.status;
  const badge =
    app.status !== 'running'
      ? {
          label: app.status === 'building' ? 'Publicando' : app.status === 'error' ? 'Erro' : 'Parado',
          cls: 'text-on-surface-variant border-outline-variant bg-surface-container-high',
          dot: 'bg-outline',
        }
      : health === 'unhealthy'
        ? { label: 'Não responde', cls: 'text-crit border-crit/30 bg-crit/10', dot: 'bg-crit animate-pulse' }
        : health === 'starting'
          ? { label: 'Subindo', cls: 'text-warn border-warn/30 bg-warn/10', dot: 'bg-warn animate-pulse' }
          : { label: 'Online', cls: 'text-ok border-ok/30 bg-ok/10', dot: 'bg-emerald-400 animate-pulse' };

  const currentHost = window.location.hostname || 'localhost';
  const directUrl = `http://${currentHost}:${app.port}`;

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Executive Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <button
            onClick={onBack}
            className="text-xs text-on-surface-variant hover:text-white flex items-center gap-1.5 transition-colors mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Voltar para lista de aplicações
          </button>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-surface-container-high border border-outline-variant flex items-center justify-center font-bold text-primary shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-2xl font-bold text-white tracking-[-0.01em]">{app.name}</h1>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold flex items-center gap-1.5 ${badge.cls}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                  {badge.label}
                </span>
                {app.sourceType === 'git' && (
                  <span className="text-[10px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/30">
                    branch: {app.branch || 'main'}
                  </span>
                )}
              </div>
              <p className="text-xs font-mono text-on-surface-variant/80 mt-0.5">
                {app.gitUrl || app.imageName}
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Cluster */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button
            onClick={deployNow}
            disabled={busy === 'deploy'}
            className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
          >
            <Rocket className={`w-3.5 h-3.5 ${busy === 'deploy' ? 'animate-bounce' : ''}`} />
            <span>Fazer Deploy Agora</span>
          </button>

          {app.status === 'running' ? (
            <button
              onClick={() => act('stop', 'Parar')}
              disabled={busy === 'stop'}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-surface-container-high text-on-surface-variant border border-outline-variant hover:text-warn disabled:opacity-50 flex items-center gap-1.5 transition-colors"
            >
              <Square className="w-3.5 h-3.5" /> Parar
            </button>
          ) : (
            <button
              onClick={() => act('start', 'Iniciar')}
              disabled={busy === 'start'}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-ok/10 text-ok border border-ok/30 hover:bg-ok/15 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
            >
              <Play className="w-3.5 h-3.5" /> Iniciar
            </button>
          )}

          <button
            onClick={() => act('restart', 'Reiniciar')}
            disabled={busy === 'restart'}
            className="px-3 py-2 rounded-lg text-xs font-semibold bg-surface-container-high text-on-surface-variant border border-outline-variant hover:text-white disabled:opacity-50 flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy === 'restart' ? 'animate-spin' : ''}`} />
            Reiniciar
          </button>
        </div>
      </div>

      {/* Tabs Navigation Bar */}
      <div className="flex items-center gap-1 border-b border-outline-variant overflow-x-auto custom-scrollbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-xs font-semibold flex items-center gap-2 border-b-2 -mb-px transition-all whitespace-nowrap ${
              tab === t.id
                ? 'border-primary text-primary bg-primary/5'
                : 'border-transparent text-on-surface-variant hover:text-white hover:bg-surface-container-high/40'
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* TAB 1: VISÃO GERAL (OVERVIEW) */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {/* Quick Telemetry Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-4 rounded-lg bg-surface-container border border-outline-variant">
              <div className="flex items-center justify-between text-on-surface-variant text-[11px] mb-2">
                <span>CPU do Contêiner</span>
                <Cpu className="w-4 h-4 text-primary" />
              </div>
              <div className="text-2xl font-bold font-mono text-white">
                {metrics?.available ? `${metrics.cpuPercent}%` : '—'}
              </div>
              {metrics?.available && (
                <div className="h-1.5 bg-surface-container-high rounded-full mt-3 overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${Math.min(100, metrics.cpuPercent)}%` }}
                  />
                </div>
              )}
            </div>

            <div className="p-4 rounded-lg bg-surface-container border border-outline-variant">
              <div className="flex items-center justify-between text-on-surface-variant text-[11px] mb-2">
                <span>Memória RAM</span>
                <HardDrive className="w-4 h-4 text-ok" />
              </div>
              <div className="text-2xl font-bold font-mono text-white">
                {metrics?.available ? formatBytes(metrics.memoryUsedBytes) : '—'}
              </div>
              {metrics?.available && (
                <div className="h-1.5 bg-surface-container-high rounded-full mt-3 overflow-hidden">
                  <div
                    className="h-full bg-ok rounded-full"
                    style={{ width: `${Math.min(100, metrics.memoryPercent)}%` }}
                  />
                </div>
              )}
            </div>

            <div className="p-4 rounded-lg bg-surface-container border border-outline-variant">
              <div className="flex items-center justify-between text-on-surface-variant text-[11px] mb-2">
                <span>Mapeamento de Porta</span>
                <Globe className="w-4 h-4 text-warn" />
              </div>
              <div className="text-base font-bold font-mono text-white mt-1">
                :{app.port}{' '}
                <span className="text-xs font-normal text-on-surface-variant">
                  &rarr; app :{app.internalPort}
                </span>
              </div>
              <p className="text-[11px] text-on-surface-variant/70 mt-2 font-mono">
                Container ID: {app.containerId ? app.containerId.substring(0, 12) : 'Nenhum'}
              </p>
            </div>

            <div className="p-4 rounded-lg bg-surface-container border border-outline-variant">
              <div className="flex items-center justify-between text-on-surface-variant text-[11px] mb-2">
                <span>Sondagem de Saúde</span>
                <Activity className="w-4 h-4 text-tertiary" />
              </div>
              <div className="text-base font-bold text-white mt-1">
                {health === 'healthy'
                  ? 'Respondendo'
                  : health === 'unhealthy'
                    ? 'Sem Resposta'
                    : 'Aguardando'}
              </div>
              <p className="text-[11px] text-on-surface-variant/70 mt-2">
                {app.health?.checkedAt
                  ? new Date(app.health.checkedAt).toLocaleTimeString('pt-BR')
                  : 'Ainda não sondado'}
              </p>
            </div>
          </div>

          {/* Access Links Card */}
          <div className="p-4 rounded-lg bg-surface-container border border-outline-variant space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              Endereços de Acesso da Aplicação
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 rounded bg-surface-container-low border border-outline-variant flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-on-surface-variant block mb-1">
                    Domínio Hostinger / SSL:
                  </span>
                  {app.domain ? (
                    <a
                      href={`https://${app.domain}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-semibold text-ok hover:underline flex items-center gap-1.5"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      https://{app.domain}
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  ) : (
                    <button
                      onClick={() => setTab('network')}
                      className="text-xs text-primary hover:underline font-semibold"
                    >
                      + Vincular Domínio com SSL Grátis
                    </button>
                  )}
                </div>
              </div>

              <div className="p-3 rounded bg-surface-container-low border border-outline-variant flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-on-surface-variant block mb-1">
                    Acesso Direto (IP do VPS + Porta):
                  </span>
                  <a
                    href={directUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-semibold font-mono text-white hover:underline flex items-center gap-1.5"
                  >
                    {directUrl}
                    <ExternalLink className="w-3.5 h-3.5 text-primary" />
                  </a>
                </div>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(directUrl);
                    setCopiedUrl(true);
                    setTimeout(() => setCopiedUrl(false), 2000);
                  }}
                  className="p-1.5 rounded text-on-surface-variant hover:text-white bg-surface-container"
                  title="Copiar link"
                >
                  {copiedUrl ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {/* Active Deployment Card */}
          {deployments.length > 0 && (
            <div className="p-4 rounded-lg bg-surface-container border border-outline-variant space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-ok" />
                  Deploy Ativo em Produção
                </h3>
                <span className="text-[11px] font-mono text-ok bg-ok/10 px-2 py-0.5 rounded border border-ok/30">
                  {deployments[0].status.toUpperCase()}
                </span>
              </div>

              <div className="p-3 rounded bg-surface-container-low border border-outline-variant flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-sm">
                      {deployments[0].commitMessage || 'Deploy'}
                    </span>
                    <span className="text-[10px] font-mono text-primary bg-primary/20 px-2 py-0.5 rounded">
                      {deployments[0].branch}
                    </span>
                  </div>
                  <p className="text-[11px] text-on-surface-variant font-mono">
                    {deployments[0].commitHash ? `#${deployments[0].commitHash} · ` : ''}
                    {deployments[0].authorName} ·{' '}
                    {new Date(deployments[0].createdAt).toLocaleString('pt-BR')} ·{' '}
                    {deployments[0].durationSeconds}s
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => redeploy(deployments[0])}
                    disabled={busy === deployments[0].id}
                    className="px-3 py-1.5 rounded bg-primary/10 hover:bg-primary/15 text-primary border border-primary/30 text-xs font-semibold flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${busy === deployments[0].id ? 'animate-spin' : ''}`} />
                    Redeploy
                  </button>
                  <button
                    onClick={() => setSelectedBuildLogs(deployments[0])}
                    className="px-3 py-1.5 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-xs font-medium border border-outline-variant"
                  >
                    Logs de Build
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: DEPLOYS & CI/CD */}
      {tab === 'deploys' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              Histórico Cronológico de Builds & Deploys
            </h3>
            <button
              onClick={deployNow}
              disabled={busy === 'deploy'}
              className="px-3 py-1.5 rounded bg-primary text-on-primary text-xs font-semibold flex items-center gap-1.5 hover:bg-primary/90 transition-all active:scale-95"
            >
              <Zap className="w-3.5 h-3.5" />
              Novo Deploy
            </button>
          </div>

          {deployments.length === 0 ? (
            <div className="p-8 text-center bg-surface-container rounded-lg border border-outline-variant text-xs text-on-surface-variant">
              Nenhum deploy registrado ainda para esta aplicação.
            </div>
          ) : (
            <div className="space-y-2">
              {deployments.map((dep, idx) => (
                <div
                  key={dep.id}
                  className={`p-4 rounded-lg bg-surface-container border transition-colors flex flex-wrap items-center justify-between gap-3 ${
                    idx === 0 ? 'border-primary/40' : 'border-outline-variant'
                  }`}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {dep.status === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 text-ok shrink-0" />
                      ) : dep.status === 'building' || dep.status === 'queued' ? (
                        <RefreshCw className="w-4 h-4 text-warn animate-spin shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-crit shrink-0" />
                      )}
                      <span className="font-bold text-on-surface text-xs truncate">
                        {dep.commitMessage || 'Deploy'}
                      </span>
                      <span className="text-[10px] font-mono text-primary bg-primary/20 px-2 py-0.5 rounded shrink-0">
                        {dep.branch}
                      </span>
                      {idx === 0 && (
                        <span className="text-[10px] bg-ok/10 text-ok px-2 py-0.5 rounded border border-ok/30 font-semibold">
                          Atual
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-on-surface-variant font-mono">
                      {dep.commitHash ? `#${dep.commitHash} · ` : ''}
                      {dep.authorName} · {new Date(dep.createdAt).toLocaleString('pt-BR')} ·{' '}
                      {dep.durationSeconds}s
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        setSelectedBuildLogs({ ...dep, buildLogs: 'Carregando logs…' });
                        api
                          .get(`/apps/${app.id}/deployments/${dep.id}/logs`)
                          .then((res) => setSelectedBuildLogs({ ...dep, buildLogs: res.data.buildLogs || '' }))
                          .catch((err) =>
                            setSelectedBuildLogs({
                              ...dep,
                              buildLogs: `Erro ao carregar logs: ${err.message}`,
                            }),
                          );
                      }}
                      className="px-3 py-1.5 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface border border-outline-variant text-xs font-semibold transition-colors"
                    >
                      Ver Logs
                    </button>

                    <button
                      onClick={() => redeploy(dep)}
                      disabled={busy === dep.id}
                      title="Reconstruir este commit com a configuração atual"
                      className="px-3 py-1.5 rounded bg-primary/10 hover:bg-primary/15 text-primary border border-primary/30 text-xs font-semibold disabled:opacity-50 flex items-center gap-1"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${busy === dep.id ? 'animate-spin' : ''}`} />
                      Redeploy
                    </button>

                    {dep.status === 'success' && idx !== 0 && (
                      <button
                        onClick={() => rollback(dep)}
                        disabled={busy === dep.id}
                        title="Voltar para a imagem já construída — sem recompilar"
                        className="px-3 py-1.5 rounded bg-warn/10 hover:bg-warn/15 text-warn border border-warn/30 text-xs font-semibold disabled:opacity-50"
                      >
                        ⏪ Rollback
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: LOGS EM TEMPO REAL (CONSOLE) */}
      {tab === 'logs' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-container p-3 rounded-lg border border-outline-variant">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-primary" />
              <span className="text-xs font-bold text-white">Console de Logs</span>
              <button
                onClick={loadLogs}
                title="Atualizar logs"
                className="p-1 rounded text-on-surface-variant hover:text-white hover:bg-surface-container-high"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${logsLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-on-surface-variant absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filtrar logs..."
                  value={logsSearchTerm}
                  onChange={(e) => setLogsSearchTerm(e.target.value)}
                  className="bg-surface-container-low border border-outline-variant rounded pl-7 pr-3 py-1 text-xs text-white placeholder-on-surface-variant/50 focus:outline-none focus:border-primary"
                />
              </div>

              <button
                onClick={() => {
                  void navigator.clipboard.writeText(logsText);
                  toast.success('Logs copiados!');
                }}
                className="px-2.5 py-1 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-xs font-medium border border-outline-variant flex items-center gap-1"
              >
                <Copy className="w-3 h-3" /> Copiar
              </button>

              <button
                onClick={() => {
                  const blob = new Blob([logsText], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${app.name}-logs.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="px-2.5 py-1 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-xs font-medium border border-outline-variant flex items-center gap-1"
              >
                <Download className="w-3 h-3" /> Baixar
              </button>
            </div>
          </div>

          <div className="p-4 bg-black/95 rounded-lg border border-outline-variant font-mono text-xs text-ok leading-relaxed min-h-[400px] max-h-[600px] overflow-y-auto custom-scrollbar whitespace-pre-wrap">
            {logsLoading && !logsText ? 'Carregando saída de logs...' : filteredLogs || 'Nenhum log gravado ainda.'}
          </div>
        </div>
      )}

      {/* TAB 4: VARIÁVEIS DE AMBIENTE */}
      {tab === 'env' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-surface-container border border-outline-variant space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Sliders className="w-4 h-4 text-warn" />
                  Variáveis de Ambiente (.env)
                </h3>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Valores fornecidos ao processo da aplicação no contêiner.
                </p>
              </div>

              <button
                onClick={saveEnv}
                disabled={busy === 'env' || !envDraft}
                className="px-4 py-2 rounded-lg bg-ok text-white font-semibold text-xs hover:bg-ok/90 transition-all disabled:opacity-50"
              >
                {busy === 'env' ? 'Salvando...' : 'Salvar Variáveis'}
              </button>
            </div>

            {envLoaded === null ? (
              <p className="text-xs text-on-surface-variant py-4">Carregando variáveis...</p>
            ) : (
              <EnvEditor initialEnv={envLoaded} onChange={(record) => setEnvDraft(record)} />
            )}
          </div>
        </div>
      )}

      {/* TAB 5: DOMÍNIO & REDE */}
      {tab === 'network' && (
        <div className="space-y-5">
          <div className="p-5 rounded-lg bg-surface-container border border-outline-variant space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />
              Domínio Customizado & Certificado SSL
            </h3>
            <p className="text-xs text-on-surface-variant">
              Vincule seu domínio ou subdomínio (ex: Hostinger, Cloudflare). O AegisPanel gera e renova
              certificados Let's Encrypt automaticamente via Caddy.
            </p>

            <div className="flex gap-2 max-w-md">
              <input
                type="text"
                placeholder="ex: app.meusite.com.br"
                value={domainDraft}
                onChange={(e) => setDomainDraft(e.target.value)}
                className="flex-1 bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-xs text-white placeholder-on-surface-variant/50 focus:outline-none focus:border-primary font-mono"
              />
              <button
                onClick={saveDomain}
                disabled={busy === 'domain'}
                className="px-4 py-2 rounded bg-primary text-on-primary text-xs font-semibold hover:bg-primary/90 transition-all"
              >
                {busy === 'domain' ? 'Salvando...' : 'Salvar Domínio'}
              </button>
            </div>
          </div>

          <div className="p-5 rounded-lg bg-surface-container border border-outline-variant space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Globe className="w-4 h-4 text-warn" />
              Portas de Rede
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
              <div>
                <label className="block text-[11px] font-semibold text-on-surface-variant uppercase mb-1">
                  Porta Pública do VPS (Host)
                </label>
                <input
                  type="number"
                  placeholder="Automática (ex: 4100)"
                  value={portDraft}
                  onChange={(e) => setPortDraft(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-xs text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-on-surface-variant uppercase mb-1">
                  Porta Interna do Contêiner
                </label>
                <input
                  type="number"
                  placeholder="3000"
                  value={internalPortDraft}
                  onChange={(e) => setInternalPortDraft(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-xs text-white font-mono"
                />
              </div>
            </div>
            <button
              onClick={saveNetworkPorts}
              disabled={busy === 'ports'}
              className="px-4 py-2 rounded bg-primary text-on-primary text-xs font-semibold hover:bg-primary/90 transition-all"
            >
              {busy === 'ports' ? 'Atualizando...' : 'Atualizar Portas'}
            </button>
          </div>
        </div>
      )}

      {/* TAB 6: AUTOMAÇÃO & CI/CD */}
      {tab === 'cicd' && (
        <div className="space-y-5">
          <div className="p-5 rounded-lg bg-surface-container border border-outline-variant space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Webhook className="w-4 h-4 text-tertiary" />
                  Webhook de Auto-Deploy do GitHub
                </h3>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Configure no GitHub (Settings &rarr; Webhooks) para disparar deploys automáticos em cada push.
                </p>
              </div>
              <button
                onClick={rotateWebhookSecret}
                disabled={busy === 'rotate-wh'}
                className="px-3 py-1.5 rounded bg-surface-container-high text-on-surface text-xs font-medium border border-outline-variant hover:text-white"
              >
                Girar Segredo
              </button>
            </div>

            <div className="p-3 bg-surface-container-low border border-outline-variant rounded flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-primary truncate">
                {webhookUrl || 'Carregando webhook...'}
              </span>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(webhookUrl);
                  setCopiedWebhook(true);
                  setTimeout(() => setCopiedWebhook(false), 2000);
                }}
                className="px-3 py-1 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-xs font-medium shrink-0 flex items-center gap-1"
              >
                {copiedWebhook ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}
                <span>Copiar URL</span>
              </button>
            </div>
          </div>

          <div className="p-5 rounded-lg bg-surface-container border border-outline-variant space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <FileCode2 className="w-4 h-4 text-primary" />
                GitHub Actions (.github/workflows/deploy.yml)
              </h3>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(workflowYaml);
                  setCopiedYaml(true);
                  setTimeout(() => setCopiedYaml(false), 2000);
                }}
                className="px-3 py-1.5 rounded bg-primary text-on-primary text-xs font-semibold flex items-center gap-1"
              >
                {copiedYaml ? <Check className="w-3.5 h-3.5 text-on-primary" /> : <Copy className="w-3.5 h-3.5" />}
                <span>Copiar YAML</span>
              </button>
            </div>
            <div className="p-4 bg-black/95 rounded border border-outline-variant font-mono text-xs text-on-surface leading-relaxed overflow-x-auto custom-scrollbar">
              <pre>{workflowYaml || '# Carregando configuração de workflow...'}</pre>
            </div>
          </div>
        </div>
      )}

      {/* TAB 7: ARQUIVOS DO PROJETO */}
      {tab === 'files' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-surface-container border border-outline-variant space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono text-on-surface-variant">
                <FolderTree className="w-4 h-4 text-warn" />
                <span>builds/{app.id}/{currentSubPath}</span>
              </div>
              {currentSubPath && (
                <button
                  onClick={() => {
                    const parts = currentSubPath.split('/').filter(Boolean);
                    parts.pop();
                    loadFiles(parts.join('/'));
                  }}
                  className="px-2 py-1 rounded bg-surface-container-high text-xs text-on-surface-variant hover:text-white"
                >
                  &uarr; Subir Pasta
                </button>
              )}
            </div>

            {loadingFiles ? (
              <p className="text-xs text-on-surface-variant py-8 text-center">Carregando arquivos...</p>
            ) : selectedFileContent ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-surface-container-low p-2 rounded border border-outline-variant">
                  <span className="font-mono text-xs text-white">{selectedFileContent.filename}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedFileContent(null)}
                      className="px-2.5 py-1 rounded text-xs text-on-surface-variant hover:text-white"
                    >
                      Fechar
                    </button>
                    <button
                      onClick={handleSaveFileContent}
                      disabled={savingFile}
                      className="px-3 py-1 rounded bg-ok text-white text-xs font-semibold flex items-center gap-1"
                    >
                      <Save className="w-3 h-3" />
                      {savingFile ? 'Salvando...' : 'Salvar Alterações'}
                    </button>
                  </div>
                </div>
                <textarea
                  value={fileContentDraft}
                  onChange={(e) => setFileContentDraft(e.target.value)}
                  className="w-full h-96 bg-black/95 text-white font-mono text-xs p-4 rounded border border-outline-variant focus:outline-none focus:border-primary custom-scrollbar"
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {appFiles.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => {
                      if (file.isDirectory) {
                        loadFiles(file.path);
                      } else {
                        handleOpenFileContent(file.path);
                      }
                    }}
                    className="p-2.5 rounded bg-surface-container-low hover:bg-surface-container-high border border-outline-variant text-left flex items-center gap-2.5 transition-colors group"
                  >
                    {file.isDirectory ? (
                      <Folder className="w-4 h-4 text-warn shrink-0" />
                    ) : (
                      <File className="w-4 h-4 text-primary shrink-0" />
                    )}
                    <span className="text-xs text-on-surface font-mono truncate group-hover:text-white">
                      {file.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 8: CONFIGURAÇÕES & ZONA DE PERIGO */}
      {tab === 'settings' && (
        <div className="space-y-6">
          <div className="p-5 rounded-lg bg-surface-container border border-outline-variant space-y-4">
            <h3 className="text-sm font-bold text-white">Configurações Gerais</h3>
            <div className="space-y-3 max-w-lg">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase mb-1">
                  Nome da Aplicação
                </label>
                <input
                  type="text"
                  value={settingsName}
                  onChange={(e) => setSettingsName(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant uppercase mb-1">
                    Limite de RAM (MB)
                  </label>
                  <input
                    type="number"
                    value={settingsMemoryMb}
                    onChange={(e) => setSettingsMemoryMb(parseInt(e.target.value) || 512)}
                    className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant uppercase mb-1">
                    CPUs
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    value={settingsCpus}
                    onChange={(e) => setSettingsCpus(parseFloat(e.target.value) || 1)}
                    className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <button
                onClick={saveSettings}
                disabled={busy === 'settings'}
                className="px-4 py-2 rounded bg-primary text-on-primary text-xs font-semibold hover:bg-primary/90 transition-all"
              >
                {busy === 'settings' ? 'Salvando...' : 'Salvar Configurações'}
              </button>
            </div>
          </div>

          <div className="p-5 rounded-lg bg-surface-container border border-crit/30 space-y-4">
            <h3 className="text-sm font-bold text-crit flex items-center gap-2">
              <Trash2 className="w-4 h-4" />
              Zona de Perigo
            </h3>
            <p className="text-xs text-on-surface-variant">
              Excluir esta aplicação remove todos os seus contêineres Docker, histórico de deploys e
              configurações permanentemente.
            </p>
            <button
              onClick={handleDeleteApp}
              disabled={busy === 'delete'}
              className="px-4 py-2 rounded bg-crit/10 hover:bg-crit/20 text-crit border border-crit/30 font-semibold text-xs transition-all"
            >
              {busy === 'delete' ? 'Excluindo...' : 'Excluir Esta Aplicação'}
            </button>
          </div>
        </div>
      )}

      {/* Build Logs Modal */}
      {selectedBuildLogs && (
        <BuildLogsModal deployment={selectedBuildLogs} onClose={() => setSelectedBuildLogs(null)} />
      )}

      {/* Live Deploy Modal */}
      {liveDeployModal && (
        <LiveDeployModal state={liveDeployModal} onClose={() => setLiveDeployModal(null)} />
      )}
    </div>
  );
};
