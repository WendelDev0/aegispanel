import React from 'react';
import { ExternalLink, Plus, Radio, RefreshCw } from 'lucide-react';
import type { EvolutionInstanceInfo } from '../../types/index.js';

function statusLabel(status: EvolutionInstanceInfo['connectionStatus']): { text: string; cls: string } {
  if (status === 'open') return { text: 'Conectada', cls: 'bg-ok/10 text-ok border-ok/30' };
  if (status === 'connecting') return { text: 'Conectando', cls: 'bg-warn/10 text-warn border-warn/30' };
  if (status === 'close') return { text: 'Desconectada', cls: 'bg-crit/10 text-crit border-crit/30' };
  return { text: 'Desconhecida', cls: 'bg-surface-container-high text-on-surface-variant border-outline-variant' };
}

function formatNumber(digits?: string): string {
  if (!digits) return 'Número ainda não lido';
  if (digits.length === 13 && digits.startsWith('55')) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  return digits;
}

interface FlowInstancesPanelProps {
  instances: EvolutionInstanceInfo[];
  bound: string[];
  managerUrl: string | null;
  loading?: boolean;
  error?: string;
  onToggle: (name: string) => void;
  onRefresh: () => void;
}

export const FlowInstancesPanel: React.FC<FlowInstancesPanelProps> = ({
  instances,
  bound,
  managerUrl,
  loading,
  error,
  onToggle,
  onRefresh,
}) => {
  return (
    <div className="bg-surface-container border border-outline-variant rounded-xl px-3.5 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Radio className="w-3.5 h-3.5 text-primary shrink-0" />
          <p className="text-xs font-semibold text-white">Linhas WhatsApp</p>
          <span className="text-[10px] text-on-surface-variant">
            {bound.length ? `${bound.length} ligada${bound.length > 1 ? 's' : ''} neste fluxo` : 'Nenhuma ligada'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="flex items-center gap-1 text-[11px] text-on-surface-variant hover:text-white"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
          {managerUrl && (
            <a
              href={managerUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
            >
              <Plus className="w-3 h-3" />
              Nova instância
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>

      {error && <p className="text-[11px] text-crit">{error}</p>}

      {instances.length === 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-outline-variant px-3 py-2">
          <p className="text-[11px] text-on-surface-variant">
            Nenhuma instância visível. Abra o manager da Evolution, crie a linha e volte aqui.
          </p>
          {managerUrl && (
            <a
              href={managerUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] font-semibold text-primary shrink-0"
            >
              Abrir manager
            </a>
          )}
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {instances.map((inst) => {
            const active = bound.some((name) => name.toLowerCase() === inst.name.toLowerCase());
            const status = statusLabel(inst.connectionStatus);
            return (
              <button
                key={inst.name}
                type="button"
                onClick={() => onToggle(inst.name)}
                className={`min-w-[220px] text-left rounded-lg border px-3 py-2 transition-colors ${
                  active
                    ? 'bg-primary/10 border-primary/40'
                    : 'bg-surface-container-low border-outline-variant hover:border-outline'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-bold text-white truncate">{inst.name}</span>
                  <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded border font-semibold ${status.cls}`}>
                    {status.text}
                  </span>
                </div>
                <p className="text-[11px] text-on-surface mt-1 font-mono">{formatNumber(inst.number)}</p>
                {inst.profileName && (
                  <p className="text-[10px] text-on-surface-variant truncate">{inst.profileName}</p>
                )}
                {inst.competitors && inst.competitors.length > 0 && (
                  <p className="text-[10px] text-warn mt-1">Também ligado: {inst.competitors.join(', ')}</p>
                )}
                <p className="text-[10px] text-on-surface-variant mt-1">
                  {active ? 'Clique para desligar deste fluxo' : 'Clique para usar neste fluxo'}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
