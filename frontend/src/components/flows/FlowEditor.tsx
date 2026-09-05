import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft,
  Save,
  ToggleLeft,
  ToggleRight,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Radio,
  SlidersHorizontal,
} from 'lucide-react';
import { api } from '../../services/api.js';
import type {
  EvolutionInstanceInfo,
  WaFlowEdge,
  WaFlowNode,
  WaFlowNodeType,
  WaFlowRecord,
} from '../../types/index.js';
import { FlowBlockNode, type FlowBlockData } from './FlowBlockNode.js';
import { FlowInspector } from './FlowInspector.js';
import { FlowPhoneSimulator } from './FlowPhoneSimulator.js';
import { FlowValidationModal, type ValidationError } from './FlowValidationModal.js';
import { BLOCK_META, PALETTE } from './flow-blocks.js';

const nodeTypes = { flowBlock: FlowBlockNode };

function toRfNodes(nodes: WaFlowNode[]): Node[] {
  return nodes.map((node) => ({
    id: node.id,
    type: 'flowBlock',
    position: node.position,
    data: { blockType: node.type, ...node.data },
  }));
}

function toRfEdges(edges: WaFlowEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    style: { stroke: '#424754', strokeWidth: 2 },
  }));
}

function fromRf(nodes: Node[], edges: Edge[]): { nodes: WaFlowNode[]; edges: WaFlowEdge[] } {
  return {
    nodes: nodes.map((node) => {
      const { blockType, ...data } = (node.data || {}) as any;
      return {
        id: node.id,
        type: blockType,
        position: node.position,
        data,
      };
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || undefined,
    })),
  };
}

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

interface FlowEditorProps {
  flowId: string;
  onBack: () => void;
}

