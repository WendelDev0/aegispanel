import React, { createContext, useContext, useState, useRef } from 'react';
import { AlertTriangle, AlertOctagon, HelpCircle, X } from 'lucide-react';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'crit' | 'warn' | 'primary';
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export const useConfirm = () => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return ctx.confirm;
};

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    options: ConfirmOptions;
  }>({
    isOpen: false,
    options: { title: '', message: '' },
  });

  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = (options: ConfirmOptions): Promise<boolean> => {
    setModalState({
      isOpen: true,
      options: {
        confirmLabel: 'Confirmar',
        cancelLabel: 'Cancelar',
        tone: 'primary',
        ...options,
      },
    });

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  };

  const handleClose = (result: boolean) => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
    if (resolverRef.current) {
      resolverRef.current(result);
      resolverRef.current = null;
    }
  };

  const { isOpen, options } = modalState;

  const getToneDetails = () => {
    switch (options.tone) {
      case 'crit':
        return {
          icon: <AlertOctagon className="w-5 h-5 text-crit" />,
          btn: 'bg-crit hover:bg-crit/90 text-white',
          badge: 'bg-crit/10 border-crit/30',
        };
      case 'warn':
        return {
          icon: <AlertTriangle className="w-5 h-5 text-warn" />,
          btn: 'bg-warn hover:bg-warn/90 text-surface-container-lowest font-medium',
          badge: 'bg-warn/10 border-warn/30',
        };
      case 'primary':
      default:
        return {
          icon: <HelpCircle className="w-5 h-5 text-primary" />,
          btn: 'bg-primary hover:bg-primary/90 text-surface-container-lowest font-medium',
          badge: 'bg-primary/10 border-primary/30',
        };
    }
  };

  const tone = getToneDetails();

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div
            className="relative w-full max-w-md bg-surface-container border border-outline-variant rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
            role="dialog"
            aria-modal="true"
          >
            {/* Header */}
            <div className="p-5 flex items-start gap-3.5">
              <div className={`p-2.5 rounded-lg border shrink-0 ${tone.badge}`}>
                {tone.icon}
              </div>
              <div className="flex-1 min-w-0 pr-2">
                <h3 className="text-sm font-semibold text-on-surface tracking-[-0.01em]">
                  {options.title}
                </h3>
                <p className="text-xs text-on-surface-variant/90 mt-1.5 leading-relaxed break-words whitespace-pre-line">
                  {options.message}
                </p>
              </div>
              <button
                onClick={() => handleClose(false)}
                className="text-on-surface-variant/60 hover:text-on-surface p-1 rounded hover:bg-surface-container-high transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 bg-surface-container-lowest border-t border-outline-variant flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => handleClose(false)}
                className="px-3.5 py-1.5 text-xs font-medium text-on-surface-variant hover:text-on-surface bg-surface-container hover:bg-surface-container-high rounded-md border border-outline-variant transition-colors"
              >
                {options.cancelLabel || 'Cancelar'}
              </button>
              <button
                type="button"
                onClick={() => handleClose(true)}
                className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${tone.btn}`}
              >
                {options.confirmLabel || 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
};
