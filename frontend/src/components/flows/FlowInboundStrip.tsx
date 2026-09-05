import React from 'react';
import type { WaInboundEvent, WaInboundSkipSummary } from '../../types/index.js';

const OUTCOME_LABEL: Record<WaInboundEvent['outcome'], { text: string; cls: string }> = {
  handled: { text: 'Respondeu', cls: 'text-ok' },
  send_failed: { text: 'Envio falhou', cls: 'text-crit' },
  unmatched: { text: 'Sem gatilho', cls: 'text-warn' },
  rejected_secret: { text: 'Webhook recusado', cls: 'text-crit' },
  parse_failed: { text: 'Mensagem ilegível', cls: 'text-warn' },
  no_text: { text: 'Sem texto', cls: 'text-warn' },
  no_instance: { text: 'Sem instância', cls: 'text-warn' },
  handoff: { text: 'Com humano', cls: 'text-amber-300' },
};

interface FlowInboundStripProps {
  events: WaInboundEvent[];
  skipped?: WaInboundSkipSummary | null;
}

/**
 * The counter matters as much as the last event: on a personal line most
 * inbound is group traffic the panel drops on purpose. Without it, a quiet
 * strip reads as a dead webhook.
 */
const SkippedNote: React.FC<{ skipped?: WaInboundSkipSummary | null }> = ({ skipped }) => {
  if (!skipped || skipped.total < 1) return null;
  const parts: string[] = [];
  if (skipped.group) parts.push(`${skipped.group} de grupo`);
  if (skipped.from_me) parts.push(`${skipped.from_me} suas`);
  if (skipped.broadcast) parts.push(`${skipped.broadcast} de status`);
  if (skipped.newsletter) parts.push(`${skipped.newsletter} de canal`);

  return (
    <p className="text-[10px] text-on-surface-variant mt-1">
      Webhook ativo: {skipped.total} mensagens ignoradas por não serem conversa 1:1
      {parts.length ? ` (${parts.join(', ')})` : ''}.
    </p>
  );
};

export const FlowInboundStrip: React.FC<FlowInboundStripProps> = ({ events, skipped }) => {
  const last = events[0];
  if (!last) {
    return (
      <div className="rounded-xl border border-outline-variant bg-surface-container px-3.5 py-2 text-[11px] text-on-surface-variant">
        Ainda não chegou mensagem neste painel. Publique o fluxo, mande um texto no WhatsApp e o resultado aparece aqui.
        <SkippedNote skipped={skipped} />
      </div>
    );
  }

  const tone = OUTCOME_LABEL[last.outcome];
  const when = new Date(last.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container px-3.5 py-2 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">Última mensagem no WhatsApp</p>
        <p className="text-xs text-white mt-0.5 truncate">
          <span className={`font-semibold ${tone.cls}`}>{tone.text}</span>
          {last.repeated && last.repeated > 1 ? (
            <span className="text-on-surface-variant"> ×{last.repeated}</span>
          ) : null}
          {last.textExcerpt ? ` · “${last.textExcerpt}”` : ''}
          {last.phoneTail ? ` · …${last.phoneTail}` : ''}
          {last.instance ? ` · ${last.instance}` : ''}
        </p>
        {last.error && <p className="text-[11px] text-crit mt-0.5 break-words">{last.error}</p>}
        {last.flowName && last.outcome === 'handled' && (
          <p className="text-[10px] text-on-surface-variant mt-0.5">Fluxo: {last.flowName}</p>
        )}
        <SkippedNote skipped={skipped} />
      </div>
      <span className="text-[10px] font-mono text-on-surface-variant shrink-0">{when}</span>
    </div>
  );
};
