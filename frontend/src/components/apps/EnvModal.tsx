import React, { useEffect, useState } from 'react';
import { RefreshCw, Save, Sliders, X } from 'lucide-react';
import { api } from '../../services/api.js';
import { EnvEditor } from '../EnvEditor.js';
import type { AppRecord } from '../../types/index.js';

interface EnvModalProps {
  app: AppRecord;
  onClose: () => void;
  onSaved: () => void;
}

export const EnvModal: React.FC<EnvModalProps> = ({ app, onClose, onSaved }) => {
  const [envRecordDraft, setEnvRecordDraft] = useState<Record<string, string>>({});
  const [loadingEnv, setLoadingEnv] = useState(true);
  const [savingEnv, setSavingEnv] = useState(false);
  const [redeployOnSave, setRedeployOnSave] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingEnv(true);
        const res = await api.get(`/apps/${app.id}/env`);
        if (cancelled) return;
        setEnvRecordDraft(res.data.env || {});
      } catch (err: any) {
        alert('Erro ao carregar variáveis: ' + (err.response?.data?.error || err.message));
      } finally {
        if (!cancelled) setLoadingEnv(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app.id]);

  const handleSaveEnv = async () => {
    try {
      setSavingEnv(true);
      await api.put(`/apps/${app.id}/env?redeploy=${redeployOnSave}`, { env: envRecordDraft });
      onSaved();
      alert('✅ Variáveis de ambiente (.env) atualizadas e aplicadas com sucesso!');
    } catch (err: any) {
      alert('Erro ao salvar .env: ' + (err.response?.data?.error || err.message));
    } finally {
      setSavingEnv(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface-container rounded-xl border border-outline-variant w-full max-w-2xl overflow-hidden p-6 space-y-4 shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between pb-3 border-b border-outline-variant">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-warn/10 p-2 flex items-center justify-center text-warn">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Variáveis de Ambiente (.env)</h3>
              <p className="text-[11px] text-on-surface-variant font-mono">Aplicação: {app.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-on-surface-variant hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto custom-scrollbar flex-1 pr-1">
          {loadingEnv ? (
            <div className="flex items-center justify-center p-12 text-on-surface-variant gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-primary" />
              <span className="text-xs">Carregando variáveis do servidor...</span>
            </div>
          ) : (
            <EnvEditor
              initialEnv={envRecordDraft}
              onChange={(record) => {
                setEnvRecordDraft(record);
              }}
              title="Variáveis em Produção"
            />
          )}
        </div>

        <div className="pt-3 border-t border-outline-variant flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-xs text-on-surface select-none">
            <input
              type="checkbox"
              checked={redeployOnSave}
              onChange={(e) => setRedeployOnSave(e.target.checked)}
              className="rounded border-outline-variant text-primary focus:ring-primary w-4 h-4"
            />
            <span>Reiniciar contêiner e aplicar alterações imediatamente</span>
          </label>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-on-surface-variant hover:text-white text-xs font-medium"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSaveEnv}
              disabled={savingEnv || loadingEnv}
              className="px-5 py-2.5 bg-primary-container hover:bg-primary text-white rounded-lg text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 shadow-md flex items-center gap-1.5"
            >
              {savingEnv ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Salvando & Aplicando...</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Salvar Variáveis (.env)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
