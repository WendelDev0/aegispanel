import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CONFIG } from '../config.js';
import { dbStorage } from '../db/storage.js';
import { GeoIpService, GeoLocation } from './geoip.service.js';
import { VisitorSet, emptyVisitors, addVisitor, VisitorAccumulator } from '../utils/hll.js';

export type Range = '1h' | '24h' | '7d' | '30d';
type Store = 'minutely' | 'hourly' | 'daily';

/**
 * Upper bounds, in milliseconds, of the latency histogram slots.
 *
 * A histogram rather than a running average: an average response time hides
 * exactly the thing an operator is looking for, which is the slow tail. The
 * bounds are fixed so buckets from different times and different domains can
 * be summed slot by slot before any percentile is computed.
 */
const LATENCY_BOUNDS = [1, 3, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
/** One extra slot for everything above the last bound. */
const LATENCY_SLOTS = LATENCY_BOUNDS.length + 1;

export interface Bucket {
  hits: number;
  /** Requests attributed to crawlers and scripts, already included in `hits`. */
  bots: number;
  visitors: VisitorSet;
  /** Counts per status class (2xx/3xx/4xx/5xx). */
  statuses: Record<string, number>;
  /** Counts per exact status code, for "which 4xx exactly". */
  codes: Record<string, number>;
  methods: Record<string, number>;
  /** HTTP version, so an operator can see whether h2/h3 is actually in use. */
  protos: Record<string, number>;
  /** Response bytes out and request bytes in. */
  bytes: number;
  bytesIn: number;
  /**
   * Protocol upgrades (status 101), counted apart from latency.
   *
   * Caddy reports `duration` for an upgraded connection as the lifetime of the
   * whole WebSocket, so a single panel tab left open for half an hour was
   * landing in the histogram as one 2000-second "response" and dragging the
   * mean past the 99th percentile.
   */
  upgrades: number;
  /** Latency histogram, one counter per slot in LATENCY_BOUNDS (+1 overflow). */
  lat: number[];
  latSum: number;
  latCount: number;
}

export interface PathStat {
  hits: number;
  errors: number;
  latSum: number;
  latCount: number;
  /** Slowest single observation, which an average would bury. */
  latMax: number;
  bytes: number;
}

export interface GeoPoint {
  countryCode: string;
  country: string;
  city: string;
  lat: number;
  lon: number;
  hits: number;
}

export interface ErrorSample {
  ts: string;
  status: number;
  method: string;
  path: string;
  host: string;
  country: string;
  ms: number;
}

export interface RequestSample {
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

export interface DomainAnalytics {
  domain: string;
  totalHits: number;
  totalBots: number;
  totalBytes: number;
  minutely: Record<string, Bucket>;
  hourly: Record<string, Bucket>;
  daily: Record<string, Bucket>;
  paths: Record<string, PathStat>;
  referrers: Record<string, number>;
  browsers: Record<string, number>;
  os: Record<string, number>;
  devices: Record<string, number>;
  geo: Record<string, GeoPoint>;
  recentErrors: ErrorSample[];
  updatedAt: string;
}

interface AnalyticsFile {
  version: 2;
  offset: number;
  domains: Record<string, DomainAnalytics>;
}

const MINUTELY_RETENTION = 180;
const HOURLY_RETENTION = 72;
const DAILY_RETENTION = 120;
const MAX_PATHS = 300;
const MAX_REFERRERS = 100;
const MAX_CODES = 40;
const MAX_GEO_POINTS = 500;
const MAX_ERRORS = 100;
const LIVE_TAIL_SIZE = 60;
const FLUSH_INTERVAL_MS = 30_000;
const POLL_INTERVAL_MS = 10_000;
/** Read the backlog in pieces: a single Buffer of the whole tail can be huge. */
const CHUNK_BYTES = 2 * 1024 * 1024;
/** Ceiling for one catch-up pass, so a long outage cannot stall the loop. */
const MAX_CATCHUP_BYTES = 64 * 1024 * 1024;

/**
 * Salt for visitor hashing.
 *
 * Derived from the installation's encryption key, so hashes cannot be compared
 * across installations and a stolen analytics file cannot be reversed into
 * addresses with a rainbow table.
 */
const VISITOR_SALT = crypto
  .createHash('sha256')
  .update(`${CONFIG.ENCRYPTION_KEY}:visitor-salt`)
  .digest('hex');

function hashVisitor(ip: string): string {
  return crypto.createHash('sha256').update(VISITOR_SALT + ip).digest('hex').slice(0, 16);
}

function emptyBucket(): Bucket {
  return {
    hits: 0,
    bots: 0,
    visitors: emptyVisitors(),
    statuses: {},
    codes: {},
    methods: {},
    protos: {},
    bytes: 0,
    bytesIn: 0,
    upgrades: 0,
    lat: new Array(LATENCY_SLOTS).fill(0),
    latSum: 0,
    latCount: 0,
  };
}

function emptyPathStat(): PathStat {
  return { hits: 0, errors: 0, latSum: 0, latCount: 0, latMax: 0, bytes: 0 };
}

function statusClass(status: number): string {
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  if (status >= 200) return '2xx';
  if (status >= 100) return '1xx';
  return 'other';
}

function latencySlot(ms: number): number {
  for (let i = 0; i < LATENCY_BOUNDS.length; i++) {
    if (ms <= LATENCY_BOUNDS[i]) return i;
  }
  return LATENCY_BOUNDS.length;
}

/**
 * Percentile from a merged histogram.
 *
 * Interpolates inside the slot the target falls in, so the answer moves
 * smoothly as traffic shifts instead of snapping between fixed bounds.
 */
function percentile(hist: number[], p: number): number {
  let total = 0;
  for (const n of hist) total += n;
  if (total === 0) return 0;

  const target = total * p;
  let seen = 0;
  for (let i = 0; i < hist.length; i++) {
    if (!hist[i]) continue;
    if (seen + hist[i] >= target) {
      const lower = i === 0 ? 0 : LATENCY_BOUNDS[i - 1];
      // The overflow slot has no upper bound; report its floor rather than
      // inventing a number the data does not support.
      const upper = i >= LATENCY_BOUNDS.length ? LATENCY_BOUNDS[LATENCY_BOUNDS.length - 1] : LATENCY_BOUNDS[i];
      const within = (target - seen) / hist[i];
      return Math.round((lower + (upper - lower) * within) * 100) / 100;
    }
    seen += hist[i];
  }
  return LATENCY_BOUNDS[LATENCY_BOUNDS.length - 1];
}

/** Coarse client identification. Enough to answer "what do my visitors use". */
function parseUserAgent(ua: string): { browser: string; os: string; device: string; bot: boolean } {
  const s = ua || '';

  const bot =
    /bot|crawler|spider|slurp|bingpreview|headlesschrome|facebookexternalhit|whatsapp|telegrambot|semrush|ahrefs|petalbot|dataprovider|censys|zgrab|masscan|monitoring|uptime/i.test(
      s
    );

  let browser = 'Outro';
  if (bot) browser = 'Bot';
  else if (/edg\//i.test(s)) browser = 'Edge';
  else if (/opr\/|opera/i.test(s)) browser = 'Opera';
  else if (/samsungbrowser/i.test(s)) browser = 'Samsung Internet';
  else if (/chrome\//i.test(s) && !/chromium/i.test(s)) browser = 'Chrome';
  else if (/firefox\//i.test(s)) browser = 'Firefox';
  else if (/safari\//i.test(s)) browser = 'Safari';
  else if (/curl|wget|python|go-http|node-fetch|axios|okhttp|java\//i.test(s)) browser = 'Script/CLI';

  let os = 'Outro';
  if (/android/i.test(s)) os = 'Android';
  else if (/iphone|ipad|ios/i.test(s)) os = 'iOS';
  else if (/windows/i.test(s)) os = 'Windows';
  else if (/mac os x|macintosh/i.test(s)) os = 'macOS';
  else if (/linux/i.test(s)) os = 'Linux';

  let device = 'Desktop';
  if (bot) device = 'Bot';
  else if (!s) device = 'Desconhecido';
  else if (/ipad|tablet|kindle|playbook|silk/i.test(s)) device = 'Tablet';
  else if (/mobi|iphone|android|windows phone/i.test(s)) device = 'Mobile';

  return { browser, os, device, bot };
}

function bumpCapped(record: Record<string, number>, key: string, max: number): void {
  record[key] = (record[key] || 0) + 1;
  const keys = Object.keys(record);
  if (keys.length > max * 1.5) {
    // Keep the busiest entries; the long tail is noise for a ranking.
    const kept = keys.sort((a, b) => record[b] - record[a]).slice(0, max);
    const keptSet = new Set(kept);
    for (const k of keys) if (!keptSet.has(k)) delete record[k];
  }
}

export class AnalyticsService {
  private static filePath = path.join(CONFIG.DATA_DIR, 'analytics.json');
  private static data: AnalyticsFile = { version: 2, offset: 0, domains: {} };
  private static dirty = false;
  private static pollTimer: NodeJS.Timeout | null = null;
  private static flushTimer: NodeJS.Timeout | null = null;
  private static remainder = '';
  private static reading = false;
  /**
   * Last requests seen, per domain. Deliberately in memory only: a live tail is
   * worthless after a restart, and persisting it would rewrite the state file
   * on every poll.
   */
  private static live = new Map<string, RequestSample[]>();
  private static ingestedSinceFlush = 0;

  static start(): void {
    this.load();
    GeoIpService.load();

    // Polling rather than fs.watch: the log lives on a volume shared with the
    // Caddy container, where inotify events are not reliable across the mount.
    this.pollTimer = setInterval(() => {
      this.consume().catch((err) => console.warn('Falha ao ler o log de acesso:', err.message));
    }, POLL_INTERVAL_MS);
    this.pollTimer.unref?.();

    this.flushTimer = setInterval(() => this.persist(), FLUSH_INTERVAL_MS);
    this.flushTimer.unref?.();

    // Do not wait a full poll interval for the first read: after a restart the
    // panel would otherwise report no traffic for ten seconds.
    this.consume().catch((err) => console.warn('Falha ao ler o log de acesso:', err.message));

    console.log('📊 Analytics ativo: consumindo o log de acesso do Caddy.');
    if (!CONFIG.GEOIP_ENABLED) {
      console.log('🌍 Geolocalização desativada (defina GEOIP_ENABLED=true para o mapa de origem).');
    }
  }

  /**
   * Forces one read of the access log instead of waiting for the poll.
   *
   * Backs the "refresh now" control: without it the button re-fetched the same
   * aggregates for up to ten seconds and looked broken.
   */
  static async refresh(): Promise<void> {
    await this.consume();
  }

  static stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.pollTimer = null;
    this.flushTimer = null;
    this.persist();
    GeoIpService.persist();
  }

  private static load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));

      if (parsed?.version === 2) {
        this.data = { version: 2, offset: parsed.offset || 0, domains: parsed.domains || {} };
        return;
      }

      // A v1 file holds none of the latency, protocol or per-path detail the
      // reports are now built from, and none of it can be derived after the
      // fact. Rewinding to the start of the log rebuilds everything the log
      // still contains, which is strictly more than the old file carried.
      if (parsed?.version === 1) {
        console.log('📊 Analytics: formato antigo detectado, reprocessando o log de acesso do início.');
        this.data = { version: 2, offset: 0, domains: {} };
        this.dirty = true;
      }
    } catch (err: any) {
      console.warn('Não foi possível carregar analytics.json, começando do zero:', err.message);
    }
  }

  private static persist(): void {
    if (!this.dirty) return;
    try {
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data), { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tmp, this.filePath);
      if (!CONFIG.IS_WINDOWS) {
        try { fs.chmodSync(this.filePath, 0o600); } catch { /* best effort */ }
      }
      this.dirty = false;
      this.ingestedSinceFlush = 0;
    } catch (err: any) {
      console.warn('Não foi possível gravar analytics.json:', err.message);
    }
  }

  /** Reads whatever the access log has appended since the last pass. */
  private static async consume(): Promise<void> {
    if (this.reading) return;
    this.reading = true;

    try {
      const logPath = CONFIG.ACCESS_LOG_PATH;
      if (!fs.existsSync(logPath)) return;

      const stat = fs.statSync(logPath);

      // Caddy rotates by renaming, so a smaller file means a fresh one: start
      // from the beginning instead of seeking past the end of it.
      if (stat.size < this.data.offset) {
        this.data.offset = 0;
        this.remainder = '';
      }

      if (stat.size === this.data.offset) return;

      let start = this.data.offset;
      // A long outage can leave a backlog larger than one pass should pull
      // through; skip ahead rather than stalling the poll loop.
      if (stat.size - start > MAX_CATCHUP_BYTES) {
        start = stat.size - MAX_CATCHUP_BYTES;
        this.remainder = '';
      }

      const fd = fs.openSync(logPath, 'r');
      try {
        const end = stat.size;
        const buffer = Buffer.alloc(CHUNK_BYTES);

        // Chunked on purpose: the previous version allocated one Buffer for the
        // whole tail and then held its UTF-8 string at the same time, so a large
        // catch-up kept several times the file size resident at once.
        while (start < end) {
          const length = Math.min(CHUNK_BYTES, end - start);
          const read = fs.readSync(fd, buffer, 0, length, start);
          if (read <= 0) break;
          start += read;

          const text = this.remainder + buffer.toString('utf-8', 0, read);
          const lines = text.split('\n');
          // The last element is either empty or a partially written line.
          this.remainder = lines.pop() ?? '';

          for (const line of lines) {
            if (line.length > 1) this.ingestLine(line);
          }
        }

        this.data.offset = start;
      } finally {
        fs.closeSync(fd);
      }

      this.prune();
      this.dirty = true;

      // A backfill pass can ingest hundreds of thousands of lines; losing that
      // to a hard kill before the 30s flush would replay and double-count them.
      if (this.ingestedSinceFlush > 20_000) this.persist();
    } finally {
      this.reading = false;
    }
  }

  /** Parses one Caddy JSON access log entry into the aggregates. */
  private static ingestLine(line: string): void {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }

    // Caddy names each site's access logger after the block that declared it,
    // so the field reads "http.log.access.log0", "http.log.access.log1" and so
    // on — never a bare "http.log.access". Comparing for equality here silently
    // discarded every line in the file and the panel reported no traffic at all
    // while happily advancing its read offset past megabytes of real requests.
    const logger: unknown = entry?.logger;
    if (typeof logger === 'string' && !logger.startsWith('http.log.access')) return;

    const request = entry?.request;
    if (!request || typeof request.host !== 'string') return;

    const domain = request.host.toLowerCase().split(':')[0];
    if (!domain) return;

    // Field name differs across Caddy versions; client_ip is present when
    // trusted proxies are configured.
    const ip: string = request.client_ip || request.remote_ip || (request.remote_addr || '').split(':')[0] || '';

    const status = Number(entry.status) || 0;
    const uri = String(request.uri || '/');
    const pathOnly = uri.split('?')[0].slice(0, 200) || '/';
    const method = String(request.method || 'GET').slice(0, 10).toUpperCase();
    const proto = String(request.proto || '').slice(0, 10) || 'HTTP/1.1';
    const size = Number(entry.size) || 0;
    const bytesIn = Number(entry.bytes_read) || 0;
    // Caddy reports duration in seconds as a float.
    const ms = Math.max(0, (Number(entry.duration) || 0) * 1000);

    const headers = request.headers || {};
    const userAgent = Array.isArray(headers['User-Agent']) ? headers['User-Agent'][0] : '';
    const referer = Array.isArray(headers.Referer) ? headers.Referer[0] : '';

    const ts = entry.ts ? new Date(Number(entry.ts) * 1000) : new Date();
    if (Number.isNaN(ts.getTime())) return;

    const { browser, os, device, bot } = parseUserAgent(userAgent);

    const stats = this.forDomain(domain);
    stats.totalHits += 1;
    stats.totalBytes += size;
    if (bot) stats.totalBots += 1;
    stats.updatedAt = new Date().toISOString();

    const iso = ts.toISOString();
    const visitor = ip ? hashVisitor(ip) : '';
    const cls = statusClass(status);
    // 101 is a connection that stayed open, not a request that was answered.
    const measurable = status !== 101;
    const slot = latencySlot(ms);

    for (const [key, store] of [
      [iso.slice(0, 16), stats.minutely],
      [iso.slice(0, 13), stats.hourly],
      [iso.slice(0, 10), stats.daily],
    ] as Array<[string, Record<string, Bucket>]>) {
      const bucket = (store[key] ||= emptyBucket());
      bucket.hits += 1;
      if (bot) bucket.bots += 1;
      bucket.bytes += size;
      bucket.bytesIn += bytesIn;
      bucket.statuses[cls] = (bucket.statuses[cls] || 0) + 1;
      bumpCapped(bucket.codes, String(status), MAX_CODES);
      bumpCapped(bucket.methods, method, 12);
      bumpCapped(bucket.protos, proto, 6);
      if (measurable) {
        bucket.lat[slot] += 1;
        bucket.latSum += ms;
        bucket.latCount += 1;
      } else {
        bucket.upgrades += 1;
      }
      if (visitor) bucket.visitors = addVisitor(bucket.visitors, visitor);
    }

    const pathStat = (stats.paths[pathOnly] ||= emptyPathStat());
    pathStat.hits += 1;
    pathStat.bytes += size;
    if (measurable) {
      pathStat.latSum += ms;
      pathStat.latCount += 1;
      if (ms > pathStat.latMax) pathStat.latMax = ms;
    }
    if (status >= 400) pathStat.errors += 1;
    this.capPaths(stats);

    if (referer) {
      try {
        const host = new URL(referer).hostname;
        if (host && host !== domain) bumpCapped(stats.referrers, host, MAX_REFERRERS);
      } catch {
        // malformed referer header; ignored
      }
    }

    bumpCapped(stats.browsers, browser, 20);
    bumpCapped(stats.os, os, 20);
    bumpCapped(stats.devices, device, 10);

    let location: GeoLocation | null = null;
    if (ip) {
      location = GeoIpService.lookup(ip);
      if (location) {
        const key = `${location.countryCode}:${location.city}`;
        const point = (stats.geo[key] ||= { ...location, hits: 0 });
        point.hits += 1;
      }
    }

    const country = location?.country || 'Desconhecido';

    if (status >= 400) {
      stats.recentErrors.unshift({
        ts: iso,
        status,
        method,
        path: pathOnly,
        host: domain,
        country,
        ms: Math.round(ms),
      });
      if (stats.recentErrors.length > MAX_ERRORS) stats.recentErrors.length = MAX_ERRORS;
    }

    const tail = this.live.get(domain) ?? [];
    tail.unshift({
      ts: iso,
      status,
      method,
      path: pathOnly,
      host: domain,
      ms: Math.round(ms * 100) / 100,
      bytes: size,
      country,
      bot,
    });
    if (tail.length > LIVE_TAIL_SIZE) tail.length = LIVE_TAIL_SIZE;
    this.live.set(domain, tail);

    this.ingestedSinceFlush += 1;
  }

  /** Path cardinality is unbounded on a site that serves generated URLs. */
  private static capPaths(stats: DomainAnalytics): void {
    const keys = Object.keys(stats.paths);
    if (keys.length <= MAX_PATHS * 1.5) return;
    const kept = new Set(keys.sort((a, b) => stats.paths[b].hits - stats.paths[a].hits).slice(0, MAX_PATHS));
    for (const key of keys) if (!kept.has(key)) delete stats.paths[key];
  }

  private static forDomain(domain: string): DomainAnalytics {
    return (this.data.domains[domain] ||= {
      domain,
      totalHits: 0,
      totalBots: 0,
      totalBytes: 0,
      minutely: {},
      hourly: {},
      daily: {},
      paths: {},
      referrers: {},
      browsers: {},
      os: {},
      devices: {},
      geo: {},
      recentErrors: [],
      updatedAt: new Date().toISOString(),
    });
  }

  private static prune(): void {
    for (const stats of Object.values(this.data.domains)) {
      const trim = (store: Record<string, Bucket>, keep: number) => {
        const keys = Object.keys(store).sort();
        for (const key of keys.slice(0, Math.max(0, keys.length - keep))) delete store[key];
      };
      trim(stats.minutely, MINUTELY_RETENTION);
      trim(stats.hourly, HOURLY_RETENTION);
      trim(stats.daily, DAILY_RETENTION);

      const geoKeys = Object.keys(stats.geo);
      if (geoKeys.length > MAX_GEO_POINTS) {
        const kept = new Set(
          geoKeys.sort((a, b) => stats.geo[b].hits - stats.geo[a].hits).slice(0, MAX_GEO_POINTS)
        );
        for (const key of geoKeys) if (!kept.has(key)) delete stats.geo[key];
      }
    }
  }

  /** Domains the panel knows about, whether or not they have traffic yet. */
  private static domainsForApp(appId: string): string[] {
    const app = dbStorage.getAppById(appId);
    if (!app) return [];

    const domains = new Set<string>();
    if (app.domain) domains.add(app.domain.toLowerCase().trim());
    for (const d of dbStorage.getDomains()) {
      if (d.targetContainer === app.name || d.targetPort === app.port) {
        domains.add(d.domain.toLowerCase().trim());
      }
    }
    return [...domains];
  }

  // ---------------------------------------------------------------------------
  // Reporting
  // ---------------------------------------------------------------------------

  private static granularityFor(range: Range): { store: Store; points: number; stepMs: number } {
    switch (range) {
      case '1h':
        return { store: 'minutely', points: 60, stepMs: 60_000 };
      case '24h':
        return { store: 'hourly', points: 24, stepMs: 3_600_000 };
      case '7d':
        return { store: 'daily', points: 7, stepMs: 86_400_000 };
      case '30d':
      default:
        return { store: 'daily', points: 30, stepMs: 86_400_000 };
    }
  }

  private static keyFor(store: Store, d: Date): string {
    const iso = d.toISOString();
    if (store === 'minutely') return iso.slice(0, 16);
    if (store === 'hourly') return iso.slice(0, 13);
    return iso.slice(0, 10);
  }

  /** Sums every bucket under `keys` across every source domain. */
  private static aggregate(sources: DomainAnalytics[], store: Store, keys: string[]) {
    const hist = new Array(LATENCY_SLOTS).fill(0);
    const statuses: Record<string, number> = {};
    const codes: Record<string, number> = {};
    const methods: Record<string, number> = {};
    const protos: Record<string, number> = {};
    const visitors = new VisitorAccumulator();
    let hits = 0;
    let bots = 0;
    let bytes = 0;
    let bytesIn = 0;
    let latSum = 0;
    let latCount = 0;
    let upgrades = 0;

    for (const source of sources) {
      const table = source[store];
      if (!table) continue;
      for (const key of keys) {
        const bucket = table[key];
        if (!bucket) continue;
        hits += bucket.hits;
        bots += bucket.bots;
        bytes += bucket.bytes;
        bytesIn += bucket.bytesIn;
        latSum += bucket.latSum;
        latCount += bucket.latCount;
        upgrades += bucket.upgrades || 0;
        visitors.add(bucket.visitors);
        for (let i = 0; i < LATENCY_SLOTS; i++) hist[i] += bucket.lat?.[i] || 0;
        for (const [k, v] of Object.entries(bucket.statuses)) statuses[k] = (statuses[k] || 0) + v;
        for (const [k, v] of Object.entries(bucket.codes || {})) codes[k] = (codes[k] || 0) + v;
        for (const [k, v] of Object.entries(bucket.methods || {})) methods[k] = (methods[k] || 0) + v;
        for (const [k, v] of Object.entries(bucket.protos || {})) protos[k] = (protos[k] || 0) + v;
      }
    }

    return { hits, bots, bytes, bytesIn, latSum, latCount, upgrades, hist, statuses, codes, methods, protos, visitors };
  }

  private static summarize(agg: ReturnType<typeof AnalyticsService.aggregate>) {
    const errors4xx = agg.statuses['4xx'] || 0;
    const errors5xx = agg.statuses['5xx'] || 0;
    return {
      hits: agg.hits,
      bots: agg.bots,
      humans: agg.hits - agg.bots,
      visitors: agg.visitors.count(),
      /** False when the count is a HyperLogLog estimate rather than exact. */
      visitorsExact: agg.visitors.exactCount,
      bytesOut: agg.bytes,
      bytesIn: agg.bytesIn,
      errors4xx,
      errors5xx,
      errorRate: agg.hits > 0 ? Math.round(((errors4xx + errors5xx) / agg.hits) * 10000) / 100 : 0,
      /** WebSocket and other upgrades, excluded from every latency figure. */
      upgrades: agg.upgrades,
      /** Requests the latency figures are actually computed from. */
      measured: agg.latCount,
      avgMs: agg.latCount > 0 ? Math.round((agg.latSum / agg.latCount) * 100) / 100 : 0,
      p50: percentile(agg.hist, 0.5),
      p75: percentile(agg.hist, 0.75),
      p95: percentile(agg.hist, 0.95),
      p99: percentile(agg.hist, 0.99),
    };
  }

  private static windowKeys(range: Range): { store: Store; keys: string[]; prevKeys: string[] } {
    const { store, points, stepMs } = this.granularityFor(range);
    // Align to the bucket boundary so the newest column is the one in progress
    // rather than a partially filled slice of two.
    const aligned = Math.floor(Date.now() / stepMs) * stepMs;

    const keys: string[] = [];
    const prevKeys: string[] = [];
    for (let i = points - 1; i >= 0; i--) {
      keys.push(this.keyFor(store, new Date(aligned - i * stepMs)));
      prevKeys.push(this.keyFor(store, new Date(aligned - (i + points) * stepMs)));
    }
    return { store, keys, prevKeys };
  }

  private static labelFor(store: Store, key: string): string {
    if (store === 'minutely') return key.slice(11);
    if (store === 'hourly') return `${key.slice(11)}h`;
    return key.slice(5);
  }

  private static pctDelta(a: number, b: number): number | null {
    // null, not 0: "no baseline to compare against" is not "unchanged", and the
    // UI has to be able to tell them apart.
    if (b === 0) return a === 0 ? 0 : null;
    return Math.round(((a - b) / b) * 1000) / 10;
  }

  /**
   * Aggregated report for one application over a window.
   *
   * Every window also computes the immediately preceding window of the same
   * length, so the UI can show whether a number is rising or falling. A metric
   * without a trend is a number without a meaning.
   */
  static getReport(appId: string, range: Range = '24h') {
    const app = dbStorage.getAppById(appId);
    if (!app) throw new Error('Aplicação não encontrada');

    const domains = this.domainsForApp(appId);
    const sources = domains.map((d) => this.data.domains[d]).filter(Boolean) as DomainAnalytics[];
    const { store, keys, prevKeys } = this.windowKeys(range);

    const series = keys.map((key, idx) => {
      const point = this.aggregate(sources, store, [key]);
      return {
        key,
        label: this.labelFor(store, key),
        hits: point.hits,
        bots: point.bots,
        visitors: point.visitors.count(),
        bytes: point.bytes,
        statuses: point.statuses,
        errors: (point.statuses['4xx'] || 0) + (point.statuses['5xx'] || 0),
        avgMs: point.latCount > 0 ? Math.round((point.latSum / point.latCount) * 100) / 100 : 0,
        p95: percentile(point.hist, 0.95),
        // Marks the bucket still being written, which always looks like a dip.
        partial: idx === keys.length - 1,
      };
    });

    const current = this.aggregate(sources, store, keys);
    const previous = this.aggregate(sources, store, prevKeys);
    const totals = this.summarize(current);
    const prevTotals = this.summarize(previous);

    const mergeCounts = (pick: (s: DomainAnalytics) => Record<string, number>, limit: number) => {
      const merged: Record<string, number> = {};
      for (const source of sources) {
        for (const [key, count] of Object.entries(pick(source) || {})) {
          merged[key] = (merged[key] || 0) + count;
        }
      }
      return Object.entries(merged)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([key, count]) => ({ key, count }));
    };

    const paths: Record<string, PathStat> = {};
    for (const source of sources) {
      for (const [key, stat] of Object.entries(source.paths || {})) {
        const target = (paths[key] ||= emptyPathStat());
        target.hits += stat.hits;
        target.errors += stat.errors;
        target.latSum += stat.latSum;
        target.latCount += stat.latCount;
        target.bytes += stat.bytes;
        if (stat.latMax > target.latMax) target.latMax = stat.latMax;
      }
    }

    const pathRows = Object.entries(paths).map(([p, s]) => ({
      path: p,
      hits: s.hits,
      errors: s.errors,
      errorRate: s.hits > 0 ? Math.round((s.errors / s.hits) * 1000) / 10 : 0,
      avgMs: s.latCount > 0 ? Math.round((s.latSum / s.latCount) * 100) / 100 : 0,
      maxMs: Math.round(s.latMax * 100) / 100,
      bytes: s.bytes,
    }));

    const geo: Record<string, GeoPoint> = {};
    for (const source of sources) {
      for (const [key, point] of Object.entries(source.geo || {})) {
        const existing = geo[key];
        if (existing) existing.hits += point.hits;
        else geo[key] = { ...point };
      }
    }

    const countries: Record<string, { country: string; countryCode: string; hits: number }> = {};
    for (const point of Object.values(geo)) {
      const entry = (countries[point.countryCode] ||= {
        country: point.country,
        countryCode: point.countryCode,
        hits: 0,
      });
      entry.hits += point.hits;
    }

    const sortCounts = (record: Record<string, number>, limit: number) =>
      Object.entries(record)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([key, count]) => ({ key, count }));

    return {
      appId,
      appName: app.name,
      domains,
      hasDomain: domains.length > 0,
      range,
      granularity: store,
      collecting: fs.existsSync(CONFIG.ACCESS_LOG_PATH),
      geoEnabled: CONFIG.GEOIP_ENABLED,
      totals: {
        ...totals,
        allTimeHits: sources.reduce((acc, s) => acc + s.totalHits, 0),
        allTimeBytes: sources.reduce((acc, s) => acc + (s.totalBytes || 0), 0),
      },
      previous: prevTotals,
      deltas: {
        hits: this.pctDelta(totals.hits, prevTotals.hits),
        visitors: this.pctDelta(totals.visitors, prevTotals.visitors),
        bytesOut: this.pctDelta(totals.bytesOut, prevTotals.bytesOut),
        p95: this.pctDelta(totals.p95, prevTotals.p95),
        // Percentage points, not a ratio: the change of a rate expressed as a
        // ratio of a rate is unreadable.
        errorRate: Math.round((totals.errorRate - prevTotals.errorRate) * 100) / 100,
      },
      latency: { bounds: LATENCY_BOUNDS, histogram: current.hist },
      series,
      statusTotals: current.statuses,
      topCodes: sortCounts(current.codes, 12),
      methods: sortCounts(current.methods, 8),
      protocols: sortCounts(current.protos, 6),
      topPaths: [...pathRows].sort((a, b) => b.hits - a.hits).slice(0, 15),
      // At least two observations: a single cold-start request would otherwise
      // top the ranking forever and hide the endpoints that are actually slow.
      slowestPaths: [...pathRows]
        .filter((p) => p.avgMs > 0 && p.hits >= 2)
        .sort((a, b) => b.avgMs - a.avgMs)
        .slice(0, 10),
      topErrorPaths: [...pathRows].filter((p) => p.errors > 0).sort((a, b) => b.errors - a.errors).slice(0, 10),
      topReferrers: mergeCounts((s) => s.referrers, 10),
      browsers: mergeCounts((s) => s.browsers, 8),
      os: mergeCounts((s) => s.os, 8),
      devices: mergeCounts((s) => s.devices, 6),
      geoPoints: Object.values(geo).sort((a, b) => b.hits - a.hits),
      countries: Object.values(countries).sort((a, b) => b.hits - a.hits).slice(0, 20),
      recentErrors: sources
        .flatMap((s) => s.recentErrors || [])
        .sort((a, b) => b.ts.localeCompare(a.ts))
        .slice(0, 30),
      live: domains
        .flatMap((d) => this.live.get(d) ?? [])
        .sort((a, b) => b.ts.localeCompare(a.ts))
        .slice(0, LIVE_TAIL_SIZE),
    };
  }

  /**
   * Panel-wide roll-up.
   *
   * The per-application view answers "how is this app doing"; it cannot answer
   * "is anything wrong right now", which is the question an operator opening
   * the panel actually has.
   */
  static getOverview(range: Range = '24h') {
    const { store, keys, prevKeys } = this.windowKeys(range);
    const all = Object.values(this.data.domains);

    const current = this.aggregate(all, store, keys);
    const previous = this.aggregate(all, store, prevKeys);

    const apps = dbStorage.getApps().map((app) => {
      const domains = this.domainsForApp(app.id);
      const sources = domains.map((d) => this.data.domains[d]).filter(Boolean) as DomainAnalytics[];
      const agg = this.aggregate(sources, store, keys);
      const prev = this.aggregate(sources, store, prevKeys);
      const summary = this.summarize(agg);
      return {
        appId: app.id,
        appName: app.name,
        domains,
        hits: summary.hits,
        visitors: summary.visitors,
        errorRate: summary.errorRate,
        errors5xx: summary.errors5xx,
        p95: summary.p95,
        bytesOut: summary.bytesOut,
        trend: this.pctDelta(agg.hits, prev.hits),
      };
    });

    const attributed = new Set(apps.flatMap((a) => a.domains));

    return {
      range,
      granularity: store,
      collecting: fs.existsSync(CONFIG.ACCESS_LOG_PATH),
      geoEnabled: CONFIG.GEOIP_ENABLED,
      totals: this.summarize(current),
      previous: this.summarize(previous),
      series: keys.map((key, idx) => {
        const point = this.aggregate(all, store, [key]);
        return {
          key,
          label: this.labelFor(store, key),
          hits: point.hits,
          errors: (point.statuses['4xx'] || 0) + (point.statuses['5xx'] || 0),
          p95: percentile(point.hist, 0.95),
          partial: idx === keys.length - 1,
        };
      }),
      apps: apps.sort((a, b) => b.hits - a.hits),
      // Domains Caddy is serving that no application in the panel claims —
      // usually the panel's own hostname, sometimes a stale DNS record.
      unattributed: all
        .filter((d) => !attributed.has(d.domain))
        .map((d) => ({ domain: d.domain, hits: d.totalHits }))
        .sort((a, b) => b.hits - a.hits)
        .slice(0, 10),
    };
  }

  /** Diagnostics for the "why is nothing being recorded" case. */
  static getStatus() {
    const logPath = CONFIG.ACCESS_LOG_PATH;
    const exists = fs.existsSync(logPath);
    let size = 0;
    let mtime: string | null = null;
    let readable = false;

    if (exists) {
      try {
        const stat = fs.statSync(logPath);
        size = stat.size;
        mtime = stat.mtime.toISOString();
        fs.accessSync(logPath, fs.constants.R_OK);
        readable = true;
      } catch {
        // permissions, or a race with rotation; reported as unreadable
      }
    }

    return {
      logPath,
      logExists: exists,
      logReadable: readable,
      logSize: size,
      logModifiedAt: mtime,
      offset: this.data.offset,
      /** Bytes appended to the log that have not been parsed yet. */
      lag: Math.max(0, size - this.data.offset),
      domainsTracked: Object.keys(this.data.domains).length,
      totalHits: Object.values(this.data.domains).reduce((acc, d) => acc + d.totalHits, 0),
      geoEnabled: CONFIG.GEOIP_ENABLED,
      trustedProxies: CONFIG.TRUSTED_PROXIES,
    };
  }
}
