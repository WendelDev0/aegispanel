import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { WaFlowNodeData, WaFlowNodeType } from '../../types/index.js';
import { BLOCK_META } from './flow-blocks.js';

export type FlowBlockData = Record<string, unknown> & WaFlowNodeData & {
  blockType: WaFlowNodeType;
};

export const FlowBlockNode = memo(({ data, selected }: NodeProps) => {
  const block = (data as unknown) as FlowBlockData;
  const meta = BLOCK_META[block.blockType] || BLOCK_META.send_text;
  const buttons = block.buttons || [];

  return (
    <div
      className={`relative w-[230px] bg-surface-container border rounded-xl shadow-lg transition-all ${
        selected ? 'border-primary ring-1 ring-primary/40' : 'border-outline-variant hover:border-outline'
      }`}
    >
      {/* Top indicator bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-outline-variant/60 bg-surface-container-high/60 rounded-t-xl">
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${meta.badgeTone}`}>
          {meta.verb}
        </span>
        <span className="text-[10px] text-on-surface-variant font-mono truncate max-w-[80px]">
          {block.blockType}
        </span>
      </div>

      {/* Target handle (all non-triggers) */}
      {block.blockType !== 'trigger_message' && block.blockType !== 'trigger_event' && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-2.5 !h-2.5 !bg-outline !border !border-surface-container"
        />
      )}

      {/* Content body */}
      <div className="px-3.5 py-2.5">
        <p className="text-xs font-semibold text-white leading-tight">{meta.label}</p>
        <p className="text-[11px] text-on-surface-variant mt-1 leading-snug line-clamp-2 break-words">
          {meta.preview((block as unknown) as Record<string, unknown>)}
        </p>
      </div>

      {/* Output handles depending on block type */}
      {block.blockType === 'condition' ? (
        <div className="px-3 pb-2 pt-1 border-t border-outline-variant/40 flex justify-between text-[10px] font-mono text-on-surface-variant">
          <div className="relative flex items-center gap-1">
            <span className="text-ok font-semibold">Sim</span>
            <Handle
              type="source"
              id="yes"
              position={Position.Bottom}
              className="!w-2.5 !h-2.5 !bg-ok !border !border-surface-container"
              style={{ left: '16px' }}
            />
          </div>
          <div className="relative flex items-center gap-1">
            <span className="text-crit font-semibold">Não</span>
            <Handle
              type="source"
              id="no"
              position={Position.Bottom}
              className="!w-2.5 !h-2.5 !bg-crit !border !border-surface-container"
              style={{ right: '16px' }}
            />
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
                className="!w-2.5 !h-2.5 !bg-primary !border !border-surface-container"
                style={{ left: '50%' }}
              />
            </span>
          ))}
        </div>
      ) : block.blockType === 'capture' ? (
        <div className="px-3 pb-2 pt-1 border-t border-outline-variant/40 flex justify-between text-[10px] font-mono text-on-surface-variant">
          <div className="relative flex items-center gap-1">
            <span className="text-ok">válido</span>
            <Handle
              type="source"
              id="next"
              position={Position.Bottom}
              className="!w-2.5 !h-2.5 !bg-ok !border !border-surface-container"
              style={{ left: '20px' }}
            />
          </div>
          <div className="relative flex items-center gap-1">
            <span className="text-crit">inválido</span>
            <Handle
              type="source"
              id="invalid"
              position={Position.Bottom}
              className="!w-2.5 !h-2.5 !bg-crit !border !border-surface-container"
              style={{ right: '20px' }}
            />
          </div>
        </div>
      ) : block.blockType === 'agent' || block.blockType === 'http' ? (
        <div className="px-3 pb-2 pt-1 border-t border-outline-variant/40 flex justify-between text-[10px] font-mono text-on-surface-variant">
          <div className="relative flex items-center gap-1">
            <span className="text-ok">sucesso</span>
            <Handle
              type="source"
              id="next"
              position={Position.Bottom}
              className="!w-2.5 !h-2.5 !bg-ok !border !border-surface-container"
              style={{ left: '24px' }}
            />
          </div>
          <div className="relative flex items-center gap-1">
            <span className="text-crit">erro</span>
            <Handle
              type="source"
              id="error"
              position={Position.Bottom}
              className="!w-2.5 !h-2.5 !bg-crit !border !border-surface-container"
              style={{ right: '20px' }}
            />
          </div>
        </div>
      ) : block.blockType === 'sql' ? (
        <div className="px-3 pb-2 pt-1 border-t border-outline-variant/40 flex justify-between text-[10px] font-mono text-on-surface-variant">
          <div className="relative flex items-center gap-1">
            <span className="text-ok">dados</span>
            <Handle
              type="source"
              id="next"
              position={Position.Bottom}
              className="!w-2.5 !h-2.5 !bg-ok !border !border-surface-container"
              style={{ left: '16px' }}
            />
          </div>
          <div className="relative flex items-center gap-1">
            <span className="text-warn">vazio</span>
            <Handle
              type="source"
              id="empty"
              position={Position.Bottom}
              className="!w-2.5 !h-2.5 !bg-warn !border !border-surface-container"
              style={{ left: '50%' }}
            />
          </div>
          <div className="relative flex items-center gap-1">
            <span className="text-crit">erro</span>
            <Handle
              type="source"
              id="error"
              position={Position.Bottom}
              className="!w-2.5 !h-2.5 !bg-crit !border !border-surface-container"
              style={{ right: '16px' }}
            />
          </div>
        </div>
      ) : (
        block.blockType !== 'end' && (
          <Handle
            type="source"
            position={Position.Bottom}
            className="!w-2.5 !h-2.5 !bg-outline !border !border-surface-container"
          />
        )
      )}
    </div>
  );
});

FlowBlockNode.displayName = 'FlowBlockNode';
