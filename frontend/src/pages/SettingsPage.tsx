import React, { useState, useEffect, useRef } from 'react';
import {
  Settings,
  Server,
  Save,
  Copy,
  Check,
  Terminal,
  Bell,
  Trash2,
  Download,
  Upload,
  Sparkles,
  MessageSquare,
  Send,
  Users,
  UserPlus,
  Lock,
  Shield,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Database,
  Bot,
  RefreshCw,
  Radio,
  ExternalLink,
  Globe,
  SlidersHorizontal,
  KeyRound,
  FileCode2,
} from 'lucide-react';
import { api, persistSession } from '../services/api.js';
import { socket } from '../services/socket.js';
import { User } from '../types/index.js';
import { SecuritySection } from '../components/settings/SecuritySection.js';
import { AuditSection } from '../components/settings/AuditSection.js';
import { StateHistorySection } from '../components/settings/StateHistorySection.js';
import { useToast } from '../components/Toast.js';
import { useConfirm } from '../components/ConfirmModal.js';
import { Badge } from '../components/ui.js';

/** Placeholder the API sends in place of a stored secret. */
const SECRET_MASK = '••••••••';

/**
 * Shown under a secret input whose value is stored on the server but never
 * sent back. Makes it clear the field being empty does not mean unset.
 */
const SecretStatus: React.FC<{ configured: boolean; onClear: () => void }> = ({ configured, onClear }) =>
  configured ? (
    <p className="text-[10px] text-on-surface-variant/80 mt-1.5 flex items-center gap-1.5">
      <Lock className="w-3 h-3 text-ok shrink-0" />
      <span>Já configurado no servidor. Deixe em branco para manter.</span>
      <button
        type="button"
        onClick={onClear}
        className="text-crit hover:underline font-semibold ml-1 cursor-pointer"
      >
        Remover
      </button>
    </p>
  ) : null;

const ROLE_LEGEND = [
  {
    role: 'ADMIN',
    badgeTone: 'info' as const,
    text: 'Acesso total: equipe, terminal do host, tarefas shell, firewall e migração do painel.',
  },
  {
    role: 'DEVELOPER',
    badgeTone: 'ok' as const,
    text: 'Gerenciamento de apps, deploys, bancos, domínios, arquivos e terminal de contêineres.',
  },
  {
    role: 'VIEWER',
    badgeTone: 'neutral' as const,
    text: 'Somente leitura: visualiza métricas e status sem permissão para alterações ou terminal.',
  },
];

type SettingsTabId = 'general' | 'notifications' | 'integrations' | 'security' | 'team' | 'system';