export const FlowEditor: React.FC<FlowEditorProps> = ({ flowId, onBack }) => {
  const [flow, setFlow] = useState<WaFlowRecord | null>(null);
  const [name, setName] = useState('');
  const [instanceNames, setInstanceNames] = useState<string[]>([]);
  const [priority, setPriority] = useState(0);
  const [sessionTtlMinutes, setSessionTtlMinutes] = useState(30);
  const [aiBudgetTokensPerDay, setAiBudgetTokensPerDay] = useState(50_000);

  const [availableInstances, setAvailableInstances] = useState<EvolutionInstanceInfo[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Validation modal state
  const [validationModalOpen, setValidationModalOpen] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);

  // Right sidebar tab: 'preview' | 'simulate' | 'inspector'
  const [rightTab, setRightTab] = useState<'preview' | 'simulate' | 'inspector'>('preview');

  // Config popover toggle
  const [showConfigPopover, setShowConfigPopover] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/wa-flows/${flowId}`);
      const next = res.data as WaFlowRecord;
      setFlow(next);
      setName(next.name);
      setInstanceNames(next.instanceNames || []);
      setPriority(next.priority || 0);
      setSessionTtlMinutes(next.sessionTtlMinutes || 30);
      setAiBudgetTokensPerDay(next.aiBudgetTokensPerDay ?? 50_000);
      setNodes(toRfNodes(next.nodes));
      setEdges(toRfEdges(next.edges));
      setIsDirty(false);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    }
  }, [flowId, setEdges, setNodes]);

  const loadInstances = useCallback(async () => {
    try {
      const res = await api.get('/system/evolution/instances');
      if (res.data?.ok && Array.isArray(res.data.instances)) {
        setAvailableInstances(res.data.instances);
      }
    } catch {
      // best effort: instances can be typed or configured later
    }
  }, []);

  useEffect(() => {
    void load();
    void loadInstances();
  }, [load, loadInstances]);

  // Unsaved changes warning
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Ctrl+S / Cmd+S save keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void persist();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [name, nodes, edges, instanceNames, priority, sessionTtlMinutes, aiBudgetTokensPerDay]);

  const selectedNode = useMemo(() => {
    if (!selectedId) return null;
    return fromRf(nodes, edges).nodes.find((n) => n.id === selectedId) || null;
  }, [edges, nodes, selectedId]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((els) => addEdge({ ...connection, id: newId('e'), style: { stroke: '#424754', strokeWidth: 2 } }, els));
      setIsDirty(true);
    },
    [setEdges]
  );

  const addBlock = (type: WaFlowNodeType) => {
    const id = newId(type);
    const buttons =
      type === 'menu'
        ? [
            { id: newId('btn'), label: 'Opção 1' },
            { id: newId('btn'), label: 'Opção 2' },
          ]
        : undefined;

    setNodes((current) => [
      ...current,
      {
        id,
        type: 'flowBlock',
        position: { x: 80 + current.length * 20, y: 80 + current.length * 30 },
        data: {
          blockType: type,
          match: 'any',
          event: 'deploy_fail',
          text: type === 'send_text' ? 'Olá {{nome}}' : '',
          buttons,
          operator: 'contains',
          captureType: 'text',
          provider: 'openai',
          model: 'gpt-4o-mini',
          delaySeconds: 2,
        },
      },
    ]);
    setSelectedId(id);
    setIsDirty(true);
    setRightTab('inspector');
  };

  const updateSelected = (next: WaFlowNode) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === next.id ? { ...node, data: { blockType: next.type, ...next.data } } : node
      )
    );
    setIsDirty(true);
  };

  const deleteNode = (id: string) => {
    setNodes((current) => current.filter((n) => n.id !== id));
    setEdges((current) => current.filter((e) => e.source !== id && e.target !== id));
    setSelectedId(null);
    setIsDirty(true);
  };

  const persist = async (): Promise<WaFlowRecord | null> => {
    setSaving(true);
    setError('');
    setSaveSuccess(false);
    try {
      const graph = fromRf(nodes, edges);
      const res = await api.put(`/wa-flows/${flowId}`, {
        name,
        instanceNames,
        priority,
        sessionTtlMinutes,
        aiBudgetTokensPerDay,
        ...graph,
      });
      setFlow(res.data);
      setIsDirty(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      return res.data;
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleClone = async () => {
    setCloning(true);
    setError('');
    try {
      await persist();
      const res = await api.post(`/wa-flows/${flowId}/clone`, {});
      alert(`Fluxo clonado com sucesso como "${res.data.name}".`);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setCloning(false);
    }
  };

  const handleValidate = async () => {
    setError('');
    try {
      await persist();
      const res = await api.post(`/wa-flows/${flowId}/validate`, {});
      if (!res.data.valid) {
        setValidationErrors(res.data.errors || []);
        setValidationModalOpen(true);
      } else {
        alert('Grafo validado com sucesso! Nenum erro encontrado.');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const togglePublish = async () => {
    if (!flow) return;
    setSaving(true);
    setError('');
    try {
      const saved = await persist();
      if (!saved) return;

      if (!flow.published) {
        // Run validation check before publish
        const valRes = await api.post(`/wa-flows/${flowId}/validate`, {});
        if (!valRes.data.valid) {
          setValidationErrors(valRes.data.errors || []);
          setValidationModalOpen(true);
          return;
        }

        if (instanceNames.length === 0) {
          setError('Vincule pelo menos uma instância da Evolution ao fluxo antes de publicar.');
          return;
        }
      }

      const res = await api.post(`/wa-flows/${flowId}/publish`, { published: !flow.published });
      setFlow(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleInstance = (inst: string) => {
    setInstanceNames((prev) =>
      prev.includes(inst) ? prev.filter((i) => i !== inst) : [...prev, inst]
    );
    setIsDirty(true);
  };

  return (
    <div className="h-[calc(100vh-7.5rem)] flex flex-col gap-2 min-h-[560px]">
      {/* Top Action Bar */}
      <div className="flex items-center justify-between gap-3 bg-surface-container border border-outline-variant rounded-xl px-4 py-2.5 shadow-sm">
        {/* Left: Back & Name */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <button
            type="button"
            onClick={() => {
              if (isDirty && !confirm('Você tem alterações não salvas. Deseja sair mesmo assim?')) return;
              onBack();
            }}
            className="p-2 rounded-lg bg-surface-container-high text-on-surface-variant hover:text-white transition-colors"
            title="Voltar para a lista de fluxos"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input
              className="bg-transparent border-b border-transparent hover:border-outline-variant focus:border-primary text-white font-bold text-base px-1 py-0.5 focus:outline-none truncate max-w-sm"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setIsDirty(true);
              }}
              placeholder="Nome do fluxo"
            />
            {isDirty && (
              <span className="text-[10px] text-warn font-semibold bg-warn/10 px-2 py-0.5 rounded border border-warn/30">
                Não salvo
              </span>
            )}
          </div>
        </div>

        {/* Center: Instances Binding Pills */}
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-1 bg-surface-container-low rounded-lg border border-outline-variant/60">
          <Radio className="w-3.5 h-3.5 text-primary" />
          <span className="text-[11px] font-semibold text-on-surface-variant mr-1">Linhas:</span>
          {availableInstances.length === 0 ? (
            <input
              type="text"
              placeholder="Nome da instância"
              value={instanceNames.join(', ')}
              onChange={(e) => {
                setInstanceNames(e.target.value.split(',').map((s) => s.trim()).filter(Boolean));
                setIsDirty(true);
              }}
              className="bg-transparent text-xs text-white font-mono focus:outline-none w-32"
            />
          ) : (
            <div className="flex items-center gap-1">
              {availableInstances.map((inst) => {
                const active = instanceNames.includes(inst.name);
                return (
                  <button
                    key={inst.name}
                    type="button"
                    onClick={() => toggleInstance(inst.name)}
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full border transition-all ${
                      active
                        ? 'bg-primary/20 text-primary border-primary/40 font-semibold'
                        : 'bg-surface-container-high text-on-surface-variant border-outline-variant hover:text-white'
                    }`}
                  >
                    {inst.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {/* Config Popover Toggle */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowConfigPopover(!showConfigPopover)}
              className="p-2 rounded-lg bg-surface-container-high text-on-surface-variant hover:text-white transition-colors"
              title="Configurações de TTL, Prioridade e Orçamento"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
            {showConfigPopover && (
              <div className="absolute right-0 mt-2 w-64 bg-surface-container border border-outline-variant rounded-xl p-3.5 shadow-2xl z-50 space-y-3">
                <p className="text-xs font-bold text-white border-b border-outline-variant pb-1.5">
                  Parâmetros de Execução
                </p>
                <label className="block text-[11px] text-on-surface-variant">
                  Prioridade (maior vence)
                  <input
                    type="number"
                    value={priority}
                    onChange={(e) => {
                      setPriority(parseInt(e.target.value, 10) || 0);
                      setIsDirty(true);
                    }}
                    className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded px-2 py-1 text-xs text-white font-mono"
                  />
                </label>
                <label className="block text-[11px] text-on-surface-variant">
                  TTL da Sessão (minutos)
                  <input
                    type="number"
                    min="5"
                    max="1440"
                    value={sessionTtlMinutes}
                    onChange={(e) => {
                      setSessionTtlMinutes(parseInt(e.target.value, 10) || 30);
                      setIsDirty(true);
                    }}
                    className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded px-2 py-1 text-xs text-white font-mono"
                  />
                </label>
                <label className="block text-[11px] text-on-surface-variant">
                  Teto Diário de IA (tokens)
                  <input
                    type="number"
                    min="0"
                    step="5000"
                    value={aiBudgetTokensPerDay}
                    onChange={(e) => {
                      setAiBudgetTokensPerDay(parseInt(e.target.value, 10) || 0);
                      setIsDirty(true);
                    }}
                    className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded px-2 py-1 text-xs text-white font-mono"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setShowConfigPopover(false)}
                  className="w-full py-1 text-center text-xs font-semibold bg-surface-container-high rounded text-white"
                >
                  Concluído
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleClone}
            disabled={cloning}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container-high text-xs text-on-surface-variant hover:text-white transition-colors"
            title="Duplicar este fluxo"
          >
            <Copy className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Clonar</span>
          </button>

          <button
            type="button"
            onClick={handleValidate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container-high text-xs text-on-surface-variant hover:text-white transition-colors"
          >
            Validar
          </button>

          <button
            type="button"
            onClick={() => void persist()}
            disabled={saving}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              saveSuccess ? 'bg-ok text-black font-bold' : 'bg-surface-container-high text-white hover:bg-surface-container-highest'
            }`}
          >
            {saveSuccess ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            <span>{saveSuccess ? 'Salvo!' : 'Salvar'}</span>
          </button>

          <button
            type="button"
            onClick={() => void togglePublish()}
            disabled={saving}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              flow?.published
                ? 'bg-ok/20 text-ok border border-ok/30'
                : 'bg-surface-container-high text-on-surface-variant hover:text-white'
            }`}
          >
            {flow?.published ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
            <span>{flow?.published ? 'Publicado' : 'Publicar'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-crit/15 border border-crit/30 text-crit text-xs animate-in fade-in">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {flow && !flow.published && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warn/10 border border-warn/30 text-warn text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            Rascunho: vincule a linha Evolution e clique em Publicar. Sem isso o WhatsApp não dispara o fluxo.
          </span>
        </div>
      )}

      {/* 3-Column Editor Layout */}
      <div className="flex-1 grid grid-cols-[220px_1fr_340px] gap-2.5 min-h-0">
        {/* Column 1: Palette */}
        <aside className="bg-surface-container border border-outline-variant rounded-xl p-2.5 space-y-1.5 overflow-y-auto shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant px-2 py-1">
            Blocos
          </p>
          <div className="space-y-1">
            {PALETTE.map((type) => {
              const meta = BLOCK_META[type];
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => addBlock(type)}
                  className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-surface-container-high transition-all group border border-transparent hover:border-outline-variant/60"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white group-hover:text-primary transition-colors">
                      {meta.verb}
                    </span>
                    <span className="text-[10px] text-on-surface-variant/70 font-mono">
                      {meta.label}
                    </span>
                  </div>
                  <span className="block text-[10px] text-on-surface-variant line-clamp-1 mt-0.5">
                    {meta.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Column 2: Canvas */}
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden shadow-inner relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={(changes) => {
              onNodesChange(changes);
              setIsDirty(true);
            }}
            onEdgesChange={(changes) => {
              onEdgesChange(changes);
              setIsDirty(true);
            }}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onSelectionChange={({ nodes: selected }) => {
              if (selected[0]?.id) {
                setSelectedId(selected[0].id);
                setRightTab('preview');
              }
            }}
            fitView
            colorMode="dark"
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#323846" gap={24} size={1.5} />
            <Controls className="!bg-surface-container !border-outline-variant !rounded-lg overflow-hidden text-white" />
            <MiniMap
              pannable
              zoomable
              maskColor="rgba(8,14,27,0.75)"
              nodeColor="#242a38"
              className="!bg-surface-container !border !border-outline-variant !rounded-lg"
            />
          </ReactFlow>
        </div>

        {/* Column 3: Phone Simulator & Inspector */}
        <aside className="h-full min-h-0">
          {rightTab === 'inspector' ? (
            <div className="h-full bg-surface-container border border-outline-variant rounded-xl overflow-hidden flex flex-col shadow-sm">
              <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container-high px-3 py-2">
                <span className="text-xs font-bold text-white">Configurar Bloco</span>
                <button
                  type="button"
                  onClick={() => setRightTab('preview')}
                  className="text-xs text-primary hover:underline font-semibold"
                >
                  Ver no Telefone
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <FlowInspector
                  node={selectedNode}
                  onChange={updateSelected}
                  onDelete={deleteNode}
                />
              </div>
            </div>
          ) : (
            <FlowPhoneSimulator
              flowId={flowId}
              flow={flow}
              selectedNode={selectedNode}
              onSelectNode={(id) => setSelectedId(id)}
              tab={rightTab}
              onTabChange={(t) => setRightTab(t)}
            />
          )}
        </aside>
      </div>

      {/* Validation Modal */}
      <FlowValidationModal
        isOpen={validationModalOpen}
        errors={validationErrors}
        onClose={() => setValidationModalOpen(false)}
        onSelectNode={(nodeId) => {
          setSelectedId(nodeId);
          setRightTab('inspector');
        }}
      />
    </div>
  );
};
