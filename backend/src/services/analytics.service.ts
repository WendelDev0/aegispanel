import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CONFIG } from '../config.js';
import { dbStorage } from '../db/storage.js';
import { GeoIpService, GeoLocation } from './geoip.service.js';

export interface Bucket {
  hits: number;
  /** Truncated salted hashes of visitor addresses, for a distinct count. */
  visitors: string[];
  statuses: Record<string, number>;
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
  country: string;
}

export interface DomainAnalytics {
  domain: string;
  totalHits: number;
  hourly: Record<string, Bucket>;
  daily: Record<string, Bucket>;
  paths: Record<string, number>;
  referrers: Record<string, number>;
  browsers: Record<string, number>;
  os: Record<string, number>;
  geo: Record<string, GeoPoint>;
  recentErrors: ErrorSample[];
  updatedAt: string;
}

interface AnalyticsFile {
  version: 1;
  offset: number;
  domains: Record<string, DomainAnalytics>;
}

const HOURLY_RETENTION = 48;
const DAILY_RETENTION = 90;
const MAX_PATHS = 200;
const MAX_REFERRERS = 100;
const MAX_GEO_POINTS = 500;
const MAX_ERRORS = 50;
const MAX_VISITORS_PER_BUCKET = 5000;
const FLUSH_INTERVAL_MS = 30_000;
const POLL_INTERVAL_MS = 10_000;
const MAX_READ_BYTES = 8 * 1024 * 1024;

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
  return crypto.createHash('sha256').update(VISITOR_SALT + ip).digest('hex').slice(0, 12);
}

function emptyBucket(): Bucket {
  return { hits: 0, visitors: [], statuses: {}, bytes: 0 };
}

function statusClass(status: number): string {
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  return '2xx';
}

