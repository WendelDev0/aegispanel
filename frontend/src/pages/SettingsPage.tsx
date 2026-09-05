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
} from 'lucide-react';
import { api, persistSession } from '../services/api.js';
import { socket } from '../services/socket.js';
import { User } from '../types/index.js';
import { SecuritySection } from '../components/settings/SecuritySection.js';
import { AuditSection } from '../components/settings/AuditSection.js';
import { StateHistorySection } from '../components/settings/StateHistorySection.js';

/** Placeholder the API sends in place of a stored secret. */
const SECRET_MASK = '••••••••';

/**
 * Shown under a secret input whose value is stored on the server but never
 * sent back. Makes it clear the field being empty does not mean unset.
 */
const SecretStatus: React.FC<{ configured: boolean; onClear: () => void }> = ({ configured, onClear }) =>
  configured ? (
    <p className="text-[10px] text-on-surface-variant/70 mt-1 flex items-center gap-1.5">
      <Lock className="w-3 h-3 text-ok shrink-0" />
      Já configurado. Deixe em branco para manter.
      <button type="button" onClick={onClear} className="text-crit hover:text-crit underline">
        Remover
      </button>
    </p>
  ) : null;

const ROLE_LEGEND = [
  {
    role: 'ADMIN',
    className: 'bg-primary/10 border-primary/30 text-primary',
    text: 'Tudo: equipe, terminal do host, tarefas shell, firewall, importar/exportar o painel.',
  },
  {
    role: 'DEVELOPER',
    className: 'bg-ok/10 border-ok/30 text-ok',
    text: 'Apps, deploys, bancos, domínios, arquivos e terminal de contêineres.',
  },
  {
    role: 'VIEWER',
    className: 'bg-surface-container-high border-outline-variant text-on-surface-variant',
    text: 'Somente leitura. Não altera nada e não abre terminal.',
  },
];

