import React from 'react';
import type { WaFlowNode, WaPanelEvent } from '../../types/index.js';
import { BLOCK_META, EVENT_LABELS } from './flow-blocks.js';

interface FlowInspectorProps {
  node: WaFlowNode | null;
  onChange: (node: WaFlowNode) => void;
  onDelete: (id: string) => void;
}

export const FlowInspector: React.FC<FlowInspectorProps> = ({ node, onChange, onDelete }) => {
  if (!node) {
    return (
      <div className="p-4 text-sm text-on-surface-variant">
        Selecione um bloco no canvas para editar o conteúdo.
      </div>
    );
  }

  const meta = BLOCK_META[node.type];
  const patch = (data: Partial<WaFlowNode['data']>) => onChange({ ...node, data: { ...node.data, ...data } });

  return (
    <div className="p-4 space-y-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">{meta.label}</p>
        <p className="text-xs text-on-surface-variant mt-1">{meta.hint}</p>
      </div>

      {node.type === 'trigger_message' && (
        <>
          <label className="block text-[11px] text-on-surface-variant">
            Quando
            <select
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1.5 text-white text-sm"
              value={node.data.match || 'any'}
              onChange={(e) => patch({ match: e.target.value as 'any' | 'contains' | 'regex' })}
            >
              <option value="any">Qualquer mensagem</option>
              <option value="contains">Contém palavra</option>
              <option value="regex">Regex</option>
            </select>
          </label>
          {node.data.match !== 'any' && (
            <input
              className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1.5 text-white text-sm"
              placeholder="oi, menu, /ajuda/i"
              value={node.data.keyword || ''}
              onChange={(e) => patch({ keyword: e.target.value })}
            />
          )}
        </>
      )}

      {node.type === 'trigger_event' && (
        <select
          className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1.5 text-white text-sm"
          value={node.data.event || 'deploy_fail'}
          onChange={(e) => patch({ event: e.target.value as WaPanelEvent })}
        >
          {(Object.keys(EVENT_LABELS) as WaPanelEvent[]).map((key) => (
            <option key={key} value={key}>
              {EVENT_LABELS[key]}
            </option>
          ))}
        </select>
      )}

      {(node.type === 'send_text' || node.type === 'menu') && (
        <textarea
          className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1.5 text-white text-sm min-h-[88px]"
          placeholder="Olá {{nome}} — use {{app}} e {{evento}} em alertas"
          value={node.data.text || ''}
          onChange={(e) => patch({ text: e.target.value })}
        />
      )}

      {node.type === 'menu' && (
        <div className="space-y-2">
          {(node.data.buttons || []).map((btn, i) => (
            <input
              key={btn.id}
              className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1.5 text-white text-sm"
              value={btn.label}
              placeholder={`Botão ${i + 1}`}
              onChange={(e) => {
                const buttons = [...(node.data.buttons || [])];
                buttons[i] = { ...btn, label: e.target.value };
                patch({ buttons });
              }}
            />
          ))}
        </div>
      )}

      {node.type === 'condition' && (
        <>
          <select
            className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1.5 text-white text-sm"
            value={node.data.operator || 'contains'}
            onChange={(e) => patch({ operator: e.target.value as 'contains' | 'equals' })}
          >
            <option value="contains">Contém</option>
            <option value="equals">Igual a</option>
          </select>
          <input
            className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1.5 text-white text-sm"
            value={node.data.value || ''}
            placeholder="valor comparado"
            onChange={(e) => patch({ value: e.target.value })}
          />
        </>
      )}

      <button
        type="button"
        onClick={() => onDelete(node.id)}
        className="text-xs text-crit hover:underline"
      >
        Remover bloco
      </button>
    </div>
  );
};
