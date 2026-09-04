import http from 'http';
import { AppRecord } from '../db/storage.js';
import { NodeService } from './node.service.js';
import { containerNameForApp } from '../utils/naming.js';
import { isRemoteTarget } from '../utils/app-upstream.js';
import { normalizeHealthcheck, type HealthcheckConfig } from '../utils/health-probe.js';

/**
 * Probes an application from the panel, over the network.
 *
 * Deliberately not Docker's own healthcheck as the primary signal. That probe
 * runs inside the container, so it needs wget or curl to exist there — a
 * distroless, scratch or slim image has neither, and every such app would be
 * reported unhealthy. With automatic rollback wired to the signal, that is not
 * a cosmetic bug: it rolls back deploys that worked.
 *
 * The panel already sits on the same Docker network as local apps and reaches
 * remote ones on their published host port, so it can ask the only question
 * that matters from outside, for any image: is something accepting connections
 * and answering HTTP on that port?
 */

export interface ProbeResult {
  reachable: boolean;
  statusCode?: number;
  error?: string;
  durationMs: number;
}

/**
 * Any HTTP response counts as reachable — including 404 and 500.
 *
 * The question this probe answers is "did the process come up", not "is the
 * application correct". An API whose `/` returns 404 is completely healthy, and
 * it is extremely common; treating that as a failure would roll back a good
 * deploy. A 500 is an application bug the panel must surface, not paper over by
 * restarting the container underneath it.
 */
export class HealthService {
  static probeUrl(url: string, timeoutMs: number): Promise<ProbeResult> {
    const startedAt = Date.now();

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: Omit<ProbeResult, 'durationMs'>) => {
        if (settled) return;
        settled = true;
        resolve({ ...result, durationMs: Date.now() - startedAt });
      };

      let request: http.ClientRequest;
      try {
        request = http.get(url, { timeout: timeoutMs }, (res) => {
          // The body is irrelevant and may be large; draining without reading
          // keeps a streaming endpoint from holding the socket open.
          res.resume();
          finish({ reachable: true, statusCode: res.statusCode });
        });
      } catch (err: any) {
        finish({ reachable: false, error: err?.message || 'URL inválida' });
        return;
      }

      request.on('timeout', () => {
        request.destroy();
        finish({ reachable: false, error: `Sem resposta em ${timeoutMs}ms` });
      });
      request.on('error', (err: any) => {
        finish({ reachable: false, error: err?.code || err?.message || 'Falha de conexão' });
      });
    });
  }

  /**
   * Address the panel uses to reach an app.
   *
   * Mirrors how Caddy resolves the same app: container DNS on the shared
   * network locally, the node's published host port remotely. Probing a
   * different address than the one serving traffic would report health for
   * something users never touch.
   */
  static targetUrl(app: AppRecord, config: HealthcheckConfig): string | null {
    const node = app.nodeId ? NodeService.getById(app.nodeId) : null;

    if (isRemoteTarget(app.nodeId, node)) {
      const host = (node?.hostIp || node?.sshHost || '').trim();
      if (!host) return null;
      const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
      return `http://${authority}:${app.port}${config.path}`;
    }

    return `http://${containerNameForApp(app.name)}:${app.internalPort || 3000}${config.path}`;
  }

  static config(app: Pick<AppRecord, 'healthcheck'>): HealthcheckConfig {
    return normalizeHealthcheck(app.healthcheck);
  }

  static async probeApp(app: AppRecord): Promise<ProbeResult> {
    const config = this.config(app);
    const url = this.targetUrl(app, config);
    if (!url) {
      return { reachable: false, error: 'Nó sem endereço para sondagem', durationMs: 0 };
    }
    return this.probeUrl(url, config.timeoutSec * 1000);
  }

  /**
   * Waits for a freshly started container to answer.
   *
   * Used as the deploy gate: a deploy that reports success while the container
   * is crash-looping is worse than a failed one, because nobody goes looking.
   */
  static async waitUntilReady(
    app: AppRecord,
    options: { timeoutMs?: number; intervalMs?: number; onAttempt?: (attempt: number, result: ProbeResult) => void } = {}
  ): Promise<{ ready: boolean; attempts: number; lastError?: string }> {
    const timeoutMs = options.timeoutMs ?? 120_000;
    const intervalMs = options.intervalMs ?? 3_000;
    const deadline = Date.now() + timeoutMs;

    let attempts = 0;
    let lastError: string | undefined;

    while (Date.now() < deadline) {
      attempts++;
      const result = await this.probeApp(app);
      options.onAttempt?.(attempts, result);

      if (result.reachable) return { ready: true, attempts };
      lastError = result.error;

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
    }

    return { ready: false, attempts, lastError };
  }
}
