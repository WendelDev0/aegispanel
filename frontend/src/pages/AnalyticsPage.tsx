import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Globe2,
  Users,
  Eye,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Link2,
  MonitorSmartphone,
  Gauge,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Activity,
  Download,
  Radio,
  ShieldQuestion,
  Timer,
  ArrowRightLeft,
} from 'lucide-react';
import { api } from '../services/api.js';
import { AppRecord } from '../types/index.js';
import { GlobeView, GlobeMarker } from '../components/GlobeView.js';
import { Panel, SectionHeader, StatCard, Badge, Meter, Tone } from '../components/ui.js';

type Range = '1h' | '24h' | '7d' | '30d';

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

interface Totals {
  hits: number;
  bots: number;
  humans: number;
  visitors: number;
  visitorsExact: boolean;
  bytesOut: number;
  bytesIn: number;
  errors4xx: number;
  errors5xx: number;
  errorRate: number;
  /** Protocol upgrades (WebSocket), excluded from every latency figure. */
  upgrades: number;
  /** Requests the latency figures were computed from. */
  measured: number;
  avgMs: number;
  p50: number;
  p75: number;
  p95: number;
  p99: number;
}

interface SeriesPoint {
  key: string;
  label: string;
  hits: number;
  bots: number;
  visitors: number;
  bytes: number;
  statuses: Record<string, number>;
  errors: number;
  avgMs: number;
  p95: number;
  partial: boolean;
}

interface PathRow {
  path: string;
  hits: number;
  errors: number;
  errorRate: number;
  avgMs: number;
  maxMs: number;
  bytes: number;
}

interface RequestSample {
  ts: string;
  status: number;
  method: string;
  path: string;
  host: string;
  ms: number;
  bytes: number;
  country: string;
  bot: boolean;
}

interface Report {
  appId: string;
  appName: string;
  domains: string[];
  hasDomain: boolean;
  range: Range;
  granularity: string;
  collecting: boolean;
  geoEnabled: boolean;
  totals: Totals & { allTimeHits: number; allTimeBytes: number };
  previous: Totals;
  deltas: {
    hits: number | null;
    visitors: number | null;
    bytesOut: number | null;
    p95: number | null;
    errorRate: number;
  };
  latency: { bounds: number[]; histogram: number[] };
  series: SeriesPoint[];
  statusTotals: Record<string, number>;
  topCodes: CountEntry[];
  methods: CountEntry[];
  protocols: CountEntry[];
  topPaths: PathRow[];
  slowestPaths: PathRow[];
  topErrorPaths: PathRow[];
  topReferrers: CountEntry[];
  browsers: CountEntry[];
  os: CountEntry[];
  devices: CountEntry[];
  geoPoints: GeoPoint[];
  countries: Array<{ country: string; countryCode: string; hits: number }>;
  recentErrors: Array<{ ts: string; status: number; method: string; path: string; host: string; country: string; ms: number }>;
  live: RequestSample[];
}

interface Overview {
  range: Range;
  granularity: string;
  collecting: boolean;
  geoEnabled: boolean;
  totals: Totals;
  previous: Totals;
  series: Array<{ key: string; label: string; hits: number; errors: number; p95: number; partial: boolean }>;
  apps: Array<{
    appId: string;
    appName: string;
    domains: string[];
    hits: number;
    visitors: number;
    errorRate: number;
    errors5xx: number;
    p95: number;
    bytesOut: number;
    trend: number | null;
  }>;
  unattributed: Array<{ domain: string; hits: number }>;
}

interface CollectorStatus {
  logPath: string;
  logExists: boolean;
  logReadable: boolean;
  logSize: number;
  logModifiedAt: string | null;
  offset: number;
  lag: number;
  domainsTracked: number;
  totalHits: number;
  geoEnabled: boolean;
  trustedProxies: string[];
}

const OVERVIEW = '__overview__';

const RANGES: Array<{ id: Range; label: string }> = [
  { id: '1h', label: '1 hora' },
  { id: '24h', label: '24 horas' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
];

const STATUS_STYLES: Record<string, { label: string; tone: Tone }> = {
  '1xx': { label: 'Upgrade', tone: 'neutral' },
  '2xx': { label: 'Sucesso', tone: 'ok' },
  '3xx': { label: 'Redirect', tone: 'info' },
  '4xx': { label: 'Erro cliente', tone: 'warn' },
  '5xx': { label: 'Erro servidor', tone: 'crit' },
  other: { label: 'Outro', tone: 'neutral' },
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const num = (n: number) => n.toLocaleString('pt-BR');

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: value < 10 && i > 0 ? 1 : 0 })} ${units[i]}`;
}

function formatMs(ms: number): string {
  if (ms <= 0) return '—';
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} s`;
}

/** Tone for a response-time reading, so colour and number never disagree. */
function latencyTone(ms: number): Tone {
  if (ms <= 0) return 'neutral';
  if (ms < 300) return 'ok';
  if (ms < 1000) return 'warn';
  return 'crit';
}

