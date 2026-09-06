import React, { memo, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

export interface FlowEdgeData extends Record<string, unknown> {
  onDelete?: (id: string) => void;
  /** Set while another block is selected, so the active path stays readable. */
  dimmed?: boolean;
  /** Which output of the source block this edge leaves from. */
  handleLabel?: string;
}

const STROKE = '#424754';
const STROKE_ACTIVE = '#7c8cff';

/**
 * A connection you can actually get rid of.
 *
 * The default edge is a 2px line with no arrowhead: nothing said which way a
 * connection ran, the hit area was the line itself, and the editor disabled
 * React Flow's own delete key without putting anything in its place — so a
 * wrong connection could be drawn and never removed. The × appears on hover
 * because the keyboard route is invisible to someone who has just drawn their
 * first flow.
 */
export const FlowEdge = memo(
  ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    selected,
    data,
  }: EdgeProps) => {
    const [hovered, setHovered] = useState(false);
    const edge = (data || {}) as FlowEdgeData;

    const [path, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });

    const active = Boolean(selected) || hovered;

    return (
      <>
        <BaseEdge
          id={id}
          path={path}
          markerEnd={markerEnd}
          style={{
            stroke: active ? STROKE_ACTIVE : STROKE,
            strokeWidth: active ? 2.5 : 2,
            opacity: edge.dimmed && !active ? 0.25 : 1,
            transition: 'stroke 120ms, opacity 120ms',
          }}
        />
        {/* Invisible and fat: the visible line is far too thin to click. */}
        <path
          d={path}
          fill="none"
          strokeWidth={20}
          stroke="transparent"
          style={{ cursor: 'pointer' }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        />

        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan flex items-center gap-1"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            {edge.handleLabel && (active || !edge.dimmed) && (
              <span className="px-1.5 py-0.5 rounded bg-surface-container border border-outline-variant text-[9px] font-mono text-on-surface-variant">
                {edge.handleLabel}
              </span>
            )}
            {active && (
              <button
                type="button"
                title="Remover ligação"
                aria-label="Remover ligação"
                onClick={(event) => {
                  event.stopPropagation();
                  edge.onDelete?.(id);
                }}
                className="w-5 h-5 rounded-full bg-surface-container border border-crit/50 text-crit hover:bg-crit hover:text-white flex items-center justify-center text-[11px] leading-none transition-colors shadow"
              >
                ×
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      </>
    );
  }
);

FlowEdge.displayName = 'FlowEdge';