interface TabItem {
  id: SettingsTabId;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const SETTINGS_TABS: TabItem[] = [
  {
    id: 'general',
    label: 'Geral & Domínio',
    description: 'Identificação da VPS, SSL e script',
    icon: Server,
  },
  {
    id: 'notifications',
    label: 'Alertas & Notificações',
    description: 'WhatsApp, Telegram e Discord',
    icon: Bell,
  },
  {
    id: 'integrations',
    label: 'IA & Integrações',
    description: 'OpenAI, OpenRouter, Redis e SQL',
    icon: Bot,
  },
  {
    id: 'security',
    label: 'Segurança & Senha',
    description: '2FA, sessões e credenciais',
    icon: Shield,
  },
  {
    id: 'team',
    label: 'Equipe & Acessos',
    description: 'Membros e controle de funções',
    icon: Users,
  },
  {
    id: 'system',
    label: 'Manutenção & Logs',
    description: 'Backup, self-update e auditoria',
    icon: Activity,
    adminOnly: true,
  },
];

interface SettingsPageProps {
  currentUser: User | null;
  onUserUpdate?: (user: User) => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ currentUser, onUserUpdate }) => {
  const isAdmin = currentUser?.role === 'admin';
  const toast = useToast();
  const confirm = useConfirm();

  // Tab State
  const [activeTab, setActiveTab] = useState<SettingsTabId>('general');

  // General Settings
  const [serverName, setServerName] = useState('');
  const [caddyEnabled, setCaddyEnabled] = useState(true);
  const [panelDomain, setPanelDomain] = useState('');
  const [teamUsers, setTeamUsers] = useState<User[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

  // Alert settings
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('');
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');

  // Evolution API (WhatsApp)
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [whatsappApiUrl, setWhatsappApiUrl] = useState('');
  const [whatsappApiKey, setWhatsappApiKey] = useState('');
  const [whatsappInstance, setWhatsappInstance] = useState('');
  const [whatsappRecipientNumber, setWhatsappRecipientNumber] = useState('');

  // Evolution API live status & testing
  const [testingEvolution, setTestingEvolution] = useState(false);
  const [evolutionTestResult, setEvolutionTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [evolutionInstances, setEvolutionInstances] = useState<
    Array<{ name: string; connectionStatus?: string; profileName?: string; number?: string }>
  >([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [evolutionManagerUrl, setEvolutionManagerUrl] = useState<string | null>(null);

  // AI Providers (OpenAI & OpenRouter)
  const [openaiKey, setOpenaiKey] = useState('');
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [allowedModels, setAllowedModels] = useState('gpt-4o-mini, gpt-4o, claude-3-5-sonnet');
  const [testingAi, setTestingAi] = useState(false);
  const [aiTestProvider, setAiTestProvider] = useState<'openai' | 'openrouter'>('openai');
  const [aiTestModel, setAiTestModel] = useState('gpt-4o-mini');
  const [aiTestResult, setAiTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Flow Data URLs (Redis & Postgres)
  const [flowRedisUrl, setFlowRedisUrl] = useState('');
  const [flowPostgresUrl, setFlowPostgresUrl] = useState('');

  // Notification Trigger Preferences
  const [notifyOnDeploySuccess, setNotifyOnDeploySuccess] = useState(true);
  const [notifyOnDeployFail, setNotifyOnDeployFail] = useState(true);
  const [notifyOnHighResource, setNotifyOnHighResource] = useState(true);
  const [notifyOnBackup, setNotifyOnBackup] = useState(true);

  const [cpuThreshold, setCpuThreshold] = useState(90);
  const [memThreshold, setMemThreshold] = useState(85);
  const [diskThreshold, setDiskThreshold] = useState(90);

  /** Which secrets already have a value stored on the server. */
  const [configuredSecrets, setConfiguredSecrets] = useState<Record<string, boolean>>({});

  // Testing status
  const [testingChannel, setTestingChannel] = useState<string | null>(null);

  // Team loading state
  const [teamError, setTeamError] = useState<string | null>(null);

  // Change own password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newOwnPassword, setNewOwnPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // Team User Modal
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'developer' | 'viewer'>('developer');
  const [addingUser, setAddingUser] = useState(false);

  // Maintenance & Logs
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [panelLogTarget, setPanelLogTarget] = useState('aegis-backend');
  const [panelLogs, setPanelLogs] = useState('');
  const [loadingPanelLogs, setLoadingPanelLogs] = useState(false);
  const [selfUpdating, setSelfUpdating] = useState(false);
  const [selfUpdateOutput, setSelfUpdateOutput] = useState('');
  const selfUpdatingRef = useRef(false);

  const fetchSettingsAndNodes = async () => {
    const [resSettings, resUsers] = await Promise.allSettled([
      api.get('/system/settings'),
      api.get('/auth/users'),
    ]);

    if (resSettings.status === 'fulfilled') {
      const data = resSettings.value.data;
      setServerName(data.serverName || 'Aegis Node 01');
      setCaddyEnabled(data.caddyEnabled ?? true);
      setPanelDomain(data.panelDomain || '');

      const alertConf = data.alertConfig || {};
      const evoConf = data.evolution || {};
      const aiConf = data.aiProviders || {};
      const dataUrls = data.flowDataUrls || {};

      setAlertsEnabled(alertConf.enabled ?? false);
      setTelegramChatId(alertConf.telegramChatId || '');

      setWhatsappEnabled(alertConf.whatsappEnabled ?? false);
      const evoUrl = alertConf.whatsappApiUrl || evoConf.apiUrl || '';
      setWhatsappApiUrl(evoUrl);
      setWhatsappInstance(alertConf.whatsappInstance || '');
      setWhatsappRecipientNumber(alertConf.whatsappRecipientNumber || '');

      const isWhatsappConfigured = alertConf.whatsappApiKey === SECRET_MASK || evoConf.apiKey === SECRET_MASK;
      const isOpenaiConfigured = aiConf.openaiKey === SECRET_MASK;
      const isOpenrouterConfigured = aiConf.openrouterKey === SECRET_MASK;
      const isRedisConfigured = !!dataUrls.redisUrl && dataUrls.redisUrl.includes(SECRET_MASK);
      const isPostgresConfigured = !!dataUrls.postgresUrl && dataUrls.postgresUrl.includes(SECRET_MASK);

      setConfiguredSecrets({
        discordWebhookUrl: alertConf.discordWebhookUrl === SECRET_MASK,
        telegramBotToken: alertConf.telegramBotToken === SECRET_MASK,
        whatsappApiKey: isWhatsappConfigured,
        openaiKey: isOpenaiConfigured,
        openrouterKey: isOpenrouterConfigured,
        flowRedisUrl: isRedisConfigured,
        flowPostgresUrl: isPostgresConfigured,
      });

      setDiscordWebhookUrl(alertConf.discordWebhookUrl === SECRET_MASK ? '' : alertConf.discordWebhookUrl || '');
      setTelegramBotToken(alertConf.telegramBotToken === SECRET_MASK ? '' : alertConf.telegramBotToken || '');
      setWhatsappApiKey(isWhatsappConfigured ? '' : alertConf.whatsappApiKey || evoConf.apiKey || '');
      setOpenaiKey(isOpenaiConfigured ? '' : aiConf.openaiKey || '');
      setOpenrouterKey(isOpenrouterConfigured ? '' : aiConf.openrouterKey || '');
      if (aiConf.allowedModels && Array.isArray(aiConf.allowedModels) && aiConf.allowedModels.length > 0) {
        setAllowedModels(aiConf.allowedModels.join(', '));
      }
      setFlowRedisUrl(isRedisConfigured ? '' : dataUrls.redisUrl || '');
      setFlowPostgresUrl(isPostgresConfigured ? '' : dataUrls.postgresUrl || '');

      if (evoUrl) {
        void fetchEvolutionInstances();
      }

      setNotifyOnDeploySuccess(alertConf.notifyOnDeploySuccess ?? true);
      setNotifyOnDeployFail(alertConf.notifyOnDeployFail ?? true);
      setNotifyOnHighResource(alertConf.notifyOnHighResource ?? true);
      setNotifyOnBackup(alertConf.notifyOnBackup ?? true);

      setCpuThreshold(alertConf.cpuThresholdPercent || 90);
      setMemThreshold(alertConf.memThresholdPercent || 85);
      setDiskThreshold(alertConf.diskThresholdPercent || 90);
    } else {
      console.error('Falha ao carregar configurações:', resSettings.reason);
    }

    if (resUsers.status === 'fulfilled') {
      setTeamUsers(resUsers.value.data || []);
      setTeamError(null);
    } else {
      setTeamUsers([]);
      setTeamError(
        (resUsers.reason as any)?.response?.status === 403
          ? 'Somente administradores podem ver e gerenciar a equipe.'
          : 'Não foi possível carregar a equipe.'
      );
    }
  };

  const fetchEvolutionInstances = async () => {
    try {
      setLoadingInstances(true);
      const res = await api.get('/system/evolution/instances');
      setEvolutionInstances(Array.isArray(res.data?.instances) ? res.data.instances : []);
      setEvolutionManagerUrl(res.data?.managerUrl || null);
    } catch (err: any) {
      console.warn('Não foi possível carregar instâncias da Evolution:', err);
    } finally {
      setLoadingInstances(false);
    }
  };

  const handleTestEvolution = async () => {
    try {
      setTestingEvolution(true);
      setEvolutionTestResult(null);
      const res = await api.post('/system/evolution/test', {
        apiUrl: whatsappApiUrl,
        apiKey: secretToSend('whatsappApiKey', whatsappApiKey),
      });
      const isOk = Boolean(res.data?.ok);
      const msg = res.data?.message || (isOk ? 'Conexão estabelecida com sucesso!' : 'Falha na conexão com a Evolution.');
      setEvolutionTestResult({ success: isOk, message: msg });
      if (isOk) {
        toast.success(msg, 'Evolution API');
      } else {
        toast.error(msg, 'Evolution API');
      }
      if (res.data?.instances && Array.isArray(res.data.instances)) {
        setEvolutionInstances(res.data.instances);
      }
    } catch (err: any) {
      const errDetail = err.response?.data?.error || err.message;
      setEvolutionTestResult({ success: false, message: errDetail });
      toast.error(errDetail, 'Erro Evolution API');
    } finally {
      setTestingEvolution(false);
    }
  };

  const handleTestAi = async () => {
    try {
      setTestingAi(true);
      setAiTestResult(null);
      const key = aiTestProvider === 'openai' ? secretToSend('openaiKey', openaiKey) : secretToSend('openrouterKey', openrouterKey);
      const res = await api.post('/system/ai/test', {
        provider: aiTestProvider,
        apiKey: key,
        model: aiTestModel,
      });
      const isOk = Boolean(res.data?.ok);
      const msg = res.data?.reply ? `Resposta da IA: "${res.data.reply}"` : res.data?.message || 'IA respondeu com sucesso!';
      setAiTestResult({ success: isOk, message: msg });
      if (isOk) {
        toast.success(msg, 'IA Conectada');
      } else {
        toast.error(msg, 'Falha no teste');
      }
    } catch (err: any) {
      const errDetail = err.response?.data?.error || err.message;
      setAiTestResult({ success: false, message: errDetail });
      toast.error(errDetail, 'Erro Provedor IA');
    } finally {
      setTestingAi(false);
    }
  };

  useEffect(() => {
    void fetchSettingsAndNodes();
  }, []);

  useEffect(() => {
    const onChunk = (data: { line?: string; status?: string; done?: boolean }) => {
      if (data.line) {
        setSelfUpdateOutput((prev) => (prev + data.line).slice(-256 * 1024));
      }
      if (data.done) setSelfUpdating(false);
    };
    const onDisconnect = () => {
      if (!selfUpdatingRef.current) return;
      setSelfUpdateOutput(
        (prev) =>
          prev +
          '\n[aegis] Conexão perdida — o backend provavelmente está reiniciando. Recarregue o painel em alguns segundos.\n'
      );
    };
    socket.on('panel:self-update', onChunk);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('panel:self-update', onChunk);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  const secretToSend = (field: string, value: string): string => {
    if (value) return value;
    return configuredSecrets[field] ? SECRET_MASK : '';
  };

  const clearSecret = async (field: string) => {
    const confirmed = await confirm({
      title: 'Remover Chave Secreta',
      message: 'Remover este segredo do painel? A integração associada para de funcionar até que uma nova credencial seja cadastrada.',
      tone: 'crit',
      confirmLabel: 'Remover Chave',
      cancelLabel: 'Manter',
    });
    if (!confirmed) return;

    try {
      if (field === 'openaiKey' || field === 'openrouterKey') {
        await api.put('/system/settings', { aiProviders: { [field]: '' } });
        if (field === 'openaiKey') setOpenaiKey('');
        if (field === 'openrouterKey') setOpenrouterKey('');
      } else if (field === 'flowRedisUrl' || field === 'flowPostgresUrl') {
        const key = field === 'flowRedisUrl' ? 'redisUrl' : 'postgresUrl';
        await api.put('/system/settings', { flowDataUrls: { [key]: '' } });
        if (field === 'flowRedisUrl') setFlowRedisUrl('');
        if (field === 'flowPostgresUrl') setFlowPostgresUrl('');
      } else {
        await api.put('/system/settings', { alertConfig: { [field]: '' } });
        if (field === 'discordWebhookUrl') setDiscordWebhookUrl('');
        if (field === 'telegramBotToken') setTelegramBotToken('');
        if (field === 'whatsappApiKey') setWhatsappApiKey('');
      }
      setConfiguredSecrets((prev) => ({ ...prev, [field]: false }));
      toast.success('Segredo removido com sucesso.', 'Configurações');
    } catch (err: any) {
      toast.error('Erro ao remover: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleChangeOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newOwnPassword) return;

    try {
      setChangingPassword(true);
      const res = await api.post('/auth/change-password', { currentPassword, newPassword: newOwnPassword });
      if (res.data?.token) {
        persistSession(res.data.token, currentUser);
      }
      setCurrentPassword('');
      setNewOwnPassword('');
      toast.success('Sua senha foi alterada com sucesso e já vale para os próximos logins.', 'Segurança');
    } catch (err: any) {
      toast.error('Erro ao alterar senha: ' + (err.response?.data?.error || err.message));
    } finally {
      setChangingPassword(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await api.put('/system/settings', {
        serverName,
        caddyEnabled,
        panelDomain: panelDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') || undefined,
        alertConfig: {
          enabled: alertsEnabled,
          discordWebhookUrl: secretToSend('discordWebhookUrl', discordWebhookUrl),
          telegramBotToken: secretToSend('telegramBotToken', telegramBotToken),
          telegramChatId,
          whatsappEnabled,
          whatsappApiUrl,
          whatsappApiKey: secretToSend('whatsappApiKey', whatsappApiKey),
          whatsappInstance,
          whatsappRecipientNumber,
          notifyOnDeploySuccess,
          notifyOnDeployFail,
          notifyOnHighResource,
          notifyOnBackup,
          cpuThresholdPercent: cpuThreshold,
          memThresholdPercent: memThreshold,
          diskThresholdPercent: diskThreshold,
        },
        evolution: {
          apiUrl: whatsappApiUrl,
          apiKey: secretToSend('whatsappApiKey', whatsappApiKey),
        },
        aiProviders: {
          openaiKey: secretToSend('openaiKey', openaiKey),
          openrouterKey: secretToSend('openrouterKey', openrouterKey),
          allowedModels: allowedModels.split(',').map((s) => s.trim()).filter(Boolean),
        },
        flowDataUrls: {
          redisUrl: secretToSend('flowRedisUrl', flowRedisUrl),
          postgresUrl: secretToSend('flowPostgresUrl', flowPostgresUrl),
        },
      });
      setSavedSuccess(true);
      toast.success('Configurações atualizadas e salvas com sucesso!', 'Salvo');
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err: any) {
      toast.error('Erro ao salvar configurações: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const handleTestAlert = async (channel: 'discord' | 'telegram' | 'whatsapp') => {
    try {
      setTestingChannel(channel);
      const res = await api.post('/system/test-alert', {
        channel,
        webhookUrl: secretToSend('discordWebhookUrl', discordWebhookUrl),
        botToken: secretToSend('telegramBotToken', telegramBotToken),
        chatId: telegramChatId,
        apiUrl: whatsappApiUrl,
        apiKey: secretToSend('whatsappApiKey', whatsappApiKey),
        instance: whatsappInstance,
        recipientNumber: whatsappRecipientNumber,
      });
      toast.success(res.data.message || `Alerta de teste enviado com sucesso via ${channel}!`, 'Teste de Alerta');
    } catch (err: any) {
      toast.error(`Falha no envio de teste para ${channel}: ` + (err.response?.data?.error || err.message));
    } finally {
      setTestingChannel(null);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername || !newPassword) return;

    try {
      setAddingUser(true);
      await api.post('/auth/users', {
        username: newUsername,
        password: newPassword,
        email: newEmail || undefined,
        role: newRole,
      });
      setShowAddUserModal(false);
      setNewUsername('');
      setNewPassword('');
      setNewEmail('');
      void fetchSettingsAndNodes();
      toast.success('Novo membro adicionado à equipe com sucesso!', 'Equipe');
    } catch (err: any) {
      toast.error('Erro ao criar usuário: ' + (err.response?.data?.error || err.message));
    } finally {
      setAddingUser(false);
    }
  };

  const handleDeleteUser = async (userId: string, username: string) => {
    const confirmed = await confirm({
      title: 'Remover Membro',
      message: `Tem certeza que deseja revogar o acesso e remover "${username}" da equipe?`,
      tone: 'crit',
      confirmLabel: 'Remover Usuário',
    });
    if (!confirmed) return;

    try {
      await api.delete(`/auth/users/${userId}`);
      void fetchSettingsAndNodes();
      toast.success(`Usuário "${username}" removido da equipe.`, 'Equipe');
    } catch (err: any) {
      toast.error('Erro ao remover usuário: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleExportState = async () => {
    try {
      const res = await api.get('/system/export-state', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `aegispanel-backup-${new Date().toISOString().split('T')[0]}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Backup exportado com sucesso!', 'Download');
    } catch (err: any) {
      toast.error('Erro ao exportar dados: ' + err.message);
    }
  };

  const handleLoadPanelLogs = async () => {
    try {
      setLoadingPanelLogs(true);
      const res = await api.get(`/system/panel/logs/${panelLogTarget}`, { params: { tail: 200 } });
      setPanelLogs(res.data.logs || '');
    } catch (err: any) {
      setPanelLogs(err.response?.data?.error || err.message);
      toast.error('Falha ao carregar logs da stack.');
    } finally {
      setLoadingPanelLogs(false);
    }
  };

  const handleSelfUpdate = async () => {
    const confirmed = await confirm({
      title: 'Atualizar Stack do Painel',
      message: 'Iniciar a atualização da stack via Docker Compose agora? O painel recarregará automaticamente por alguns segundos.',
      tone: 'warn',
      confirmLabel: 'Iniciar Self-Update',
    });
    if (!confirmed) return;

    try {
      selfUpdatingRef.current = true;
      setSelfUpdating(true);
      setSelfUpdateOutput('[aegis] Iniciando self-update…\n');
      const res = await api.post('/system/panel/self-update', {}, { timeout: 11 * 60 * 1000 });
      if (res.data?.output) {
        setSelfUpdateOutput((prev) =>
          prev.includes(res.data.output) ? prev : `${prev}\n${res.data.output}`
        );
      }
      toast.info('Atualização da stack iniciada.', 'Self-Update');
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message;
      setSelfUpdateOutput((prev) => `${prev}\n[aegis] ${msg}\n`);
      toast.error('Self-update falhou: ' + msg);
    } finally {
      selfUpdatingRef.current = false;
      setSelfUpdating(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const confirmed = await confirm({
      title: 'Substituição de Estado do Painel',
      message: 'ATENÇÃO: Importar este arquivo substituirá os bancos de dados, aplicações e configurações atuais do painel. Deseja prosseguir?',
      tone: 'crit',
      confirmLabel: 'Substituir Estado',
    });
    if (!confirmed) {
      if (importFileRef.current) importFileRef.current.value = '';
      return;
    }

    try {
      setImporting(true);
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const parsed = JSON.parse(event.target?.result as string);
          const res = await api.post('/system/import-state', parsed);
          toast.success(
            res.data.warning
              ? `${res.data.message} (${res.data.warning})`
              : 'Estado importado com sucesso! Recarregando…',
            'Backup Restaurado'
          );
          setTimeout(() => window.location.reload(), 1500);
        } catch (err: any) {
          const details: string[] = err.response?.data?.details || [];
          const reason = err.response?.data?.error || err.message;
          toast.error(
            details.length > 0 ? `Backup inválido: ${details.join(', ')}` : 'Backup inválido: ' + reason,
            'Erro de Importação'
          );
          setImporting(false);
        }
      };
      reader.readAsText(file);
    } catch (err: any) {
      toast.error('Erro ao processar arquivo: ' + err.message);
      setImporting(false);
    }
  };

  const copyInstallScript = () => {
    const script = `curl -fsSL https://raw.githubusercontent.com/WendelDev0/aegispanel/main/install.sh | bash`;
    void navigator.clipboard.writeText(script);
    setCopiedScript(true);
    toast.success('Comando oficial copiado para a área de transferência!', 'Copiado');
    setTimeout(() => setCopiedScript(false), 2500);
  };

  const renderSaveFooter = () => (
    <div className="flex items-center justify-between pt-4 border-t border-outline-variant mt-6">
      <div>
        {savedSuccess && (
          <span className="text-ok text-xs font-semibold flex items-center gap-1.5 animate-fadeIn">
            <Check className="w-4 h-4" /> Alterações salvas com sucesso!
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={saving || !isAdmin}
        title={isAdmin ? undefined : 'Somente administradores podem alterar as configurações do painel.'}
        className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-container hover:bg-primary text-white font-semibold text-xs transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
      >
        <Save className={`w-4 h-4 ${saving ? 'animate-spin' : ''}`} />
        <span>{saving ? 'Salvando...' : 'Salvar Alterações'}</span>
      </button>
    </div>
  );

  const visibleTabs = SETTINGS_TABS.filter((t) => !t.adminOnly || isAdmin);

  return (
    <div className="space-y-6 max-w-5xl pb-12">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface-container p-5 rounded-lg border border-outline-variant">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="mono-label text-primary">Painel de Administração</span>
            {!isAdmin && (
              <Badge tone="warn" dot>
                Modo Leitura
              </Badge>
            )}
          </div>
          <h2 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <Settings className="w-6 h-6 text-primary" />
            Configurações & Governança da VPS
          </h2>
          <p className="text-xs text-on-surface-variant mt-0.5">
            Gerencie integrações, canais de alerta, segurança, equipe e rotinas do servidor.
          </p>
        </div>

        {/* Global Save Button for Quick Access */}
        {isAdmin && ['general', 'notifications', 'integrations'].includes(activeTab) && (
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-container hover:bg-primary text-white font-semibold text-xs transition-all active:scale-95 disabled:opacity-50 shrink-0 self-start sm:self-center"
          >
            <Save className={`w-4 h-4 ${saving ? 'animate-spin' : ''}`} />
            <span>{saving ? 'Salvando…' : 'Salvar Alterações'}</span>
          </button>
        )}
      </div>

      {/* Non-Admin Notice */}
      {!isAdmin && (
        <div className="flex items-start gap-3 p-3.5 rounded-lg border border-outline-variant bg-surface-container-low text-xs text-on-surface-variant">
          <Shield className="w-4 h-4 text-warn shrink-0 mt-0.5" />
          <span>
            Você possui permissões restritas ({currentUser?.role?.toUpperCase() || 'VIEWER'}). Alterar configurações globais da VPS exige o perfil <span className="font-mono text-white">ADMIN</span>.
          </span>
        </div>
      )}

      {/* Segmented Navigation Tabs */}
      <div className="bg-surface-container-low p-1.5 rounded-lg border border-outline-variant flex items-center gap-1 overflow-x-auto custom-scrollbar">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-semibold whitespace-nowrap transition-all ${
                isActive
                  ? 'bg-primary-container text-white shadow-sm font-bold'
                  : 'text-on-surface-variant hover:text-white hover:bg-surface-container'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-on-surface-variant/70'}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: GERAL & DOMÍNIO */}
      {activeTab === 'general' && (
        <div className="space-y-6 animate-fadeIn">
          <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-5">
            <div className="flex items-center gap-2.5 border-b border-outline-variant pb-4">
              <div className="p-2 rounded bg-primary/10 text-primary">
                <Server className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Identificação & Domínio do Painel</h3>
                <p className="text-xs text-on-surface-variant">
                  Personalize o nome da VPS e configure o subdomínio com HTTPS automático emitido pelo Caddy.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-1">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Nome de Exibição do Servidor
                </label>
                <input
                  type="text"
                  required
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                  placeholder="ex: Aegis Production Node"
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary transition-colors"
                />
                <p className="text-[11px] text-on-surface-variant/70 mt-1">
                  Exibido na barra superior e nos alertas enviados pela VPS.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Domínio Próprio do Painel (SSL Nativo)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="ex: painel.seudominio.com"
                    value={panelDomain}
                    onChange={(e) => setPanelDomain(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-primary transition-colors pr-10"
                  />
                  <Globe className="w-4 h-4 text-on-surface-variant absolute right-3 top-3 pointer-events-none" />
                </div>
                <p className="text-[11px] text-on-surface-variant/70 mt-1">
                  Aponte o DNS (tipo A) para o IP desta máquina e acesse sem informar a porta :3000.
                </p>
              </div>
            </div>

            {renderSaveFooter()}
          </div>

          {/* Script Oficial de Instalação */}
          <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded bg-ok/10 text-ok">
                  <Terminal className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Script Oficial de Instalação</h3>
                  <p className="text-xs text-on-surface-variant">
                    Comando rápido para provisionar novas instâncias do AegisPanel em servidores Ubuntu/Debian.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={copyInstallScript}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-white text-xs font-semibold border border-outline-variant transition-colors"
              >
                {copiedScript ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedScript ? 'Copiado!' : 'Copiar Script'}</span>
              </button>
            </div>

            <div className="bg-surface-container-lowest p-3.5 rounded border border-outline-variant font-mono text-xs text-ok select-all overflow-x-auto flex items-center justify-between gap-4">
              <span>curl -fsSL https://raw.githubusercontent.com/WendelDev0/aegispanel/main/install.sh | bash</span>
              <FileCode2 className="w-4 h-4 text-on-surface-variant/40 shrink-0" />
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ALERTAS & NOTIFICAÇÕES */}
      {activeTab === 'notifications' && (
        <div className="space-y-6 animate-fadeIn">
          {/* WhatsApp Evolution API */}
          <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded bg-ok/10 text-ok">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base flex items-center gap-2">
                    <span>WhatsApp (Evolution API)</span>
                    <Badge tone="ok">Pro</Badge>
                  </h3>
                  <p className="text-xs text-on-surface-variant">
                    Receba notificações em tempo real de deploys, status de contêineres e incidentes críticos.
                  </p>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer bg-surface-container-low px-3 py-1.5 rounded-lg border border-outline-variant hover:border-outline">
                <input
                  type="checkbox"
                  checked={whatsappEnabled}
                  onChange={(e) => setWhatsappEnabled(e.target.checked)}
                  className="w-4 h-4 rounded text-primary focus:ring-0"
                />
                <span className="text-on-surface">Ativar Notificações WhatsApp</span>
              </label>
            </div>

            {whatsappEnabled && (
              <div className="space-y-5 pt-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                      Evolution API URL (Instância)
                    </label>
                    <input
                      type="text"
                      placeholder="https://evolution.seudominio.com ou http://localhost:8080"
                      value={whatsappApiUrl}
                      onChange={(e) => setWhatsappApiUrl(e.target.value)}
                      className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-ok"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                      API Key (Chave Global de Autenticação)
                    </label>
                    <input
                      type="password"
                      placeholder={configuredSecrets.whatsappApiKey ? 'Manter chave atual' : 'Sua chave secreta da Evolution API'}
                      value={whatsappApiKey}
                      onChange={(e) => setWhatsappApiKey(e.target.value)}
                      className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-ok"
                    />
                    <SecretStatus
                      configured={Boolean(configuredSecrets.whatsappApiKey)}
                      onClear={() => void clearSecret('whatsappApiKey')}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                      Nome da Instância WhatsApp
                    </label>
                    <input
                      type="text"
                      placeholder="ex: principal ou producao"
                      value={whatsappInstance}
                      onChange={(e) => setWhatsappInstance(e.target.value)}
                      className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-ok"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                      Número de Destino (DDI + DDD + Número)
                    </label>
                    <input
                      type="text"
                      placeholder="ex: 5511999998888"
                      value={whatsappRecipientNumber}
                      onChange={(e) => setWhatsappRecipientNumber(e.target.value)}
                      className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-ok"
                    />
                  </div>
                </div>

                {/* Actions & Diagnostics */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleTestEvolution()}
                      disabled={testingEvolution || !whatsappApiUrl}
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-surface-container-high hover:bg-surface-container-highest text-white border border-outline-variant rounded-lg text-xs font-semibold transition-all disabled:opacity-40"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${testingEvolution ? 'animate-spin' : ''}`} />
                      <span>{testingEvolution ? 'Testando conexão…' : 'Testar Conexão Evolution'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleTestAlert('whatsapp')}
                      disabled={testingChannel === 'whatsapp' || !whatsappApiUrl || !whatsappRecipientNumber}
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-ok/15 hover:bg-ok/25 text-ok border border-ok/30 rounded-lg text-xs font-semibold transition-all disabled:opacity-40"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{testingChannel === 'whatsapp' ? 'Enviando…' : 'Enviar Alerta de Teste'}</span>
                    </button>
                  </div>

                  {evolutionTestResult && (
                    <div
                      className={`text-xs px-3 py-1.5 rounded-lg border flex items-center gap-2 ${
                        evolutionTestResult.success ? 'bg-ok/10 border-ok/30 text-ok' : 'bg-crit/10 border-crit/30 text-crit'
                      }`}
                    >
                      {evolutionTestResult.success ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                      )}
                      <span>{evolutionTestResult.message}</span>
                    </div>
                  )}
                </div>

                {/* Connected Instances */}
                <div className="pt-3 border-t border-outline-variant space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Radio className="w-4 h-4 text-ok" />
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                        Instâncias Detectadas
                      </h4>
                    </div>
                    <div className="flex items-center gap-3">
                      {evolutionManagerUrl && (
                        <a
                          href={evolutionManagerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Manager Evolution
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => void fetchEvolutionInstances()}
                        disabled={loadingInstances || !whatsappApiUrl}
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${loadingInstances ? 'animate-spin' : ''}`} />
                        <span>Atualizar</span>
                      </button>
                    </div>
                  </div>

                  {loadingInstances ? (
                    <p className="text-xs text-on-surface-variant font-mono">Verificando instâncias…</p>
                  ) : evolutionInstances.length === 0 ? (
                    <div className="p-3.5 rounded bg-surface-container-low border border-outline-variant text-xs text-on-surface-variant">
                      Nenhuma instância conectada encontrada no momento.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                      {evolutionInstances.map((inst) => {
                        const isOpen = inst.connectionStatus === 'open';
                        const isConnecting = inst.connectionStatus === 'connecting';
                        return (
                          <div
                            key={inst.name}
                            className="bg-surface-container-low border border-outline-variant rounded-lg p-3 flex flex-col justify-between space-y-2"
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-xs font-mono font-bold text-white truncate">{inst.name}</span>
                              <Badge tone={isOpen ? 'ok' : isConnecting ? 'warn' : 'crit'} dot>
                                {isOpen ? 'Online' : isConnecting ? 'Conectando' : 'Offline'}
                              </Badge>
                            </div>
                            {inst.number && (
                              <p className="text-[11px] text-on-surface-variant/80 font-mono">{inst.number}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Webhook Configuration Helper */}
                <div className="p-3.5 bg-surface-container-low border border-outline-variant rounded-lg space-y-1.5 text-xs">
                  <span className="font-semibold text-white">URL de Webhook para Fluxos:</span>
                  <div className="flex items-center justify-between gap-2 bg-surface-container px-3 py-2 rounded font-mono text-[11px] text-on-surface-variant overflow-x-auto">
                    <span className="truncate">{`${window.location.origin}/api/wa-flows/webhook`}</span>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(`${window.location.origin}/api/wa-flows/webhook`);
                        toast.success('URL de Webhook copiada!');
                      }}
                      className="text-primary hover:underline font-sans text-xs shrink-0 cursor-pointer"
                    >
                      Copiar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Telegram & Discord Notifications */}
          <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded bg-primary/10 text-primary">
                  <Bell className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Alertas no Telegram & Discord</h3>
                  <p className="text-xs text-on-surface-variant">
                    Integrações de canal único para envio automatizado de logs e avisos.
                  </p>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer bg-surface-container-low px-3 py-1.5 rounded-lg border border-outline-variant hover:border-outline">
                <input
                  type="checkbox"
                  checked={alertsEnabled}
                  onChange={(e) => setAlertsEnabled(e.target.checked)}
                  className="w-4 h-4 rounded text-primary focus:ring-0"
                />
                <span className="text-on-surface">Ativar Alertas Secundários</span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-1">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                  Discord Webhook URL
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder={configuredSecrets.discordWebhookUrl ? 'Manter webhook atual' : 'https://discord.com/api/webhooks/…'}
                    value={discordWebhookUrl}
                    onChange={(e) => setDiscordWebhookUrl(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2 text-white text-xs font-mono focus:outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => void handleTestAlert('discord')}
                    disabled={(!discordWebhookUrl && !configuredSecrets.discordWebhookUrl) || testingChannel === 'discord'}
                    className="px-3.5 py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded-lg text-xs font-semibold shrink-0 disabled:opacity-40 border border-outline-variant"
                  >
                    {testingChannel === 'discord' ? 'Enviando…' : 'Testar'}
                  </button>
                </div>
                <SecretStatus
                  configured={Boolean(configuredSecrets.discordWebhookUrl)}
                  onClear={() => void clearSecret('discordWebhookUrl')}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                  Telegram (Bot Token & Chat ID)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    placeholder={configuredSecrets.telegramBotToken ? 'Manter token' : 'Bot Token'}
                    value={telegramBotToken}
                    onChange={(e) => setTelegramBotToken(e.target.value)}
                    className="w-1/2 bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-primary"
                  />
                  <input
                    type="text"
                    placeholder="Chat ID"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    className="w-1/2 bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-white text-xs font-mono focus:outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => void handleTestAlert('telegram')}
                    disabled={
                      (!telegramBotToken && !configuredSecrets.telegramBotToken) ||
                      !telegramChatId ||
                      testingChannel === 'telegram'
                    }
                    className="px-3.5 py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded-lg text-xs font-semibold shrink-0 disabled:opacity-40 border border-outline-variant"
                  >
                    {testingChannel === 'telegram' ? 'Enviando…' : 'Testar'}
                  </button>
                </div>
                <SecretStatus
                  configured={Boolean(configuredSecrets.telegramBotToken)}
                  onClear={() => void clearSecret('telegramBotToken')}
                />
              </div>
            </div>

            {/* Notification Triggers */}
            <div className="pt-4 border-t border-outline-variant space-y-3">
              <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                Gatilhos de Notificação
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <label className="flex items-center gap-2 cursor-pointer bg-surface-container-low p-2.5 rounded-lg border border-outline-variant hover:border-outline transition-colors">
                  <input
                    type="checkbox"
                    checked={notifyOnDeploySuccess}
                    onChange={(e) => setNotifyOnDeploySuccess(e.target.checked)}
                    className="rounded text-primary focus:ring-0"
                  />
                  <CheckCircle2 className="w-3.5 h-3.5 text-ok shrink-0" />
                  <span className="text-on-surface">Deploy Sucesso</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer bg-surface-container-low p-2.5 rounded-lg border border-outline-variant hover:border-outline transition-colors">
                  <input
                    type="checkbox"
                    checked={notifyOnDeployFail}
                    onChange={(e) => setNotifyOnDeployFail(e.target.checked)}
                    className="rounded text-primary focus:ring-0"
                  />
                  <AlertTriangle className="w-3.5 h-3.5 text-crit shrink-0" />
                  <span className="text-on-surface">Deploy Falha</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer bg-surface-container-low p-2.5 rounded-lg border border-outline-variant hover:border-outline transition-colors">
                  <input
                    type="checkbox"
                    checked={notifyOnHighResource}
                    onChange={(e) => setNotifyOnHighResource(e.target.checked)}
                    className="rounded text-primary focus:ring-0"
                  />
                  <Activity className="w-3.5 h-3.5 text-warn shrink-0" />
                  <span className="text-on-surface">Alto Consumo</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer bg-surface-container-low p-2.5 rounded-lg border border-outline-variant hover:border-outline transition-colors">
                  <input
                    type="checkbox"
                    checked={notifyOnBackup}
                    onChange={(e) => setNotifyOnBackup(e.target.checked)}
                    className="rounded text-primary focus:ring-0"
                  />
                  <Database className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="text-on-surface">Rotina Backup</span>
                </label>
              </div>
            </div>

            {/* Threshold Sliders */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 pt-4 border-t border-outline-variant">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold text-on-surface-variant">Alerta CPU</span>
                  <span className="text-xs font-mono font-bold text-primary">{cpuThreshold}%</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="98"
                  value={cpuThreshold}
                  onChange={(e) => setCpuThreshold(parseInt(e.target.value))}
                  className="w-full accent-[#4d8eff] cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold text-on-surface-variant">Alerta Memória RAM</span>
                  <span className="text-xs font-mono font-bold text-ok">{memThreshold}%</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="98"
                  value={memThreshold}
                  onChange={(e) => setMemThreshold(parseInt(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold text-on-surface-variant">Alerta Disco</span>
                  <span className="text-xs font-mono font-bold text-warn">{diskThreshold}%</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="98"
                  value={diskThreshold}
                  onChange={(e) => setDiskThreshold(parseInt(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>
            </div>

            {renderSaveFooter()}
          </div>
        </div>
      )}

      {/* TAB 3: IA & INTEGRAÇÕES */}
      {activeTab === 'integrations' && (
        <div className="space-y-6 animate-fadeIn">
          {/* AI Providers Section */}
          <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-5">
            <div className="flex items-center gap-3 border-b border-outline-variant pb-4">
              <div className="p-2 rounded bg-primary/10 text-primary">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <span>Provedores de Inteligência Artificial</span>
                  <Badge tone="info">Fluxos & Agentes</Badge>
                </h3>
                <p className="text-xs text-on-surface-variant">
                  Chaves de API para agentes autônomos, assistentes de atendimento e geração de texto nos fluxos.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-1">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                  OpenAI API Key
                </label>
                <input
                  type="password"
                  placeholder={configuredSecrets.openaiKey ? 'Manter chave atual' : 'sk-…'}
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-primary"
                />
                <SecretStatus
                  configured={Boolean(configuredSecrets.openaiKey)}
                  onClear={() => void clearSecret('openaiKey')}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                  OpenRouter API Key
                </label>
                <input
                  type="password"
                  placeholder={configuredSecrets.openrouterKey ? 'Manter chave atual' : 'sk-or-…'}
                  value={openrouterKey}
                  onChange={(e) => setOpenrouterKey(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-primary"
                />
                <SecretStatus
                  configured={Boolean(configuredSecrets.openrouterKey)}
                  onClear={() => void clearSecret('openrouterKey')}
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                  Modelos Permitidos (separados por vírgula)
                </label>
                <input
                  type="text"
                  placeholder="gpt-4o-mini, gpt-4o, claude-3-5-sonnet, deepseek/deepseek-chat"
                  value={allowedModels}
                  onChange={(e) => setAllowedModels(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            {/* Test AI Provider */}
            <div className="pt-4 border-t border-outline-variant flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={aiTestProvider}
                  onChange={(e) => setAiTestProvider(e.target.value as any)}
                  className="bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-white text-xs"
                >
                  <option value="openai">OpenAI</option>
                  <option value="openrouter">OpenRouter</option>
                </select>

                <input
                  type="text"
                  value={aiTestModel}
                  onChange={(e) => setAiTestModel(e.target.value)}
                  placeholder="Modelo de teste"
                  className="bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-white text-xs font-mono w-40"
                />

                <button
                  type="button"
                  onClick={() => void handleTestAi()}
                  disabled={testingAi}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 rounded-lg text-xs font-semibold transition-all disabled:opacity-40"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{testingAi ? 'Testando IA…' : 'Testar Resposta IA'}</span>
                </button>
              </div>

              {aiTestResult && (
                <div
                  className={`text-xs px-3 py-1.5 rounded-lg border flex items-center gap-2 ${
                    aiTestResult.success ? 'bg-ok/10 border-ok/30 text-ok' : 'bg-crit/10 border-crit/30 text-crit'
                  }`}
                >
                  {aiTestResult.success ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                  <span>{aiTestResult.message}</span>
                </div>
              )}
            </div>

            {renderSaveFooter()}
          </div>

          {/* Flow External Data Plane (Redis & Postgres) */}
          <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-5">
            <div className="flex items-center gap-3 border-b border-outline-variant pb-4">
              <div className="p-2 rounded bg-surface-container-high text-white">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Fontes de Dados dos Fluxos (Opcional)</h3>
                <p className="text-xs text-on-surface-variant">
                  Armazenamento externo para persistência de sessões distribuídas (Redis) e consultas SQL diretas.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-1">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                  Redis URL (Sessões distribuídas)
                </label>
                <input
                  type="text"
                  placeholder={configuredSecrets.flowRedisUrl ? 'Manter URL atual' : 'redis://:senha@host:6379/0'}
                  value={flowRedisUrl}
                  onChange={(e) => setFlowRedisUrl(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-primary"
                />
                <SecretStatus
                  configured={Boolean(configuredSecrets.flowRedisUrl)}
                  onClear={() => void clearSecret('flowRedisUrl')}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                  PostgreSQL URL (Consultas diretas nos nós)
                </label>
                <input
                  type="text"
                  placeholder={configuredSecrets.flowPostgresUrl ? 'Manter URL atual' : 'postgres://user:senha@host:5432/db'}
                  value={flowPostgresUrl}
                  onChange={(e) => setFlowPostgresUrl(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-primary"
                />
                <SecretStatus
                  configured={Boolean(configuredSecrets.flowPostgresUrl)}
                  onClear={() => void clearSecret('flowPostgresUrl')}
                />
              </div>
            </div>

            {renderSaveFooter()}
          </div>
        </div>
      )}

      {/* TAB 4: SEGURANÇA & SENHA */}
      {activeTab === 'security' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Minha Senha */}
          <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-4">
            <div className="flex items-center gap-3 border-b border-outline-variant pb-4">
              <div className="p-2 rounded bg-primary/10 text-primary">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Alteração de Senha do Usuário</h3>
                <p className="text-xs text-on-surface-variant">
                  Conectado como <span className="text-white font-semibold">{currentUser?.username || '-'}</span>
                  {currentUser?.role && (
                    <span className="ml-2 text-[10px] px-2 py-0.5 rounded font-mono font-semibold bg-surface-container-high text-primary">
                      {currentUser.role.toUpperCase()}
                    </span>
                  )}
                </p>
              </div>
            </div>

            <form onSubmit={handleChangeOwnPassword} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end pt-1">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">Senha Atual</label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">Nova Senha</label>
                <input
                  type="password"
                  required
                  minLength={12}
                  placeholder="Mínimo 12 caracteres"
                  value={newOwnPassword}
                  onChange={(e) => setNewOwnPassword(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary font-mono"
                />
              </div>
              <button
                type="submit"
                disabled={changingPassword}
                className="px-5 py-2.5 bg-primary-container hover:bg-primary disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-all active:scale-95"
              >
                {changingPassword ? 'Alterando senha…' : 'Atualizar Minha Senha'}
              </button>
            </form>
          </div>

          {/* 2FA and Session Security Section */}
          <SecuritySection
            currentUser={currentUser}
            onUserUpdate={(user) => onUserUpdate?.(user)}
          />
        </div>
      )}

      {/* TAB 5: EQUIPE & ACESSOS */}
      {activeTab === 'team' && (
        <div className="space-y-6 animate-fadeIn">
          <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded bg-primary/10 text-primary">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base flex items-center gap-2">
                    <span>Equipe & Controle de Permissões</span>
                    <Badge tone="neutral">{teamUsers.length} membros</Badge>
                  </h3>
                  <p className="text-xs text-on-surface-variant">
                    Controle os usuários que possuem acesso ao painel com níveis de privilégio bem definidos.
                  </p>
                </div>
              </div>

              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary-container hover:bg-primary text-white rounded-lg text-xs font-semibold transition-all shadow-sm active:scale-95"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Adicionar Membro</span>
                </button>
              )}
            </div>

            {teamError ? (
              <div className="flex items-start gap-3 p-4 rounded-lg border border-outline-variant bg-surface-container-low">
                <Shield className="w-5 h-5 text-on-surface-variant shrink-0 mt-0.5" />
                <p className="text-xs text-on-surface-variant">{teamError}</p>
              </div>
            ) : (
              <>
                {/* Role Legend */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {ROLE_LEGEND.map((r) => (
                    <div key={r.role} className="p-3.5 rounded-lg border border-outline-variant bg-surface-container-low space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="mono-label text-white font-bold">{r.role}</span>
                        <Badge tone={r.badgeTone} dot>{r.role}</Badge>
                      </div>
                      <p className="text-[11px] text-on-surface-variant/80 leading-relaxed">{r.text}</p>
                    </div>
                  ))}
                </div>

                {/* Team Members List */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
                  {teamUsers.map((user) => {
                    const isSelf = user.id === currentUser?.id;
                    const adminCount = teamUsers.filter((u) => u.role === 'admin').length;
                    const isLastAdmin = user.role === 'admin' && adminCount <= 1;
                    const canRemove = isAdmin && !isSelf && !isLastAdmin;

                    return (
                      <div
                        key={user.id}
                        className="p-4 rounded-lg bg-surface-container-lowest border border-outline-variant flex items-start justify-between gap-3 hover:border-outline transition-colors"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-white text-sm truncate">{user.username}</span>
                            {isSelf && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold">
                                você
                              </span>
                            )}
                            <Badge
                              tone={user.role === 'admin' ? 'info' : user.role === 'developer' ? 'ok' : 'neutral'}
                              dot
                            >
                              {user.role.toUpperCase()}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-on-surface-variant truncate font-mono">
                            {user.email || 'Sem e-mail cadastrado'}
                          </p>
                          {isLastAdmin && (
                            <p className="text-[10px] text-warn font-semibold">Único administrador (protegido)</p>
                          )}
                        </div>

                        {canRemove && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteUser(user.id, user.username)}
                            className="p-1.5 text-on-surface-variant/70 hover:text-crit rounded-lg hover:bg-surface-container transition-colors shrink-0 cursor-pointer"
                            title="Remover usuário da equipe"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* TAB 6: MANUTENÇÃO & LOGS (ADMIN ONLY) */}
      {activeTab === 'system' && isAdmin && (
        <div className="space-y-6 animate-fadeIn">
          {/* Backup & Migration */}
          <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-4">
            <div className="flex items-center gap-3 border-b border-outline-variant pb-4">
              <div className="p-2 rounded bg-primary/10 text-primary">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Migração & Backup Global do Painel</h3>
                <p className="text-xs text-on-surface-variant">
                  Exporte todo o estado do painel (Aplicações, Bancos, Cron, Domínios e Configurações) em um único JSON.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => void handleExportState()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-white text-xs font-semibold border border-outline-variant transition-all active:scale-95"
              >
                <Download className="w-4 h-4 text-primary" />
                <span>Exportar Backup Completo (.JSON)</span>
              </button>

              <input
                type="file"
                ref={importFileRef}
                onChange={(e) => void handleImportFile(e)}
                accept=".json"
                className="hidden"
              />

              <button
                type="button"
                onClick={() => importFileRef.current?.click()}
                disabled={importing}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-white text-xs font-semibold border border-outline-variant transition-all active:scale-95 disabled:opacity-50"
              >
                <Upload className="w-4 h-4 text-ok" />
                <span>{importing ? 'Processando importação…' : 'Restaurar Backup do Painel'}</span>
              </button>
            </div>
          </div>

          {/* Autogestão & Logs da Stack */}
          <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-4">
            <div className="flex items-center gap-3 border-b border-outline-variant pb-4">
              <div className="p-2 rounded bg-ok/10 text-ok">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Autogestão & Logs da Stack</h3>
                <p className="text-xs text-on-surface-variant">
                  Diagnóstico interno dos contêineres do painel (backend, frontend, caddy, nginx) e self-update via compose.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <select
                value={panelLogTarget}
                onChange={(e) => setPanelLogTarget(e.target.value)}
                className="bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-primary"
              >
                <option value="aegis-backend">aegis-backend (Node.js API)</option>
                <option value="aegis-frontend">aegis-frontend (Nginx UI)</option>
                <option value="aegis-caddy">aegis-caddy (Reverse Proxy)</option>
                <option value="aegis-nginx">aegis-nginx (Ingress)</option>
              </select>

              <button
                type="button"
                onClick={() => void handleLoadPanelLogs()}
                disabled={loadingPanelLogs}
                className="px-4 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-xs font-semibold text-white border border-outline-variant disabled:opacity-50 transition-colors"
              >
                {loadingPanelLogs ? 'Carregando logs…' : 'Ver Logs'}
              </button>

              <button
                type="button"
                onClick={() => void handleSelfUpdate()}
                disabled={selfUpdating}
                className="px-4 py-2 rounded-lg bg-primary-container hover:bg-primary text-white text-xs font-semibold disabled:opacity-50 transition-colors shadow-sm"
              >
                {selfUpdating ? 'Atualizando stack…' : 'Self-Update da Stack'}
              </button>
            </div>

            {selfUpdateOutput && (
              <pre className="max-h-64 overflow-auto bg-surface-container-lowest border border-outline-variant rounded-lg p-3 text-[11px] font-mono text-ok whitespace-pre-wrap">
                {selfUpdateOutput}
              </pre>
            )}

            {panelLogs && (
              <pre className="max-h-64 overflow-auto bg-surface-container-lowest border border-outline-variant rounded-lg p-3 text-[11px] font-mono text-ok whitespace-pre-wrap">
                {panelLogs}
              </pre>
            )}
          </div>

          {/* State History and Audit Sections */}
          <StateHistorySection />
          <AuditSection />
        </div>
      )}

      {/* Add Team User Modal */}
      {showAddUserModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-container rounded-lg border border-outline-variant w-full max-w-md overflow-hidden p-6 space-y-5 shadow-2xl animate-scaleIn">
            <div className="flex items-center justify-between border-b border-outline-variant pb-3">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-primary" />
                Novo Membro da Equipe
              </h3>
              <button
                type="button"
                onClick={() => setShowAddUserModal(false)}
                className="text-on-surface-variant hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Nome de Usuário *</label>
                <input
                  type="text"
                  required
                  placeholder="ex: dev_operador"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Senha de Acesso *</label>
                <input
                  type="password"
                  required
                  minLength={12}
                  placeholder="Mínimo 12 caracteres"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">E-mail (Opcional)</label>
                <input
                  type="email"
                  placeholder="operador@seudominio.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Nível de Acesso</label>
                <select
                  value={newRole}
                  onChange={(e: any) => setNewRole(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary"
                >
                  <option value="viewer">Visualizador — Somente leitura</option>
                  <option value="developer">Desenvolvedor — Deploys, bancos e contêineres</option>
                  <option value="admin">Administrador — Acesso total e terminal host</option>
                </select>
                {newRole === 'admin' && (
                  <p className="text-[11px] text-warn mt-1.5 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                    Administradores possuem controle total sobre a VPS, incluindo terminal root no host.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-outline-variant">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="px-4 py-2 text-on-surface-variant hover:text-white text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={addingUser}
                  className="px-5 py-2.5 bg-primary-container hover:bg-primary text-white rounded-lg text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
                >
                  {addingUser ? 'Criando usuário…' : 'Salvar Membro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
