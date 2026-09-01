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
  Server
} from 'lucide-react';
import { api } from '../services/api.js';
import { DatabaseRecord } from '../types/index.js';
import { NavTab } from '../components/Sidebar.js';

export interface AppTemplate {
  id: string;
  name: string;
  category: 'whatsapp' | 'automation' | 'database' | 'cms' | 'monitoring' | 'tools';
  description: string;
  iconUrl: string;
  defaultPort: number;
  image: string;
  version: string;
  author: string;
  env: Record<string, string>;
  features: string[];
  tags: string[];
  docsUrl?: string;
}

interface TemplatesPageProps {
  setActiveTab?: (tab: NavTab) => void;
}

export const TemplatesPage: React.FC<TemplatesPageProps> = ({ setActiveTab }) => {
  const [templates, setTemplates] = useState<AppTemplate[]>([]);
  const [databases, setDatabases] = useState<DatabaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Install modal
  const [selectedTemplate, setSelectedTemplate] = useState<AppTemplate | null>(null);
  const [customName, setCustomName] = useState('');
  const [customPort, setCustomPort] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [selectedPostgresId, setSelectedPostgresId] = useState('');
  const [selectedRedisId, setSelectedRedisId] = useState('');

  // Post install modal
  const [installedApp, setInstalledApp] = useState<{ name: string; port: number; apiKey?: string; templateId: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const fetchTemplatesAndDbs = async () => {
    try {
      setLoading(true);
      const [resTemplates, resDbs] = await Promise.all([
        api.get('/templates'),
        api.get('/databases'),
      ]);
      setTemplates(resTemplates.data);
      setDatabases(resDbs.data);
    } catch (err) {
      console.error('Failed to fetch templates or databases:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplatesAndDbs();
  }, []);

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
      const res = await api.post('/templates/install', {
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
      setInstalledApp({
        name: customName || selectedTemplate.name,
        port: installedPort,
        apiKey: appKey,
        templateId: selectedTemplate.id,
      });
    } catch (err: any) {
      alert('Erro ao instalar template: ' + (err.response?.data?.error || err.message));
    } finally {
      setInstallingId(null);
    }
  };

  const categories = [
    { id: 'all', label: 'Todos os Apps', count: templates.length },
    { id: 'whatsapp', label: 'WhatsApp & Chatbots', count: templates.filter(t => t.category === 'whatsapp').length },
    { id: 'automation', label: 'Automação & IA', count: templates.filter(t => t.category === 'automation').length },
    { id: 'cms', label: 'CMS & Sites', count: templates.filter(t => t.category === 'cms').length },
    { id: 'monitoring', label: 'Monitoramento', count: templates.filter(t => t.category === 'monitoring').length },
    { id: 'database', label: 'Bancos & Backend', count: templates.filter(t => t.category === 'database').length },
    { id: 'tools', label: 'Armazenamento S3', count: templates.filter(t => t.category === 'tools').length },
  ];

  const filteredTemplates = templates.filter((t) => {
    const matchesCat = selectedCategory === 'all' || t.category === selectedCategory;
    const matchesSearch =
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
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
      {/* Hero WhatsApp Evolution Banner */}
      <div className="bg-gradient-to-r from-emerald-950/70 via-indigo-950/50 to-slate-900 rounded-lg p-6 lg:p-8 border border-ok/30 relative overflow-hidden">
        <div className="relative z-10 max-w-2xl space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-ok/15 text-ok border border-ok/30 text-xs font-semibold">
            <MessageSquare className="w-3.5 h-3.5 text-ok" />
            Stack Oficial de WhatsApp & Automações
          </div>

          <h2 className="text-2xl lg:text-3xl font-extrabold text-white tracking-tight">
            Marketplace de Aplicações 1-Clique
          </h2>

          <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
            Instale a <strong>Evolution API v2 do WhatsApp</strong>, <strong>n8n</strong>, <strong>Chatwoot</strong>, <strong>Typebot</strong> e <strong>WordPress</strong> no seu servidor em segundos, com persistência total e banco de dados integrado.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={() => {
                const evo = templates.find(t => t.id === 'evolution-api-v2');
                if (evo) openInstallModal(evo);
              }}
              className="flex items-center gap-2 px-5 py-2.5 rounded bg-ok/90 hover:bg-ok text-white font-semibold text-xs transition-all active:scale-95"
            >
              <Zap className="w-4 h-4" /> Instalar WhatsApp Evolution API
            </button>

            <button
              onClick={() => {
                const n8nApp = templates.find(t => t.id === 'n8n');
                if (n8nApp) openInstallModal(n8nApp);
              }}
              className="flex items-center gap-2 px-4 py-2.5 rounded bg-primary-container/30 hover:bg-primary-container/40 text-primary border border-primary/30 font-semibold text-xs transition-all"
            >
              <Bot className="w-4 h-4 text-primary" /> Instalar n8n IA
            </button>
          </div>
        </div>
      </div>

      {/* Search and Categories Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-on-surface-variant absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por nome, tag (ex: WhatsApp, IA, CMS, S3)..."
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
              className={`px-3 py-1.5 rounded text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                selectedCategory === c.id
                  ? 'bg-primary-container text-white'
                  : 'bg-surface-container-low/90 text-on-surface-variant hover:text-on-surface border border-outline-variant'
              }`}
            >
              <span>{c.label}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${selectedCategory === c.id ? 'bg-white/20 text-white' : 'bg-surface-container-high text-on-surface-variant/70'}`}>
                {c.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Templates Grid */}
      {loading ? (
        <div className="flex items-center justify-center p-16 text-on-surface-variant">
          <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="bg-surface-container rounded-lg p-12 border border-outline-variant text-center">
          <ShoppingBag className="w-8 h-8 text-outline mx-auto mb-3" />
          <h3 className="font-bold text-white text-base">Nenhum aplicativo encontrado</h3>
          <p className="text-xs text-on-surface-variant mt-1">Tente buscar por outro termo ou selecione a categoria "Todos os Apps".</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredTemplates.map((template) => (
            <div
              key={template.id}
              className={`bg-surface-container rounded-lg p-6 border transition-all flex flex-col justify-between group ${
                template.id === 'evolution-api-v2'
                  ? 'border-emerald-500/40 hover:border-emerald-500 ring-1 ring-emerald-500/20'
                  : 'border-outline-variant hover:border-primary/40'
              }`}
            >
              <div className="space-y-4">
                {/* Top Row: Icon + Version + Port */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-surface-container-low border border-outline-variant p-2 flex items-center justify-center">
                      <img
                        src={template.iconUrl}
                        alt={template.name}
                        className="w-full h-full object-contain rounded"
                        onError={(e: any) => {
                          e.target.style.display = 'none';
                        }}
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/25">
                          {template.version}
                        </span>
                        <span className="text-[10px] text-on-surface-variant/70 font-mono">by {template.author}</span>
                      </div>
                      <h3 className="font-bold text-white text-base group-hover:text-primary transition-colors mt-0.5">
                        {template.name}
                      </h3>
                    </div>
                  </div>

                  <span className="text-[11px] font-mono font-bold text-on-surface-variant bg-surface-container-lowest px-2 py-1 rounded border border-outline-variant shrink-0">
                    Porta :{template.defaultPort}
                  </span>
                </div>

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
                      className="text-[10px] bg-surface-container-lowest text-on-surface-variant border border-outline-variant px-2 py-0.5 rounded-lg font-mono"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Install Button & Docs */}
              <div className="pt-4 mt-4 border-t border-outline-variant flex items-center gap-2">
                <button
                  onClick={() => openInstallModal(template)}
                  disabled={installingId === template.id}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded font-semibold text-xs transition-all active:scale-95 disabled:opacity-50 ${
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
                    className="p-2.5 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant hover:text-white transition-colors"
                  >
                    <BookOpen className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Configurar e Instalar Template */}
      {selectedTemplate && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-container rounded-lg border border-outline-variant w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-outline-variant flex items-center justify-between bg-surface-container-low">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 p-2 flex items-center justify-center">
                  <img
                    src={selectedTemplate.iconUrl}
                    alt={selectedTemplate.name}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Instalar {selectedTemplate.name}</h3>
                  <p className="text-[11px] text-on-surface-variant">{selectedTemplate.image}</p>
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
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary"
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
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary font-mono"
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
                        className="text-[11px] text-primary hover:underline"
                      >
                        Gerar Nova Chave
                      </button>
                    </div>
                    <input
                      type="text"
                      required
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="w-full bg-surface-container-lowest border border-emerald-500/40 rounded px-3.5 py-2.5 text-ok text-xs font-mono focus:outline-none focus:border-ok select-all"
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
                      className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-primary"
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
                      className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-primary"
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
                  className="px-5 py-2.5 bg-ok/90 hover:bg-ok text-white rounded text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
                >
                  {installingId === selectedTemplate.id ? 'Criando Container...' : 'Confirmar & Instalar Agora'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Sucesso Pós-Instalação com Guia Rápido */}
      {installedApp && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-container rounded-lg border border-emerald-500/40 w-full max-w-lg overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-ok font-bold text-base">
                <Check className="w-5 h-5" />
                <span>Aplicação Instalada com Sucesso!</span>
              </div>
              <button onClick={() => setInstalledApp(null)} className="text-on-surface-variant hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-on-surface-variant">
              O contêiner de <strong>{installedApp.name}</strong> foi criado e já está rodando na porta <strong>:{installedApp.port}</strong>.
            </p>

            {/* Quick Links & Keys */}
            <div className="bg-surface-container-lowest p-4 rounded-lg border border-outline-variant space-y-3 text-xs font-mono">
              <div>
                <span className="text-on-surface-variant/70 block text-[10px]">ENDEREÇO DE ACESSO</span>
                <span className="text-ok flex items-center gap-1 font-bold">
                  http://127.0.0.1:{installedApp.port}
                </span>
                <span className="text-[10px] text-on-surface-variant/70 block mt-1">
                  Porta protegida no servidor. Vincule um domínio em Aplicações para acesso externo.
                </span>
              </div>

              {installedApp.templateId === 'evolution-api-v2' && (
                <>
                  <div>
                    <span className="text-on-surface-variant/70 block text-[10px]">DOCUMENTAÇÃO SWAGGER EM TEMPO REAL</span>
                    <span className="text-primary flex items-center gap-1">
                      http://127.0.0.1:{installedApp.port}/docs
                    </span>
                  </div>

                  {installedApp.apiKey && (
                    <div>
                      <div className="flex justify-between items-center text-[10px] text-on-surface-variant/70 mb-1">
                        <span>API KEY MESTRE (AUTENTICAÇÃO)</span>
                        <button
                          onClick={() => copyToClipboard(installedApp.apiKey || '')}
                          className="text-ok hover:underline flex items-center gap-1"
                        >
                          {copiedKey ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copiedKey ? 'Copiada!' : 'Copiar'}
                        </button>
                      </div>
                      <div className="p-2 bg-surface-container-low rounded-lg text-ok text-xs font-mono truncate select-all">
                        {installedApp.apiKey}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setInstalledApp(null);
                  if (setActiveTab) setActiveTab('apps');
                }}
                className="px-5 py-2.5 bg-primary-container hover:bg-primary text-white rounded text-xs font-semibold transition-all active:scale-95"
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
