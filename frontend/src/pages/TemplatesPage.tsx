import React, { useState, useEffect } from 'react';
import {
  ShoppingBag,
  Download,
  Check,
  RefreshCw,
  Sparkles,
  ExternalLink,
  Layers,
  ArrowRight,
  Bot,
  Globe,
  Database,
  Activity,
  X,
  Search,
  Key,
  ShieldCheck,
  Zap,
  MessageSquare,
  Copy,
  Terminal,
  BookOpen,
  Server,
  CheckCircle2,
  AlertCircle,
  ArrowUpCircle,
  Play,
  Square,
  Info,
  Sliders
} from 'lucide-react';
import { api } from '../services/api.js';
import { AppRecord, DatabaseRecord } from '../types/index.js';
import { NavTab } from '../components/Sidebar.js';
import { ProviderLogo } from '../components/ProviderLogo.js';

export interface AppTemplate {
  id: string;
  name: string;
  category: 'whatsapp' | 'automation' | 'database' | 'cms' | 'monitoring' | 'tools';
  description: string;
  iconUrl: string;
  defaultPort: number;
  image: string;
  version: string;
  latestVersion?: string;
  releaseDate?: string;
  author: string;
  websiteUrl?: string;
  changelogUrl?: string;
  env: Record<string, string>;
  features: string[];
  tags: string[];
  docsUrl?: string;
}

export interface ProviderUpdateInfo {
  templateId: string;
  templateName: string;
  currentCatalogVersion: string;
  latestVersion: string;
  releaseDate?: string;
  changelogUrl?: string;
  installedAppId?: string;
  installedAppName?: string;
  installedImage?: string;
  isInstalled: boolean;
  hasUpdate: boolean;
}

export interface UpdatesSummary {
  checkedAt: string;
  totalProviders: number;
  totalInstalled: number;
  updatesAvailable: number;
  providers: ProviderUpdateInfo[];
}

interface TemplatesPageProps {
  setActiveTab?: (tab: NavTab) => void;
}