interface SettingsPageProps {
  currentUser: User | null;
  onUserUpdate?: (user: User) => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ currentUser, onUserUpdate }) => {
  const isAdmin = currentUser?.role === 'admin';

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

  /**
   * Which secrets already have a value stored on the server.
   *
   * The API never sends the values back, so the inputs stay empty and a stored
   * secret is only overwritten when the user actually types a new one. Showing
   * the mask inside the input would make it look editable and invite the user
   * to "fix" a value they cannot see.
   */
  const [configuredSecrets, setConfiguredSecrets] = useState<Record<string, boolean>>({});

  // Testing status
  const [testingChannel, setTestingChannel] = useState<string | null>(null);

  // Team loading state, so a non-admin gets an explanation instead of an
  // empty list.
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

  // Import file ref
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [panelLogTarget, setPanelLogTarget] = useState('aegis-backend');
  const [panelLogs, setPanelLogs] = useState('');
  const [loadingPanelLogs, setLoadingPanelLogs] = useState(false);
  const [selfUpdating, setSelfUpdating] = useState(false);
  const [selfUpdateOutput, setSelfUpdateOutput] = useState('');
  const selfUpdatingRef = useRef(false);


  const fetchSettingsAndNodes = async () => {
    // Settled individually: listing the team requires the admin role, and a
    // rejection there used to abort the whole load, leaving a developer with a
    // blank settings page.
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

      // Masked fields are recorded as "configured" and left blank in the form.
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
      setEvolutionTestResult({
        success: res.data.ok,
        message: res.data.message || (res.data.ok ? 'Conexão estabelecida com sucesso!' : 'Falha na conexão com a Evolution.'),
      });
      if (res.data.instances && Array.isArray(res.data.instances)) {
        setEvolutionInstances(res.data.instances);
      }
    } catch (err: any) {
      setEvolutionTestResult({
        success: false,
        message: err.response?.data?.error || err.message,
      });
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
      setAiTestResult({
        success: res.data.ok,
        message: res.data.reply ? `Resposta da IA: "${res.data.reply}"` : res.data.message || 'IA respondeu com sucesso!',
      });
    } catch (err: any) {
      setAiTestResult({
        success: false,
        message: err.response?.data?.error || err.message,
      });
    } finally {
      setTestingAi(false);
    }
  };

  useEffect(() => {
    fetchSettingsAndNodes();
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

  /**
   * Blank + already configured -> send the mask, which the server reads as
   * "unchanged". Blank + not configured -> send empty. Typed -> send it.
   */
  const secretToSend = (field: string, value: string): string => {
    if (value) return value;
    return configuredSecrets[field] ? SECRET_MASK : '';
  };

  const clearSecret = async (field: string) => {
    if (!confirm('Remover este segredo do painel? A integração para de funcionar até você cadastrar outro.')) return;
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
    } catch (err: any) {
      alert('Erro ao remover: ' + (err.response?.data?.error || err.message));
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
      alert('✅ Senha alterada. Ela já vale para os próximos logins.');
    } catch (err: any) {
      alert('Erro ao alterar senha: ' + (err.response?.data?.error || err.message));
    } finally {
      setChangingPassword(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      await api.put('/system/settings', {
        serverName,
        caddyEnabled,
        panelDomain: panelDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') || undefined,
        alertConfig: {
          enabled: alertsEnabled,
          // A blank field on a secret that is already stored means "leave it
          // as is": the mask is sent back so the server keeps the stored
          // value. Clearing it deliberately requires the "Remover" action.
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
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch (err: any) {
      alert('Erro ao salvar: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const handleTestAlert = async (channel: 'discord' | 'telegram' | 'whatsapp') => {
    try {
      setTestingChannel(channel);
      const res = await api.post('/system/test-alert', {
        channel,
        // Blank means "test with what is already stored"; the server
        // substitutes the saved secret for the mask.
        webhookUrl: secretToSend('discordWebhookUrl', discordWebhookUrl),
        botToken: secretToSend('telegramBotToken', telegramBotToken),
        chatId: telegramChatId,
        apiUrl: whatsappApiUrl,
        apiKey: secretToSend('whatsappApiKey', whatsappApiKey),
        instance: whatsappInstance,
        recipientNumber: whatsappRecipientNumber,
      });
      alert('✅ ' + res.data.message);
    } catch (err: any) {
      alert(`Erro no envio de teste para ${channel}: ` + (err.response?.data?.error || err.message));
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
      fetchSettingsAndNodes();
      alert('🎉 Novo membro adicionado à equipe!');
    } catch (err: any) {
      alert('Erro ao criar usuário: ' + (err.response?.data?.error || err.message));
    } finally {
      setAddingUser(false);
    }
  };

  const handleDeleteUser = async (userId: string, username: string) => {
    if (!confirm(`Remover o usuário "${username}" da equipe?`)) return;
    try {
      await api.delete(`/auth/users/${userId}`);
      fetchSettingsAndNodes();
    } catch (err: any) {
      alert('Erro ao remover usuário: ' + (err.response?.data?.error || err.message));
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
    } catch (err: any) {
      alert('Erro ao exportar dados: ' + err.message);
    }
  };

  const handleLoadPanelLogs = async () => {
    try {
      setLoadingPanelLogs(true);
      const res = await api.get(`/system/panel/logs/${panelLogTarget}`, { params: { tail: 200 } });
      setPanelLogs(res.data.logs || '');
    } catch (err: any) {
      setPanelLogs(err.response?.data?.error || err.message);
    } finally {
      setLoadingPanelLogs(false);
    }
  };

  const handleSelfUpdate = async () => {
    if (!confirm('Atualizar a stack do painel agora? O painel pode recarregar sozinho por alguns segundos.')) return;
    try {
      selfUpdatingRef.current = true;
      setSelfUpdating(true);
      setSelfUpdateOutput('[aegis] Iniciando self-update…\n');
      const res = await api.post('/system/panel/self-update', {}, { timeout: 11 * 60 * 1000 });
      if (res.data.output) {
        setSelfUpdateOutput((prev) =>
          prev.includes(res.data.output) ? prev : `${prev}\n${res.data.output}`
        );
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message;
      setSelfUpdateOutput((prev) => `${prev}\n[aegis] ${msg}\n`);
      if (err.response) {
        alert('Self-update falhou: ' + msg);
      }
    } finally {
      selfUpdatingRef.current = false;
      setSelfUpdating(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!confirm('ATENÇÃO: Importar este arquivo substituirá os bancos, apps e configurações atuais do painel. Deseja continuar?')) {
      return;
    }

    try {
      setImporting(true);
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const parsed = JSON.parse(event.target?.result as string);
          const res = await api.post('/system/import-state', parsed);
          alert(
            res.data.warning
              ? `🎉 ${res.data.message}\n\n⚠️ ${res.data.warning}`
              : '🎉 Estado importado com sucesso! Recarregando a página...'
          );
          window.location.reload();
        } catch (err: any) {
          // The server validates the payload and returns what is wrong with it.
          const details: string[] = err.response?.data?.details || [];
          const reason = err.response?.data?.error || err.message;
          alert(
            details.length > 0
              ? ['Arquivo de backup inválido:', '', ...details.map((d) => `• ${d}`)].join('\n')
              : 'Arquivo de backup inválido: ' + reason
          );
          setImporting(false);
        }
      };
      reader.readAsText(file);
    } catch (err: any) {
      alert('Erro ao processar arquivo: ' + err.message);
      setImporting(false);
    }
  };

  const copyInstallScript = () => {
    const script = `curl -fsSL https://raw.githubusercontent.com/WendelDev0/aegispanel/main/install.sh | bash`;
    navigator.clipboard.writeText(script);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Settings className="w-6 h-6 text-primary" />
          Configurações do Servidor & Plataforma
        </h2>
        <p className="text-sm text-on-surface-variant mt-1">
          Gerencie alertas no WhatsApp/Telegram, equipe, domínio próprio do painel e nós de computação.
        </p>
      </div>

      {/* Main Settings Form */}
      <form onSubmit={handleSave} className="space-y-6">
        {/* Identificação do Servidor & Domínio Próprio */}
        <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-5">
          <h3 className="font-bold text-white text-base flex items-center gap-2">
            <Server className="w-5 h-5 text-primary" />
            Identificação & Domínio Próprio do Painel
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                Nome de Exibição do Servidor
              </label>
              <input
                type="text"
                required
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                Domínio Próprio do Painel (SSL Nativo)
              </label>
              <input
                type="text"
                placeholder="ex: painel.seudominio.com"
                value={panelDomain}
                onChange={(e) => setPanelDomain(e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-primary"
              />
              <p className="text-[10px] text-on-surface-variant mt-1">
                Acesse o dashboard via HTTPS diretamente pelo seu subdomínio.
              </p>
            </div>
          </div>
        </div>

        {/* WhatsApp Notifications (Evolution API) */}
        <div className="bg-surface-container rounded-lg p-6 border border-ok/30 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded bg-ok/10 text-ok">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <span>Notificações no WhatsApp (Evolution API)</span>
                  <span className="text-[10px] bg-ok/15 text-ok px-2 py-0.5 rounded-full font-mono">Pro</span>
                </h3>
                <p className="text-xs text-on-surface-variant">
                  Receba avisos instantâneos de deploys e incidentes direto no seu WhatsApp.
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={whatsappEnabled}
                onChange={(e) => setWhatsappEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-on-surface">Ativar WhatsApp</span>
            </label>
          </div>

          {whatsappEnabled && (
            <div className="space-y-4 pt-2 border-t border-outline-variant">
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
                    placeholder={configuredSecrets.whatsappApiKey ? 'Manter a chave atual' : 'Sua chave secreta da Evolution API'}
                    value={whatsappApiKey}
                    onChange={(e) => setWhatsappApiKey(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-ok"
                  />
                  <SecretStatus
                    configured={!!configuredSecrets.whatsappApiKey}
                    onClear={() => clearSecret('whatsappApiKey')}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                    Nome da Instância WhatsApp
                  </label>
                  <input
                    type="text"
                    placeholder="ex: principal ou selva-vps"
                    value={whatsappInstance}
                    onChange={(e) => setWhatsappInstance(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-ok"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                    Número do Seu WhatsApp (com DDI e DDD)
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

              {/* Evolution Actions & Test Result */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleTestEvolution()}
                    disabled={testingEvolution || !whatsappApiUrl}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-surface-container-high hover:bg-surface-container-highest text-white border border-outline-variant rounded text-xs font-semibold transition-all disabled:opacity-40"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${testingEvolution ? 'animate-spin' : ''}`} />
                    <span>{testingEvolution ? 'Testando conexão…' : 'Testar Conexão Evolution'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleTestAlert('whatsapp')}
                    disabled={testingChannel === 'whatsapp' || !whatsappApiUrl || !whatsappRecipientNumber}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-ok border border-ok/30 rounded text-xs font-semibold transition-all disabled:opacity-40"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{testingChannel === 'whatsapp' ? 'Enviando...' : 'Enviar Alerta de Teste'}</span>
                  </button>
                </div>

                {evolutionTestResult && (
                  <div
                    className={`text-xs px-3 py-1.5 rounded border flex items-center gap-2 ${
                      evolutionTestResult.success
                        ? 'bg-ok/10 border-ok/30 text-ok'
                        : 'bg-crit/10 border-crit/30 text-crit'
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

              {/* Live Instances Cards */}
              <div className="pt-4 border-t border-outline-variant space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-ok" />
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                      Instâncias Conectadas na Evolution
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => void fetchEvolutionInstances()}
                    disabled={loadingInstances || !whatsappApiUrl}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingInstances ? 'animate-spin' : ''}`} />
                    <span>Atualizar lista</span>
                  </button>
                </div>

                {loadingInstances ? (
                  <p className="text-xs text-on-surface-variant font-mono">Consultando instâncias…</p>
                ) : evolutionInstances.length === 0 ? (
                  <div className="p-3.5 rounded bg-surface-container-low border border-outline-variant text-xs text-on-surface-variant">
                    Nenhuma instância detectada ou a API ainda não foi testada. Salve as credenciais e clique em
                    "Testar Conexão Evolution".
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
                            <span className="text-xs font-mono font-bold text-white truncate">
                              {inst.name}
                            </span>
                            <span
                              className={`text-[9px] uppercase px-2 py-0.5 rounded font-mono border ${
                                isOpen
                                  ? 'bg-ok/10 text-ok border-ok/30'
                                  : isConnecting
                                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                                  : 'bg-crit/10 text-crit border-crit/30'
                              }`}
                            >
                              {isOpen ? 'Conectado' : isConnecting ? 'Conectando' : 'Desconectado'}
                            </span>
                          </div>
                          {inst.number && (
                            <p className="text-[11px] text-on-surface-variant/80 font-mono">{inst.number}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-[10px] text-on-surface-variant/70">
                  💡 No editor de fluxos, você pode vincular fluxos específicos a cada uma dessas instâncias.
                </p>
              </div>

              {/* Webhook Configuration Helper */}
              <div className="p-3.5 bg-surface-container-low border border-outline-variant rounded-lg space-y-1.5 text-xs">
                <span className="font-semibold text-white">URL de Webhook para Fluxos:</span>
                <div className="flex items-center justify-between gap-2 bg-surface-container px-3 py-2 rounded font-mono text-[11px] text-on-surface-variant overflow-x-auto">
                  <span className="truncate">
                    {`${window.location.origin}/api/wa-flows/webhook`}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/api/wa-flows/webhook`);
                      alert('URL de Webhook copiada com sucesso!');
                    }}
                    className="text-primary hover:underline font-sans text-xs shrink-0"
                  >
                    Copiar
                  </button>
                </div>
                <p className="text-[10px] text-on-surface-variant/70">
                  Cadastre esta URL nas configurações de Webhook das instâncias da Evolution API com o evento{' '}
                  <span className="font-mono text-white">MESSAGES_UPSERT</span>.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* AI Providers Section */}
        <div className="bg-surface-container rounded-lg p-6 border border-primary/30 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded bg-primary/10 text-primary">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <span>Provedores de Inteligência Artificial</span>
                  <span className="text-[10px] bg-primary/15 text-primary px-2 py-0.5 rounded-full font-mono">
                    Fluxos Pro
                  </span>
                </h3>
                <p className="text-xs text-on-surface-variant">
                  Chaves de API para alimentar o bloco Agente IA e respostas inteligentes no WhatsApp.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4 pt-2 border-t border-outline-variant">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                  OpenAI API Key
                </label>
                <input
                  type="password"
                  placeholder={configuredSecrets.openaiKey ? 'Manter a chave atual' : 'sk-...'}
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-primary"
                />
                <SecretStatus
                  configured={!!configuredSecrets.openaiKey}
                  onClear={() => clearSecret('openaiKey')}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                  OpenRouter API Key
                </label>
                <input
                  type="password"
                  placeholder={configuredSecrets.openrouterKey ? 'Manter a chave atual' : 'sk-or-...'}
                  value={openrouterKey}
                  onChange={(e) => setOpenrouterKey(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-primary"
                />
                <SecretStatus
                  configured={!!configuredSecrets.openrouterKey}
                  onClear={() => clearSecret('openrouterKey')}
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                  Modelos Permitidos (separados por vírgula)
                </label>
                <input
                  type="text"
                  placeholder="gpt-4o-mini, gpt-4o, claude-3-5-sonnet, deepseek/deepseek-chat"
                  value={allowedModels}
                  onChange={(e) => setAllowedModels(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-primary"
                />
                <p className="text-[10px] text-on-surface-variant/70 mt-1">
                  Modelos disponíveis para seleção no bloco Agente IA.
                </p>
              </div>
            </div>

            {/* Test AI Provider */}
            <div className="pt-3 border-t border-outline-variant flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <select
                  value={aiTestProvider}
                  onChange={(e) => setAiTestProvider(e.target.value as any)}
                  className="bg-surface-container-low border border-outline-variant rounded px-3 py-1.5 text-white text-xs"
                >
                  <option value="openai">OpenAI</option>
                  <option value="openrouter">OpenRouter</option>
                </select>

                <input
                  type="text"
                  value={aiTestModel}
                  onChange={(e) => setAiTestModel(e.target.value)}
                  placeholder="Modelo de teste"
                  className="bg-surface-container-low border border-outline-variant rounded px-3 py-1.5 text-white text-xs font-mono w-40"
                />

                <button
                  type="button"
                  onClick={() => void handleTestAi()}
                  disabled={testingAi}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 rounded text-xs font-semibold transition-all disabled:opacity-40"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{testingAi ? 'Testando IA…' : 'Testar Provedor de IA'}</span>
                </button>
              </div>

              {aiTestResult && (
                <div
                  className={`text-xs px-3 py-1.5 rounded border flex items-center gap-2 ${
                    aiTestResult.success
                      ? 'bg-ok/10 border-ok/30 text-ok'
                      : 'bg-crit/10 border-crit/30 text-crit'
                  }`}
                >
                  {aiTestResult.success ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{aiTestResult.message}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Flow External Data Plane (Redis & Postgres) */}
        <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-5">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded bg-surface-container-highest text-white">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Fontes de Dados dos Fluxos (Opcional)</h3>
              <p className="text-xs text-on-surface-variant">
                Infraestrutura externa para sessões distribuídas (Redis) e consultas diretas (PostgreSQL).
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-outline-variant">
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">
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
                configured={!!configuredSecrets.flowRedisUrl}
                onClear={() => clearSecret('flowRedisUrl')}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                PostgreSQL URL (Bloco SQL)
              </label>
              <input
                type="text"
                placeholder={configuredSecrets.flowPostgresUrl ? 'Manter URL atual' : 'postgres://user:senha@host:5432/db'}
                value={flowPostgresUrl}
                onChange={(e) => setFlowPostgresUrl(e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-primary"
              />
              <SecretStatus
                configured={!!configuredSecrets.flowPostgresUrl}
                onClear={() => clearSecret('flowPostgresUrl')}
              />
            </div>
          </div>
        </div>

        {/* Telegram & Discord Notifications */}
        <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded bg-primary/10 text-primary">
                <Bell className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Alertas no Telegram & Discord</h3>
                <p className="text-xs text-on-surface-variant">
                  Integrações adicionais de monitoramento de infraestrutura.
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={alertsEnabled}
                onChange={(e) => setAlertsEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-primary focus:ring-primary"
              />
              <span className="text-on-surface">Ativar Notificações</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-outline-variant">
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                Discord Webhook URL
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder={configuredSecrets.discordWebhookUrl ? 'Manter o webhook atual' : 'https://discord.com/api/webhooks/...'}
                  value={discordWebhookUrl}
                  onChange={(e) => setDiscordWebhookUrl(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => handleTestAlert('discord')}
                  disabled={(!discordWebhookUrl && !configuredSecrets.discordWebhookUrl) || testingChannel === 'discord'}
                  className="px-3 py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded text-xs shrink-0 disabled:opacity-40"
                >
                  Testar
                </button>
              </div>
              <SecretStatus
                configured={!!configuredSecrets.discordWebhookUrl}
                onClear={() => clearSecret('discordWebhookUrl')}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                Telegram (Bot Token e Chat ID)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  placeholder={configuredSecrets.telegramBotToken ? 'Manter o token atual' : 'Bot Token'}
                  value={telegramBotToken}
                  onChange={(e) => setTelegramBotToken(e.target.value)}
                  className="w-1/2 bg-surface-container-low border border-outline-variant rounded px-3 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-primary"
                />
                <input
                  type="text"
                  placeholder="Chat ID"
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                  className="w-1/2 bg-surface-container-low border border-outline-variant rounded px-3 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => handleTestAlert('telegram')}
                  disabled={
                    (!telegramBotToken && !configuredSecrets.telegramBotToken) ||
                    !telegramChatId ||
                    testingChannel === 'telegram'
                  }
                  className="px-3 py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded text-xs shrink-0 disabled:opacity-40"
                >
                  Testar
                </button>
              </div>
            </div>
          </div>

          {/* Trigger Preferences */}
          <div className="pt-3 border-t border-outline-variant space-y-3">
            <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Gatilhos de Notificação</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <label className="flex items-center gap-2 cursor-pointer bg-surface-container-low p-2.5 rounded border border-outline-variant hover:border-outline-variant transition-colors">
                <input
                  type="checkbox"
                  checked={notifyOnDeploySuccess}
                  onChange={(e) => setNotifyOnDeploySuccess(e.target.checked)}
                  className="rounded text-primary focus:ring-0"
                />
                <CheckCircle2 className="w-3.5 h-3.5 text-ok shrink-0" />
                <span className="text-on-surface-variant">Deploy Sucesso</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer bg-surface-container-low p-2.5 rounded border border-outline-variant hover:border-outline-variant transition-colors">
                <input
                  type="checkbox"
                  checked={notifyOnDeployFail}
                  onChange={(e) => setNotifyOnDeployFail(e.target.checked)}
                  className="rounded text-primary focus:ring-0"
                />
                <AlertTriangle className="w-3.5 h-3.5 text-crit shrink-0" />
                <span className="text-on-surface-variant">Deploy Falhou</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer bg-surface-container-low p-2.5 rounded border border-outline-variant hover:border-outline-variant transition-colors">
                <input
                  type="checkbox"
                  checked={notifyOnHighResource}
                  onChange={(e) => setNotifyOnHighResource(e.target.checked)}
                  className="rounded text-primary focus:ring-0"
                />
                <Activity className="w-3.5 h-3.5 text-warn shrink-0" />
                <span className="text-on-surface-variant">CPU / RAM &gt; 90%</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer bg-surface-container-low p-2.5 rounded border border-outline-variant hover:border-outline-variant transition-colors">
                <input
                  type="checkbox"
                  checked={notifyOnBackup}
                  onChange={(e) => setNotifyOnBackup(e.target.checked)}
                  className="rounded text-primary focus:ring-0"
                />
                <Database className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-on-surface-variant">Backup Banco</span>
              </label>
            </div>
          </div>

          {/* Threshold Sliders */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-outline-variant">
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                Limite Alerta CPU: <span className="text-primary font-bold">{cpuThreshold}%</span>
              </label>
              <input
                type="range"
                min="50"
                max="98"
                value={cpuThreshold}
                onChange={(e) => setCpuThreshold(parseInt(e.target.value))}
                className="w-full accent-[#4d8eff]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                Limite Alerta Memória: <span className="text-ok font-bold">{memThreshold}%</span>
              </label>
              <input
                type="range"
                min="50"
                max="98"
                value={memThreshold}
                onChange={(e) => setMemThreshold(parseInt(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                Limite Alerta Disco: <span className="text-warn font-bold">{diskThreshold}%</span>
              </label>
              <input
                type="range"
                min="50"
                max="98"
                value={diskThreshold}
                onChange={(e) => setDiskThreshold(parseInt(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>
          </div>

              {!isAdmin && (
            <div className="flex items-start gap-3 p-4 rounded-lg border border-outline-variant bg-surface-container-low">
              <Shield className="w-5 h-5 text-on-surface-variant shrink-0 mt-0.5" />
              <p className="text-xs text-on-surface-variant">
                Você está vendo estas configurações em modo leitura. Alterá-las exige o perfil{' '}
                <span className="font-mono text-on-surface">admin</span>.
              </p>
            </div>
          )}

          {/* Save Button */}
          <div className="flex items-center justify-between pt-3">
            {savedSuccess ? (
              <span className="text-ok text-xs font-semibold flex items-center gap-1">
                <Check className="w-4 h-4" /> Configurações salvas com sucesso!
              </span>
            ) : <span></span>}

            <button
              type="submit"
              disabled={saving || !isAdmin}
              title={isAdmin ? undefined : 'Somente administradores podem alterar as configurações do painel.'}
              className="flex items-center gap-2 px-6 py-2.5 rounded bg-primary-container hover:bg-primary text-white font-semibold text-sm transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </div>
      </form>

      <SecuritySection
        currentUser={currentUser}
        onUserUpdate={(user) => onUserUpdate?.(user)}
      />

      {/* Change own password: available to every role, including viewers. */}
      <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded bg-sky-500/10 text-sky-400">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-white text-base">Minha Senha</h3>
            <p className="text-xs text-on-surface-variant">
              Conectado como <span className="text-on-surface font-semibold">{currentUser?.username || '-'}</span>
              {currentUser?.role && (
                <span className="ml-1.5 text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold bg-surface-container-high text-on-surface-variant">
                  {currentUser.role.toUpperCase()}
                </span>
              )}
            </p>
          </div>
        </div>

        <form onSubmit={handleChangeOwnPassword} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant mb-1">Senha atual</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-sky-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant mb-1">Nova senha</label>
            <input
              type="password"
              required
              minLength={12}
              placeholder="Mínimo 12 caracteres"
              value={newOwnPassword}
              onChange={(e) => setNewOwnPassword(e.target.value)}
              className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-sky-500"
            />
          </div>
          <button
            type="submit"
            disabled={changingPassword}
            className="px-4 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded text-xs font-semibold"
          >
            {changingPassword ? 'Alterando...' : 'Alterar senha'}
          </button>
        </form>
      </div>

      {/* Team / Multi-User Management Section */}
      <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded bg-purple-500/10 text-purple-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Equipe & Controle de Permissões</h3>
              <p className="text-xs text-on-surface-variant">
                Convide desenvolvedores e operadores com permissões granulares.
              </p>
            </div>
          </div>

          {isAdmin && (
            <button
              onClick={() => setShowAddUserModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-semibold transition-all"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Adicionar Membro
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
            {/* What each role can do, so the choice is not a guess. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {ROLE_LEGEND.map((r) => (
                <div key={r.role} className={`p-3 rounded border ${r.className}`}>
                  <p className="text-[10px] font-mono font-bold mb-1">{r.role}</p>
                  <p className="text-[11px] text-on-surface-variant leading-snug">{r.text}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {teamUsers.map((user) => {
                const isSelf = user.id === currentUser?.id;
                const adminCount = teamUsers.filter((u) => u.role === 'admin').length;
                // Mirrors the server rules, so the button is absent rather than
                // present and guaranteed to fail.
                const isLastAdmin = user.role === 'admin' && adminCount <= 1;
                const canRemove = isAdmin && !isSelf && !isLastAdmin;

                return (
                  <div
                    key={user.id}
                    className="p-4 rounded-lg bg-surface-container-lowest border border-outline-variant flex items-center justify-between gap-2"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-white text-sm truncate">{user.username}</span>
                        {isSelf && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-tertiary font-semibold">
                            você
                          </span>
                        )}
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold ${
                            user.role === 'admin'
                              ? 'bg-primary/20 text-primary'
                              : user.role === 'developer'
                              ? 'bg-ok/15 text-ok'
                              : 'bg-surface-container-high text-on-surface-variant'
                          }`}
                        >
                          {user.role.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-[11px] text-on-surface-variant truncate">{user.email || 'Sem e-mail cadastrado'}</p>
                      {isLastAdmin && (
                        <p className="text-[10px] text-warn/80">Único administrador — não pode ser removido.</p>
                      )}
                    </div>

                    {canRemove && (
                      <button
                        onClick={() => handleDeleteUser(user.id, user.username)}
                        className="p-1.5 text-on-surface-variant/70 hover:text-crit rounded-lg hover:bg-surface-container-low transition-colors shrink-0"
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

      {/* Migration & Backup Section: admin only, mirrors the server rule. */}
      {isAdmin && (
      <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h3 className="font-bold text-white text-base">Migração & Backup Global do Painel</h3>
        </div>
        <p className="text-xs text-on-surface-variant">
          Exporte todo o estado do AegisPanel (Bancos, Aplicações, Cron Jobs, Domínios e Configurações) em um único arquivo JSON para restauração instantânea.
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            onClick={handleExportState}
            className="flex items-center gap-2 px-4 py-2.5 rounded bg-surface-container-high hover:bg-surface-container-highest text-primary text-xs font-semibold border border-primary/30 transition-all active:scale-95"
          >
            <Download className="w-4 h-4" />
            <span>Exportar Backup Completo (.JSON)</span>
          </button>

          <input
            type="file"
            ref={importFileRef}
            onChange={handleImportFile}
            accept=".json"
            className="hidden"
          />

          <button
            onClick={() => importFileRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-2 px-4 py-2.5 rounded bg-surface-container-high hover:bg-surface-container-highest text-ok text-xs font-semibold border border-ok/30 transition-all active:scale-95 disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            <span>{importing ? 'Importando...' : 'Restaurar / Importar Backup'}</span>
          </button>
        </div>
      </div>
      )}

      {isAdmin && (
      <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-4">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-ok" />
          <h3 className="font-bold text-white text-base">Autogestão do Painel</h3>
        </div>
        <p className="text-xs text-on-surface-variant">
          Logs allowlisted da stack (backend, frontend, caddy, nginx) e self-update via Docker Compose.
          Quando o GitHub está à frente, o botão Atualizar também aparece no topo do painel, como numa IDE.
          O compose sobe num contêiner irmão para o backend não se matar no meio (isso gerava 502).
          Bloqueado em LOCAL_MODE.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={panelLogTarget}
            onChange={(e) => setPanelLogTarget(e.target.value)}
            className="bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-xs text-white"
          >
            <option value="aegis-backend">aegis-backend</option>
            <option value="aegis-frontend">aegis-frontend</option>
            <option value="aegis-caddy">aegis-caddy</option>
            <option value="aegis-nginx">aegis-nginx</option>
          </select>
          <button
            onClick={handleLoadPanelLogs}
            disabled={loadingPanelLogs}
            className="px-4 py-2 rounded bg-surface-container-high text-xs font-semibold text-on-surface border border-outline-variant disabled:opacity-50"
          >
            {loadingPanelLogs ? 'Carregando…' : 'Ver logs'}
          </button>
          <button
            onClick={handleSelfUpdate}
            disabled={selfUpdating}
            className="px-4 py-2 rounded bg-primary-container hover:bg-primary text-white text-xs font-semibold disabled:opacity-50"
          >
            {selfUpdating ? 'Atualizando…' : 'Self-update da stack'}
          </button>
        </div>

        {selfUpdateOutput && (
          <pre className="max-h-64 overflow-auto bg-surface-container-lowest border border-outline-variant rounded p-3 text-[11px] font-mono text-ok whitespace-pre-wrap">
            {selfUpdateOutput}
          </pre>
        )}
        {panelLogs && (
          <pre className="max-h-64 overflow-auto bg-surface-container-lowest border border-outline-variant rounded p-3 text-[11px] font-mono text-ok whitespace-pre-wrap">
            {panelLogs}
          </pre>
        )}
      </div>
      )}

      {/* VPS 1-Click Installer Script Box */}
      <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-ok" />
            <h3 className="font-bold text-white text-base">Script Oficial de Instalação em VPS Linux</h3>
          </div>
          <button
            onClick={copyInstallScript}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-xs font-medium border border-outline-variant transition-colors"
          >
            {copiedScript ? (
              <>
                <Check className="w-3.5 h-3.5 text-ok" />
                <span className="text-ok">Copiado</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar Comando</span>
              </>
            )}
          </button>
        </div>
        <div className="bg-surface-container-lowest p-4 rounded border border-outline-variant font-mono text-xs text-ok select-all">
          curl -fsSL https://raw.githubusercontent.com/WendelDev0/aegispanel/main/install.sh | bash
        </div>
      </div>

      {/* Add Team User Modal */}
      {showAddUserModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-container rounded-lg border border-outline-variant w-full max-w-md overflow-hidden p-6 space-y-5">
            <h3 className="font-bold text-white text-lg flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-purple-400" />
              Novo Membro da Equipe
            </h3>

            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Nome de Usuário *</label>
                <input
                  type="text"
                  required
                  placeholder="ex: dev_selva"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
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
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">E-mail (Opcional)</label>
                <input
                  type="email"
                  placeholder="voce@seudominio.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Função / Permissão</label>
                <select
                  value={newRole}
                  onChange={(e: any) => setNewRole(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
                >
                  <option value="viewer">Visualizador — somente leitura</option>
                  <option value="developer">Desenvolvedor — deploys, apps, bancos, arquivos</option>
                  <option value="admin">Administrador — controle total do servidor</option>
                </select>
                {newRole === 'admin' && (
                  <p className="text-[11px] text-warn/90 mt-1.5 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                    Administradores abrem terminal no host, executam comandos e gerenciam a equipe. Na prática,
                    é acesso root ao servidor.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
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
                  className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
                >
                  {addingUser ? 'Criando...' : 'Salvar Membro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isAdmin && <StateHistorySection />}
      {isAdmin && <AuditSection />}
    </div>
  );
};
