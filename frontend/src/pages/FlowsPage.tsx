import React, { useEffect, useState } from 'react';
import { MessageCircle, Plus, Trash2 } from 'lucide-react';
import { api } from '../services/api.js';
import type { WaFlowRecord } from '../types/index.js';
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
  return BLOCK_META[trigger.type].preview(trigger.data);
}

interface FlowsPageProps {
  flowId?: string | null;
  onOpen: (id?: string) => void;
}

export const FlowsPage: React.FC<FlowsPageProps> = ({ flowId, onOpen }) => {
  const [flows, setFlows] = useState<WaFlowRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      const res = await api.get('/wa-flows');
      setFlows(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Failed to load WhatsApp flows:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createFlow = async () => {
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

  const removeFlow = async (id: string, name: string) => {
    if (!confirm(`Excluir o fluxo "${name}"?`)) return;
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <MessageCircle className="w-6 h-6 text-primary" />
            Fluxos WhatsApp
          </h2>
          <p className="text-sm text-on-surface-variant mt-1">
            Chatbot de entrada e alertas do painel no mesmo canvas, pela Evolution já configurada.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void createFlow()}
          disabled={creating}
          className="flex items-center gap-2 px-4 py-2.5 rounded bg-primary-container text-white text-sm font-semibold"
        >
          <Plus className="w-4 h-4" />
          Novo fluxo
        </button>
      </div>

      {loading ? (
        <p className="text-on-surface-variant text-sm">Carregando fluxos…</p>
      ) : flows.length === 0 ? (
        <div className="bg-surface-container border border-outline-variant rounded-lg p-10 text-center">
          <p className="text-white font-semibold">Nenhum fluxo ainda</p>
          <p className="text-sm text-on-surface-variant mt-1 max-w-md mx-auto">
            Crie um fluxo simples: mensagem “oi”, um menu e uma resposta. Eventos de deploy usam o
            número configurado em Configurações.
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {flows.map((flow) => (
            <button
              key={flow.id}
              type="button"
              onClick={() => onOpen(flow.id)}
              className="text-left bg-surface-container border border-outline-variant rounded-lg p-4 hover:border-primary/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-white font-semibold">{flow.name}</p>
                  <p className="text-xs text-on-surface-variant mt-1">{triggerLabel(flow)}</p>
                </div>
                <span
                  className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${
                    flow.published ? 'text-ok border-ok/30 bg-ok/10' : 'text-on-surface-variant border-outline-variant'
                  }`}
                >
                  {flow.published ? 'Ligado' : 'Rascunho'}
                </span>
              </div>
              <div className="flex items-center justify-between mt-4">
                <span className="text-[11px] font-mono text-on-surface-variant">
                  {flow.lastRunAt
                    ? `Última execução ${new Date(flow.lastRunAt).toLocaleString('pt-BR')}`
                    : 'Ainda não executou'}
                </span>
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeFlow(flow.id, flow.name);
                  }}
                  className="p-1 text-crit hover:bg-crit/10 rounded"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
