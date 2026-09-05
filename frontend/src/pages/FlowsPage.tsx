import React, { useEffect, useState } from 'react';
import {
  MessageCircle,
  Plus,
  Trash2,
  Copy,
  Sparkles,
  Search,
  Bot,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Layers,
  X,
  Radio,
  ArrowRight,
} from 'lucide-react';
import { api } from '../services/api.js';
import type { WaFlowRecord, WaFlowTemplate } from '../types/index.js';
import { FlowEditor } from '../components/flows/FlowEditor.js';
import { BLOCK_META } from '../components/flows/flow-blocks.js';

function starterGraph() {
  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger_message' as const,
        position: { x: 80, y: 40 },
        data: { match: 'any' as const, keyword: 'oi' },
      },
      {
        id: 'text-1',
        type: 'send_text' as const,
        position: { x: 80, y: 180 },
        data: { text: 'Olá {{nome}}! Como posso ajudar?' },
      },
      {
        id: 'end-1',
        type: 'end' as const,
        position: { x: 80, y: 320 },
        data: {},
      },
    ],
    edges: [
      { id: 'e1', source: 'trigger-1', target: 'text-1' },
      { id: 'e2', source: 'text-1', target: 'end-1' },
    ],
  };
}

function triggerLabel(flow: WaFlowRecord): string {
  const trigger = flow.nodes.find((n) => n.type === 'trigger_message' || n.type === 'trigger_event');
  if (!trigger) return 'Sem gatilho';
  const meta = BLOCK_META[trigger.type];
  return meta ? meta.preview(trigger.data as any) : 'Gatilho configurado';
}

function hasAiNode(flow: WaFlowRecord): boolean {
  return flow.nodes.some((n) => n.type === 'agent');
}

interface FlowsPageProps {
  flowId?: string | null;
  onOpen: (id?: string) => void;
}

