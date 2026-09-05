import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Copy, Settings2, Trash2 } from 'lucide-react';
import type { WaFlowNodeData, WaFlowNodeType } from '../../types/index.js';
import { BLOCK_META } from './flow-blocks.js';

export type FlowBlockData = Record<string, unknown> & WaFlowNodeData & {
  blockType: WaFlowNodeType;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onInspect?: (id: string) => void;
};

function stop(e: React.MouseEvent) {
  e.stopPropagation();
  e.preventDefault();
}

export const FlowBlockNode = memo(({ id, data, selected }: NodeProps) => {
  const block = (data as unknown) as FlowBlockData;
  const meta = BLOCK_META[block.blockType] || BLOCK_META.send_text;
  const buttons = block.buttons || [];

  return (
    <div
      className={`relative w-[248px] bg-surface-container border rounded-xl overflow-hidden transition-all ${
        selected ? `${meta.tone} ring-1` : 'border-outline-variant hover:border-outline'
      }`}
    >
      <span className={`absolute inset-y-0 left-0 w-[3px] ${meta.bar}`} aria-hidden />

      <div className={`flex items-center justify-between pl-4 pr-2 py-1.5 border-b border-outline-variant/50 ${meta.header}`}>
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${meta.badgeTone}`}>
          {meta.verb}
        </span>
        <div className="flex items-center gap-0.5 nodrag nopan">
          <button
            type="button"
            title="Configurar bloco"
            onClick={(e) => {
              stop(e);
              block.onInspect?.(id);
            }}
            className="p-1 rounded text-on-surface-variant hover:text-white hover:bg-surface-container-high"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Duplicar bloco"
            onClick={(e) => {
              stop(e);
              block.onDuplicate?.(id);
            }}
            className="p-1 rounded text-on-surface-variant hover:text-white hover:bg-surface-container-high"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Apagar bloco (Delete)"
            onClick={(e) => {
              stop(e);
              block.onDelete?.(id);
            }}
            className="p-1 rounded text-on-surface-variant hover:text-crit hover:bg-crit/10"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {block.blockType !== 'trigger_message' && block.blockType !== 'trigger_event' && (
        <Handle
          type="target"
          position={Position.Top}
          className={`!w-2.5 !h-2.5 !border !border-surface-container ${meta.handle}`}
        />
      )}

      <div className="pl-4 pr-3.5 py-2.5">
        <p className="text-xs font-semibold text-white leading-tight">{meta.label}</p>
        <p className="text-[11px] text-on-surface-variant mt-1 leading-snug line-clamp-2 break-words">
          {meta.preview((block as unknown) as Record<string, unknown>)}
        </p>
      </div>

      {block.blockType === 'condition' ? (
        <div className="px-3 pb-2 pt-1 border-t border-outline-variant/40 flex justify-between text-[10px] font-mono text-on-surface-variant">
          <div className="relative flex items-center gap-1">
            <span className="text-ok font-semibold">Sim</span>
            <Handle type="source" id="yes" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-ok !border !border-surface-container" style={{ left: '16px' }} />
          </div>
          <div className="relative flex items-center gap-1">
            <span className="text-crit font-semibold">Não</span>
            <Handle type="source" id="no" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-crit !border !border-surface-container" style={{ right: '16px' }} />
          </div>
        </div>
      ) : block.blockType === 'menu' ? (
        <div className="px-3 pb-2 pt-1 border-t border-outline-variant/40 flex flex-wrap gap-1.5 justify-center">
          {buttons.map((btn, i) => (
            <span
              key={btn.id}
              className="relative text-[10px] px-2 py-0.5 rounded bg-surface-container-high border border-outline-variant text-on-surface"
            >
              {btn.label || `Opção ${i + 1}`}
              <Handle
                type="source"
                id={btn.id}
                position={Position.Bottom}
                className={`!w-2.5 !h-2.5 !border !border-surface-container ${meta.handle}`}
                style={{ left: '50%' }}
              />
            </span>
          ))}
        </div>
      ) : block.blockType === 'capture' ? (
        <div className="px-3 pb-2 pt-1 border-t border-outline-variant/40 flex justify-between text-[10px] font-mono text-on-surface-variant">
          <div className="relative flex items-center gap-1">
            <span className="text-ok">válido</span>
            <Handle type="source" id="next" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-ok !border !border-surface-container" style={{ left: '20px' }} />
          </div>
          <div className="relative flex items-center gap-1">
            <span className="text-crit">inválido</span>
            <Handle type="source" id="invalid" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-crit !border !border-surface-container" style={{ right: '20px' }} />
          </div>
        </div>
      ) : block.blockType === 'agent' || block.blockType === 'http' ? (
        <div className="px-3 pb-2 pt-1 border-t border-outline-variant/40 flex justify-between text-[10px] font-mono text-on-surface-variant">
          <div className="relative flex items-center gap-1">
            <span className="text-ok">sucesso</span>
            <Handle type="source" id="next" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-ok !border !border-surface-container" style={{ left: '24px' }} />
          </div>
          <div className="relative flex items-center gap-1">
            <span className="text-crit">erro</span>
            <Handle type="source" id="error" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-crit !border !border-surface-container" style={{ right: '20px' }} />
          </div>
        </div>
      ) : block.blockType === 'sql' ? (
        <div className="px-3 pb-2 pt-1 border-t border-outline-variant/40 flex justify-between text-[10px] font-mono text-on-surface-variant">
          <div className="relative flex items-center gap-1">
            <span className="text-ok">dados</span>
            <Handle type="source" id="next" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-ok !border !border-surface-container" style={{ left: '16px' }} />
          </div>
          <div className="relative flex items-center gap-1">
            <span className="text-warn">vazio</span>
            <Handle type="source" id="empty" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-warn !border !border-surface-container" style={{ left: '50%' }} />
          </div>
          <div className="relative flex items-center gap-1">
            <span className="text-crit">erro</span>
            <Handle type="source" id="error" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-crit !border !border-surface-container" style={{ right: '16px' }} />
          </div>
        </div>
      ) : (
        block.blockType !== 'end' && (
          <Handle
            type="source"
            position={Position.Bottom}
            className={`!w-2.5 !h-2.5 !border !border-surface-container ${meta.handle}`}
          />
        )
      )}
    </div>
  );
});

FlowBlockNode.displayName = 'FlowBlockNode';
