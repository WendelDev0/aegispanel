import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  SlidersHorizontal,
  Undo2,
  Redo2,
} from 'lucide-react';
import { api } from '../../services/api.js';
import type {
  EvolutionInstanceInfo,
  WaFlowEdge,
  WaFlowNode,
  WaFlowNodeType,
  WaFlowRecord,
  WaInboundEvent,
  WaInboundSkipSummary,
} from '../../types/index.js';
import { FlowBlockNode, type FlowBlockData } from './FlowBlockNode.js';
import { FlowInspector } from './FlowInspector.js';
import { FlowPhoneSimulator } from './FlowPhoneSimulator.js';
import { FlowValidationModal, type ValidationError } from './FlowValidationModal.js';
import { FlowInstancesPanel } from './FlowInstancesPanel.js';
import { FlowInternalRouteCard } from './FlowInternalRouteCard.js';
import { FlowInboundStrip } from './FlowInboundStrip.js';
import { BLOCK_META, PALETTE } from './flow-blocks.js';

const nodeTypes = { flowBlock: FlowBlockNode };

type GraphSnap = { nodes: Node[]; edges: Edge[] };

function cloneGraph(nodes: Node[], edges: Edge[]): GraphSnap {
  return {
    nodes: nodes.map((node) => ({ ...node, position: { ...node.position }, data: { ...node.data } })),
    edges: edges.map((edge) => ({ ...edge })),
  };
}

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
      const { blockType, onDelete, onDuplicate, onInspect, ...data } = (node.data || {}) as FlowBlockData;
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

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
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
  const [managerUrl, setManagerUrl] = useState<string | null>(null);
  const [instanceError, setInstanceError] = useState('');
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [inboundEvents, setInboundEvents] = useState<WaInboundEvent[]>([]);
  const [inboundSkipped, setInboundSkipped] = useState<WaInboundSkipSummary | null>(null);
  const [publishWarnings, setPublishWarnings] = useState<string[]>([]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [validationModalOpen, setValidationModalOpen] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [rightTab, setRightTab] = useState<'preview' | 'simulate' | 'inspector'>('preview');
  const [showConfigPopover, setShowConfigPopover] = useState(false);

  const pastRef = useRef<GraphSnap[]>([]);
  const futureRef = useRef<GraphSnap[]>([]);
  const [historyTick, setHistoryTick] = useState(0);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const takeSnapshot = useCallback(() => {
    pastRef.current.push(cloneGraph(nodesRef.current, edgesRef.current));
    if (pastRef.current.length > 60) pastRef.current.shift();
    futureRef.current = [];
    setHistoryTick((n) => n + 1);
  }, []);

  const applySnap = useCallback(
    (snap: GraphSnap) => {
      setNodes(snap.nodes);
      setEdges(snap.edges);
      setIsDirty(true);
    },
    [setEdges, setNodes]
  );

  const undo = useCallback(() => {
    const prev = pastRef.current.pop();
    if (!prev) return;
    futureRef.current.push(cloneGraph(nodesRef.current, edgesRef.current));
    applySnap(prev);
    setHistoryTick((n) => n + 1);
  }, [applySnap]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(cloneGraph(nodesRef.current, edgesRef.current));
    applySnap(next);
    setHistoryTick((n) => n + 1);
  }, [applySnap]);

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
      pastRef.current = [];
      futureRef.current = [];
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    }
  }, [flowId, setEdges, setNodes]);

  const loadInstances = useCallback(async () => {
    setLoadingInstances(true);
    try {
      const res = await api.get('/wa-flows/instances');
      setAvailableInstances(Array.isArray(res.data?.instances) ? res.data.instances : []);
      setManagerUrl(res.data?.managerUrl || null);
      setInstanceError(res.data?.ok ? '' : res.data?.error || '');
    } catch (err: any) {
      setInstanceError(err.response?.data?.error || 'Não foi possível listar as instâncias.');
    } finally {
      setLoadingInstances(false);
    }
  }, []);

  const loadInbound = useCallback(async () => {
    try {
      const res = await api.get('/wa-flows/inbound', { params: { limit: 8 } });
      setInboundEvents(Array.isArray(res.data?.events) ? res.data.events : []);
      setInboundSkipped(res.data?.skipped || null);
    } catch {
      /* strip is best-effort */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadInstances();
    void loadInbound();
  }, [load, loadInstances, loadInbound]);

  useEffect(() => {
    const timer = window.setInterval(() => void loadInbound(), 4000);
    return () => window.clearInterval(timer);
  }, [loadInbound]);

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

  const deleteNode = useCallback(
    (id: string) => {
      takeSnapshot();
      setNodes((current) => current.filter((n) => n.id !== id));
      setEdges((current) => current.filter((e) => e.source !== id && e.target !== id));
      setSelectedId((current) => (current === id ? null : current));
      setIsDirty(true);
    },
    [setEdges, setNodes, takeSnapshot]
  );

  const inspectNode = useCallback((id: string) => {
    setSelectedId(id);
    setRightTab('inspector');
  }, []);

  const duplicateNode = useCallback(
    (id: string) => {
      const current = nodesRef.current.find((n) => n.id === id);
      if (!current) return;
      takeSnapshot();
      const copyId = newId(String((current.data as FlowBlockData).blockType || 'block'));
      const copy: Node = {
        ...current,
        id: copyId,
        position: { x: current.position.x + 40, y: current.position.y + 40 },
        selected: true,
        data: { ...current.data },
      };
      setNodes((els) => [...els.map((n) => ({ ...n, selected: false })), copy]);
      setSelectedId(copyId);
      setIsDirty(true);
    },
    [setNodes, takeSnapshot]
  );

  const nodesWithActions = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          onDelete: deleteNode,
          onDuplicate: duplicateNode,
          onInspect: inspectNode,
        },
      })),
    [deleteNode, duplicateNode, inspectNode, nodes]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void persist();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (isTypingTarget(e.target)) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        if (isTypingTarget(e.target)) return;
        e.preventDefault();
        redo();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !isTypingTarget(e.target)) {
        e.preventDefault();
        deleteNode(selectedId);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const selectedNode = useMemo(() => {
    if (!selectedId) return null;
    return fromRf(nodes, edges).nodes.find((n) => n.id === selectedId) || null;
  }, [edges, nodes, selectedId]);

  const onConnect = useCallback(
    (connection: Connection) => {
      takeSnapshot();
      setEdges((els) => addEdge({ ...connection, id: newId('e'), style: { stroke: '#424754', strokeWidth: 2 } }, els));
      setIsDirty(true);
    },
    [setEdges, takeSnapshot]
  );

  const addBlock = (type: WaFlowNodeType) => {
    takeSnapshot();
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
    takeSnapshot();
    setNodes((current) =>
      current.map((node) =>
        node.id === next.id ? { ...node, data: { blockType: next.type, ...next.data } } : node
      )
    );
    setIsDirty(true);
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
        alert('Grafo validado com sucesso! Nenhum erro encontrado.');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const togglePublish = async () => {
    if (!flow) return;
    setSaving(true);
    setError('');
    setPublishWarnings([]);
    try {
      const saved = await persist();
      if (!saved) return;

      if (!flow.published) {
        const ready = await api.get(`/wa-flows/${flowId}/readiness`);
        if (!ready.data?.validation?.valid) {
          setValidationErrors(ready.data.validation.errors || []);
          setValidationModalOpen(true);
          return;
        }
        if (!ready.data?.publish?.ok) {
          setError(ready.data?.publish?.error || 'Não é possível publicar ainda.');
          return;
        }
        setPublishWarnings(ready.data?.publish?.warnings || []);
      }

      const res = await api.post(`/wa-flows/${flowId}/publish`, { published: !flow.published });
      setFlow(res.data);
      void loadInbound();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleInstance = (inst: string) => {
    setInstanceNames((prev) =>
      prev.some((name) => name.toLowerCase() === inst.toLowerCase())
        ? prev.filter((i) => i.toLowerCase() !== inst.toLowerCase())
        : [...prev, inst]
    );
    setIsDirty(true);
  };

  return (
    <div className="h-[calc(100vh-7.5rem)] flex flex-col gap-2 min-h-[560px]">
      <div className="flex items-center justify-between gap-3 bg-surface-container border border-outline-variant rounded-xl px-4 py-2.5">
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

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={undo}
            disabled={historyTick < 0 || pastRef.current.length === 0}
            className="p-2 rounded-lg bg-surface-container-high text-on-surface-variant hover:text-white disabled:opacity-30"
            title="Desfazer (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={historyTick < 0 || futureRef.current.length === 0}
            className="p-2 rounded-lg bg-surface-container-high text-on-surface-variant hover:text-white disabled:opacity-30"
            title="Refazer (Ctrl+Shift+Z)"
          >
            <Redo2 className="w-4 h-4" />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowConfigPopover(!showConfigPopover)}
              className="p-2 rounded-lg bg-surface-container-high text-on-surface-variant hover:text-white transition-colors"
              title="TTL, prioridade e orçamento"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
            {showConfigPopover && (
              <div className="absolute right-0 mt-2 w-64 bg-surface-container border border-outline-variant rounded-xl p-3.5 z-50 space-y-3">
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

      <FlowInstancesPanel
        instances={availableInstances}
        bound={instanceNames}
        managerUrl={managerUrl}
        loading={loadingInstances}
        error={instanceError}
        onToggle={toggleInstance}
        onRefresh={() => void loadInstances()}
      />

      <FlowInternalRouteCard />

      <FlowInboundStrip events={inboundEvents} skipped={inboundSkipped} />

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-crit/15 border border-crit/30 text-crit text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {publishWarnings.map((warning) => (
        <div key={warning} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warn/10 border border-warn/30 text-warn text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{warning}</span>
        </div>
      ))}

      {flow && !flow.published && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warn/10 border border-warn/30 text-warn text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            Rascunho: vincule uma linha conectada e clique em Publicar. Sem isso o WhatsApp não dispara o fluxo.
          </span>
        </div>
      )}

      <div className="flex-1 grid grid-cols-[220px_1fr_340px] gap-2.5 min-h-0">
        <aside className="bg-surface-container border border-outline-variant rounded-xl p-2.5 space-y-1.5 overflow-y-auto">
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
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${meta.bar}`} />
                    <span className="text-xs font-semibold text-white group-hover:text-primary transition-colors">
                      {meta.verb}
                    </span>
                  </div>
                  <span className="block text-[10px] text-on-surface-variant line-clamp-1 mt-0.5 pl-4">
                    {meta.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden relative">
          <ReactFlow
            nodes={nodesWithActions}
            edges={edges}
            onNodesChange={(changes) => {
              const structural = changes.some((change) => change.type === 'remove' || change.type === 'add');
              if (structural) takeSnapshot();
              onNodesChange(changes);
              setIsDirty(true);
            }}
            onEdgesChange={(changes) => {
              const structural = changes.some((change) => change.type === 'remove' || change.type === 'add');
              if (structural) takeSnapshot();
              onEdgesChange(changes);
              setIsDirty(true);
            }}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            deleteKeyCode={null}
            onNodeDoubleClick={(_e, node) => inspectNode(node.id)}
            onNodeDragStart={() => takeSnapshot()}
            onSelectionChange={({ nodes: selected }) => {
              if (selected[0]?.id) {
                setSelectedId(selected[0].id);
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
              nodeColor={(node) => BLOCK_META[(node.data as FlowBlockData).blockType]?.minimap || '#242a38'}
              className="!bg-surface-container !border !border-outline-variant !rounded-lg"
            />
          </ReactFlow>
        </div>

        <aside className="h-full min-h-0">
          {rightTab === 'inspector' ? (
            <div className="h-full bg-surface-container border border-outline-variant rounded-xl overflow-hidden flex flex-col">
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
