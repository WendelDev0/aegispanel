import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { WaFlowNodeType, WaPanelEvent } from '../../types/index.js';
import { BLOCK_META } from './flow-blocks.js';

export type FlowBlockData = {
  blockType: WaFlowNodeType;
  match?: 'any' | 'contains' | 'regex';
  keyword?: string;
  event?: WaPanelEvent;
  text?: string;
  buttons?: Array<{ id: string; label: string }>;
  operator?: 'contains' | 'equals';
  value?: string;
};

export const FlowBlockNode = memo(({ data, selected }: NodeProps) => {
  const block = data as FlowBlockData;
  const meta = BLOCK_META[block.blockType];
  const buttons = block.buttons || [];

  return (
    <div
      className={`relative w-[220px] bg-surface-container border rounded-lg overflow-hidden ${
        selected ? 'border-primary' : 'border-outline-variant'
      }`}
    >
      <span className={`absolute inset-y-0 left-0 w-[3px] ${meta.tone}`} aria-hidden />
      {block.blockType !== 'trigger_message' && block.blockType !== 'trigger_event' && (
        <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-outline !border-0" />
      )}
      <div className="pl-3 pr-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">{meta.label}</p>
        <p className="text-xs text-white mt-1 leading-snug break-words">{meta.preview(block)}</p>
      </div>
      {block.blockType === 'condition' ? (
        <>
          <Handle
            type="source"
            id="yes"
            position={Position.Bottom}
            className="!w-2 !h-2 !bg-ok !border-0"
            style={{ left: '30%' }}
          />
          <Handle
            type="source"
            id="no"
            position={Position.Bottom}
            className="!w-2 !h-2 !bg-crit !border-0"
            style={{ left: '70%' }}
          />
          <div className="flex justify-between px-4 pb-1 text-[9px] font-mono text-on-surface-variant">
            <span>sim</span>
            <span>não</span>
          </div>
        </>
      ) : block.blockType === 'menu' && buttons.length > 0 ? (
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          {buttons.map((btn, i) => (
            <span key={btn.id} className="relative text-[10px] px-1.5 py-0.5 rounded border border-outline-variant text-on-surface-variant">
              {btn.label || `Opção ${i + 1}`}
              <Handle
                type="source"
                id={btn.id}
                position={Position.Bottom}
                className="!w-2 !h-2 !bg-primary !border-0"
                style={{ left: `${((i + 0.5) / buttons.length) * 100}%` }}
              />
            </span>
          ))}
        </div>
      ) : (
        block.blockType !== 'end' && (
          <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-outline !border-0" />
        )
      )}
    </div>
  );
});

FlowBlockNode.displayName = 'FlowBlockNode';
