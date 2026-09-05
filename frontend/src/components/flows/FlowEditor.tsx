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
import { ArrowLeft, Save, ToggleLeft, ToggleRight } from 'lucide-react';
import { api } from '../../services/api.js';
import type { WaFlowEdge, WaFlowNode, WaFlowNodeType, WaFlowRecord } from '../../types/index.js';
import { FlowBlockNode, type FlowBlockData } from './FlowBlockNode.js';
import { FlowInspector } from './FlowInspector.js';
import { BLOCK_META, PALETTE } from './flow-blocks.js';

const nodeTypes = { flowBlock: FlowBlockNode };

function toRfNodes(nodes: WaFlowNode[]): Node<FlowBlockData>[] {
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
    style: { stroke: '#424754' },
  }));
}

function fromRf(nodes: Node<FlowBlockData>[], edges: Edge[]): { nodes: WaFlowNode[]; edges: WaFlowEdge[] } {
  return {
    nodes: nodes.map((node) => {
      const { blockType, ...data } = node.data;
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
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowBlockData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await api.get(`/wa-flows/${flowId}`);
    const next = res.data as WaFlowRecord;
    setFlow(next);
    setName(next.name);
    setNodes(toRfNodes(next.nodes));
    setEdges(toRfEdges(next.edges));
  }, [flowId, setEdges, setNodes]);

  useEffect(() => {
    void load().catch((err) => setError(err.response?.data?.error || err.message));
  }, [load]);

  const selectedNode = useMemo(() => {
    if (!selectedId) return null;
    return fromRf(nodes, edges).nodes.find((n) => n.id === selectedId) || null;
  }, [edges, nodes, selectedId]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((els) => addEdge({ ...connection, id: newId('e'), style: { stroke: '#424754' } }, els));
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
        position: { x: 80 + current.length * 24, y: 80 + current.length * 36 },
        data: {
          blockType: type,
          match: 'any',
          event: 'deploy_fail',
          text: type === 'send_text' ? 'Olá {{nome}}' : '',
          buttons,
          operator: 'contains',
        },
      },
    ]);
    setSelectedId(id);
  };

  const updateSelected = (next: WaFlowNode) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === next.id ? { ...node, data: { blockType: next.type, ...next.data } } : node
      )
    );
  };

  const deleteNode = (id: string) => {
    setNodes((current) => current.filter((n) => n.id !== id));
    setEdges((current) => current.filter((e) => e.source !== id && e.target !== id));
    setSelectedId(null);
  };

  const persist = async () => {
    setSaving(true);
    setError('');
    try {
      const graph = fromRf(nodes, edges);
      const res = await api.put(`/wa-flows/${flowId}`, { name, ...graph });
      setFlow(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async () => {
    if (!flow) return;
    setSaving(true);
    setError('');
    try {
      await persist();
      const res = await api.post(`/wa-flows/${flowId}/publish`, { published: !flow.published });
      setFlow(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col gap-3 min-h-[520px]">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="p-2 rounded-lg bg-surface-container-high text-on-surface-variant hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <input
          className="flex-1 bg-transparent border-b border-outline-variant text-white font-semibold text-lg px-1 py-1 focus:outline-none focus:border-primary"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          onClick={() => void persist()}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-2 rounded bg-surface-container-high text-sm text-white"
        >
          <Save className="w-4 h-4" />
          Salvar
        </button>
        <button
          type="button"
          onClick={() => void togglePublish()}
          disabled={saving}
          className={`flex items-center gap-1.5 px-3 py-2 rounded text-sm ${
            flow?.published ? 'bg-ok/15 text-ok' : 'bg-surface-container-high text-on-surface-variant'
          }`}
        >
          {flow?.published ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
          {flow?.published ? 'Publicado' : 'Publicar'}
        </button>
      </div>
      {error && <p className="text-xs text-crit">{error}</p>}

      <div className="flex-1 grid grid-cols-[200px_1fr_260px] gap-3 min-h-0">
        <aside className="bg-surface-container border border-outline-variant rounded-lg p-2 space-y-1 overflow-y-auto">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant px-2 py-1">
            Blocos
          </p>
          {PALETTE.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => addBlock(type)}
              className="w-full text-left px-2 py-2 rounded-lg hover:bg-surface-container-high"
            >
              <span className="block text-xs text-white">{BLOCK_META[type].label}</span>
              <span className="block text-[10px] text-on-surface-variant">{BLOCK_META[type].hint}</span>
            </button>
          ))}
        </aside>

        <div className="bg-surface-container-lowest border border-outline-variant rounded-lg overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onSelectionChange={({ nodes: selected }) => setSelectedId(selected[0]?.id || null)}
            fitView
            colorMode="dark"
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#424754" gap={20} />
            <Controls />
            <MiniMap
              pannable
              zoomable
              maskColor="rgba(8,14,27,0.7)"
              nodeColor="#242a38"
            />
          </ReactFlow>
        </div>

        <aside className="bg-surface-container border border-outline-variant rounded-lg overflow-y-auto">
          <FlowInspector node={selectedNode} onChange={updateSelected} onDelete={deleteNode} />
        </aside>
      </div>
    </div>
  );
};
