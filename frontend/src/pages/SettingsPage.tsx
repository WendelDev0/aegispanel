import React, { useState, useEffect, useRef } from 'react';
import {
  Settings,
  Server,
  Save,
  Copy,
  Check,
  Terminal,
  Bell,
  Sliders,
  Plus,
  Trash2,
  Globe,
  Radio,
  Download,
  Upload,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  MessageSquare,
  Send,
  Users,
  UserPlus,
  Lock,
  Mail,
  Shield,
  Eye,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Database,
  Cpu
} from 'lucide-react';
import { api } from '../services/api.js';
import { ServerNode, User } from '../types/index.js';

export const SettingsPage: React.FC = () => {
  const [serverName, setServerName] = useState('');
  const [caddyEnabled, setCaddyEnabled] = useState(true);
  const [panelDomain, setPanelDomain] = useState('');
  const [nodes, setNodes] = useState<ServerNode[]>([]);
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

  // Notification Trigger Preferences
  const [notifyOnDeploySuccess, setNotifyOnDeploySuccess] = useState(true);
  const [notifyOnDeployFail, setNotifyOnDeployFail] = useState(true);
  const [notifyOnHighResource, setNotifyOnHighResource] = useState(true);
  const [notifyOnBackup, setNotifyOnBackup] = useState(true);

  const [cpuThreshold, setCpuThreshold] = useState(90);
  const [memThreshold, setMemThreshold] = useState(85);
  const [diskThreshold, setDiskThreshold] = useState(90);

  // Testing status
  const [testingChannel, setTestingChannel] = useState<string | null>(null);

  // Team User Modal
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'developer' | 'viewer'>('developer');
  const [addingUser, setAddingUser] = useState(false);

  // Add node modal
  const [showAddNodeModal, setShowAddNodeModal] = useState(false);
  const [newNodeName, setNewNodeName] = useState('');
  const [newNodeType, setNewNodeType] = useState<'vps' | 'local' | 'cloud'>('vps');
  const [newNodeIp, setNewNodeIp] = useState('');
  const [newNodeLocation, setNewNodeLocation] = useState('');

  // Import file ref
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const fetchSettingsAndNodes = async () => {
    try {
      const [resSettings, resNodes, resUsers] = await Promise.all([
        api.get('/system/settings'),
        api.get('/nodes'),
        api.get('/auth/users'),
      ]);
      setServerName(resSettings.data.serverName || 'Aegis Node 01');
      setCaddyEnabled(resSettings.data.caddyEnabled ?? true);
      setPanelDomain(resSettings.data.panelDomain || '');
      setNodes(resNodes.data);
      setTeamUsers(resUsers.data || []);

      const alertConf = resSettings.data.alertConfig || {};
      setAlertsEnabled(alertConf.enabled ?? false);
      setDiscordWebhookUrl(alertConf.discordWebhookUrl || '');
      setTelegramBotToken(alertConf.telegramBotToken || '');
      setTelegramChatId(alertConf.telegramChatId || '');

      setWhatsappEnabled(alertConf.whatsappEnabled ?? false);
      setWhatsappApiUrl(alertConf.whatsappApiUrl || '');
      setWhatsappApiKey(alertConf.whatsappApiKey || '');
      setWhatsappInstance(alertConf.whatsappInstance || '');
      setWhatsappRecipientNumber(alertConf.whatsappRecipientNumber || '');

      setNotifyOnDeploySuccess(alertConf.notifyOnDeploySuccess ?? true);
      setNotifyOnDeployFail(alertConf.notifyOnDeployFail ?? true);
      setNotifyOnHighResource(alertConf.notifyOnHighResource ?? true);
      setNotifyOnBackup(alertConf.notifyOnBackup ?? true);

      setCpuThreshold(alertConf.cpuThresholdPercent || 90);
      setMemThreshold(alertConf.memThresholdPercent || 85);
      setDiskThreshold(alertConf.diskThresholdPercent || 90);
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

  useEffect(() => {
    fetchSettingsAndNodes();
  }, []);

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
          discordWebhookUrl,
          telegramBotToken,
          telegramChatId,
          whatsappEnabled,
          whatsappApiUrl,
          whatsappApiKey,
          whatsappInstance,
          whatsappRecipientNumber,
          notifyOnDeploySuccess,
          notifyOnDeployFail,
          notifyOnHighResource,
          notifyOnBackup,
          cpuThresholdPercent: cpuThreshold,
          memThresholdPercent: memThreshold,
          diskThresholdPercent: diskThreshold,
        }
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
        webhookUrl: discordWebhookUrl,
        botToken: telegramBotToken,
        chatId: telegramChatId,
        apiUrl: whatsappApiUrl,
        apiKey: whatsappApiKey,
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

  const handleAddNode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNodeName || !newNodeIp) return;

    try {
      await api.post('/nodes', {
        name: newNodeName,
        type: newNodeType,
        hostIp: newNodeIp,
        location: newNodeLocation,
      });
      setShowAddNodeModal(false);
      setNewNodeName('');
      setNewNodeIp('');
      setNewNodeLocation('');
      fetchSettingsAndNodes();
    } catch (err: any) {
      alert('Erro ao adicionar nó: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDeleteNode = async (id: string, name: string) => {
    if (!confirm(`Remover o nó de servidor "${name}"?`)) return;
    try {
      await api.delete(`/nodes/${id}`);
      fetchSettingsAndNodes();
    } catch (err: any) {
      alert('Erro ao remover nó: ' + (err.response?.data?.error || err.message));
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
          await api.post('/system/import-state', parsed);
          alert('🎉 Estado completo importado com sucesso! Recarregando a página...');
          window.location.reload();
        } catch (err: any) {
          alert('Arquivo de backup inválido: ' + err.message);
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
          <Settings className="w-6 h-6 text-indigo-400" />
          Configurações do Servidor & Plataforma
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Gerencie alertas no WhatsApp/Telegram, equipe, domínio próprio do painel e nós de computação.
        </p>
      </div>

      {/* Main Settings Form */}
      <form onSubmit={handleSave} className="space-y-6">
        {/* Identificação do Servidor & Domínio Próprio */}
        <div className="bg-[#0f172a]/90 rounded-3xl p-6 border border-slate-800 shadow-xl space-y-5">
          <h3 className="font-bold text-white text-base flex items-center gap-2">
            <Server className="w-5 h-5 text-indigo-400" />
            Identificação & Domínio Próprio do Painel
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Nome de Exibição do Servidor
              </label>
              <input
                type="text"
                required
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Domínio Próprio do Painel (SSL Nativo)
              </label>
              <input
                type="text"
                placeholder="ex: painel.selvamarketing.com"
                value={panelDomain}
                onChange={(e) => setPanelDomain(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-indigo-500"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Acesse o dashboard via HTTPS diretamente pelo seu subdomínio.
              </p>
            </div>
          </div>
        </div>

        {/* WhatsApp Notifications (Evolution API) */}
        <div className="bg-[#0f172a]/90 rounded-3xl p-6 border border-emerald-500/30 shadow-xl space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <span>Notificações no WhatsApp (Evolution API)</span>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-mono">Pro</span>
                </h3>
                <p className="text-xs text-slate-400">
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
              <span className="text-slate-200">Ativar WhatsApp</span>
            </label>
          </div>

          {whatsappEnabled && (
            <div className="space-y-4 pt-2 border-t border-slate-800">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Evolution API URL (Instância)
                  </label>
                  <input
                    type="text"
                    placeholder="https://evo.selvamarketing.com ou http://localhost:8080"
                    value={whatsappApiUrl}
                    onChange={(e) => setWhatsappApiUrl(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    API Key (Chave Global de Autenticação)
                  </label>
                  <input
                    type="password"
                    placeholder="Sua chave secreta da Evolution API"
                    value={whatsappApiKey}
                    onChange={(e) => setWhatsappApiKey(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Nome da Instância WhatsApp
                  </label>
                  <input
                    type="text"
                    placeholder="ex: principal ou selva-vps"
                    value={whatsappInstance}
                    onChange={(e) => setWhatsappInstance(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Número do Seu WhatsApp (com DDI e DDD)
                  </label>
                  <input
                    type="text"
                    placeholder="ex: 5511999998888"
                    value={whatsappRecipientNumber}
                    onChange={(e) => setWhatsappRecipientNumber(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => handleTestAlert('whatsapp')}
                  disabled={testingChannel === 'whatsapp' || !whatsappApiUrl || !whatsappRecipientNumber}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-semibold transition-all disabled:opacity-40"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{testingChannel === 'whatsapp' ? 'Enviando...' : 'Enviar Teste (WhatsApp)'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Telegram & Discord Notifications */}
        <div className="bg-[#0f172a]/90 rounded-3xl p-6 border border-slate-800 shadow-xl space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
                <Bell className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Alertas no Telegram & Discord</h3>
                <p className="text-xs text-slate-400">
                  Integrações adicionais de monitoramento de infraestrutura.
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={alertsEnabled}
                onChange={(e) => setAlertsEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-slate-200">Ativar Notificações</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Discord Webhook URL
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="https://discord.com/api/webhooks/..."
                  value={discordWebhookUrl}
                  onChange={(e) => setDiscordWebhookUrl(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => handleTestAlert('discord')}
                  disabled={!discordWebhookUrl || testingChannel === 'discord'}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs shrink-0 disabled:opacity-40"
                >
                  Testar
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Telegram (Bot Token e Chat ID)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  placeholder="Bot Token"
                  value={telegramBotToken}
                  onChange={(e) => setTelegramBotToken(e.target.value)}
                  className="w-1/2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-indigo-500"
                />
                <input
                  type="text"
                  placeholder="Chat ID"
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                  className="w-1/2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => handleTestAlert('telegram')}
                  disabled={!telegramBotToken || !telegramChatId || testingChannel === 'telegram'}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs shrink-0 disabled:opacity-40"
                >
                  Testar
                </button>
              </div>
            </div>
          </div>

          {/* Trigger Preferences */}
          <div className="pt-3 border-t border-slate-800 space-y-3">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Gatilhos de Notificação</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <label className="flex items-center gap-2 cursor-pointer bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors">
                <input
                  type="checkbox"
                  checked={notifyOnDeploySuccess}
                  onChange={(e) => setNotifyOnDeploySuccess(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-0"
                />
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-slate-300">Deploy Sucesso</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors">
                <input
                  type="checkbox"
                  checked={notifyOnDeployFail}
                  onChange={(e) => setNotifyOnDeployFail(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-0"
                />
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span className="text-slate-300">Deploy Falhou</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors">
                <input
                  type="checkbox"
                  checked={notifyOnHighResource}
                  onChange={(e) => setNotifyOnHighResource(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-0"
                />
                <Activity className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="text-slate-300">CPU / RAM &gt; 90%</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors">
                <input
                  type="checkbox"
                  checked={notifyOnBackup}
                  onChange={(e) => setNotifyOnBackup(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-0"
                />
                <Database className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span className="text-slate-300">Backup Banco</span>
              </label>
            </div>
          </div>

          {/* Threshold Sliders */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-800">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Limite Alerta CPU: <span className="text-indigo-400 font-bold">{cpuThreshold}%</span>
              </label>
              <input
                type="range"
                min="50"
                max="98"
                value={cpuThreshold}
                onChange={(e) => setCpuThreshold(parseInt(e.target.value))}
                className="w-full accent-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Limite Alerta Memória: <span className="text-emerald-400 font-bold">{memThreshold}%</span>
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
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Limite Alerta Disco: <span className="text-amber-400 font-bold">{diskThreshold}%</span>
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

          {/* Save Button */}
          <div className="flex items-center justify-between pt-3">
            {savedSuccess ? (
              <span className="text-emerald-400 text-xs font-semibold flex items-center gap-1">
                <Check className="w-4 h-4" /> Configurações salvas com sucesso!
              </span>
            ) : <span></span>}

            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all active:scale-95 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </div>
      </form>

      {/* Team / Multi-User Management Section */}
      <div className="bg-[#0f172a]/90 rounded-3xl p-6 border border-slate-800 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Equipe & Controle de Permissões</h3>
              <p className="text-xs text-slate-400">
                Convide desenvolvedores e operadores com permissões granulares.
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowAddUserModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-purple-600/30 transition-all"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Adicionar Membro
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {teamUsers.map(user => (
            <div
              key={user.id}
              className="p-4 rounded-2xl bg-slate-950 border border-slate-800/80 flex items-center justify-between"
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white text-sm">{user.username}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold ${
                    user.role === 'admin' ? 'bg-indigo-500/20 text-indigo-300' :
                    user.role === 'developer' ? 'bg-emerald-500/20 text-emerald-300' :
                    'bg-slate-800 text-slate-400'
                  }`}>
                    {user.role.toUpperCase()}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">{user.email || 'Sem e-mail cadastrado'}</p>
              </div>

              {user.role !== 'admin' && (
                <button
                  onClick={() => handleDeleteUser(user.id, user.username)}
                  className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-slate-900 transition-colors"
                  title="Remover usuário da equipe"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Migration & Backup Section */}
      <div className="bg-[#0f172a]/90 rounded-3xl p-6 border border-slate-800 shadow-xl space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-indigo-400" />
          <h3 className="font-bold text-white text-base">Migração & Backup Global do Painel</h3>
        </div>
        <p className="text-xs text-slate-400">
          Exporte todo o estado do AegisPanel (Bancos, Aplicações, Cron Jobs, Domínios e Configurações) em um único arquivo JSON para restauração instantânea.
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            onClick={handleExportState}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-indigo-300 text-xs font-semibold border border-indigo-500/30 transition-all active:scale-95"
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
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 text-xs font-semibold border border-emerald-500/30 transition-all active:scale-95 disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            <span>{importing ? 'Importando...' : 'Restaurar / Importar Backup'}</span>
          </button>
        </div>
      </div>

      {/* VPS 1-Click Installer Script Box */}
      <div className="bg-[#0f172a]/90 rounded-3xl p-6 border border-slate-800 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <h3 className="font-bold text-white text-base">Script Oficial de Instalação na VPS Contabo</h3>
          </div>
          <button
            onClick={copyInstallScript}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
          >
            {copiedScript ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copiado</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar Comando</span>
              </>
            )}
          </button>
        </div>
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs text-emerald-400 select-all">
          curl -fsSL https://raw.githubusercontent.com/WendelDev0/aegispanel/main/install.sh | bash
        </div>
      </div>

      {/* Add Team User Modal */}
      {showAddUserModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-3xl border border-slate-800 w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-5">
            <h3 className="font-bold text-white text-lg flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-purple-400" />
              Novo Membro da Equipe
            </h3>

            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Nome de Usuário *</label>
                <input
                  type="text"
                  required
                  placeholder="ex: dev_selva"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Senha de Acesso *</label>
                <input
                  type="password"
                  required
                  placeholder="Mínimo 6 caracteres"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">E-mail (Opcional)</label>
                <input
                  type="email"
                  placeholder="dev@selvamarketing.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Função / Permissão</label>
                <select
                  value={newRole}
                  onChange={(e: any) => setNewRole(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
                >
                  <option value="developer">Desenvolvedor (Deploy, Logs e Arquivos)</option>
                  <option value="viewer">Visualizador (Apenas Acompanhamento)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={addingUser}
                  className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-purple-600/30 transition-all active:scale-95 disabled:opacity-50"
                >
                  {addingUser ? 'Criando...' : 'Salvar Membro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
