import React, { useCallback, useEffect, useState } from 'react';
import { FileText, RefreshCw, X } from 'lucide-react';
import { api } from '../../services/api.js';
import type { AppRecord } from '../../types/index.js';

interface AppLogsModalProps {
  app: AppRecord;
  onClose: () => void;
}

export const AppLogsModal: React.FC<AppLogsModalProps> = ({ app, onClose }) => {
  const [logsText, setLogsText] = useState('');
  const [logsLoading, setLogsLoading] = useState(true);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    setLogsText('');
    try {
      const res = await api.get(`/apps/${app.id}/logs`);
      setLogsText(res.data.logs || 'Sem logs disponíveis.');
    } catch (err: any) {
      setLogsText('Erro ao carregar logs: ' + err.message);
    } finally {
      setLogsLoading(false);
    }
  }, [app.id]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0a0f1c] rounded-lg border border-outline-variant w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="p-4 bg-surface-container-low/90 border-b border-outline-variant flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            <span className="font-bold text-white text-sm">Logs da Aplicação: {app.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadLogs()}
              className="p-1.5 rounded-lg text-on-surface-variant hover:text-white bg-surface-container-high hover:bg-surface-container-highest"
              title="Atualizar logs"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="text-on-surface-variant hover:text-white p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-5 flex-1 overflow-auto font-mono text-xs text-ok bg-black/90 whitespace-pre-wrap leading-relaxed custom-scrollbar">
          {logsLoading ? 'Carregando logs...' : logsText}
        </div>
      </div>
    </div>
  );
};
