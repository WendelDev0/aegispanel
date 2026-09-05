import React, { useEffect, useMemo, useState } from 'react';
import {
  MessageCircle,
  Plus,
  Trash2,
  Copy,
  Sparkles,
  Search,
  Bot,
  Activity,
  AlertTriangle,
  Layers,
  X,
  Radio,
  Clock,
} from 'lucide-react';
import { api } from '../services/api.js';
import type { WaFlowRecord, WaFlowTemplate } from '../types/index.js';
import { FlowEditor } from '../components/flows/FlowEditor.js';
import { BLOCK_META } from '../components/flows/flow-blocks.js';
import { Panel, SectionHeader, StatCard, Badge, type Tone } from '../components/ui.js';

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

/**
 * One glance has to answer "is this flow healthy?". Errors outrank published,
 * because a flow that is live and failing is the case the operator must see
 * first — it used to read as a plain "Ativo" badge like any other.
 */
function flowTone(flow: WaFlowRecord): Tone {
  if ((flow.stats?.errorsToday || 0) > 0) return 'crit';
  if (!flow.published) return 'neutral';
  return 'ok';
}

function compact(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function lastRunLabel(iso?: string): string {
  if (!iso) return 'Nunca executou';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Category is a label, not a status: one tone, no traffic lights. */
const CATEGORY_LABEL: Record<string, string> = {
  vendas: 'Vendas',
  alerta: 'Alerta',
  suporte: 'Suporte',
};

interface FlowsPageProps {
  flowId?: string | null;
  onOpen: (id?: string) => void;
}

const TemplateCard: React.FC<{
  tmpl: WaFlowTemplate;
  disabled?: boolean;
  onUse: () => void;
}> = ({ tmpl, disabled, onUse }) => (
  <div className="bg-surface-container-low border border-outline-variant rounded-lg p-4 flex flex-col hover:border-outline transition-colors">
    <div className="flex items-start justify-between gap-3">
      <h4 className="text-sm font-semibold text-on-surface tracking-[-0.01em]">{tmpl.name}</h4>
      <span className="mono-label shrink-0 mt-0.5">{CATEGORY_LABEL[tmpl.category] || tmpl.category}</span>
    </div>

    <p className="text-xs text-on-surface-variant mt-2 leading-relaxed line-clamp-2">{tmpl.description}</p>

    <div className="flex items-center gap-1.5 text-2xs text-on-surface-variant/70 mt-3">
      <Layers className="w-3 h-3" />
      <span className="font-mono tabular-nums">{tmpl.nodes.length}</span>
      <span>blocos prontos</span>
    </div>

    <button
      type="button"
      onClick={onUse}
      disabled={disabled}
      className="mt-4 w-full px-3 py-1.5 rounded border border-outline-variant bg-surface-container hover:border-primary/50 hover:text-primary text-on-surface text-xs font-semibold transition-colors disabled:opacity-50"
    >
      Usar este modelo
    </button>
  </div>
);

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

  const allInstances = useMemo(
    () => Array.from(new Set(flows.flatMap((f) => f.instanceNames || []))).filter(Boolean),
    [flows]
  );

  /** Operation-wide read, so the health question is answered before scrolling. */
  const totals = useMemo(() => {
    return flows.reduce(
      (acc, f) => ({
        published: acc.published + (f.published ? 1 : 0),
        runs: acc.runs + (f.stats?.runsToday || 0),
        errors: acc.errors + (f.stats?.errorsToday || 0),
        tokens: acc.tokens + (f.stats?.aiTokensToday || 0),
      }),
      { published: 0, runs: 0, errors: 0, tokens: 0 }
    );
  }, [flows]);

  const filteredFlows = useMemo(
    () =>
      flows.filter((f) => {
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
          } else if (!(f.instanceNames || []).includes(selectedInstance)) {
            return false;
          }
        }
        return true;
      }),
    [flows, searchQuery, selectedInstance]
  );

  if (flowId) {
    return <FlowEditor flowId={flowId} onBack={() => onOpen()} />;
  }

  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded border text-xs font-medium shrink-0 transition-colors ${
      active
        ? 'bg-primary/10 text-primary border-primary/40'
        : 'bg-surface-container text-on-surface-variant border-outline-variant hover:text-on-surface hover:border-outline'
    }`;

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MessageCircle className="w-[18px] h-[18px]" />}
        title="Fluxos WhatsApp"
        subtitle="Automação conversacional multi-instância, IA e eventos de infraestrutura no mesmo canvas."
        actions={
          <>
            {templates.length > 0 && (
              <button
                type="button"
                onClick={() => setShowTemplatesModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant bg-surface-container hover:border-outline text-on-surface text-xs font-semibold transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Modelos
              </button>
            )}
            <button
              type="button"
              onClick={() => void createBlankFlow()}
              disabled={creating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary-container hover:bg-primary text-on-primary-container text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              Novo fluxo
            </button>
          </>
        }
      />

      {flows.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<Radio className="w-4 h-4" />}
            label="Publicados"
            value={totals.published}
            detail={`de ${flows.length} ${flows.length === 1 ? 'fluxo' : 'fluxos'}`}
            tone={totals.published > 0 ? 'ok' : 'neutral'}
          />
          <StatCard
            icon={<Activity className="w-4 h-4" />}
            label="Conversas hoje"
            value={compact(totals.runs)}
            detail="turnos atendidos"
            tone="info"
          />
          <StatCard
            icon={<AlertTriangle className="w-4 h-4" />}
            label="Erros hoje"
            value={totals.errors}
            detail={totals.errors > 0 ? 'verifique os fluxos marcados' : 'nenhuma falha de envio'}
            tone={totals.errors > 0 ? 'crit' : 'ok'}
          />
          <StatCard
            icon={<Bot className="w-4 h-4" />}
            label="Tokens IA"
            value={compact(totals.tokens)}
            detail="consumo do dia"
            tone="info"
          />
        </div>
      )}

      {flows.length > 0 && (
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="relative w-full lg:w-80">
            <Search className="w-3.5 h-3.5 text-on-surface-variant/70 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar por nome, gatilho ou instância"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-surface-container border border-outline-variant rounded pl-9 pr-3 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary/60 transition-colors"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <button type="button" onClick={() => setSelectedInstance('all')} className={chip(selectedInstance === 'all')}>
              Todas <span className="font-mono tabular-nums text-on-surface-variant">{flows.length}</span>
            </button>
            {allInstances.map((inst) => {
              const count = flows.filter((f) => (f.instanceNames || []).includes(inst)).length;
              return (
                <button
                  key={inst}
                  type="button"
                  onClick={() => setSelectedInstance(inst)}
                  className={`${chip(selectedInstance === inst)} font-mono inline-flex items-center gap-1.5`}
                >
                  {inst} <span className="tabular-nums text-on-surface-variant">{count}</span>
                </button>
              );
            })}
            {flows.some((f) => (f.instanceNames || []).length === 0) && (
              <button
                type="button"
                onClick={() => setSelectedInstance('__global__')}
                className={chip(selectedInstance === '__global__')}
              >
                Sem vínculo
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <Panel className="p-12">
          <p className="text-center text-xs text-on-surface-variant">Carregando fluxos…</p>
        </Panel>
      ) : flows.length === 0 ? (
        <div className="space-y-6">
          <Panel className="p-10">
            <div className="max-w-md mx-auto text-center">
              <span className="w-11 h-11 rounded-lg bg-surface-container-high border border-outline-variant text-primary flex items-center justify-center mx-auto">
                <MessageCircle className="w-5 h-5" />
              </span>
              <h3 className="text-[15px] font-semibold text-on-surface tracking-[-0.01em] mt-4">
                Nenhum fluxo criado ainda
              </h3>
              <p className="text-xs text-on-surface-variant mt-2 leading-relaxed">
                Um fluxo responde no WhatsApp sozinho: recebe a mensagem, decide o caminho e envia a resposta.
                Comece do zero ou parta de um modelo pronto.
              </p>
              <button
                type="button"
                onClick={() => void createBlankFlow()}
                disabled={creating}
                className="mt-5 px-4 py-2 rounded bg-primary-container hover:bg-primary text-on-primary-container text-xs font-semibold transition-colors disabled:opacity-50"
              >
                Criar fluxo em branco
              </button>
            </div>
          </Panel>

          {templates.length > 0 && (
            <div className="space-y-3">
              <SectionHeader icon={<Sparkles className="w-[18px] h-[18px]" />} title="Modelos prontos" />
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {templates.map((tmpl) => (
                  <TemplateCard
                    key={tmpl.id}
                    tmpl={tmpl}
                    disabled={creating}
                    onUse={() => void createFromTemplate(tmpl)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : filteredFlows.length === 0 ? (
        <Panel className="p-10">
          <p className="text-center text-xs text-on-surface-variant">
            Nenhum fluxo corresponde aos filtros aplicados.
          </p>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredFlows.map((flow) => {
            const tone = flowTone(flow);
            const runsToday = flow.stats?.runsToday || 0;
            const errorsToday = flow.stats?.errorsToday || 0;
            const tokensToday = flow.stats?.aiTokensToday || 0;
            const usesAi = hasAiNode(flow);

            return (
              <Panel key={flow.id} accent={tone} className="group">
                <button
                  type="button"
                  onClick={() => onOpen(flow.id)}
                  className="w-full text-left p-4 pl-5 focus:outline-none focus-visible:bg-surface-container-high/40 hover:bg-surface-container-high/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-on-surface tracking-[-0.01em] truncate group-hover:text-primary transition-colors">
                        {flow.name}
                      </h3>
                      <p className="text-xs text-on-surface-variant mt-1 truncate">{triggerLabel(flow)}</p>
                    </div>
                    <Badge tone={flow.published ? 'ok' : 'neutral'} dot={flow.published}>
                      {flow.published ? 'Ativo' : 'Rascunho'}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 mt-3">
                    {(flow.instanceNames || []).length > 0 ? (
                      flow.instanceNames.map((inst) => (
                        <span
                          key={inst}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-outline-variant bg-surface-container-lowest font-mono text-2xs text-on-surface-variant"
                        >
                          <Radio className="w-2.5 h-2.5 text-ok" />
                          {inst}
                        </span>
                      ))
                    ) : (
                      <Badge tone="warn">Sem instância vinculada</Badge>
                    )}
                    {usesAi && (
                      <span
                        title="Usa bloco de IA"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-outline-variant bg-surface-container-lowest text-2xs text-on-surface-variant"
                      >
                        <Bot className="w-2.5 h-2.5" />
                        IA
                      </span>
                    )}
                    {flow.priority > 0 && (
                      <span className="px-1.5 py-0.5 rounded border border-outline-variant bg-surface-container-lowest font-mono text-2xs text-on-surface-variant">
                        P{flow.priority}
                      </span>
                    )}
                  </div>

                  {/* Left-aligned pairs: a column of numbers is read by scanning
                      down one edge, which centred cells make impossible. */}
                  <div className="flex items-end gap-6 mt-4">
                    <div>
                      <span className="mono-label block">Hoje</span>
                      <span className="font-mono text-lg leading-none text-on-surface tabular-nums mt-1 block">
                        {compact(runsToday)}
                      </span>
                    </div>
                    <div>
                      <span className="mono-label block">Erros</span>
                      <span
                        className={`font-mono text-lg leading-none tabular-nums mt-1 block ${
                          errorsToday > 0 ? 'text-crit' : 'text-on-surface-variant/60'
                        }`}
                      >
                        {errorsToday}
                      </span>
                    </div>
                    {/* Tokens only where a flow can actually spend them. */}
                    {usesAi && (
                      <div>
                        <span className="mono-label block">Tokens</span>
                        <span className="font-mono text-lg leading-none text-on-surface tabular-nums mt-1 block">
                          {compact(tokensToday)}
                        </span>
                      </div>
                    )}
                  </div>
                </button>

                <div className="flex items-center justify-between gap-2 px-4 pl-5 py-2 border-t border-outline-variant">
                  <span className="inline-flex items-center gap-1.5 font-mono text-2xs text-on-surface-variant/70 truncate">
                    <Clock className="w-3 h-3 shrink-0" />
                    {lastRunLabel(flow.lastRunAt)}
                  </span>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      title="Clonar este fluxo"
                      disabled={cloningId === flow.id}
                      onClick={() => void cloneFlow(flow)}
                      className="p-1.5 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-50"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Excluir fluxo"
                      onClick={() => void removeFlow(flow.id, flow.name)}
                      className="p-1.5 rounded text-on-surface-variant hover:text-crit hover:bg-crit/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {showTemplatesModal && (
        <div
          className="fixed inset-0 z-50 bg-surface-container-lowest/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowTemplatesModal(false)}
        >
          <div
            className="bg-surface-container border border-outline-variant rounded-lg max-w-3xl w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 p-5 border-b border-outline-variant">
              <SectionHeader
                icon={<Sparkles className="w-[18px] h-[18px]" />}
                title="Modelos prontos"
                subtitle="Fluxos testados para partir de algo que já funciona."
              />
              <button
                type="button"
                onClick={() => setShowTemplatesModal(false)}
                className="p-1.5 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5 max-h-[60vh] overflow-y-auto">
              {templates.map((tmpl) => (
                <TemplateCard
                  key={tmpl.id}
                  tmpl={tmpl}
                  disabled={creating}
                  onUse={() => void createFromTemplate(tmpl)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
