import React, { useEffect, useState } from 'react';
import { History, RotateCcw, Database as DatabaseIcon } from 'lucide-react';
import { api } from '../../services/api.js';

interface Snapshot {
  name: string;
  reason: string;
  takenAt: string;
  sizeBytes: number;
}

type Delta = Record<string, { before: number; after: number; delta: number }>;

/** Why each snapshot was taken, in the operator's language. */
const REASON_LABEL: Record<string, string> = {
  'import-state': 'Antes de importar estado',
  'restore-panel-state': 'Antes de restaurar backup do painel',
  'remove-app': 'Antes de remover aplicação',
  'remove-database': 'Antes de remover banco',
  'save-settings': 'Antes de salvar configurações',
  'schema-migration': 'Antes de migrar o schema',
  boot: 'Na inicialização do painel',
  manual: 'Manual',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Snapshots of panel state, with what each one would change if restored.
 *
 * The counts are the point. Before pressing a button that replaces every user,
 * app and database record, the question is "does this snapshot still have my 12
 * apps" — a field-level diff of a multi-megabyte document answers that far less
 * clearly than one line saying apps 12 → 11.
 */
export const StateHistorySection: React.FC = () => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [delta, setDelta] = useState<Delta | null>(null);
  const [restoring, setRestoring] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/system/state/snapshots');
      setSnapshots(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Falha ao listar os snapshots.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const inspect = async (name: string) => {
    if (selected === name) {
      setSelected(null);
      setDelta(null);
      return;
    }
    setSelected(name);
    setDelta(null);
    try {
      const res = await api.get(`/system/state/snapshots/${encodeURIComponent(name)}/delta`);
      setDelta(res.data);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Falha ao comparar o snapshot.');
    }
  };

  const restore = async (name: string) => {
    // Deliberately blunt: this replaces every record and revokes every session.
    const confirmed = window.confirm(
      `Restaurar o estado de ${new Date(
        snapshots.find((s) => s.name === name)?.takenAt || Date.now(),
      ).toLocaleString('pt-BR')}?\n\n` +
        'Isso substitui usuários, aplicações, bancos e configurações pelo conteúdo do snapshot, ' +
        'e derruba todas as sessões abertas. Os contêineres em execução não são alterados.',
    );
    if (!confirmed) return;

    setRestoring(true);
    try {
      const res = await api.post(`/system/state/rollback/${encodeURIComponent(name)}`);
      alert(
        `${res.data.message}\n\nUsuários: ${res.data.counts.users} · ` +
          `Apps: ${res.data.counts.apps} · Bancos: ${res.data.counts.databases}`,
      );
      window.location.reload();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Falha ao restaurar o estado.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="bg-surface-container border border-outline-variant rounded-lg p-5 mt-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-bold text-white">Estado do Painel</h3>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-[11px] text-on-surface-variant hover:text-white disabled:opacity-50"
        >
          {loading ? 'Carregando...' : 'Atualizar'}
        </button>
      </div>

      <p className="text-[11px] text-on-surface-variant/80 mb-4">
        Cópias de <code>panel_db.json</code> gravadas antes de mudanças destrutivas. A gravação
        atômica já impede um arquivo pela metade — isto é para o outro caso: um save perfeitamente
        válido, mas errado.
      </p>

      {snapshots.length === 0 && !loading && (
        <p className="text-xs text-on-surface-variant/70">
          Nenhum snapshot ainda. O primeiro é gravado na próxima mudança destrutiva ou na próxima
          inicialização do painel.
        </p>
      )}

      <div className="space-y-2">
        {snapshots.map((snapshot) => (
          <div
            key={snapshot.name}
            className="border border-outline-variant rounded bg-surface-container-low"
          >
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <button
                onClick={() => inspect(snapshot.name)}
                className="flex-1 text-left min-w-0"
                title="Ver o que muda se restaurar"
              >
                <p className="text-xs text-on-surface truncate">
                  {new Date(snapshot.takenAt).toLocaleString('pt-BR')}
                </p>
                <p className="text-[10px] text-on-surface-variant/70">
                  {REASON_LABEL[snapshot.reason] || snapshot.reason} · {formatSize(snapshot.sizeBytes)}
                </p>
              </button>
              <button
                onClick={() => restore(snapshot.name)}
                disabled={restoring}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-semibold bg-warn/10 text-warn border border-warn/30 hover:bg-warn/20 disabled:opacity-50"
              >
                <RotateCcw className="w-3 h-3" />
                Restaurar
              </button>
            </div>

            {selected === snapshot.name && (
              <div className="border-t border-outline-variant px-3 py-2.5">
                {!delta ? (
                  <p className="text-[10px] text-on-surface-variant/70">Comparando...</p>
                ) : (
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {Object.entries(delta)
                      .filter(([, counts]) => counts.delta !== 0)
                      .map(([collection, counts]) => (
                        <span key={collection} className="text-[10px] font-mono">
                          <span className="text-on-surface-variant">{collection}</span>{' '}
                          <span className={counts.delta > 0 ? 'text-ok' : 'text-crit'}>
                            {counts.before} → {counts.after}
                          </span>
                        </span>
                      ))}
                    {Object.values(delta).every((counts) => counts.delta === 0) && (
                      <span className="text-[10px] text-on-surface-variant/70 flex items-center gap-1.5">
                        <DatabaseIcon className="w-3 h-3" />
                        Mesma quantidade de registros em todas as coleções.
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
