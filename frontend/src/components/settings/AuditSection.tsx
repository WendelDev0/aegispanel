import React, { useEffect, useState } from 'react';
import { Activity, Download, Filter } from 'lucide-react';
import { api, downloadAuthenticated } from '../../services/api.js';

interface AuditEvent {
  ts: string;
  actor?: { id: string; username: string; role: string };
  ip?: string;
  action: string;
  outcome: string;
}

export const AuditSection: React.FC = () => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (actor.trim()) params.set('actor', actor.trim());
      if (action.trim()) params.set('action', action.trim());
      params.set('limit', '200');
      const res = await api.get(`/system/audit?${params.toString()}`);
      setEvents(res.data);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Falha ao carregar a auditoria.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const exportCsv = async () => {
    const params = new URLSearchParams();
    if (actor.trim()) params.set('actor', actor.trim());
    if (action.trim()) params.set('action', action.trim());
    params.set('format', 'csv');
    await downloadAuthenticated(`/system/audit?${params.toString()}`, 'aegis-audit.csv');
  };

  return (
    <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded bg-sky-500/10 text-sky-400">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-white text-base">Auditoria</h3>
            <p className="text-xs text-on-surface-variant">
              Registro append-only de quem alterou o painel. Fora do estado JSON.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant text-xs text-on-surface-variant hover:text-white"
        >
          <Download className="w-3.5 h-3.5" />
          Exportar CSV
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
        className="flex flex-col sm:flex-row gap-2"
      >
        <input
          type="text"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          placeholder="Ator (usuário ou id)"
          className="flex-1 bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-white text-xs"
        />
        <input
          type="text"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="Ação contém…"
          className="flex-1 bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-white text-xs"
        />
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded bg-surface-container-high text-xs font-semibold text-on-surface disabled:opacity-50"
        >
          <Filter className="w-3.5 h-3.5" />
          Filtrar
        </button>
      </form>

      <div className="overflow-x-auto rounded border border-outline-variant">
        <table className="w-full text-xs">
          <thead className="bg-surface-container-high text-on-surface-variant uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Quando</th>
              <th className="text-left px-3 py-2 font-semibold">Ator</th>
              <th className="text-left px-3 py-2 font-semibold">IP</th>
              <th className="text-left px-3 py-2 font-semibold">Ação</th>
              <th className="text-left px-3 py-2 font-semibold">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-on-surface-variant">
                  {loading ? 'Carregando…' : 'Nenhum evento no período.'}
                </td>
              </tr>
            )}
            {events.map((e, i) => (
              <tr key={`${e.ts}-${i}`} className="border-t border-outline-variant/60">
                <td className="px-3 py-2 font-mono text-on-surface-variant whitespace-nowrap">
                  {new Date(e.ts).toLocaleString('pt-BR')}
                </td>
                <td className="px-3 py-2 text-on-surface">
                  {e.actor?.username || '—'}
                  {e.actor?.role && (
                    <span className="ml-1 text-[10px] text-on-surface-variant">{e.actor.role}</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-on-surface-variant">{e.ip || '—'}</td>
                <td className="px-3 py-2 font-mono text-on-surface break-all">{e.action}</td>
                <td className="px-3 py-2">
                  <span
                    className={
                      e.outcome === 'success'
                        ? 'text-ok'
                        : e.outcome === 'forbidden' || e.outcome === 'unauthenticated'
                          ? 'text-warn'
                          : 'text-crit'
                    }
                  >
                    {e.outcome}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
