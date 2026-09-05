import React, { useCallback, useEffect, useState } from 'react';
import { Network, ShieldCheck, TriangleAlert } from 'lucide-react';
import { api } from '../../services/api.js';
import type { WaInternalRouteState, WaInternalRouteProbe } from '../../types/index.js';

/**
 * The addresses are never typed here. A wrong container name registers a
 * webhook nothing can reach, and the panel would still say "publicado" while
 * the bot went silent — so the button asks the backend to prove both
 * directions first and the operator only says yes or no.
 */
export const FlowInternalRouteCard: React.FC = () => {
  const [current, setCurrent] = useState<WaInternalRouteState | null>(null);
  const [probe, setProbe] = useState<WaInternalRouteProbe | null>(null);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/wa-flows/internal-route');
      setCurrent(res.data?.current || null);
      setProbe(res.data?.probe || null);
    } catch (err: any) {
      // Only admins may see this; a viewer simply gets no card.
      if (err?.response?.status === 403) setDenied(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (enabled: boolean) => {
      setBusy(true);
      try {
        const res = await api.post('/wa-flows/internal-route', { enabled });
        setProbe(res.data || null);
        setCurrent(res.data?.current || null);
      } catch (err: any) {
        setProbe(err?.response?.data || { ok: false, error: 'Não foi possível testar a rota interna.' });
      } finally {
        setBusy(false);
        void load();
      }
    },
    [load]
  );

  if (denied || !current) return null;

  const enabled = current.enabled;
  const available = Boolean(probe?.ok) || enabled;

  return (
    <div className="bg-surface-container border border-outline-variant rounded-xl px-3.5 py-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Network className="w-3.5 h-3.5 text-primary shrink-0" />
          <p className="text-xs font-semibold text-white">Rota interna</p>
          {enabled ? (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-ok">
              <ShieldCheck className="w-3 h-3" />
              Ligada
            </span>
          ) : (
            <span className="text-[10px] text-on-surface-variant">Tráfego pelo domínio público</span>
          )}
        </div>
        <button
          type="button"
          disabled={busy || (!available && !enabled)}
          onClick={() => void toggle(!enabled)}
          className="text-[11px] font-semibold text-primary hover:underline disabled:text-on-surface-variant disabled:no-underline disabled:cursor-not-allowed"
        >
          {busy ? 'Testando…' : enabled ? 'Voltar ao domínio público' : 'Testar e ligar'}
        </button>
      </div>

      <p className="text-[11px] text-on-surface-variant">
        Com a Evolution rodando neste mesmo painel, o webhook e os envios podem ir pela rede do Docker. Uma resposta do
        bot deixa de depender de DNS público e da renovação do certificado.
      </p>

      {enabled && current.panelBaseUrl && (
        <p className="text-[10px] font-mono text-on-surface-variant break-all">
          Evolution → {current.panelBaseUrl}
          {current.evolutionUrl ? ` · painel → ${current.evolutionUrl}` : ''}
        </p>
      )}

      {!enabled && probe?.ok && probe.suggestion && (
        <p className="text-[10px] font-mono text-ok break-all">
          Testado: {probe.suggestion.upstream} responde, e a Evolution alcança {probe.panelBaseUrl}.
        </p>
      )}

      {probe && !probe.ok && probe.error && (
        <p className="flex items-start gap-1.5 text-[11px] text-warn">
          <TriangleAlert className="w-3 h-3 mt-0.5 shrink-0" />
          <span className="break-words">{probe.error}</span>
        </p>
      )}
    </div>
  );
};
