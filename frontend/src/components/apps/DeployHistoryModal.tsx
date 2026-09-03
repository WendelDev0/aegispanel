import React from 'react';
import { Clock, X, CheckCircle2, RefreshCw, AlertCircle } from 'lucide-react';
import type { AppRecord, DeploymentRecord } from '../../types/index.js';

interface DeployHistoryModalProps {
  app: AppRecord;
  deployments: DeploymentRecord[];
  rollingBackId: string | null;
  onClose: () => void;
  onOpenLogs: (dep: DeploymentRecord) => void;
  onRollback: (appId: string, deploymentId: string) => void;
}

export const DeployHistoryModal: React.FC<DeployHistoryModalProps> = ({
  app,
  deployments,
  rollingBackId,
  onClose,
  onOpenLogs,
  onRollback,
}) => (
  <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
    <div className="bg-surface-container rounded-lg border border-outline-variant w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
      <div className="p-5 bg-surface-container-low/90 border-b border-outline-variant flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-ok" />
          <span className="font-bold text-white text-sm">Histórico de Deploys: {app.name}</span>
        </div>
        <button onClick={onClose} className="text-on-surface-variant hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 flex-1 overflow-y-auto space-y-3 custom-scrollbar">
        {deployments.length === 0 ? (
          <div className="text-center py-8 text-on-surface-variant/70 text-xs">
            Nenhum registro de build anterior encontrado.
          </div>
        ) : (
          deployments.map((dep) => (
            <div
              key={dep.id}
              className="p-4 rounded-lg bg-surface-container-low border border-outline-variant flex items-center justify-between hover:border-outline-variant transition-colors"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {dep.status === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-ok" />
                  ) : dep.status === 'building' ? (
                    <RefreshCw className="w-4 h-4 text-warn animate-spin" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-crit" />
                  )}
                  <span className="font-bold text-on-surface text-xs">{dep.commitMessage || 'Deploy'}</span>
                  <span className="text-[10px] font-mono text-primary bg-primary/20 px-2 py-0.5 rounded">
                    {dep.branch}
                  </span>
                </div>
                <p className="text-[11px] text-on-surface-variant font-mono">
                  Por {dep.authorName} • {new Date(dep.createdAt).toLocaleString('pt-BR')} • {dep.durationSeconds}s
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => onOpenLogs(dep)}
                  title="Ver saída de logs deste build"
                  className="px-3 py-1.5 rounded bg-surface-container-high hover:bg-surface-container-highest text-primary text-xs font-semibold transition-colors"
                >
                  Ver Logs
                </button>

                {dep.status === 'success' && (
                  <button
                    onClick={() => onRollback(app.id, dep.id)}
                    disabled={rollingBackId === dep.id}
                    title="Reverter a aplicação para este commit/versão"
                    className="px-3 py-1.5 rounded bg-warn/10 hover:bg-warn/15 text-warn border border-warn/30 text-xs font-semibold transition-colors flex items-center gap-1 active:scale-95 disabled:opacity-50"
                  >
                    <Clock className={`w-3.5 h-3.5 ${rollingBackId === dep.id ? 'animate-spin' : ''}`} />
                    <span>{rollingBackId === dep.id ? 'Revertendo...' : '⏪ Rollback'}</span>
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  </div>
);