export const FlowsPage: React.FC<FlowsPageProps> = ({ flowId, onOpen }) => {
  const [flows, setFlows] = useState<WaFlowRecord[]>([]);
  const [templates, setTemplates] = useState<WaFlowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInstance, setSelectedInstance] = useState<string>('all');
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);

  const load = async () => {
    try {
      const [resFlows, resTemplates] = await Promise.allSettled([
        api.get('/wa-flows'),
        api.get('/wa-flows/templates'),
      ]);
      if (resFlows.status === 'fulfilled') {
        setFlows(Array.isArray(resFlows.value.data) ? resFlows.value.data : []);
      }
      if (resTemplates.status === 'fulfilled') {
        setTemplates(Array.isArray(resTemplates.value.data) ? resTemplates.value.data : []);
      }
    } catch (err) {
      console.error('Failed to load WhatsApp flows:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createBlankFlow = async () => {
    setCreating(true);
    try {
      const res = await api.post('/wa-flows', { name: 'Novo fluxo', ...starterGraph() });
      onOpen(res.data.id);
    } catch (err: any) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setCreating(false);
    }
  };

  const createFromTemplate = async (tmpl: WaFlowTemplate) => {
    setCreating(true);
    try {
      const res = await api.post('/wa-flows', {
        name: tmpl.name,
        nodes: tmpl.nodes,
        edges: tmpl.edges,
      });
      setShowTemplatesModal(false);
      onOpen(res.data.id);
    } catch (err: any) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setCreating(false);
    }
  };

  const cloneFlow = async (flow: WaFlowRecord) => {
    try {
      setCloningId(flow.id);
      const res = await api.post(`/wa-flows/${flow.id}/clone`);
      await load();
      if (res.data?.id) {
        onOpen(res.data.id);
      }
    } catch (err: any) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setCloningId(null);
    }
  };

  const removeFlow = async (id: string, name: string) => {
    if (!confirm(`Excluir permanentemente o fluxo "${name}"?`)) return;
    try {
      await api.delete(`/wa-flows/${id}`, { data: {} });
      if (flowId === id) onOpen();
      await load();
    } catch (err: any) {
      alert(err.response?.data?.error || err.message);
    }
  };

  if (flowId) {
    return <FlowEditor flowId={flowId} onBack={() => onOpen()} />;
  }

  // Extract all distinct instances configured in flows
  const allInstances = Array.from(
    new Set(flows.flatMap((f) => f.instanceNames || []))
  ).filter(Boolean);

  const filteredFlows = flows.filter((f) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = f.name.toLowerCase().includes(q);
      const matchTrigger = triggerLabel(f).toLowerCase().includes(q);
      const matchInstance = (f.instanceNames || []).some((i) => i.toLowerCase().includes(q));
      if (!matchName && !matchTrigger && !matchInstance) return false;
    }
    if (selectedInstance !== 'all') {
      if (selectedInstance === '__global__') {
        if ((f.instanceNames || []).length > 0) return false;
      } else {
        if (!(f.instanceNames || []).includes(selectedInstance)) return false;
      }
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-ok/10 text-ok border border-ok/20">
              <MessageCircle className="w-5 h-5" />
            </div>
            Fluxos WhatsApp Pro
          </h2>
          <p className="text-sm text-on-surface-variant mt-1">
            Automação conversacional multi-instância, IA e eventos de infraestrutura no mesmo canvas.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {templates.length > 0 && (
            <button
              type="button"
              onClick={() => setShowTemplatesModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              Modelos prontos
            </button>
          )}

          <button
            type="button"
            onClick={() => void createBlankFlow()}
            disabled={creating}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Novo fluxo
          </button>
        </div>
      </div>

      {/* Filter and Search Bar (if flows exist) */}
      {flows.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-surface-container-low border border-outline-variant rounded-lg p-3">
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-on-surface-variant absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por nome, gatilho ou instância..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-surface-container border border-outline-variant rounded-md pl-9 pr-3 py-1.5 text-xs text-white placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0 text-xs">
            <span className="text-on-surface-variant text-[11px] font-medium shrink-0">Instância:</span>
            <button
              type="button"
              onClick={() => setSelectedInstance('all')}
              className={`px-2.5 py-1 rounded text-xs font-medium shrink-0 transition-colors ${
                selectedInstance === 'all'
                  ? 'bg-primary/20 text-primary border border-primary/40'
                  : 'bg-surface-container text-on-surface-variant hover:text-white border border-outline-variant'
              }`}
            >
              Todas ({flows.length})
            </button>
            {allInstances.map((inst) => {
              const count = flows.filter((f) => (f.instanceNames || []).includes(inst)).length;
              return (
                <button
                  key={inst}
                  type="button"
                  onClick={() => setSelectedInstance(inst)}
                  className={`px-2.5 py-1 rounded text-xs font-mono shrink-0 transition-colors flex items-center gap-1.5 ${
                    selectedInstance === inst
                      ? 'bg-ok/20 text-ok border border-ok/40'
                      : 'bg-surface-container text-on-surface-variant hover:text-white border border-outline-variant'
                  }`}
                >
                  <Radio className="w-3 h-3 text-ok" />
                  {inst} ({count})
                </button>
              );
            })}
            {flows.some((f) => (f.instanceNames || []).length === 0) && (
              <button
                type="button"
                onClick={() => setSelectedInstance('__global__')}
                className={`px-2.5 py-1 rounded text-xs font-medium shrink-0 transition-colors ${
                  selectedInstance === '__global__'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-surface-container text-on-surface-variant hover:text-white border border-outline-variant'
                }`}
              >
                Global (sem vínculo)
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="p-12 text-center text-sm text-on-surface-variant">Carregando fluxos…</div>
      ) : flows.length === 0 ? (
        /* Empty State with Template Cards */
        <div className="space-y-6">
          <div className="bg-surface-container border border-outline-variant rounded-xl p-8 text-center max-w-xl mx-auto">
            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center mx-auto mb-3">
              <MessageCircle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white">Nenhum fluxo criado ainda</h3>
            <p className="text-xs text-on-surface-variant mt-1.5 leading-relaxed">
              Crie um fluxo conversacional para sua operação. Você pode começar do zero ou escolher um
              dos modelos profissionais prontos abaixo.
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => void createBlankFlow()}
                disabled={creating}
                className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                Criar fluxo em branco
              </button>
            </div>
          </div>

          {/* Quick Start Templates */}
          {templates.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <h4 className="text-sm font-bold text-white">Comece com um modelo pronto</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {templates.map((tmpl) => (
                  <div
                    key={tmpl.id}
                    className="bg-surface-container border border-outline-variant hover:border-primary/40 rounded-xl p-4 transition-all flex flex-col justify-between group"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-white group-hover:text-primary transition-colors">
                          {tmpl.name}
                        </span>
                        <span
                          className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded border ${
                            tmpl.category === 'vendas'
                              ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                              : tmpl.category === 'alerta'
                              ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
                              : 'text-sky-400 border-sky-500/30 bg-sky-500/10'
                          }`}
                        >
                          {tmpl.category}
                        </span>
                      </div>
                      <p className="text-xs text-on-surface-variant mt-1.5 line-clamp-2">
                        {tmpl.description}
                      </p>
                      <div className="mt-3 flex items-center gap-2 text-[11px] text-on-surface-variant/70">
                        <Layers className="w-3.5 h-3.5 text-on-surface-variant" />
                        <span>{tmpl.nodes.length} blocos pré-configurados</span>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-outline-variant flex justify-end">
                      <button
                        type="button"
                        onClick={() => void createFromTemplate(tmpl)}
                        disabled={creating}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 text-xs font-semibold transition-colors"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Usar este modelo
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : filteredFlows.length === 0 ? (
        <div className="p-8 text-center text-on-surface-variant text-xs bg-surface-container border border-outline-variant rounded-lg">
          Nenhum fluxo corresponde aos filtros aplicados.
        </div>
      ) : (
        /* Flow Cards Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredFlows.map((flow) => {
            const hasAi = hasAiNode(flow);
            const runsToday = flow.stats?.runsToday || 0;
            const errorsToday = flow.stats?.errorsToday || 0;
            const tokensToday = flow.stats?.aiTokensToday || 0;

            return (
              <div
                key={flow.id}
                onClick={() => onOpen(flow.id)}
                className="bg-surface-container hover:bg-surface-container-high/60 border border-outline-variant hover:border-primary/40 rounded-xl p-5 cursor-pointer transition-all flex flex-col justify-between space-y-4 group shadow-sm"
              >
                {/* Header: Title and Status */}
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 pr-2">
                      <h3 className="text-white font-bold text-sm group-hover:text-primary transition-colors flex items-center gap-2">
                        {flow.name}
                        {hasAi && (
                          <span title="Utiliza Agente de IA" className="text-primary">
                            <Bot className="w-3.5 h-3.5" />
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-on-surface-variant line-clamp-1">
                        {triggerLabel(flow)}
                      </p>
                    </div>

                    <span
                      className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded border shrink-0 ${
                        flow.published
                          ? 'text-ok border-ok/30 bg-ok/10'
                          : 'text-on-surface-variant border-outline-variant bg-surface-container-low'
                      }`}
                    >
                      {flow.published ? 'Ativo' : 'Rascunho'}
                    </span>
                  </div>

                  {/* Bound Instances Badges */}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {(flow.instanceNames || []).length > 0 ? (
                      flow.instanceNames.map((inst) => (
                        <span
                          key={inst}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-ok/10 text-ok border border-ok/20 font-mono text-[10px]"
                          title={`Instância vinculada: ${inst}`}
                        >
                          <Radio className="w-2.5 h-2.5" />
                          {inst}
                        </span>
                      ))
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[10px]"
                        title="Atende mensagens de qualquer instância conectada"
                      >
                        Global (todas as instâncias)
                      </span>
                    )}

                    {flow.priority && flow.priority > 0 ? (
                      <span className="px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant text-[10px] font-mono">
                        P{flow.priority}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Metrics Row */}
                <div className="grid grid-cols-3 gap-2 py-2 px-3 bg-surface-container-low/70 rounded-lg border border-outline-variant/60 text-center">
                  <div>
                    <span className="block text-[10px] text-on-surface-variant">Hoje</span>
                    <span className="text-xs font-mono font-bold text-white">{runsToday}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-on-surface-variant">Erros</span>
                    <span
                      className={`text-xs font-mono font-bold ${
                        errorsToday > 0 ? 'text-crit' : 'text-on-surface-variant'
                      }`}
                    >
                      {errorsToday}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-on-surface-variant">Tokens IA</span>
                    <span className="text-xs font-mono font-bold text-white">
                      {tokensToday > 1000 ? `${(tokensToday / 1000).toFixed(1)}k` : tokensToday}
                    </span>
                  </div>
                </div>

                {/* Footer: Last run + Action buttons */}
                <div className="pt-2 border-t border-outline-variant flex items-center justify-between text-xs">
                  <span className="text-[11px] text-on-surface-variant/80 font-mono truncate max-w-[160px]">
                    {flow.lastRunAt
                      ? new Date(flow.lastRunAt).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                          day: '2-digit',
                          month: '2-digit',
                        })
                      : 'Sem execuções'}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Clonar este fluxo"
                      disabled={cloningId === flow.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void cloneFlow(flow);
                      }}
                      className="p-1.5 text-on-surface-variant hover:text-white hover:bg-surface-container-high rounded transition-colors disabled:opacity-50"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      title="Excluir fluxo"
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeFlow(flow.id, flow.name);
                      }}
                      className="p-1.5 text-crit/80 hover:text-crit hover:bg-crit/10 rounded transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpen(flow.id)}
                      className="ml-1 px-2.5 py-1 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded text-[11px] font-semibold flex items-center gap-1 transition-colors"
                    >
                      <span>Abrir</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Templates Modal */}
      {showTemplatesModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-surface-container border border-outline-variant rounded-xl max-w-2xl w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <h3 className="text-base font-bold text-white">Modelos Prontos de WhatsApp</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowTemplatesModal(false)}
                className="text-on-surface-variant hover:text-white p-1 rounded hover:bg-surface-container-high"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-on-surface-variant">
              Selecione um modelo testado para acelerar a criação do seu fluxo conversacional.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto pr-1">
              {templates.map((tmpl) => (
                <div
                  key={tmpl.id}
                  className="bg-surface-container-low border border-outline-variant rounded-lg p-4 flex flex-col justify-between hover:border-primary/40 transition-colors"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-white">{tmpl.name}</span>
                      <span
                        className={`text-[9px] uppercase font-mono px-1.5 py-0.5 rounded border ${
                          tmpl.category === 'vendas'
                            ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                            : tmpl.category === 'alerta'
                            ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
                            : 'text-sky-400 border-sky-500/30 bg-sky-500/10'
                        }`}
                      >
                        {tmpl.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-on-surface-variant mt-1.5 leading-relaxed">
                      {tmpl.description}
                    </p>
                    <p className="text-[10px] text-on-surface-variant/70 font-mono mt-2">
                      {tmpl.nodes.length} blocos
                    </p>
                  </div>

                  <div className="mt-4 pt-2 border-t border-outline-variant flex justify-end">
                    <button
                      type="button"
                      disabled={creating}
                      onClick={() => void createFromTemplate(tmpl)}
                      className="px-3 py-1 bg-primary hover:bg-primary/90 text-white rounded text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      Criar a partir deste
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2 border-t border-outline-variant">
              <button
                type="button"
                onClick={() => setShowTemplatesModal(false)}
                className="px-4 py-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded text-xs"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
