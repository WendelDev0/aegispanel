import fs from 'fs';
import path from 'path';
import http from 'http';
import { CONFIG } from '../config.js';

export interface GeoLocation {
  countryCode: string;
  country: string;
  city: string;
  lat: number;
  lon: number;
}

/** ip-api.com free tier: 15 batch calls per minute, 100 addresses per call. */
const BATCH_SIZE = 100;
const BATCH_INTERVAL_MS = 6000;
const MAX_CACHE_ENTRIES = 50_000;

/**
 * Reverse-resolves visitor IP addresses to a coarse location.
 *
 * Results are cached on disk and every address is looked up at most once, so a
 * returning visitor never leaves the server again. Only the resolved location
 * is kept by the analytics store; the address itself is not retained beyond
 * this cache, which exists to avoid repeat lookups.
 *
 * The free ip-api.com endpoint is plain HTTP, so treat the response as
 * untrusted input and never send anything but the address itself.
 */
export class GeoIpService {
  private static cache = new Map<string, GeoLocation | null>();
  private static pending = new Set<string>();
  private static timer: NodeJS.Timeout | null = null;
  private static cachePath = path.join(CONFIG.DATA_DIR, 'geoip-cache.json');
  private static dirty = false;

  static load(): void {
    try {
      if (fs.existsSync(this.cachePath)) {
        const raw = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8'));
        for (const [ip, loc] of Object.entries(raw)) {
          this.cache.set(ip, loc as GeoLocation | null);
        }
        console.log(`🌍 Cache de geolocalização carregado: ${this.cache.size} endereços.`);
      }
    } catch (err: any) {
      console.warn('Não foi possível carregar o cache de geolocalização:', err.message);
    }
  }

  static persist(): void {
    if (!this.dirty) return;
    try {
      const entries = [...this.cache.entries()].slice(-MAX_CACHE_ENTRIES);
      const tmp = `${this.cachePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(entries)), 'utf-8');
      fs.renameSync(tmp, this.cachePath);
      this.dirty = false;
    } catch (err: any) {
      console.warn('Não foi possível gravar o cache de geolocalização:', err.message);
    }
  }

  /**
   * Addresses that can never be resolved and must never be sent anywhere:
   * loopback, link-local, and the RFC 1918 private ranges that carry
   * container-to-container traffic.
   */
  static isPrivate(ip: string): boolean {
    if (!ip) return true;
    if (ip === '::1' || ip.startsWith('127.') || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) {
      return true;
    }
    if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true;
    if (ip.startsWith('172.')) {
      const second = parseInt(ip.split('.')[1], 10);
      if (second >= 16 && second <= 31) return true;
    }
    return false;
  }

  /** Cached location, or null when unknown. Queues a lookup on a miss. */
  static lookup(ip: string): GeoLocation | null {
    if (!CONFIG.GEOIP_ENABLED || this.isPrivate(ip)) return null;

    if (this.cache.has(ip)) return this.cache.get(ip) ?? null;

    if (!this.pending.has(ip)) {
      this.pending.add(ip);
      this.scheduleFlush();
    }
    return null;
  }

  private static scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch((err) => console.warn('Falha na resolução de geolocalização:', err.message));
    }, BATCH_INTERVAL_MS);
    this.timer.unref?.();
  }

  private static async flush(): Promise<void> {
    if (this.pending.size === 0) return;

    const batch = [...this.pending].slice(0, BATCH_SIZE);
    for (const ip of batch) this.pending.delete(ip);

    try {
      const results = await this.queryBatch(batch);
      for (const [ip, loc] of results) {
        this.cache.set(ip, loc);
      }
      this.dirty = true;
      this.persist();
    } catch (err: any) {
      console.warn('Consulta de geolocalização falhou:', err.message);
      // Do not requeue: a failing provider would otherwise be retried forever.
      for (const ip of batch) this.cache.set(ip, null);
    }

    if (this.pending.size > 0) this.scheduleFlush();
  }

  private static queryBatch(ips: string[]): Promise<Array<[string, GeoLocation | null]>> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(ips.map((ip) => ({ query: ip, fields: 'status,country,countryCode,city,lat,lon,query' })));

      const req = http.request(
        {
          hostname: 'ip-api.com',
          path: '/batch',
          method: 'POST',
          timeout: 10_000,
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (!Array.isArray(parsed)) return reject(new Error('Resposta inesperada do provedor'));

              resolve(
                parsed.map((entry: any): [string, GeoLocation | null] => {
                  const ip = String(entry?.query ?? '');
                  if (entry?.status !== 'success' || typeof entry.lat !== 'number' || typeof entry.lon !== 'number') {
                    return [ip, null];
                  }
                  return [
                    ip,
                    {
                      countryCode: String(entry.countryCode || '??').slice(0, 2),
                      country: String(entry.country || 'Desconhecido').slice(0, 64),
                      city: String(entry.city || '').slice(0, 64),
                      lat: entry.lat,
                      lon: entry.lon,
                    },
                  ];
                })
              );
            } catch (err: any) {
              reject(err);
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Tempo esgotado'));
      });
      req.write(payload);
      req.end();
    });
  }
}
