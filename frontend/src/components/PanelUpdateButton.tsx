import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import { api } from '../services/api.js';
import { socket } from '../services/socket.js';

interface UpdateStatus {
  available: boolean;
  canApply: boolean;
  updating: boolean;
  behind: number;
  remoteSubject: string;
  currentSha: string;
  remoteSha: string;
}

const POLL_MS = 3 * 60 * 1000;

export const PanelUpdateButton: React.FC = () => {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [updating, setUpdating] = useState(false);
  const [output, setOutput] = useState('');
  const [openLog, setOpenLog] = useState(false);
  const updatingRef = useRef(false);

  const load = async (refresh = false) => {
    try {
      const res = await api.get('/system/panel/update-status', {
        params: refresh ? { refresh: 1 } : undefined,
      });
      setStatus(res.data);
      if (res.data?.updating) setUpdating(true);
    } catch {
      /* viewers and failed git fetch stay silent */
    }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onChunk = (data: { line?: string; status?: string; done?: boolean }) => {
      if (data.line) {
        setOutput((prev) => (prev + data.line).slice(-64 * 1024));
        setOpenLog(true);
      }
      if (data.done) {
        updatingRef.current = false;
        setUpdating(false);
        void load(true);
      }
    };
    socket.on('panel:self-update', onChunk);
    return () => {
      socket.off('panel:self-update', onChunk);
    };
  }, []);

  const apply = async () => {
    if (!status?.canApply) return;
    if (!confirm('Baixar a nova versão e reconstruir o painel agora? A página pode cair por alguns segundos — recarregue se precisar.')) {
      return;
    }
    try {
      updatingRef.current = true;
      setUpdating(true);
      setOpenLog(true);
      setOutput('[aegis] Baixando atualização…\n');
      await api.post('/system/panel/self-update', {}, { timeout: 11 * 60 * 1000 });
    } catch (err: any) {
      setOutput((prev) => `${prev}\n[aegis] ${err.response?.data?.error || err.message}\n`);
      updatingRef.current = false;
      setUpdating(false);
    }
  };

  if (!status?.available || !status.canApply) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void apply()}
        disabled={updating}
        title={status.remoteSubject || 'Nova versão do painel'}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-primary-container text-white text-xs font-semibold disabled:opacity-60"
      >
        {updating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        {updating ? 'Atualizando…' : status.behind > 1 ? `Atualizar (${status.behind})` : 'Atualizar'}
      </button>
      {openLog && output && (
        <div className="absolute right-0 top-10 w-[min(28rem,90vw)] bg-surface-container border border-outline-variant rounded-lg p-2 z-30">
          <div className="flex justify-end">
            <button type="button" onClick={() => setOpenLog(false)} className="p-1 text-on-surface-variant">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <pre className="max-h-48 overflow-auto text-[11px] font-mono text-ok whitespace-pre-wrap px-1 pb-1">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
};
