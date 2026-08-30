import React, { useEffect, useMemo, useState } from 'react';
import {
  Globe2,
  Users,
  Eye,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Link2,
  MonitorSmartphone,
} from 'lucide-react';
import { api } from '../services/api.js';
import { AppRecord } from '../types/index.js';
import { GlobeView, GlobeMarker } from '../components/GlobeView.js';

type Range = '24h' | '7d' | '30d';

interface CountEntry {
  key: string;
  count: number;
}

interface GeoPoint {
  countryCode: string;
  country: string;
  city: string;
  lat: number;
  lon: number;
  hits: number;
}

interface Report {
  appId: string;
  appName: string;
  domains: string[];
  hasDomain: boolean;
  range: Range;
  totals: { hits: number; visitors: number; allTimeHits: number };
  series: Array<{ key: string; label: string; hits: number; visitors: number }>;
  statusTotals: Record<string, number>;
  topPaths: CountEntry[];
  topReferrers: CountEntry[];
  browsers: CountEntry[];
  os: CountEntry[];
  geoPoints: GeoPoint[];
  countries: Array<{ country: string; countryCode: string; hits: number }>;
  recentErrors: Array<{ ts: string; status: number; method: string; path: string; country: string }>;
  collecting: boolean;
}

const RANGES: Array<{ id: Range; label: string }> = [
  { id: '24h', label: '24 horas' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
];

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  '2xx': { label: 'Sucesso', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  '3xx': { label: 'Redirect', className: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  '4xx': { label: 'Erro cliente', className: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  '5xx': { label: 'Erro servidor', className: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
};

interface AnalyticsPageProps {
  /** App id taken from the URL, so a card can deep-link straight here. */
  initialAppId?: string | null;
}

export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({ initialAppId }) => {
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>(initialAppId || '');
  const [range, setRange] = useState<Range>('24h');
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/apps')
      .then((res) => {
        setApps(res.data);
        if (!selectedId && res.data.length > 0) setSelectedId(res.data[0].id);
      })
      .catch(() => setApps([]))
      .finally(() => setLoading(false));
  }, []);

  const fetchReport = async () => {
    if (!selectedId) return;
    try {
      const res = await api.get(`/analytics/${selectedId}`, { params: { range } });
      setReport(res.data);
    } catch {
      setReport(null);
    }
  };

  useEffect(() => {
    fetchReport();
    // Access logs are consumed on a 10s cycle, so refreshing faster than that
    // would only redraw identical data.
    const interval = setInterval(fetchReport, 15000);
    return () => clearInterval(interval);
  }, [selectedId, range]);

  const markers: GlobeMarker[] = useMemo(
    () =>
      (report?.geoPoints || []).slice(0, 200).map((p) => ({
        lat: p.lat,
        lon: p.lon,
        hits: p.hits,
        label: p.city ? `${p.city}, ${p.country}` : p.country,
      })),
    [report]
  );

  const maxSeries = Math.max(1, ...(report?.series || []).map((p) => p.hits));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
            <Globe2 className="w-6 h-6 text-emerald-400" />
            Analytics
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Visitas e origem geográfica dos acessos, medidas no proxy — sem script na sua página.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500"
          >
            {apps.length === 0 && <option value="">Nenhuma aplicação</option>}
            {apps.map((app) => (
              <option key={app.id} value={app.id}>
                {app.name}
              </option>
            ))}
          </select>

          <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  range === r.id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <button
            onClick={fetchReport}
            title="Atualizar agora"
            className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {report && !report.hasDomain && (
        <div className="flex items-start gap-3 p-4 rounded-2xl border border-amber-500/40 bg-amber-500/10">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-amber-200 text-sm">Esta aplicação ainda não tem domínio</h4>
            <p className="text-xs text-amber-100/80 mt-1">
              As métricas vêm do log de acesso do proxy, que só registra tráfego que chega por um domínio.
              Vincule um domínio à aplicação para começar a medir.
            </p>
          </div>
        </div>
      )}

      {report && report.hasDomain && report.totals.allTimeHits === 0 && (
        <div className="flex items-start gap-3 p-4 rounded-2xl border border-slate-700 bg-slate-900/60">
          <Globe2 className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-slate-200 text-sm">Ainda sem acessos registrados</h4>
            <p className="text-xs text-slate-400 mt-1">
              A coleta começa no próximo acesso ao site. Se você acabou de atualizar o painel, o proxy precisa
              recarregar a configuração uma vez para passar a gravar o log.
            </p>
          </div>
        </div>
      )}

      {report && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={<Eye className="w-5 h-5" />} label="Visitas" value={report.totals.hits} accent="emerald" />
            <StatCard
              icon={<Users className="w-5 h-5" />}
              label="Visitantes únicos"
              value={report.totals.visitors}
              accent="indigo"
            />
            <StatCard
              icon={<Globe2 className="w-5 h-5" />}
              label="Países"
              value={report.countries.length}
              accent="sky"
            />
            <StatCard
              icon={<AlertTriangle className="w-5 h-5" />}
              label="Erros (4xx + 5xx)"
              value={(report.statusTotals['4xx'] || 0) + (report.statusTotals['5xx'] || 0)}
              accent="rose"
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
            <div className="xl:col-span-3 bg-[#0f172a]/80 rounded-2xl p-5 border border-slate-800">
              <h3 className="font-bold text-white text-sm mb-4">Origem dos acessos</h3>
              <GlobeView
                markers={markers}
                emptyMessage={
                  report.hasDomain
                    ? 'Nenhum acesso localizado ainda. Os pontos aparecem conforme o site recebe visitas.'
                    : 'Vincule um domínio à aplicação para medir os acessos.'
                }
              />
              <p className="text-[11px] text-slate-500 text-center mt-3">
                Arraste para girar. Cada ponto é uma cidade; o tamanho acompanha o volume de acessos.
              </p>
            </div>

            <div className="xl:col-span-2 bg-[#0f172a]/80 rounded-2xl p-5 border border-slate-800">
              <h3 className="font-bold text-white text-sm mb-4">Países</h3>
              {report.countries.length === 0 ? (
                <p className="text-xs text-slate-500">Sem dados de localização ainda.</p>
              ) : (
                <div className="space-y-2.5">
                  {report.countries.slice(0, 10).map((c) => {
                    const pct = Math.round((c.hits / Math.max(1, report.countries[0].hits)) * 100);
                    return (
                      <div key={c.countryCode}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-slate-200 font-medium">{c.country}</span>
                          <span className="text-slate-400 font-mono">{c.hits}</span>
                        </div>
                        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500/70 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="bg-[#0f172a]/80 rounded-2xl p-5 border border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white text-sm">Visitas por {range === '24h' ? 'hora' : 'dia'}</h3>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(report.statusTotals).map(([cls, count]) => {
                  const style = STATUS_STYLES[cls] || {
                    label: cls,
                    className: 'bg-slate-800 text-slate-300 border-slate-700',
                  };
                  return (
                    <span
                      key={cls}
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${style.className}`}
                    >
                      {style.label} {count}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="flex items-end gap-1 h-40 overflow-x-auto">
              {report.series.map((point) => (
                <div key={point.key} className="flex-1 min-w-[10px] flex flex-col items-center gap-1 group">
                  <div className="w-full flex flex-col justify-end h-32">
                    <div
                      className="w-full bg-emerald-500/70 group-hover:bg-emerald-400 rounded-t transition-colors"
                      style={{ height: `${(point.hits / maxSeries) * 100}%`, minHeight: point.hits > 0 ? 2 : 0 }}
                      title={`${point.hits} visitas · ${point.visitors} visitantes`}
                    />
                  </div>
                  <span className="text-[9px] text-slate-500 truncate w-full text-center">{point.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <RankCard title="Páginas mais acessadas" icon={<ExternalLink className="w-4 h-4" />} entries={report.topPaths} />
            <RankCard title="De onde vieram" icon={<Link2 className="w-4 h-4" />} entries={report.topReferrers} emptyLabel="Só acessos diretos até agora." />
            <RankCard title="Navegadores" icon={<MonitorSmartphone className="w-4 h-4" />} entries={report.browsers} />
            <RankCard title="Sistemas operacionais" icon={<MonitorSmartphone className="w-4 h-4" />} entries={report.os} />
          </div>

          {report.recentErrors.length > 0 && (
            <div className="bg-[#0f172a]/80 rounded-2xl p-5 border border-slate-800">
              <h3 className="font-bold text-white text-sm mb-4 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                Erros recentes
              </h3>
              <div className="space-y-1.5 max-h-64 overflow-y-auto custom-scrollbar">
                {report.recentErrors.map((err, idx) => (
                  <div
                    key={`${err.ts}-${idx}`}
                    className="flex items-center gap-3 text-xs font-mono bg-slate-950 px-3 py-2 rounded-lg border border-slate-800"
                  >
                    <span
                      className={`font-bold shrink-0 ${err.status >= 500 ? 'text-rose-400' : 'text-amber-400'}`}
                    >
                      {err.status}
                    </span>
                    <span className="text-slate-500 shrink-0">{err.method}</span>
                    <span className="text-slate-200 truncate flex-1">{err.path}</span>
                    <span className="text-slate-500 shrink-0 hidden sm:inline">{err.country}</span>
                    <span className="text-slate-600 shrink-0 hidden md:inline">
                      {new Date(err.ts).toLocaleTimeString('pt-BR')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-slate-500">
            Medido no proxy Caddy. Endereços IP são resolvidos para cidade e descartados: o painel guarda apenas
            contagens agregadas e um identificador irreversível por visitante, usado para contar visitantes únicos.
          </p>
        </>
      )}
    </div>
  );
};

const ACCENTS: Record<string, string> = {
  emerald: 'bg-emerald-500/10 text-emerald-400',
  indigo: 'bg-indigo-500/10 text-indigo-400',
  sky: 'bg-sky-500/10 text-sky-400',
  rose: 'bg-rose-500/10 text-rose-400',
};

const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: number; accent: string }> = ({
  icon,
  label,
  value,
  accent,
}) => (
  <div className="bg-[#0f172a]/80 p-5 rounded-2xl border border-slate-800 flex items-start gap-3.5">
    <div className={`p-2.5 rounded-xl shrink-0 ${ACCENTS[accent]}`}>{icon}</div>
    <div className="min-w-0">
      <p className="text-2xl font-bold text-white tabular-nums">{value.toLocaleString('pt-BR')}</p>
      <p className="text-xs text-slate-400 mt-0.5">{label}</p>
    </div>
  </div>
);

const RankCard: React.FC<{
  title: string;
  icon: React.ReactNode;
  entries: CountEntry[];
  emptyLabel?: string;
}> = ({ title, icon, entries, emptyLabel }) => (
  <div className="bg-[#0f172a]/80 rounded-2xl p-5 border border-slate-800">
    <h3 className="font-bold text-white text-sm mb-4 flex items-center gap-2">
      <span className="text-slate-400">{icon}</span>
      {title}
    </h3>
    {entries.length === 0 ? (
      <p className="text-xs text-slate-500">{emptyLabel || 'Sem dados ainda.'}</p>
    ) : (
      <div className="space-y-2">
        {entries.map((entry) => (
          <div key={entry.key} className="flex items-center justify-between gap-3 text-xs">
            <span className="text-slate-300 truncate font-mono">{entry.key}</span>
            <span className="text-slate-400 font-mono tabular-nums shrink-0">{entry.count.toLocaleString('pt-BR')}</span>
          </div>
        ))}
      </div>
    )}
  </div>
);
