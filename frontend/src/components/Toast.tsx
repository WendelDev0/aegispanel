import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  durationMs?: number;
}

interface ToastContextType {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, 'id'>) => string;
  removeToast: (id: string) => void;
  success: (message: string, title?: string) => string;
  error: (message: string, title?: string) => string;
  warn: (message: string, title?: string) => string;
  info: (message: string, title?: string) => string;
}

const ToastContext = createContext<ToastContextType | null>(null);

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (item: Omit<ToastItem, 'id'>) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const newToast: ToastItem = { ...item, id };
      setToasts((prev) => [...prev, newToast]);

      const duration = item.durationMs ?? (item.type === 'error' ? 6000 : 4000);
      if (duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }
      return id;
    },
    [removeToast]
  );

  const success = useCallback((message: string, title?: string) => addToast({ type: 'success', message, title }), [addToast]);
  const error = useCallback((message: string, title?: string) => addToast({ type: 'error', message, title }), [addToast]);
  const warn = useCallback((message: string, title?: string) => addToast({ type: 'warning', message, title }), [addToast]);
  const info = useCallback((message: string, title?: string) => addToast({ type: 'info', message, title }), [addToast]);

  // Intercept window.alert so all existing calls seamlessly become modern toasts
  React.useEffect(() => {
    const originalAlert = window.alert;
    window.alert = (msg: any) => {
      const str = String(msg ?? '');
      if (str.startsWith('✅') || str.startsWith('🎉') || str.toLowerCase().includes('sucesso')) {
        success(str.replace(/^[✅🎉]\s*/, ''), 'Sucesso');
      } else if (str.toLowerCase().includes('erro') || str.toLowerCase().includes('falha') || str.startsWith('❌')) {
        error(str.replace(/^[❌⚠️]\s*/, ''), 'Atenção');
      } else if (str.toLowerCase().includes('atenção') || str.toLowerCase().includes('aviso')) {
        warn(str, 'Aviso');
      } else {
        info(str);
      }
    };
    return () => {
      window.alert = originalAlert;
    };
  }, [success, error, warn, info]);

  const getToastStyles = (type: ToastType) => {
    switch (type) {
      case 'success':
        return {
          icon: <CheckCircle2 className="w-4 h-4 text-ok shrink-0 mt-0.5" />,
          border: 'border-ok/30',
          bg: 'bg-surface-container-high',
          badge: 'text-ok',
          accent: 'bg-ok',
        };
      case 'error':
        return {
          icon: <AlertCircle className="w-4 h-4 text-crit shrink-0 mt-0.5" />,
          border: 'border-crit/30',
          bg: 'bg-surface-container-high',
          badge: 'text-crit',
          accent: 'bg-crit',
        };
      case 'warning':
        return {
          icon: <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />,
          border: 'border-warn/30',
          bg: 'bg-surface-container-high',
          badge: 'text-warn',
          accent: 'bg-warn',
        };
      case 'info':
      default:
        return {
          icon: <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />,
          border: 'border-primary/30',
          bg: 'bg-surface-container-high',
          badge: 'text-primary',
          accent: 'bg-primary',
        };
    }
  };

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, success, error, warn, info }}>
      {children}
      {/* Toast floating container */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((toast) => {
          const style = getToastStyles(toast.type);
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto relative flex items-start gap-3 p-3.5 rounded-lg border shadow-xl backdrop-blur-md transition-all duration-200 animate-in fade-in slide-in-from-bottom-3 ${style.bg} ${style.border}`}
            >
              <span className={`absolute inset-y-0 left-0 w-[3px] rounded-l-lg ${style.accent}`} />
              {style.icon}
              <div className="flex-1 min-w-0 pr-2">
                {toast.title && <h4 className="text-xs font-semibold text-on-surface mb-0.5">{toast.title}</h4>}
                <p className="text-xs text-on-surface-variant leading-relaxed break-words">{toast.message}</p>
              </div>
              <button
                onClick={() => removeToast(toast.id)}
                className="text-on-surface-variant/60 hover:text-on-surface p-1 rounded hover:bg-surface-container transition-colors shrink-0"
                title="Fechar notificação"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};
