import React from 'react';
import { X, AlertCircle, CheckCircle, ArrowRight } from 'lucide-react';

export interface ValidationError {
  nodeId?: string;
  message: string;
}

interface FlowValidationModalProps {
  isOpen: boolean;
  errors: ValidationError[];
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
}

export const FlowValidationModal: React.FC<FlowValidationModalProps> = ({
  isOpen,
  errors,
  onClose,
  onSelectNode,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-surface-container border border-outline-variant rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-outline-variant bg-surface-container-high/60">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-crit" />
            <h3 className="text-sm font-bold text-white">Problemas encontrados no fluxo</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-on-surface-variant hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 max-h-[380px] overflow-y-auto space-y-2">
          <p className="text-xs text-on-surface-variant mb-3">
            Para publicar este fluxo com segurança, resolva os seguintes pontos identificados pelo validador:
          </p>

          {errors.map((err, idx) => (
            <div
              key={idx}
              onClick={() => {
                if (err.nodeId) {
                  onSelectNode(err.nodeId);
                  onClose();
                }
              }}
              className={`p-3 rounded-xl border border-crit/30 bg-crit/10 text-xs flex items-start justify-between gap-3 transition-all ${
                err.nodeId ? 'cursor-pointer hover:bg-crit/15 hover:border-crit/50' : ''
              }`}
            >
              <div className="flex-1">
                {err.nodeId && (
                  <span className="inline-block text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-crit/20 text-crit mb-1">
                    Bloco: {err.nodeId}
                  </span>
                )}
                <p className="text-white font-medium leading-snug">{err.message}</p>
              </div>
              {err.nodeId && (
                <span className="flex items-center gap-1 text-[11px] text-primary font-semibold shrink-0 mt-1">
                  Corrigir <ArrowRight className="w-3.5 h-3.5" />
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-3.5 border-t border-outline-variant bg-surface-container-high/40 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-surface-container-high text-white text-xs font-semibold hover:bg-surface-container-highest transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
