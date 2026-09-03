import React from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, X, Zap } from 'lucide-react';
import type { AppRecord } from '../../types/index.js';

export interface LiveDeployState {
  app: AppRecord;
  step: number;
  stepName: string;
  logs: string;
  percentage: number;
  status: 'running' | 'success' | 'failed';
}

const STEPS = [
  { num: 1, label: 'Auth & Repo' },
  { num: 2, label: 'Git Clone' },
  { num: 3, label: 'Detector' },
  { num: 4, label: 'Build Docker' },
  { num: 5, label: 'Online' },
] as const;

interface LiveDeployModalProps {
  state: LiveDeployState;
  onClose: () => void;
}

export const LiveDeployModal: React.FC<LiveDeployModalProps> = ({ state, onClose }) => (
  <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
    <div className="bg-surface-container-lowest rounded-lg border border-primary/40 w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
      <div className="p-5 bg-surface-container-low/90 border-b border-outline-variant flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded ${
              state.status === 'success'
                ? 'bg-ok/15 text-ok'
                : state.status === 'failed'
                  ? 'bg-crit/15 text-crit'
                  : 'bg-primary/20 text-primary'
            }`}
          >
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-white text-base flex items-center gap-2">
              <span>Deploy em Tempo Real: {state.app.name}</span>
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full font-mono font-semibold ${
                  state.status === 'success'
                    ? 'bg-ok/15 text-ok'
                    : state.status === 'failed'
                      ? 'bg-crit/15 text-crit'
                      : 'bg-primary/20 text-primary animate-pulse'
                }`}
              >
                {state.status.toUpperCase()}
              </span>
            </h3>
            <p className="text-xs text-on-surface-variant">
              Step {state.step}/5: {state.stepName}
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="text-on-surface-variant hover:text-white p-2 rounded hover:bg-surface-container-high transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="w-full bg-surface-container-lowest h-2">
        <div
          className={`h-full transition-all duration-300 ${
            state.status === 'failed' ? 'bg-crit' : state.status === 'success' ? 'bg-ok' : 'bg-primary-container'
          }`}
          style={{ width: `${state.percentage}%` }}
        />
      </div>

      <div className="p-4 bg-surface-container-lowest/80 border-b border-outline-variant grid grid-cols-5 gap-2 text-center text-[11px]">
        {STEPS.map((st) => {
          const isPassed = state.step > st.num || state.status === 'success';
          const isCurrent = state.step === st.num && state.status === 'running';
          return (
            <div
              key={st.num}
              className={`p-2 rounded border transition-all ${
                isPassed
                  ? 'bg-ok/10 border-ok/30 text-ok font-semibold'
                  : isCurrent
                    ? 'bg-primary/20 border-primary text-white font-bold animate-pulse'
                    : 'bg-surface-container-low/40 border-outline-variant text-on-surface-variant/70'
              }`}
            >
              <div className="text-[10px] font-mono mb-0.5">PASSO {st.num}</div>
              <div className="truncate">{st.label}</div>
            </div>
          );
        })}
      </div>

      <div className="p-4 bg-black/95 flex-1 overflow-y-auto font-mono text-xs text-ok leading-relaxed custom-scrollbar whitespace-pre-wrap min-h-[250px] max-h-[350px]">
        {state.logs || 'Aguardando saída de build do servidor...'}
      </div>

      <div className="p-4 bg-surface-container-low/90 border-t border-outline-variant flex items-center justify-between">
        <span className="text-xs text-on-surface-variant flex items-center gap-2">
          {state.status === 'running' ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary" />
              <span>Compilando contêiner isolado...</span>
            </>
          ) : state.status === 'success' ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-ok" />
              <span>Aplicação compilada e online com sucesso!</span>
            </>
          ) : (
            <>
              <AlertCircle className="w-3.5 h-3.5 text-crit" />
              <span>O processo de build foi interrompido com erro.</span>
            </>
          )}
        </span>
        <button
          onClick={onClose}
          className="px-5 py-2 rounded bg-primary-container hover:bg-primary text-white font-semibold text-xs transition-all"
        >
          {state.status === 'running' ? 'Minimizar' : 'Fechar'}
        </button>
      </div>
    </div>
  </div>
);