/** Coarse client identification. Enough to answer "what do my visitors use". */
function parseUserAgent(ua: string): { browser: string; os: string } {
  const s = ua || '';
  let browser = 'Outro';
  if (/bot|crawler|spider|slurp|bingpreview/i.test(s)) browser = 'Bot';
  else if (/edg\//i.test(s)) browser = 'Edge';
  else if (/opr\/|opera/i.test(s)) browser = 'Opera';
  else if (/chrome\//i.test(s) && !/chromium/i.test(s)) browser = 'Chrome';
  else if (/firefox\//i.test(s)) browser = 'Firefox';
  else if (/safari\//i.test(s)) browser = 'Safari';
  else if (/curl|wget|python|go-http|node-fetch|axios/i.test(s)) browser = 'Script/CLI';

  let os = 'Outro';
  if (/android/i.test(s)) os = 'Android';
  else if (/iphone|ipad|ios/i.test(s)) os = 'iOS';
  else if (/windows/i.test(s)) os = 'Windows';
  else if (/mac os x|macintosh/i.test(s)) os = 'macOS';
  else if (/linux/i.test(s)) os = 'Linux';

  return { browser, os };
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
  private static data: AnalyticsFile = { version: 1, offset: 0, domains: {} };
  private static dirty = false;
  private static pollTimer: NodeJS.Timeout | null = null;
  private static flushTimer: NodeJS.Timeout | null = null;
  private static remainder = '';
  private static reading = false;

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

    console.log('📊 Analytics ativo: consumindo o log de acesso do Caddy.');
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
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        if (parsed && parsed.version === 1) {
          this.data = { version: 1, offset: parsed.offset || 0, domains: parsed.domains || {} };
        }
      }
    } catch (err: any) {
      console.warn('Não foi possível carregar analytics.json, começando do zero:', err.message);
    }
  }

  private static persist(): void {
    if (!this.dirty) return;
    try {
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data), 'utf-8');
      fs.renameSync(tmp, this.filePath);
      this.dirty = false;
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

      // A long outage can leave a large backlog; skip ahead rather than
      // reading hundreds of megabytes into memory at once.
      let start = this.data.offset;
      if (stat.size - start > MAX_READ_BYTES) {
        start = stat.size - MAX_READ_BYTES;
        this.remainder = '';
      }

      const fd = fs.openSync(logPath, 'r');
      try {
        const length = stat.size - start;
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, start);
        this.data.offset = stat.size;

        const text = this.remainder + buffer.toString('utf-8');
        const lines = text.split('\n');
        // The last element is either empty or a partially written line.
        this.remainder = lines.pop() ?? '';

        for (const line of lines) {
          if (line.trim()) this.ingestLine(line);
        }
      } finally {
        fs.closeSync(fd);
      }

      this.prune();
      this.dirty = true;
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

    if (entry?.logger && entry.logger !== 'http.log.access') return;

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
    const method = String(request.method || 'GET');
    const size = Number(entry.size) || 0;

    const headers = request.headers || {};
    const userAgent = Array.isArray(headers['User-Agent']) ? headers['User-Agent'][0] : '';
    const referer = Array.isArray(headers.Referer) ? headers.Referer[0] : '';

    const ts = entry.ts ? new Date(Number(entry.ts) * 1000) : new Date();
    if (Number.isNaN(ts.getTime())) return;

    const stats = this.forDomain(domain);
    stats.totalHits += 1;
    stats.updatedAt = new Date().toISOString();

    const hourKey = ts.toISOString().slice(0, 13);
    const dayKey = ts.toISOString().slice(0, 10);
    const visitor = ip ? hashVisitor(ip) : '';

    for (const [key, store] of [
      [hourKey, stats.hourly],
      [dayKey, stats.daily],
    ] as Array<[string, Record<string, Bucket>]>) {
      const bucket = (store[key] ||= emptyBucket());
      bucket.hits += 1;
      bucket.bytes += size;
      bucket.statuses[statusClass(status)] = (bucket.statuses[statusClass(status)] || 0) + 1;
      if (visitor && bucket.visitors.length < MAX_VISITORS_PER_BUCKET && !bucket.visitors.includes(visitor)) {
        bucket.visitors.push(visitor);
      }
    }

    bumpCapped(stats.paths, pathOnly, MAX_PATHS);

    if (referer) {
      try {
        const host = new URL(referer).hostname;
        if (host && host !== domain) bumpCapped(stats.referrers, host, MAX_REFERRERS);
      } catch {
        // malformed referer header; ignored
      }
    }

    const { browser, os } = parseUserAgent(userAgent);
    bumpCapped(stats.browsers, browser, 20);
    bumpCapped(stats.os, os, 20);

    let location: GeoLocation | null = null;
    if (ip) {
      location = GeoIpService.lookup(ip);
      if (location) {
        const key = `${location.countryCode}:${location.city}`;
        const point = (stats.geo[key] ||= { ...location, hits: 0 });
        point.hits += 1;
      }
    }

    if (status >= 400) {
      stats.recentErrors.unshift({
        ts: ts.toISOString(),
        status,
        method,
        path: pathOnly,
        country: location?.country || 'Desconhecido',
      });
      if (stats.recentErrors.length > MAX_ERRORS) stats.recentErrors.length = MAX_ERRORS;
    }
  }

  private static forDomain(domain: string): DomainAnalytics {
    return (this.data.domains[domain] ||= {
      domain,
      totalHits: 0,
      hourly: {},
      daily: {},
      paths: {},
      referrers: {},
      browsers: {},
      os: {},
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

  /**
   * Aggregated report for one application over a window.
   * Hourly buckets back the 24h view; daily buckets back longer ranges.
   */
  static getReport(appId: string, range: '24h' | '7d' | '30d' = '24h') {
    const app = dbStorage.getAppById(appId);
    if (!app) throw new Error('Aplicação não encontrada');

    const domains = this.domainsForApp(appId);
    const sources = domains.map((d) => this.data.domains[d]).filter(Boolean) as DomainAnalytics[];

    const useHourly = range === '24h';
    const points = range === '24h' ? 24 : range === '7d' ? 7 : 30;

    const now = new Date();
    const keys: string[] = [];
    for (let i = points - 1; i >= 0; i--) {
      const d = new Date(now);
      if (useHourly) d.setUTCHours(d.getUTCHours() - i);
      else d.setUTCDate(d.getUTCDate() - i);
      keys.push(useHourly ? d.toISOString().slice(0, 13) : d.toISOString().slice(0, 10));
    }

    const series = keys.map((key) => {
      let hits = 0;
      const visitors = new Set<string>();
      const statuses: Record<string, number> = {};

      for (const source of sources) {
        const bucket = (useHourly ? source.hourly : source.daily)[key];
        if (!bucket) continue;
        hits += bucket.hits;
        for (const v of bucket.visitors) visitors.add(v);
        for (const [cls, count] of Object.entries(bucket.statuses)) {
          statuses[cls] = (statuses[cls] || 0) + count;
        }
      }

      return { key, label: useHourly ? `${key.slice(11)}h` : key.slice(5), hits, visitors: visitors.size, statuses };
    });

    const mergeCounts = (pick: (s: DomainAnalytics) => Record<string, number>, limit: number) => {
      const merged: Record<string, number> = {};
      for (const source of sources) {
        for (const [key, count] of Object.entries(pick(source))) {
          merged[key] = (merged[key] || 0) + count;
        }
      }
      return Object.entries(merged)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([key, count]) => ({ key, count }));
    };

    const geo: Record<string, GeoPoint> = {};
    for (const source of sources) {
      for (const [key, point] of Object.entries(source.geo)) {
        const existing = geo[key];
        if (existing) existing.hits += point.hits;
        else geo[key] = { ...point };
      }
    }

    const totalHits = series.reduce((acc, p) => acc + p.hits, 0);
    const totalVisitors = new Set<string>();
    for (const source of sources) {
      for (const key of keys) {
        const bucket = (useHourly ? source.hourly : source.daily)[key];
        if (bucket) for (const v of bucket.visitors) totalVisitors.add(v);
      }
    }

    const statusTotals: Record<string, number> = {};
    for (const point of series) {
      for (const [cls, count] of Object.entries(point.statuses)) {
        statusTotals[cls] = (statusTotals[cls] || 0) + count;
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

    return {
      appId,
      appName: app.name,
      domains,
      hasDomain: domains.length > 0,
      range,
      totals: {
        hits: totalHits,
        visitors: totalVisitors.size,
        allTimeHits: sources.reduce((acc, s) => acc + s.totalHits, 0),
      },
      series,
      statusTotals,
      topPaths: mergeCounts((s) => s.paths, 15),
      topReferrers: mergeCounts((s) => s.referrers, 10),
      browsers: mergeCounts((s) => s.browsers, 8),
      os: mergeCounts((s) => s.os, 8),
      geoPoints: Object.values(geo).sort((a, b) => b.hits - a.hits),
      countries: Object.values(countries).sort((a, b) => b.hits - a.hits).slice(0, 20),
      recentErrors: sources.flatMap((s) => s.recentErrors).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 20),
      collecting: fs.existsSync(CONFIG.ACCESS_LOG_PATH),
    };
  }
}
