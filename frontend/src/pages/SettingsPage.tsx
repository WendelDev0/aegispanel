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
  Sparkles
} from 'lucide-react';
import { api } from '../services/api.js';
import { ServerNode } from '../types/index.js';

export const SettingsPage: React.FC = () => {
  const [serverName, setServerName] = useState('');
  const [caddyEnabled, setCaddyEnabled] = useState(true);
  const [nodes, setNodes] = useState<ServerNode[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

  // Alert settings
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('');
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [cpuThreshold, setCpuThreshold] = useState(90);
  const [memThreshold, setMemThreshold] = useState(85);
  const [diskThreshold, setDiskThreshold] = useState(90);

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
      const [resSettings, resNodes] = await Promise.all([
        api.get('/system/settings'),
        api.get('/nodes'),
      ]);
      setServerName(resSettings.data.serverName || 'Aegis Node 01');
      setCaddyEnabled(resSettings.data.caddyEnabled ?? true);
      setNodes(resNodes.data);

      const alertConf = resSettings.data.alertConfig || {};
      setAlertsEnabled(alertConf.enabled ?? false);
      setDiscordWebhookUrl(alertConf.discordWebhookUrl || '');
      setTelegramBotToken(alertConf.telegramBotToken || '');
      setTelegramChatId(alertConf.telegramChatId || '');
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
        alertConfig: {
          enabled: alertsEnabled,
          discordWebhookUrl,
          telegramBotToken,
          telegramChatId,
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

  const handleExportState = () => {
    window.open('/api/system/export-state', '_blank');
  };

  const handleImportState = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setImporting(true);
        const parsed = JSON.parse(reader.result as string);
        await api.post('/system/import-state', parsed);
        alert('🎉 Dados importados com sucesso! Todos os seus bancos, apps e domínios foram sincronizados.');
        window.location.reload();
      } catch (err: any) {
        alert('Erro na importação: ' + (err.response?.data?.error || err.message));
      } finally {
        setImporting(false);
      }
    };
    reader.readAsText(file);
  };

  const handleSelectNode = async (id: string) => {
    try {
      await api.post(`/nodes/select/${id}`);
      fetchSettingsAndNodes();
    } catch (err: any) {
      alert('Erro ao alternar nó: ' + (err.response?.data?.error || err.message));
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
      fetchSettingsAndNodes();
    } catch (err: any) {
      alert('Erro ao cadastrar nó: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDeleteNode = async (id: string) => {
    if (!confirm('Remover este servidor do cluster?')) return;
    try {
      await api.delete(`/nodes/${id}`);
      fetchSettingsAndNodes();
    } catch (err: any) {
      alert('Erro ao remover: ' + (err.response?.data?.error || err.message));
    }
  };

  const installScript = `# 🚀 Script de Instalação 1-Click na sua VPS Contabo / Ubuntu 22.04/24.04
curl -fsSL https://raw.githubusercontent.com/WendelDev0/aegispanel/main/install.sh | bash`;

  const copyInstallScript = () => {
    navigator.clipboard.writeText(installScript);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Settings className="w-6 h-6 text-indigo-400" />
          Configurações, Migração & Multi-Servidor
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Sincronize seus dados entre seu computador local e sua VPS Contabo com 1 clique.
        </p>
      </div>

      {/* Migration / Sync Local -> Contabo Card */}
      <div className="bg-gradient-to-r from-indigo-950/50 via-slate-900 to-slate-900 rounded-2xl p-6 border border-indigo-500/30 shadow-xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-white text-base">Migração 1-Clique: Computador Local ➔ VPS Contabo</h3>
            <p className="text-xs text-slate-300">
              Tudo o que você criar no seu computador agora (bancos, apps, variáveis de ambiente) pode ser exportado e importado na Contabo instantaneamente:
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          {/* Export Button */}
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2 flex flex-col justify-between">
            <div>
              <h4 className="font-bold text-xs text-white flex items-center gap-1.5">
                <Download className="w-4 h-4 text-emerald-400" /> 1. Exportar Tudo do Computador Local
              </h4>
              <p className="text-[11px] text-slate-400 mt-1">
                Baixa um arquivo com todos os bancos, aplicações, variáveis de ambiente e domínios configurados.
              </p>
            </div>
            <button
              onClick={handleExportState}
              className="w-full mt-2 flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow transition-all active:scale-95"
            >
              <Download className="w-3.5 h-3.5" /> Baixar Pacote de Migração (.json)
            </button>
          </div>

          {/* Import Button */}
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2 flex flex-col justify-between">
            <div>
              <h4 className="font-bold text-xs text-white flex items-center gap-1.5">
                <Upload className="w-4 h-4 text-indigo-400" /> 2. Importar na VPS Contabo
              </h4>
              <p className="text-[11px] text-slate-400 mt-1">
                Quando abrir o painel na Contabo, selecione o arquivo baixado para recriar toda a infraestrutura na hora.
              </p>
            </div>
            <input
              type="file"
              ref={importFileRef}
              accept=".json"
              onChange={handleImportState}
              className="hidden"
            />
            <button
              onClick={() => importFileRef.current?.click()}
              disabled={importing}
              className="w-full mt-2 flex items-center justify-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow transition-all active:scale-95 disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" /> {importing ? 'Importando...' : 'Carregar Pacote de Migração'}
            </button>
          </div>
        </div>
      </div>

      {/* Multi-Server Management */}
      <div className="bg-[#0f172a]/80 rounded-2xl p-6 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-indigo-400" />
            <h3 className="font-bold text-white text-base">Cluster Multi-Servidor (VPS + Servidor Local Empresa)</h3>
          </div>
          <button
            onClick={() => setShowAddNodeModal(true)}
            title="Conectar outro servidor VPS ou máquina local ao painel"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Adicionar Servidor
          </button>
        </div>

        <p className="text-xs text-slate-400">
          Alterne o controle entre a sua VPS da Contabo na nuvem e o seu Servidor Físico na empresa sem precisar de painéis separados:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {nodes.map((node) => (
            <div
              key={node.id}
              onClick={() => handleSelectNode(node.id)}
              className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                node.isCurrent
                  ? 'bg-indigo-600/15 border-indigo-500 shadow-md text-white'
                  : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <Radio className={`w-4 h-4 ${node.isCurrent ? 'text-indigo-400' : 'text-slate-600'}`} />
                <div>
                  <h4 className="font-bold text-xs">{node.name}</h4>
                  <p className="text-[11px] font-mono text-slate-400">{node.hostIp} • {node.location || 'Local'}</p>
                </div>
              </div>

              {node.isCurrent ? (
                <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded font-bold">
                  Ativo
                </span>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteNode(node.id);
                  }}
                  title="Remover servidor"
                  className="p-1 text-slate-500 hover:text-rose-400"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Notifications & Thresholds */}
      <form onSubmit={handleSave} className="space-y-6">
        <div className="bg-[#0f172a]/80 rounded-2xl p-6 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-amber-400" />
              <h3 className="font-bold text-white text-base">Alertas & Notificações Automáticas</h3>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={alertsEnabled}
                onChange={(e) => setAlertsEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-slate-200">Ativar Alertas</span>
            </label>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Discord Webhook URL (Canal de Alertas)
              </label>
              <input
                type="text"
                placeholder="https://discord.com/api/webhooks/..."
                value={discordWebhookUrl}
                onChange={(e) => setDiscordWebhookUrl(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Limite CPU: <span className="text-indigo-400 font-bold">{cpuThreshold}%</span>
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
                  Limite Memória: <span className="text-emerald-400 font-bold">{memThreshold}%</span>
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
                  Limite Disco: <span className="text-amber-400 font-bold">{diskThreshold}%</span>
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
          </div>
        </div>

        {/* Server Display Config */}
        <div className="bg-[#0f172a]/80 rounded-2xl p-6 border border-slate-800 space-y-4">
          <h3 className="font-bold text-white text-base flex items-center gap-2">
            <Server className="w-4 h-4 text-indigo-400" />
            Identificação do Nó
          </h3>

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

          <div className="flex items-center justify-between pt-2">
            {savedSuccess ? (
              <span className="text-emerald-400 text-xs font-semibold flex items-center gap-1">
                <Check className="w-4 h-4" /> Configurações salvas com sucesso!
              </span>
            ) : <span></span>}

            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all active:scale-95 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </div>
      </form>

      {/* VPS 1-Click Installer Script Box */}
      <div className="bg-[#0f172a]/80 rounded-2xl p-6 border border-slate-800 space-y-4">
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

        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 font-mono text-xs text-emerald-400 overflow-x-auto whitespace-pre-wrap leading-relaxed">
          {installScript}
        </div>
      </div>

      {/* Modal: Add Node */}
      {showAddNodeModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-2xl border border-slate-800 w-full max-w-md overflow-hidden shadow-2xl p-6">
            <h3 className="font-bold text-white text-base mb-4">Adicionar Servidor ao Cluster</h3>
            <form onSubmit={handleAddNode} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Nome do Servidor *</label>
                <input
                  type="text"
                  required
                  placeholder="ex: VPS Contabo 02 ou Servidor Empresa"
                  value={newNodeName}
                  onChange={(e) => setNewNodeName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-white text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">IP / Hostname *</label>
                <input
                  type="text"
                  required
                  placeholder="ex: 161.97.100.50 ou homelab.local"
                  value={newNodeIp}
                  onChange={(e) => setNewNodeIp(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-white text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Localização</label>
                <input
                  type="text"
                  placeholder="ex: Contabo Alemanha ou Empresa Matriz"
                  value={newNodeLocation}
                  onChange={(e) => setNewNodeLocation(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-white text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddNodeModal(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white text-xs font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold"
                >
                  Salvar Servidor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