export const TemplatesPage: React.FC<TemplatesPageProps> = ({ setActiveTab }) => {
  const [templates, setTemplates] = useState<AppTemplate[]>([]);
  const [databases, setDatabases] = useState<DatabaseRecord[]>([]);
  const [installedApps, setInstalledApps] = useState<AppRecord[]>([]);
  const [updatesSummary, setUpdatesSummary] = useState<UpdatesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [upgradingAppId, setUpgradingAppId] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showUpdatesModal, setShowUpdatesModal] = useState(false);
  const [updateFeedbackMessage, setUpdateFeedbackMessage] = useState<string | null>(null);

  // Install modal
  const [selectedTemplate, setSelectedTemplate] = useState<AppTemplate | null>(null);
  const [customName, setCustomName] = useState('');
  const [customPort, setCustomPort] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [selectedPostgresId, setSelectedPostgresId] = useState('');
  const [selectedRedisId, setSelectedRedisId] = useState('');

  // Post install modal
  const [installedAppModal, setInstalledAppModal] = useState<{ name: string; port: number; apiKey?: string; templateId: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const fetchAllData = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const [resTemplates, resDbs, resApps, resUpdates] = await Promise.allSettled([
        api.get('/templates'),
        api.get('/databases'),
        api.get('/apps'),
        api.get('/templates/updates'),
      ]);

      if (resTemplates.status === 'fulfilled') setTemplates(resTemplates.value.data);
      if (resDbs.status === 'fulfilled') setDatabases(resDbs.value.data);
      if (resApps.status === 'fulfilled') setInstalledApps(resApps.value.data);
      if (resUpdates.status === 'fulfilled') setUpdatesSummary(resUpdates.value.data);
    } catch (err) {
      console.error('Failed to fetch marketplace data:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  const handleCheckUpdates = async () => {
    try {
      setCheckingUpdates(true);
      setUpdateFeedbackMessage(null);
      const res = await api.get('/templates/updates');
      setUpdatesSummary(res.data);
      await fetchAllData(true);

      const availableCount = res.data?.updatesAvailable || 0;
      if (availableCount > 0) {
        setUpdateFeedbackMessage(`Foram encontradas ${availableCount} atualizações de provedores disponíveis!`);
      } else {
        setUpdateFeedbackMessage('Todos os provedores e aplicações estão na versão mais recente!');
      }
      setTimeout(() => setUpdateFeedbackMessage(null), 6000);
    } catch (err: any) {
      alert('Erro ao verificar atualizações: ' + (err.response?.data?.error || err.message));
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleUpgradeApp = async (appId: string) => {
    try {
      setUpgradingAppId(appId);
      await api.post('/templates/upgrade-app', { appId });
      await fetchAllData(true);
      alert('Aplicação atualizada com sucesso para a versão mais recente do provedor!');
    } catch (err: any) {
      alert('Erro ao atualizar aplicação: ' + (err.response?.data?.error || err.message));
    } finally {
      setUpgradingAppId(null);
    }
  };

  const getInstalledAppForTemplate = (template: AppTemplate): AppRecord | undefined => {
    const templateBase = template.image.split(':')[0].toLowerCase();
    return installedApps.find((app) => {
      const matchImage = app.imageName && app.imageName.toLowerCase().includes(templateBase);
      const matchName = app.name.toLowerCase().includes(template.id.toLowerCase());
      return matchImage || matchName;
    });
  };

  const generateApiKey = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let key = 'EVO_';
    for (let i = 0; i < 28; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setApiKey(key);
  };

  const openInstallModal = (t: AppTemplate) => {
    setSelectedTemplate(t);
    setCustomName(`${t.id}-app`);
    setCustomPort(t.defaultPort.toString());
    if (t.id.includes('evolution')) {
      generateApiKey();
      const pg = databases.find(d => d.type === 'postgres');
      if (pg) setSelectedPostgresId(pg.id);
      const red = databases.find(d => d.type === 'redis');
      if (red) setSelectedRedisId(red.id);
    }
  };

  const handleInstall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate) return;

    try {
      setInstallingId(selectedTemplate.id);
      await api.post('/templates/install', {
        templateId: selectedTemplate.id,
        customName: customName || undefined,
        customPort: customPort ? parseInt(customPort) : undefined,
        apiKey: apiKey || undefined,
        postgresDbId: selectedPostgresId || undefined,
        redisDbId: selectedRedisId || undefined,
      });

      const installedPort = customPort ? parseInt(customPort) : selectedTemplate.defaultPort;
      const appKey = apiKey;

      setSelectedTemplate(null);
      setInstalledAppModal({
        name: customName || selectedTemplate.name,
        port: installedPort,
        apiKey: appKey,
        templateId: selectedTemplate.id,
      });

      // Refresh installed apps list
      fetchAllData(true);
    } catch (err: any) {
      alert('Erro ao instalar template: ' + (err.response?.data?.error || err.message));
    } finally {
      setInstallingId(null);
    }
  };

  const implementedCount = templates.filter(t => getInstalledAppForTemplate(t) !== undefined).length;

  const categories = [
    { id: 'all', label: 'Todos os Apps', count: templates.length },
    { id: 'implemented', label: '✓ Implementados', count: implementedCount, highlight: true },
    { id: 'whatsapp', label: 'WhatsApp & Chatbots', count: templates.filter(t => t.category === 'whatsapp').length },
    { id: 'automation', label: 'Automação & IA', count: templates.filter(t => t.category === 'automation').length },
    { id: 'cms', label: 'CMS & Sites', count: templates.filter(t => t.category === 'cms').length },
    { id: 'monitoring', label: 'Monitoramento', count: templates.filter(t => t.category === 'monitoring').length },
    { id: 'database', label: 'Bancos & Backend', count: templates.filter(t => t.category === 'database').length },
    { id: 'tools', label: 'S3 & Ferramentas', count: templates.filter(t => t.category === 'tools').length },
  ];

  const filteredTemplates = templates.filter((t) => {
    const isImplemented = getInstalledAppForTemplate(t) !== undefined;
    let matchesCat = false;

    if (selectedCategory === 'all') {
      matchesCat = true;
    } else if (selectedCategory === 'implemented') {
      matchesCat = isImplemented;
    } else {
      matchesCat = t.category === selectedCategory;
    }

    const matchesSearch =
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase())) ||
      t.author.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesCat && matchesSearch;
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const postgresDbs = databases.filter(d => d.type === 'postgres');
  const redisDbs = databases.filter(d => d.type === 'redis');

  return (
    <div className="space-y-6">
      {/* Top Banner with Provider Updates Sync */}
      <div className="bg-gradient-to-r from-emerald-950/80 via-slate-900 to-indigo-950/70 rounded-xl p-6 lg:p-8 border border-emerald-500/30 relative overflow-hidden shadow-xl">
        {/* Glow effect */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-80 h-80 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-ok/15 text-ok border border-ok/30 text-xs font-semibold">
              <MessageSquare className="w-3.5 h-3.5 text-ok" />
              Catálogo Oficial de Provedores & Implantação 1-Clique
            </div>

            <h2 className="text-2xl lg:text-3xl font-extrabold text-white tracking-tight">
              Marketplace de Aplicações & Provedores
            </h2>

            <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
              Instale e gerencie <strong>Evolution API v2 do WhatsApp</strong>, <strong>n8n</strong>, <strong>Chatwoot</strong>, <strong>Typebot</strong>, <strong>Flowise AI</strong> e bancos de dados com logotipos oficiais, persistência de dados e controle de versão em tempo real.
            </p>

            {/* Implemented and Available Quick Stats */}
            <div className="flex flex-wrap items-center gap-3 pt-2 text-xs font-mono">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-surface-container/80 border border-outline-variant text-white">
                <CheckCircle2 className="w-3.5 h-3.5 text-ok" />
                <strong className="text-ok">{implementedCount}</strong> Implementados
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-surface-container/80 border border-outline-variant text-on-surface-variant">
                <Layers className="w-3.5 h-3.5 text-primary" />
                <strong className="text-white">{templates.length}</strong> Provedores Disponíveis
              </span>
              {updatesSummary && updatesSummary.updatesAvailable > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-warn/15 border border-warn/30 text-warn animate-pulse">
                  <ArrowUpCircle className="w-3.5 h-3.5 text-warn" />
                  <strong>{updatesSummary.updatesAvailable}</strong> Atualização(ões) Disponível(eis)
                </span>
              )}
            </div>
          </div>

          {/* Action Hub: Check Updates & Quick Installs */}
          <div className="flex flex-col sm:flex-row lg:flex-col gap-3 shrink-0">
            <button
              onClick={handleCheckUpdates}
              disabled={checkingUpdates}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-white border border-outline-variant font-semibold text-xs transition-all active:scale-95 disabled:opacity-50 shadow-md"
            >
              <RefreshCw className={`w-4 h-4 text-primary ${checkingUpdates ? 'animate-spin' : ''}`} />
              <span>{checkingUpdates ? 'Verificando Provedores...' : 'Checar Atualizações dos Provedores'}</span>
            </button>

            <button
              onClick={() => setShowUpdatesModal(true)}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary-container/40 hover:bg-primary-container/60 text-primary border border-primary/30 font-semibold text-xs transition-all active:scale-95"
            >
              <Sparkles className="w-4 h-4" />
              <span>Ver Status dos Provedores</span>
            </button>
          </div>
        </div>

        {/* Feedback Message */}
        {updateFeedbackMessage && (
          <div className="mt-4 p-3 rounded-lg bg-ok/20 border border-ok/40 text-ok text-xs font-semibold flex items-center justify-between animate-fadeIn">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-ok shrink-0" />
              <span>{updateFeedbackMessage}</span>
            </div>
            <button onClick={() => setUpdateFeedbackMessage(null)} className="text-ok hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Search and Categories Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-on-surface-variant absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar provedor (ex: Evolution, n8n, WhatsApp, IA, S3)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-surface-container border border-outline-variant rounded-lg pl-10 pr-4 py-2.5 text-xs text-white placeholder-on-surface-variant/50 focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 custom-scrollbar">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedCategory(c.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 border ${
                selectedCategory === c.id
                  ? c.id === 'implemented'
                    ? 'bg-ok/20 text-ok border-ok/50 ring-1 ring-ok/30'
                    : 'bg-primary-container text-white border-primary/50'
                  : c.id === 'implemented' && c.count > 0
                  ? 'bg-ok/10 text-ok hover:bg-ok/20 border-ok/30'
                  : 'bg-surface-container text-on-surface-variant hover:text-on-surface border-outline-variant'
              }`}
            >
              <span>{c.label}</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  selectedCategory === c.id
                    ? 'bg-white/20 text-white'
                    : 'bg-surface-container-high text-on-surface-variant/80'
                }`}
              >
                {c.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Templates Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-16 text-on-surface-variant space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin text-primary" />
          <p className="text-xs">Carregando catálogo de provedores e aplicações...</p>
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="bg-surface-container rounded-xl p-12 border border-outline-variant text-center space-y-3">
          <ShoppingBag className="w-10 h-10 text-outline mx-auto" />
          <h3 className="font-bold text-white text-base">Nenhum provedor encontrado</h3>
          <p className="text-xs text-on-surface-variant max-w-md mx-auto">
            {selectedCategory === 'implemented'
              ? 'Você ainda não possui nenhuma aplicação deste catálogo instalada. Escolha um template e faça a instalação em 1-clique.'
              : 'Tente buscar por outro termo ou selecione a categoria "Todos os Apps".'}
          </p>
          {selectedCategory === 'implemented' && (
            <button
              onClick={() => setSelectedCategory('all')}
              className="mt-2 px-4 py-2 bg-primary-container hover:bg-primary text-white rounded-lg text-xs font-semibold transition-all"
            >
              Ver Todos os Provedores Disponíveis
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredTemplates.map((template) => {
            const installedApp = getInstalledAppForTemplate(template);
            const isImplemented = Boolean(installedApp);
            const isRunning = installedApp?.status === 'running';

            const providerUpdate = updatesSummary?.providers.find(p => p.templateId === template.id);
            const hasUpdate = isImplemented && providerUpdate?.hasUpdate;

            return (
              <div
                key={template.id}
                className={`bg-surface-container rounded-xl p-6 border transition-all flex flex-col justify-between group relative overflow-hidden ${
                  isImplemented
                    ? 'border-emerald-500/50 hover:border-emerald-400 ring-1 ring-emerald-500/20 bg-surface-container/90 shadow-lg shadow-emerald-950/20'
                    : 'border-outline-variant hover:border-primary/40'
                }`}
              >
                {/* Top Accent Strip for Implemented Status */}
                {isImplemented && (
                  <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-600" />
                )}

                <div className="space-y-4">
                  {/* Top Row: Provider Official Vector Logo + Status Badge + Version */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {/* Authentic Brand SVG Logo */}
                      <ProviderLogo
                        id={template.id}
                        name={template.name}
                        iconUrl={template.iconUrl}
                        size="lg"
                        className="shadow-md"
                      />
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-mono font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/25">
                            {template.version}
                          </span>
                          <span className="text-[10px] text-on-surface-variant/80 font-mono">
                            by {template.author}
                          </span>
                        </div>
                        <h3 className="font-bold text-white text-base group-hover:text-primary transition-colors mt-0.5">
                          {template.name}
                        </h3>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-[11px] font-mono font-bold text-on-surface-variant bg-surface-container-lowest px-2 py-0.5 rounded border border-outline-variant">
                        Porta :{installedApp ? installedApp.port : template.defaultPort}
                      </span>
                      {template.releaseDate && (
                        <span className="text-[9px] text-on-surface-variant/60 font-mono">
                          Rel: {template.releaseDate}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Status Box: Implemented vs Available */}
                  {installedApp ? (
                    <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ok">
                          <span className="w-2 h-2 rounded-full bg-ok animate-pulse" />
                          Implementado no Servidor
                        </span>
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded uppercase font-bold ${
                            isRunning
                              ? 'bg-ok/20 text-ok border border-ok/30'
                              : 'bg-surface-container-high text-on-surface-variant'
                          }`}
                        >
                          {isRunning ? 'Em Execução' : 'Parado'}
                        </span>
                      </div>

                      <div className="text-[11px] text-on-surface-variant font-mono truncate flex items-center gap-1">
                        <span className="text-on-surface-variant/70">App:</span>
                        <strong className="text-white truncate">{installedApp.name}</strong>
                      </div>

                      {installedApp.domain && (
                        <div className="text-[11px] text-on-surface-variant font-mono truncate flex items-center gap-1">
                          <Globe className="w-3 h-3 text-primary" />
                          <span className="text-primary truncate">{installedApp.domain}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-surface-container-low/60 border border-outline-variant/60 rounded-lg p-2.5 flex items-center justify-between text-xs text-on-surface-variant">
                      <span className="flex items-center gap-1.5 text-[11px]">
                        <Sparkles className="w-3.5 h-3.5 text-primary" /> Pronto para Implantação
                      </span>
                      <span className="text-[10px] font-mono text-on-surface-variant/70">
                        1-Clique Docker
                      </span>
                    </div>
                  )}

                  {/* Description */}
                  <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-2">
                    {template.description}
                  </p>

                  {/* Feature bullets */}
                  <div className="space-y-1.5 pt-1">
                    {template.features.slice(0, 3).map((feat, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-[11px] text-on-surface-variant">
                        <Check className="w-3.5 h-3.5 text-ok shrink-0 mt-0.5" />
                        <span className="truncate">{feat}</span>
                      </div>
                    ))}
                  </div>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1.5 pt-2 border-t border-outline-variant">
                    {template.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] bg-surface-container-lowest text-on-surface-variant border border-outline-variant px-2 py-0.5 rounded font-mono"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Bottom Action Bar */}
                <div className="pt-4 mt-4 border-t border-outline-variant space-y-2">
                  {installedApp ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        {/* Primary Manage Button */}
                        <button
                          onClick={() => {
                            if (setActiveTab) setActiveTab('apps');
                          }}
                          className="flex-1 flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg bg-ok/90 hover:bg-ok text-white font-semibold text-xs transition-all active:scale-95 shadow-md shadow-emerald-950/40"
                        >
                          <Sliders className="w-4 h-4" />
                          <span>Gerenciar Aplicação</span>
                        </button>

                        {/* Direct Web Access button */}
                        <a
                          href={`http://${window.location.hostname}:${installedApp.port}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Abrir porta web no navegador"
                          className="p-2.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-ok hover:text-white border border-ok/30 transition-colors"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>

                        {template.docsUrl && (
                          <a
                            href={template.docsUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="Ver documentação oficial"
                            className="p-2.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant hover:text-white transition-colors"
                          >
                            <BookOpen className="w-4 h-4" />
                          </a>
                        )}
                      </div>

                      {/* Secondary Actions: Upgrade if available or install new instance */}
                      <div className="flex items-center justify-between text-[11px] pt-1">
                        {hasUpdate ? (
                          <button
                            onClick={() => handleUpgradeApp(installedApp.id)}
                            disabled={upgradingAppId === installedApp.id}
                            className="text-warn hover:underline flex items-center gap-1 font-semibold"
                          >
                            <ArrowUpCircle className="w-3.5 h-3.5 animate-bounce" />
                            <span>
                              {upgradingAppId === installedApp.id ? 'Atualizando...' : 'Atualização Disponível'}
                            </span>
                          </button>
                        ) : (
                          <span className="text-on-surface-variant/70 text-[10px] flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-ok" /> Versão Atualizada
                          </span>
                        )}

                        <button
                          onClick={() => openInstallModal(template)}
                          className="text-primary hover:underline font-medium text-[11px]"
                        >
                          + Nova Instância
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openInstallModal(template)}
                        disabled={installingId === template.id}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-xs transition-all active:scale-95 disabled:opacity-50 ${
                          template.id === 'evolution-api-v2'
                            ? 'bg-ok/90 hover:bg-ok text-white'
                            : 'bg-primary-container hover:bg-primary text-white'
                        }`}
                      >
                        <Download className={`w-4 h-4 ${installingId === template.id ? 'animate-bounce' : ''}`} />
                        <span>{installingId === template.id ? 'Criando Container...' : 'Configurar & Instalar'}</span>
                      </button>

                      {template.docsUrl && (
                        <a
                          href={template.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="Ver documentação oficial"
                          className="p-2.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant hover:text-white transition-colors"
                        >
                          <BookOpen className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Central de Atualizações de Provedores */}
      {showUpdatesModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-container rounded-xl border border-outline-variant w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh] shadow-2xl">
            <div className="p-5 border-b border-outline-variant flex items-center justify-between bg-surface-container-low">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 p-2 flex items-center justify-center text-primary">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Central de Versões & Atualizações dos Provedores</h3>
                  <p className="text-[11px] text-on-surface-variant">
                    Sincronização em tempo real com registros Docker e repositórios oficiais
                  </p>
                </div>
              </div>
              <button onClick={() => setShowUpdatesModal(false)} className="text-on-surface-variant hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar">
              <div className="flex items-center justify-between pb-3 border-b border-outline-variant text-xs">
                <span className="text-on-surface-variant">
                  Última checagem:{' '}
                  <strong className="text-white">
                    {updatesSummary?.checkedAt
                      ? new Date(updatesSummary.checkedAt).toLocaleTimeString('pt-BR')
                      : 'Agora'}
                  </strong>
                </span>
                <button
                  onClick={handleCheckUpdates}
                  disabled={checkingUpdates}
                  className="flex items-center gap-1.5 text-primary hover:underline font-semibold"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${checkingUpdates ? 'animate-spin' : ''}`} />
                  Reverificar Agora
                </button>
              </div>

              <div className="space-y-3">
                {templates.map((template) => {
                  const installed = getInstalledAppForTemplate(template);
                  const updateInfo = updatesSummary?.providers.find(p => p.templateId === template.id);

                  return (
                    <div
                      key={template.id}
                      className="bg-surface-container-low border border-outline-variant rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3">
                        <ProviderLogo
                          id={template.id}
                          name={template.name}
                          iconUrl={template.iconUrl}
                          size="md"
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-white text-sm">{template.name}</h4>
                            {installed ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-ok/15 text-ok border border-ok/30">
                                Implementado
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono text-on-surface-variant bg-surface-container-high">
                                Disponível
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-on-surface-variant mt-1 font-mono">
                            <span>Versão Oficial: <strong className="text-primary">{template.version}</strong></span>
                            {template.releaseDate && <span>Lançamento: {template.releaseDate}</span>}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {template.changelogUrl && (
                          <a
                            href={template.changelogUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-1.5 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant hover:text-white text-xs flex items-center gap-1"
                          >
                            <BookOpen className="w-3.5 h-3.5" /> Notas de Versão
                          </a>
                        )}

                        {installed && updateInfo?.hasUpdate && (
                          <button
                            onClick={() => handleUpgradeApp(installed.id)}
                            disabled={upgradingAppId === installed.id}
                            className="px-3.5 py-1.5 bg-warn/90 hover:bg-warn text-white rounded text-xs font-semibold flex items-center gap-1.5 transition-all"
                          >
                            <ArrowUpCircle className="w-4 h-4" />
                            {upgradingAppId === installed.id ? 'Atualizando...' : 'Atualizar Imagem'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-4 border-t border-outline-variant bg-surface-container-low flex justify-end">
              <button
                onClick={() => setShowUpdatesModal(false)}
                className="px-5 py-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-white text-xs font-semibold"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Configurar e Instalar Template */}
      {selectedTemplate && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-container rounded-xl border border-outline-variant w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] shadow-2xl">
            <div className="p-5 border-b border-outline-variant flex items-center justify-between bg-surface-container-low">
              <div className="flex items-center gap-3">
                <ProviderLogo
                  id={selectedTemplate.id}
                  name={selectedTemplate.name}
                  iconUrl={selectedTemplate.iconUrl}
                  size="md"
                />
                <div>
                  <h3 className="font-bold text-white text-base">Instalar {selectedTemplate.name}</h3>
                  <p className="text-[11px] text-on-surface-variant font-mono">{selectedTemplate.image}</p>
                </div>
              </div>
              <button onClick={() => setSelectedTemplate(null)} className="text-on-surface-variant hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleInstall} className="p-6 space-y-4 overflow-y-auto custom-scrollbar">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Identificador / Nome da Aplicação *
                </label>
                <input
                  type="text"
                  required
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Porta Host no Servidor *
                </label>
                <input
                  type="number"
                  required
                  value={customPort}
                  onChange={(e) => setCustomPort(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary font-mono"
                />
              </div>

              {/* Evolution API Specific Settings */}
              {selectedTemplate.id === 'evolution-api-v2' && (
                <div className="space-y-4 pt-2 border-t border-outline-variant">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-ok uppercase tracking-wider flex items-center gap-1.5">
                        <Key className="w-3.5 h-3.5" /> API Key Mestre da Evolution API
                      </label>
                      <button
                        type="button"
                        onClick={generateApiKey}
                        className="text-[11px] text-primary hover:underline font-medium"
                      >
                        Gerar Nova Chave
                      </button>
                    </div>
                    <input
                      type="text"
                      required
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="w-full bg-surface-container-lowest border border-emerald-500/40 rounded-lg px-3.5 py-2.5 text-ok text-xs font-mono focus:outline-none focus:border-ok select-all"
                    />
                    <p className="text-[10px] text-on-surface-variant mt-1">
                      Você usará esta chave no header <code className="text-ok">apikey: SUA_CHAVE</code> para autenticar chamadas de envio de WhatsApp.
                    </p>
                  </div>

                  {/* Link with PostgreSQL Database */}
                  <div>
                    <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-primary" /> Vincular Banco PostgreSQL (Recomendado)
                    </label>
                    <select
                      value={selectedPostgresId}
                      onChange={(e) => setSelectedPostgresId(e.target.value)}
                      className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-primary"
                    >
                      <option value="">Nenhum (Usar SQLite embutido local)</option>
                      {postgresDbs.map((db) => (
                        <option key={db.id} value={db.id}>
                          {db.name} (Porta :{db.port} - User: {db.dbUser})
                        </option>
                      ))}
                    </select>
                    {postgresDbs.length === 0 && (
                      <p className="text-[10px] text-warn mt-1">
                        💡 Dica: Crie um banco PostgreSQL na aba "Bancos de Dados" para salvar conversas com máxima performance.
                      </p>
                    )}
                  </div>

                  {/* Link with Redis Cache */}
                  <div>
                    <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-warn" /> Vincular Cache Redis (Opcional)
                    </label>
                    <select
                      value={selectedRedisId}
                      onChange={(e) => setSelectedRedisId(e.target.value)}
                      className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-primary"
                    >
                      <option value="">Nenhum (Sem cache Redis)</option>
                      {redisDbs.map((db) => (
                        <option key={db.id} value={db.id}>
                          {db.name} (Porta :{db.port})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-outline-variant">
                <button
                  type="button"
                  onClick={() => setSelectedTemplate(null)}
                  className="px-4 py-2.5 text-on-surface-variant hover:text-white text-xs font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={installingId === selectedTemplate.id}
                  className="px-5 py-2.5 bg-ok/90 hover:bg-ok text-white rounded-lg text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
                >
                  {installingId === selectedTemplate.id ? 'Criando Container...' : 'Confirmar & Instalar Agora'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Sucesso Pós-Instalação com Guia Rápido */}
      {installedAppModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-container rounded-xl border border-emerald-500/40 w-full max-w-lg overflow-hidden p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-ok font-bold text-base">
                <Check className="w-5 h-5" />
                <span>Aplicação Instalada com Sucesso!</span>
              </div>
              <button onClick={() => setInstalledAppModal(null)} className="text-on-surface-variant hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-on-surface-variant">
              O contêiner de <strong>{installedAppModal.name}</strong> foi criado e já está rodando na porta <strong>:{installedAppModal.port}</strong>.
            </p>

            {/* Quick Links & Keys */}
            <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant space-y-3 text-xs font-mono">
              <div>
                <span className="text-on-surface-variant/70 block text-[10px]">ENDEREÇO DE ACESSO</span>
                <span className="text-ok flex items-center gap-1 font-bold">
                  http://{window.location.hostname}:{installedAppModal.port}
                </span>
                <span className="text-[10px] text-on-surface-variant/70 block mt-1">
                  Porta protegida no servidor. Vincule um domínio em Aplicações para acesso externo HTTPS.
                </span>
              </div>

              {installedAppModal.templateId === 'evolution-api-v2' && (
                <>
                  <div>
                    <span className="text-on-surface-variant/70 block text-[10px]">DOCUMENTAÇÃO SWAGGER EM TEMPO REAL</span>
                    <span className="text-primary flex items-center gap-1">
                      http://{window.location.hostname}:{installedAppModal.port}/docs
                    </span>
                  </div>

                  {installedAppModal.apiKey && (
                    <div>
                      <div className="flex justify-between items-center text-[10px] text-on-surface-variant/70 mb-1">
                        <span>API KEY MESTRE (AUTENTICAÇÃO)</span>
                        <button
                          onClick={() => copyToClipboard(installedAppModal.apiKey || '')}
                          className="text-ok hover:underline flex items-center gap-1"
                        >
                          {copiedKey ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copiedKey ? 'Copiada!' : 'Copiar'}
                        </button>
                      </div>
                      <div className="p-2.5 bg-surface-container-low rounded-lg text-ok text-xs font-mono truncate select-all">
                        {installedAppModal.apiKey}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setInstalledAppModal(null);
                  if (setActiveTab) setActiveTab('apps');
                }}
                className="px-5 py-2.5 bg-primary-container hover:bg-primary text-white rounded-lg text-xs font-semibold transition-all active:scale-95"
              >
                Ir para Aplicações & Logs
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
