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
  X
} from 'lucide-react';
import { api } from '../services/api.js';
import { NavTab } from '../components/Sidebar.js';

export interface AppTemplate {
  id: string;
  name: string;
  category: 'automation' | 'database' | 'cms' | 'monitoring' | 'tools';
  description: string;
  iconUrl: string;
  defaultPort: number;
  image: string;
  env: Record<string, string>;
  tags: string[];
}

interface TemplatesPageProps {
  setActiveTab?: (tab: NavTab) => void;
}

export const TemplatesPage: React.FC<TemplatesPageProps> = ({ setActiveTab }) => {
  const [templates, setTemplates] = useState<AppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedTemplate, setSelectedTemplate] = useState<AppTemplate | null>(null);
  const [customName, setCustomName] = useState('');
  const [customPort, setCustomPort] = useState('');

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const res = await api.get('/templates');
      setTemplates(res.data);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const openInstallModal = (t: AppTemplate) => {
    setSelectedTemplate(t);
    setCustomName(`${t.id}-app`);
    setCustomPort(t.defaultPort.toString());
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
      });

      setSelectedTemplate(null);
      alert(`🎉 Aplicação "${selectedTemplate.name}" instalada com sucesso na porta :${customPort}!`);
      if (setActiveTab) {
        setActiveTab('apps');
      }
    } catch (err: any) {
      alert('Erro ao instalar template: ' + (err.response?.data?.error || err.message));
    } finally {
      setInstallingId(null);
    }
  };

  const categories = [
    { id: 'all', label: 'Todas as Aplicações' },
    { id: 'automation', label: 'Automação & IA (WhatsApp/n8n)' },
    { id: 'cms', label: 'CMS & Sites (WordPress)' },
    { id: 'monitoring', label: 'Monitoramento (Uptime Kuma)' },
    { id: 'database', label: 'Bancos & Backend (PocketBase)' },
    { id: 'tools', label: 'Armazenamento (MinIO S3)' },
  ];

  const filteredTemplates = templates.filter((t) => {
    if (selectedCategory === 'all') return true;
    return t.category === selectedCategory;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <ShoppingBag className="w-6 h-6 text-indigo-400" />
            Marketplace de Aplicações 1-Clique
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Instale ferramentas de automação WhatsApp (Evolution API, Typebot), n8n, WordPress, Uptime Kuma e S3 em 1 clique na sua VPS.
          </p>
        </div>
      </div>

      {/* Category Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedCategory(c.id)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              selectedCategory === c.id
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Templates Grid */}
      {loading ? (
        <div className="flex items-center justify-center p-12 text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredTemplates.map((template) => (
            <div
              key={template.id}
              className="bg-[#0f172a]/80 rounded-2xl p-5 border border-slate-800 hover:border-indigo-500/50 transition-all flex flex-col justify-between group shadow-lg"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 p-2.5 flex items-center justify-center">
                    <img
                      src={template.iconUrl}
                      alt={template.name}
                      className="w-full h-full object-contain rounded"
                      onError={(e: any) => {
                        e.target.style.display = 'none';
                        e.target.parentElement.innerHTML = '🚀';
                      }}
                    />
                  </div>

                  <span className="text-[11px] font-mono font-bold text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                    Porta :{template.defaultPort}
                  </span>
                </div>

                <div>
                  <h3 className="font-bold text-white text-base group-hover:text-indigo-400 transition-colors">
                    {template.name}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                    {template.description}
                  </p>
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {template.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] bg-slate-900/90 text-indigo-300 border border-slate-800 px-2 py-0.5 rounded-md font-mono"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Install Button */}
              <div className="pt-4 mt-4 border-t border-slate-800/80">
                <button
                  onClick={() => openInstallModal(template)}
                  disabled={installingId === template.id}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30 transition-all active:scale-95 disabled:opacity-50"
                >
                  <Download className={`w-4 h-4 ${installingId === template.id ? 'animate-bounce' : ''}`} />
                  <span>{installingId === template.id ? 'Instalando na VPS...' : 'Instalar em 1-Clique'}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Instalar Template */}
      {selectedTemplate && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-2xl border border-slate-800 w-full max-w-md overflow-hidden shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 p-2 flex items-center justify-center">
                  <img
                    src={selectedTemplate.iconUrl}
                    alt={selectedTemplate.name}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Instalar {selectedTemplate.name}</h3>
                  <p className="text-[11px] text-slate-400">Deploy automático com contêiner isolado</p>
                </div>
              </div>
              <button onClick={() => setSelectedTemplate(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleInstall} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                  Identificador / Nome do App *
                </label>
                <input
                  type="text"
                  required
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                  Porta Host no Servidor *
                </label>
                <input
                  type="number"
                  required
                  value={customPort}
                  onChange={(e) => setCustomPort(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs font-mono text-slate-400 space-y-1">
                <div>Imagem: <span className="text-emerald-400">{selectedTemplate.image}</span></div>
                <div>Porta Interna: <span className="text-indigo-400">:{selectedTemplate.defaultPort}</span></div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedTemplate(null)}
                  className="px-4 py-2 text-slate-400 hover:text-white text-xs font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={installingId === selectedTemplate.id}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all active:scale-95 disabled:opacity-50"
                >
                  {installingId === selectedTemplate.id ? 'Criando Container...' : 'Confirmar & Instalar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
