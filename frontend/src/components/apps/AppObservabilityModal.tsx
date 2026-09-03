import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertCircle, RefreshCw, X } from 'lucide-react';
import { api } from '../../services/api.js';
import type { AlertHistoryRecord, AppMetricsSnapshot, AppRecord } from '../../types/index.js';

interface AppObservabilityModalProps {
  app: AppRecord;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function usageTone(percent: number): string {
  if (percent >= 90) return 'bg-crit';
  if (percent >= 70) return 'bg-warn';
  return 'bg-ok';
}

export const AppObservabilityModal: React.FC<AppObservabilityModalProps> = ({ app, onClose }) => {
  const [metrics, setMetrics] = useState<AppMetricsSnapshot | null>(null);
  const [alerts, setAlerts] = useState<AlertHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [metricsRes, alertsRes] = await Promise.all([
        api.get(`/apps/${app.id}/metrics`),
        api.get(`/apps/${app.id}/alerts`),
      ]);
      setMetrics(metricsRes.data);
      setAlerts(Array.isArray(alertsRes.data) ? alertsRes.data : []);
    } catch (err) {
      console.error('Failed to load app observability:', err);
    } finally {
      setLoading(false);
    }
  }, [app.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface-container rounded-lg border border-outline-variant w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="p-4 bg-surface-container-low/90 border-b border-outline-variant flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            <span className="font-bold text-white text-sm">Observabilidade: {app.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void load()}
              className="p-1.5 rounded-lg text-on-surface-variant hover:text-white bg-surface-container-high"
              title="Atualizar"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="text-on-surface-variant hover:text-white p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto custom-scrollbar">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-3">
              CPU e memória do contêiner
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-surface-container-low border border-outline-variant rounded-lg p-3">
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-on-surface-variant">CPU</span>
                  <span className="text-white font-mono">{metrics?.cpuPercent ?? 0}%</span>
                </div>
                <div className="h-1.5 bg-surface-container-highest rounded overflow-hidden">
                  <div
                    className={`h-full ${usageTone(metrics?.cpuPercent ?? 0)}`}
                    style={{ width: `${Math.min(100, metrics?.cpuPercent ?? 0)}%` }}
                  />
                </div>
              </div>
              <div className="bg-surface-container-low border border-outline-variant rounded-lg p-3">
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-on-surface-variant">Memória</span>
                  <span className="text-white font-mono">{metrics?.memoryPercent ?? 0}%</span>
                </div>
                <div className="h-1.5 bg-surface-container-highest rounded overflow-hidden">
                  <div
                    className={`h-full ${usageTone(metrics?.memoryPercent ?? 0)}`}
                    style={{ width: `${Math.min(100, metrics?.memoryPercent ?? 0)}%` }}
                  />
                </div>
                <p className="text-[10px] text-on-surface-variant mt-2 font-mono">
                  {formatBytes(metrics?.memoryUsedBytes ?? 0)} / {formatBytes(metrics?.memoryLimitBytes ?? 0)}
                </p>
              </div>
            </div>
            <p className="text-[11px] text-on-surface-variant mt-2">
              Logs retidos em disco: {formatBytes(metrics?.retainedLogBytes ?? 0)} (rotação automática, teto global 80 MB)
            </p>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-3">
              Histórico de alertas
            </h4>
            {alerts.length === 0 ? (
              <p className="text-sm text-on-surface-variant">Nenhum alerta registrado para esta aplicação.</p>
            ) : (
              <ul className="space-y-2">
                {alerts.map((alert) => (
                  <li
                    key={alert.id}
                    className="border border-outline-variant rounded-lg p-3 bg-surface-container-low"
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle className={`w-4 h-4 mt-0.5 ${alert.isError ? 'text-crit' : 'text-ok'}`} />
                      <div>
                        <p className="text-sm text-white font-semibold">{alert.title}</p>
                        <p className="text-xs text-on-surface-variant whitespace-pre-wrap mt-1">{alert.message}</p>
                        <p className="text-[10px] font-mono text-on-surface-variant/70 mt-1">
                          {new Date(alert.createdAt).toLocaleString('pt-BR')}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