function errorTone(rate: number): Tone {
  if (rate === 0) return 'ok';
  if (rate < 5) return 'warn';
  return 'crit';
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/**
 * Percentage change against the preceding window of the same length.
 *
 * `null` means there was no traffic to compare against, which is not the same
 * as "unchanged" and must not be drawn as 0%.
 */
const Delta: React.FC<{ value: number | null; suffix?: string; lowerIsBetter?: boolean }> = ({
  value,
  suffix = '%',
  lowerIsBetter = false,
}) => {
  if (value === null) return <span className="text-2xs text-on-surface-variant/60">sem base</span>;
  if (value === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-on-surface-variant/70">
        <Minus className="w-3 h-3" /> estável
      </span>
    );
  }

  const up = value > 0;
  const good = lowerIsBetter ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;

  return (
    <span className={`inline-flex items-center gap-1 text-2xs font-medium ${good ? 'text-ok' : 'text-crit'}`}>
      <Icon className="w-3 h-3" />
      {up ? '+' : ''}
      {value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
      {suffix}
    </span>
  );
};

/**
 * Traffic chart: stacked bars for successful vs failed requests, with the p95
 * response time drawn over them.
 *
 * The two live together on purpose. A spike in traffic and a spike in latency
 * mean very different things, and reading them from two charts side by side
 * makes the operator do the correlation by eye.
 */
const TrafficChart: React.FC<{
  points: Array<{ label: string; hits: number; errors: number; p95: number; partial: boolean }>;
  height?: number;
}> = ({ points, height = 176 }) => {
  const [hover, setHover] = useState<number | null>(null);

  const maxHits = Math.max(1, ...points.map((p) => p.hits));
  const maxP95 = Math.max(1, ...points.map((p) => p.p95));
  const hasLatency = points.some((p) => p.p95 > 0);

  // viewBox coordinates: one unit per point horizontally, 0-100 vertically.
  // preserveAspectRatio is off so the line stretches with the bars, and the
  // stroke is kept at its literal width so it does not stretch with it.
  const line = points
    .map((p, i) => `${i + 0.5},${100 - (p.p95 / maxP95) * 92}`)
    .join(' ');

  return (
    <div className="relative">
      <div className="flex items-end gap-[3px]" style={{ height }} onMouseLeave={() => setHover(null)}>
        {points.map((point, idx) => {
          const total = (point.hits / maxHits) * 100;
          const errorShare = point.hits > 0 ? (point.errors / point.hits) * 100 : 0;
          return (
            <div
              key={point.label + idx}
              className="flex-1 min-w-[4px] h-full flex flex-col justify-end cursor-default"
              onMouseEnter={() => setHover(idx)}
            >
              <div
                className={`w-full flex flex-col justify-end rounded-t transition-all ${
                  hover === idx ? 'opacity-100' : 'opacity-85'
                } ${point.partial ? 'opacity-50' : ''}`}
                style={{ height: `${total}%`, minHeight: point.hits > 0 ? 2 : 0 }}
              >
                {errorShare > 0 && (
                  <div
                    className="w-full bg-crit rounded-t"
                    style={{ height: `${errorShare}%`, minHeight: 2 }}
                  />
                )}
                <div className="w-full bg-primary-container flex-1 rounded-t-[1px]" />
              </div>
            </div>
          );
        })}
      </div>

      {hasLatency && (
        <svg
          className="absolute inset-x-0 top-0 pointer-events-none"
          style={{ height }}
          viewBox={`0 0 ${points.length} 100`}
          preserveAspectRatio="none"
          aria-hidden
        >
          <polyline
            points={line}
            fill="none"
            stroke="#fbbf24"
            strokeWidth={1.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            opacity={0.85}
          />
        </svg>
      )}

      <div className="flex gap-[3px] mt-1.5">
        {points.map((point, idx) => (
          <span
            key={point.label + idx}
            className={`flex-1 min-w-[4px] text-center text-[9px] truncate ${
              hover === idx ? 'text-on-surface' : 'text-on-surface-variant/50'
            }`}
          >
            {points.length > 32 && idx % 2 !== 0 ? '' : point.label}
          </span>
        ))}
      </div>

      {hover !== null && points[hover] && (
        <div
          className="absolute -top-1 z-10 pointer-events-none bg-surface-container-highest border border-outline-variant rounded px-2.5 py-1.5 shadow-lg"
          style={{
            left: `${((hover + 0.5) / points.length) * 100}%`,
            transform: `translate(-${((hover + 0.5) / points.length) * 100}%, -100%)`,
          }}
        >
          <p className="text-2xs font-semibold text-on-surface mb-0.5">
            {points[hover].label}
            {points[hover].partial && <span className="text-on-surface-variant/60"> · parcial</span>}
          </p>
          <p className="font-mono text-2xs text-on-surface-variant">{num(points[hover].hits)} acessos</p>
          {points[hover].errors > 0 && (
            <p className="font-mono text-2xs text-crit">{num(points[hover].errors)} erros</p>
          )}
          {points[hover].p95 > 0 && (
            <p className="font-mono text-2xs text-warn">p95 {formatMs(points[hover].p95)}</p>
          )}
        </div>
      )}
    </div>
  );
};

/** Ranked list with a proportional bar, used for every categorical breakdown. */
const RankCard: React.FC<{
  title: string;
  icon: React.ReactNode;
  entries: CountEntry[];
  emptyLabel?: string;
  tone?: Tone;
}> = ({ title, icon, entries, emptyLabel, tone = 'info' }) => {
  const max = Math.max(1, ...entries.map((e) => e.count));
  return (
    <Panel className="p-5">
      <SectionHeader icon={icon} title={title} />
      {entries.length === 0 ? (
        <p className="text-xs text-on-surface-variant/70 mt-4">{emptyLabel || 'Sem dados ainda.'}</p>
      ) : (
        <div className="space-y-2.5 mt-4">
          {entries.map((entry) => (
            <div key={entry.key}>
              <div className="flex items-center justify-between gap-3 text-xs mb-1">
                <span className="text-on-surface truncate font-mono" title={entry.key}>
                  {entry.key}
                </span>
                <span className="text-on-surface-variant font-mono tabular-nums shrink-0">
                  {num(entry.count)}
                </span>
              </div>
              <Meter percent={(entry.count / max) * 100} tone={tone} />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
};

const StatusPill: React.FC<{ status: number }> = ({ status }) => {
  const tone: Tone = status >= 500 ? 'crit' : status >= 400 ? 'warn' : status >= 300 ? 'info' : 'ok';
  return (
    <Badge tone={tone} className="font-mono shrink-0">
      {status}
    </Badge>
  );
};

/**
 * Latency distribution.
 *
 * A percentile row alone says where the tail is but not how heavy it is; the
 * histogram shows whether "p95 = 800ms" is a handful of slow requests or a
 * second population of them.
 */
const LatencyPanel: React.FC<{ totals: Totals; latency: { bounds: number[]; histogram: number[] } }> = ({
  totals,
  latency,
}) => {
  const max = Math.max(1, ...latency.histogram);
  const total = latency.histogram.reduce((a, b) => a + b, 0);

  const labelFor = (i: number) => {
    if (i >= latency.bounds.length) return `>${formatMs(latency.bounds[latency.bounds.length - 1])}`;
    const lower = i === 0 ? 0 : latency.bounds[i - 1];
    return `${lower}–${latency.bounds[i]}`;
  };

  return (
    <Panel className="p-5">
      <SectionHeader
        icon={<Timer className="w-4 h-4" />}
        title="Tempo de resposta"
        subtitle={
          totals.upgrades > 0
            ? `Sobre ${num(totals.measured)} requisições. ${num(totals.upgrades)} conexões WebSocket ficam de fora: para elas o proxy mede a duração da conexão inteira, não uma resposta.`
            : 'Medido no proxy, do primeiro byte da requisição ao último da resposta.'
        }
      />

      <div className="grid grid-cols-4 gap-2 mt-4">
        {(['p50', 'p75', 'p95', 'p99'] as const).map((p) => (
          <div key={p} className="bg-surface-container-lowest border border-outline-variant rounded p-2.5">
            <span className="mono-label">{p}</span>
            <p className={`font-mono text-sm mt-1 ${
              latencyTone(totals[p]) === 'crit'
                ? 'text-crit'
                : latencyTone(totals[p]) === 'warn'
                ? 'text-warn'
                : 'text-on-surface'
            }`}>
              {formatMs(totals[p])}
            </p>
          </div>
        ))}
      </div>

      {total === 0 ? (
        <p className="text-xs text-on-surface-variant/70 mt-5">Sem requisições medidas nesta janela.</p>
      ) : (
        <div className="mt-5">
          <div className="flex items-end gap-[3px] h-20">
            {latency.histogram.map((count, i) => (
              <div
                key={i}
                className="flex-1 flex flex-col justify-end h-full group relative"
                title={`${labelFor(i)} ms · ${num(count)} requisições`}
              >
                <div
                  className={`w-full rounded-t ${
                    i >= latency.bounds.length - 3 ? 'bg-crit/70' : i >= latency.bounds.length - 5 ? 'bg-warn/70' : 'bg-tertiary/70'
                  } group-hover:opacity-100 opacity-80`}
                  style={{ height: `${(count / max) * 100}%`, minHeight: count > 0 ? 2 : 0 }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1.5 text-[9px] text-on-surface-variant/50 font-mono">
            <span>0 ms</span>
            <span>média {formatMs(totals.avgMs)}</span>
            <span>&gt;{latency.bounds[latency.bounds.length - 1] / 1000}s</span>
          </div>
        </div>
      )}
    </Panel>
  );
};

/** Sortable table over the per-path aggregates. */
const PathTable: React.FC<{ rows: PathRow[]; emptyLabel: string }> = ({ rows, emptyLabel }) => {
  if (rows.length === 0) {
    return <p className="text-xs text-on-surface-variant/70 mt-4">{emptyLabel}</p>;
  }

  const maxHits = Math.max(1, ...rows.map((r) => r.hits));

  return (
    <div className="mt-4 overflow-x-auto custom-scrollbar">
      <table className="w-full text-xs min-w-[560px]">
        <thead>
          <tr className="text-on-surface-variant/60 text-left">
            <th className="font-medium pb-2 pr-3">Caminho</th>
            <th className="font-medium pb-2 px-3 text-right">Acessos</th>
            <th className="font-medium pb-2 px-3 text-right">Erros</th>
            <th className="font-medium pb-2 px-3 text-right">Média</th>
            <th className="font-medium pb-2 px-3 text-right">Pior</th>
            <th className="font-medium pb-2 pl-3 text-right">Tráfego</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path} className="border-t border-outline-variant/60">
              <td className="py-2 pr-3 max-w-[280px]">
                <span className="font-mono text-on-surface truncate block" title={row.path}>
                  {row.path}
                </span>
                <Meter percent={(row.hits / maxHits) * 100} tone="info" className="mt-1.5 max-w-[200px]" />
              </td>
              <td className="py-2 px-3 text-right font-mono tabular-nums text-on-surface">{num(row.hits)}</td>
              <td className="py-2 px-3 text-right font-mono tabular-nums">
                {row.errors === 0 ? (
                  <span className="text-on-surface-variant/50">0</span>
                ) : (
                  <span className={row.errorRate >= 5 ? 'text-crit' : 'text-warn'}>
                    {num(row.errors)}
                    <span className="text-on-surface-variant/50"> ({row.errorRate}%)</span>
                  </span>
                )}
              </td>
              <td
                className={`py-2 px-3 text-right font-mono tabular-nums ${
                  latencyTone(row.avgMs) === 'crit'
                    ? 'text-crit'
                    : latencyTone(row.avgMs) === 'warn'
                    ? 'text-warn'
                    : 'text-on-surface-variant'
                }`}
              >
                {formatMs(row.avgMs)}
              </td>
              <td className="py-2 px-3 text-right font-mono tabular-nums text-on-surface-variant/70">
                {formatMs(row.maxMs)}
              </td>
              <td className="py-2 pl-3 text-right font-mono tabular-nums text-on-surface-variant/70">
                {formatBytes(row.bytes)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Rolling window of the most recent requests the collector has parsed. */
const LiveTail: React.FC<{ requests: RequestSample[]; granularityHint: string }> = ({
  requests,
  granularityHint,
}) => (
  <Panel className="p-5">
    <SectionHeader
      icon={<Radio className="w-4 h-4" />}
      title="Requisições ao vivo"
      subtitle={granularityHint}
      actions={
        requests.length > 0 ? (
          <Badge tone="ok" dot>
            ao vivo
          </Badge>
        ) : undefined
      }
    />
    {requests.length === 0 ? (
      <p className="text-xs text-on-surface-variant/70 mt-4">
        Nenhuma requisição desde que o painel iniciou. O histórico fica nos gráficos acima.
      </p>
    ) : (
      <div className="mt-4 space-y-1 max-h-72 overflow-y-auto custom-scrollbar">
        {requests.map((r, idx) => (
          <div
            key={`${r.ts}-${idx}`}
            className="flex items-center gap-2.5 text-2xs font-mono bg-surface-container-lowest px-2.5 py-1.5 rounded border border-outline-variant/60"
          >
            <span className="text-outline shrink-0 hidden sm:inline">
              {new Date(r.ts).toLocaleTimeString('pt-BR')}
            </span>
            <StatusPill status={r.status} />
            <span className="text-on-surface-variant/70 shrink-0 w-10">{r.method}</span>
            <span className="text-on-surface truncate flex-1" title={`${r.host}${r.path}`}>
              {r.path}
            </span>
            {r.bot && (
              <span className="text-on-surface-variant/50 shrink-0 hidden md:inline" title="Identificado como bot">
                bot
              </span>
            )}
            <span
              className={`shrink-0 tabular-nums ${
                latencyTone(r.ms) === 'crit' ? 'text-crit' : latencyTone(r.ms) === 'warn' ? 'text-warn' : 'text-on-surface-variant/70'
              }`}
            >
              {formatMs(r.ms)}
            </span>
          </div>
        ))}
      </div>
    )}
  </Panel>
);

/**
 * Explains an empty page.
 *
 * The failure this feature actually has is silence, so when there is no data
 * the panel has to say which of the several possible reasons applies rather
 * than drawing empty axes.
 */
const CollectorDiagnostics: React.FC<{ status: CollectorStatus | null }> = ({ status }) => {
  if (!status) return null;

  const problems: Array<{ tone: Tone; title: string; body: string }> = [];

  if (!status.logExists) {
    problems.push({
      tone: 'crit',
      title: 'O log de acesso do proxy não existe',
      body: `Esperado em ${status.logPath}. O contêiner do painel precisa montar o volume de logs do Caddy, e o Caddy precisa recarregar a configuração uma vez para começar a gravar.`,
    });
  } else if (!status.logReadable) {
    problems.push({
      tone: 'crit',
      title: 'O log de acesso existe mas não pode ser lido',
      body: `Verifique as permissões de ${status.logPath} dentro do contêiner do painel.`,
    });
  } else if (status.logSize === 0) {
    problems.push({
      tone: 'warn',
      title: 'O log de acesso está vazio',
      body: 'O Caddy ainda não registrou nenhuma requisição. A coleta começa no próximo acesso a um domínio do painel.',
    });
  } else if (status.totalHits === 0) {
    problems.push({
      tone: 'crit',
      title: 'O log tem conteúdo, mas nada foi contabilizado',
      body: `${formatBytes(status.logSize)} de log e nenhum acesso registrado. Isso indica um formato de log inesperado — confirme que os blocos do Caddyfile usam "format json".`,
    });
  }

  if (status.lag > 1024 * 1024) {
    problems.push({
      tone: 'warn',
      title: 'A leitura do log está atrasada',
      body: `${formatBytes(status.lag)} ainda não processados. O coletor lê a cada 10 segundos e vai alcançar o arquivo.`,
    });
  }

  if (!status.geoEnabled) {
    problems.push({
      tone: 'info',
      title: 'Geolocalização desativada',
      body: 'O mapa e a lista de países ficam vazios. Ativar envia os endereços dos visitantes ao ip-api.com para resolver cidade e país — por isso é opt-in. Defina GEOIP_ENABLED=true no serviço do backend para ligar.',
    });
  }

  if (problems.length === 0) return null;

  return (
    <div className="space-y-3">
      {problems.map((p) => (
        <Panel key={p.title} accent={p.tone} className="p-4">
          <div className="flex items-start gap-3 pl-2">
            {p.tone === 'info' ? (
              <ShieldQuestion className="w-5 h-5 text-tertiary shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle
                className={`w-5 h-5 shrink-0 mt-0.5 ${p.tone === 'crit' ? 'text-crit' : 'text-warn'}`}
              />
            )}
            <div className="min-w-0">
              <h4 className="font-semibold text-on-surface text-sm">{p.title}</h4>
              <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">{p.body}</p>
            </div>
          </div>
        </Panel>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface AnalyticsPageProps {
  /** App id taken from the URL, so a card can deep-link straight here. */
  initialAppId?: string | null;
}

type PathTab = 'top' | 'slow' | 'errors';

export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({ initialAppId }) => {
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>(initialAppId || OVERVIEW);
  const [range, setRange] = useState<Range>('24h');
  const [report, setReport] = useState<Report | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [status, setStatus] = useState<CollectorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pathTab, setPathTab] = useState<PathTab>('top');
  // Keeps the auto-refresh from racing a manual one and rendering older data.
  const inFlight = useRef(false);

  useEffect(() => {
    api
      .get('/apps')
      .then((res) => setApps(res.data))
      .catch(() => setApps([]))
      .finally(() => setLoading(false));
  }, []);

  const fetchData = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const [dataRes, statusRes] = await Promise.all([
        selectedId === OVERVIEW
          ? api.get('/analytics/_overview', { params: { range } })
          : api.get(`/analytics/${selectedId}`, { params: { range } }),
        api.get('/analytics/_status'),
      ]);

      if (selectedId === OVERVIEW) {
        setOverview(dataRes.data);
        setReport(null);
      } else {
        setReport(dataRes.data);
        setOverview(null);
      }
      setStatus(statusRes.data);
    } catch {
      setReport(null);
      setOverview(null);
    } finally {
      inFlight.current = false;
    }
  }, [selectedId, range]);

  useEffect(() => {
    fetchData();
    // The collector parses the log on a 10s cycle, so polling faster than that
    // only redraws identical data.
    const interval = setInterval(fetchData, range === '1h' ? 10000 : 20000);
    return () => clearInterval(interval);
  }, [fetchData, range]);

  const manualRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

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

  const exportPaths = () => {
    if (!report) return;
    const rows = [
      ['caminho', 'acessos', 'erros', 'taxa_erro_pct', 'media_ms', 'pior_ms', 'bytes'],
      ...report.topPaths.map((p) => [p.path, p.hits, p.errors, p.errorRate, p.avgMs, p.maxMs, p.bytes]),
    ];
    // Quoted on purpose: a path can legitimately contain a comma.
    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `analytics-${report.appName}-${range}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const pathRows =
    report && (pathTab === 'top' ? report.topPaths : pathTab === 'slow' ? report.slowestPaths : report.topErrorPaths);

  const granularityHint =
    report?.granularity === 'minutely'
      ? 'Agregado por minuto'
      : report?.granularity === 'hourly'
      ? 'Agregado por hora'
      : 'Agregado por dia';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
            <Activity className="w-6 h-6 text-ok" />
            Analytics
          </h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Tráfego, latência e erros medidos no proxy — sem script na sua página.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-ok"
          >
            <option value={OVERVIEW}>Visão geral do servidor</option>
            {apps.map((app) => (
              <option key={app.id} value={app.id}>
                {app.name}
              </option>
            ))}
          </select>

          <div className="flex bg-surface-container-low border border-outline-variant rounded p-1">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                  range === r.id ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-white'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <button
            onClick={manualRefresh}
            title="Atualizar agora"
            className="p-2.5 rounded bg-surface-container-low border border-outline-variant text-on-surface-variant hover:text-white"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <CollectorDiagnostics status={status} />

      {report && !report.hasDomain && (
        <Panel accent="warn" className="p-4">
          <div className="flex items-start gap-3 pl-2">
            <AlertTriangle className="w-5 h-5 text-warn shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-on-surface text-sm">Esta aplicação ainda não tem domínio</h4>
              <p className="text-xs text-on-surface-variant mt-1">
                As métricas vêm do log do proxy, que só registra tráfego chegando por um domínio. Vincule um
                domínio à aplicação para começar a medir.
              </p>
            </div>
          </div>
        </Panel>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Server-wide view                                                   */}
      {/* ---------------------------------------------------------------- */}
      {overview && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard
              icon={<Eye className="w-4 h-4" />}
              label="Acessos"
              value={num(overview.totals.hits)}
              detail={`${num(overview.totals.bots)} de bots`}
              tone="info"
            />
            <StatCard
              icon={<Users className="w-4 h-4" />}
              label="Visitantes"
              value={num(overview.totals.visitors)}
              detail={overview.totals.visitorsExact ? 'contagem exata' : 'estimativa (±5%)'}
              tone="info"
            />
            <StatCard
              icon={<Gauge className="w-4 h-4" />}
              label="p95 resposta"
              value={formatMs(overview.totals.p95)}
              detail={`mediana ${formatMs(overview.totals.p50)}`}
              tone={latencyTone(overview.totals.p95)}
            />
            <StatCard
              icon={<AlertTriangle className="w-4 h-4" />}
              label="Taxa de erro"
              value={`${overview.totals.errorRate}%`}
              detail={`${num(overview.totals.errors5xx)} do servidor`}
              tone={errorTone(overview.totals.errorRate)}
            />
            <StatCard
              icon={<ArrowRightLeft className="w-4 h-4" />}
              label="Tráfego"
              value={formatBytes(overview.totals.bytesOut)}
              detail={`${formatBytes(overview.totals.bytesIn)} recebidos`}
              tone="info"
            />
          </div>

          <Panel className="p-5">
            <SectionHeader
              icon={<Activity className="w-4 h-4" />}
              title="Tráfego do servidor"
              subtitle="Barras: acessos, com a fatia vermelha sendo erros. Linha âmbar: p95 do tempo de resposta."
            />
            <div className="mt-5">
              <TrafficChart points={overview.series} />
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionHeader icon={<Globe2 className="w-4 h-4" />} title="Por aplicação" />
            {overview.apps.length === 0 ? (
              <p className="text-xs text-on-surface-variant/70 mt-4">Nenhuma aplicação cadastrada.</p>
            ) : (
              <div className="mt-4 overflow-x-auto custom-scrollbar">
                <table className="w-full text-xs min-w-[640px]">
                  <thead>
                    <tr className="text-on-surface-variant/60 text-left">
                      <th className="font-medium pb-2 pr-3">Aplicação</th>
                      <th className="font-medium pb-2 px-3 text-right">Acessos</th>
                      <th className="font-medium pb-2 px-3 text-right">Tendência</th>
                      <th className="font-medium pb-2 px-3 text-right">Visitantes</th>
                      <th className="font-medium pb-2 px-3 text-right">Erros</th>
                      <th className="font-medium pb-2 px-3 text-right">p95</th>
                      <th className="font-medium pb-2 pl-3 text-right">Tráfego</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.apps.map((app) => (
                      <tr
                        key={app.appId}
                        className="border-t border-outline-variant/60 hover:bg-surface-container-high/40 cursor-pointer"
                        onClick={() => setSelectedId(app.appId)}
                      >
                        <td className="py-2.5 pr-3">
                          <span className="text-on-surface font-medium">{app.appName}</span>
                          <span className="block font-mono text-2xs text-on-surface-variant/60 truncate max-w-[220px]">
                            {app.domains.join(', ') || 'sem domínio'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-on-surface">
                          {num(app.hits)}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <Delta value={app.trend} />
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-on-surface-variant">
                          {num(app.visitors)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          <span
                            className={
                              app.errorRate === 0
                                ? 'text-on-surface-variant/50'
                                : errorTone(app.errorRate) === 'crit'
                                ? 'text-crit'
                                : 'text-warn'
                            }
                          >
                            {app.errorRate}%
                          </span>
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono tabular-nums ${
                            latencyTone(app.p95) === 'crit'
                              ? 'text-crit'
                              : latencyTone(app.p95) === 'warn'
                              ? 'text-warn'
                              : 'text-on-surface-variant'
                          }`}
                        >
                          {formatMs(app.p95)}
                        </td>
                        <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-on-surface-variant/70">
                          {formatBytes(app.bytesOut)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {overview.unattributed.length > 0 && (
            <Panel className="p-5">
              <SectionHeader
                icon={<ShieldQuestion className="w-4 h-4" />}
                title="Domínios sem aplicação"
                subtitle="Hostnames que o proxy atendeu e que nenhuma aplicação do painel reivindica — normalmente o próprio painel, às vezes um DNS antigo apontando para cá."
              />
              <div className="mt-4 space-y-2">
                {overview.unattributed.map((d) => (
                  <div key={d.domain} className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-mono text-on-surface-variant truncate">{d.domain}</span>
                    <span className="font-mono tabular-nums text-on-surface-variant/70 shrink-0">
                      {num(d.hits)}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Per-application view                                              */}
      {/* ---------------------------------------------------------------- */}
      {report && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard
              icon={<Eye className="w-4 h-4" />}
              label="Acessos"
              value={num(report.totals.hits)}
              detail={`${num(report.totals.humans)} humanos · ${num(report.totals.bots)} bots`}
              tone="info"
            />
            <StatCard
              icon={<Users className="w-4 h-4" />}
              label="Visitantes"
              value={num(report.totals.visitors)}
              detail={report.totals.visitorsExact ? 'contagem exata' : 'estimativa (±5%)'}
              tone="info"
            />
            <StatCard
              icon={<Gauge className="w-4 h-4" />}
              label="p95 resposta"
              value={formatMs(report.totals.p95)}
              detail={`p99 ${formatMs(report.totals.p99)}`}
              tone={latencyTone(report.totals.p95)}
            />
            <StatCard
              icon={<AlertTriangle className="w-4 h-4" />}
              label="Taxa de erro"
              value={`${report.totals.errorRate}%`}
              detail={`${num(report.totals.errors4xx)} cliente · ${num(report.totals.errors5xx)} servidor`}
              tone={errorTone(report.totals.errorRate)}
            />
            <StatCard
              icon={<ArrowRightLeft className="w-4 h-4" />}
              label="Tráfego"
              value={formatBytes(report.totals.bytesOut)}
              detail={`${formatBytes(report.totals.allTimeBytes)} desde o início`}
              tone="info"
            />
          </div>

          {/* Trend row: every headline number against the previous window. */}
          <Panel className="p-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pl-1">
              <span className="mono-label">vs. período anterior</span>
              <span className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                acessos <Delta value={report.deltas.hits} />
              </span>
              <span className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                visitantes <Delta value={report.deltas.visitors} />
              </span>
              <span className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                p95 <Delta value={report.deltas.p95} lowerIsBetter />
              </span>
              <span className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                erro{' '}
                <Delta
                  value={report.deltas.errorRate === 0 ? 0 : report.deltas.errorRate}
                  suffix=" p.p."
                  lowerIsBetter
                />
              </span>
              <span className="flex items-center gap-1.5 text-xs text-on-surface-variant">
                tráfego <Delta value={report.deltas.bytesOut} />
              </span>
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionHeader
              icon={<Activity className="w-4 h-4" />}
              title={`Tráfego · ${granularityHint.toLowerCase()}`}
              subtitle="Barras: acessos, com a fatia vermelha sendo erros. Linha âmbar: p95 do tempo de resposta."
              actions={
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(report.statusTotals)
                    .sort((a, b) => b[1] - a[1])
                    .map(([cls, count]) => {
                      const style = STATUS_STYLES[cls] || { label: cls, tone: 'neutral' as Tone };
                      return (
                        <Badge key={cls} tone={style.tone} dot>
                          {style.label} {num(count)}
                        </Badge>
                      );
                    })}
                </div>
              }
            />
            <div className="mt-5">
              <TrafficChart points={report.series} />
            </div>
          </Panel>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <LatencyPanel totals={report.totals} latency={report.latency} />
            <LiveTail requests={report.live} granularityHint="Últimas requisições vistas pelo coletor." />
          </div>

          <Panel className="p-5">
            <SectionHeader
              icon={<ExternalLink className="w-4 h-4" />}
              title="Caminhos"
              actions={
                <div className="flex items-center gap-2">
                  <div className="flex bg-surface-container-low border border-outline-variant rounded p-1">
                    {(
                      [
                        ['top', 'Mais acessados'],
                        ['slow', 'Mais lentos'],
                        ['errors', 'Com mais erros'],
                      ] as Array<[PathTab, string]>
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => setPathTab(id)}
                        className={`px-2.5 py-1 rounded text-2xs font-semibold transition-colors ${
                          pathTab === id
                            ? 'bg-primary-container text-on-primary-container'
                            : 'text-on-surface-variant hover:text-white'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={exportPaths}
                    title="Exportar CSV"
                    className="p-1.5 rounded bg-surface-container-low border border-outline-variant text-on-surface-variant hover:text-white"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
              }
            />
            <PathTable
              rows={pathRows || []}
              emptyLabel={
                pathTab === 'errors'
                  ? 'Nenhum caminho retornou erro nesta janela.'
                  : 'Sem caminhos registrados ainda.'
              }
            />
          </Panel>

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
            <Panel className="xl:col-span-3 p-5">
              <SectionHeader
                icon={<Globe2 className="w-4 h-4" />}
                title="Origem dos acessos"
                subtitle="Cada ponto é uma cidade; o tamanho acompanha o volume."
              />
              <div className="mt-4">
                <GlobeView
                  markers={markers}
                  emptyMessage={
                    !report.geoEnabled
                      ? 'Geolocalização desativada. Defina GEOIP_ENABLED=true no backend para preencher o mapa.'
                      : report.hasDomain
                      ? 'Nenhum acesso localizado ainda. Os pontos aparecem conforme o site recebe visitas.'
                      : 'Vincule um domínio à aplicação para medir os acessos.'
                  }
                />
              </div>
            </Panel>

            <div className="xl:col-span-2 space-y-5">
              <RankCard
                title="Países"
                icon={<Globe2 className="w-4 h-4" />}
                entries={report.countries.slice(0, 10).map((c) => ({ key: c.country, count: c.hits }))}
                emptyLabel={
                  report.geoEnabled
                    ? 'Sem dados de localização ainda.'
                    : 'Geolocalização desativada nas configurações do backend.'
                }
                tone="ok"
              />
              <RankCard
                title="Dispositivos"
                icon={<MonitorSmartphone className="w-4 h-4" />}
                entries={report.devices}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
            <RankCard title="Navegadores" icon={<MonitorSmartphone className="w-4 h-4" />} entries={report.browsers} />
            <RankCard title="Sistemas operacionais" icon={<MonitorSmartphone className="w-4 h-4" />} entries={report.os} />
            <RankCard
              title="De onde vieram"
              icon={<Link2 className="w-4 h-4" />}
              entries={report.topReferrers}
              emptyLabel="Só acessos diretos até agora."
            />
            <RankCard
              title="Códigos de status"
              icon={<AlertTriangle className="w-4 h-4" />}
              entries={report.topCodes}
              tone="warn"
            />
            <RankCard title="Métodos" icon={<ArrowRightLeft className="w-4 h-4" />} entries={report.methods} />
            <RankCard
              title="Protocolo"
              icon={<Activity className="w-4 h-4" />}
              entries={report.protocols}
              tone="ok"
            />
          </div>

          {report.recentErrors.length > 0 && (
            <Panel className="p-5">
              <SectionHeader
                icon={<AlertTriangle className="w-4 h-4 text-crit" />}
                title="Erros recentes"
                subtitle="As últimas respostas 4xx e 5xx, com o tempo que cada uma levou."
              />
              <div className="mt-4 space-y-1.5 max-h-72 overflow-y-auto custom-scrollbar">
                {report.recentErrors.map((err, idx) => (
                  <div
                    key={`${err.ts}-${idx}`}
                    className="flex items-center gap-3 text-2xs font-mono bg-surface-container-lowest px-3 py-2 rounded border border-outline-variant/60"
                  >
                    <StatusPill status={err.status} />
                    <span className="text-on-surface-variant/70 shrink-0 w-10">{err.method}</span>
                    <span className="text-on-surface truncate flex-1" title={`${err.host}${err.path}`}>
                      {err.path}
                    </span>
                    <span className="text-on-surface-variant/70 shrink-0 tabular-nums hidden sm:inline">
                      {formatMs(err.ms)}
                    </span>
                    <span className="text-on-surface-variant/70 shrink-0 hidden md:inline">{err.country}</span>
                    <span className="text-outline shrink-0 hidden lg:inline">
                      {new Date(err.ts).toLocaleTimeString('pt-BR')}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <p className="text-[11px] text-on-surface-variant/70">
            Medido no proxy Caddy sobre {report.domains.join(', ') || 'nenhum domínio'}. Endereços IP nunca são
            gravados: o painel guarda contagens agregadas e um identificador irreversível por visitante, usado só
            para contar visitantes distintos.
          </p>
        </>
      )}
    </div>
  );
};
