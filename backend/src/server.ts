import express from 'express';
import http from 'http';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { CONFIG } from './config.js';
import { setIo, connectedClients } from './realtime.js';
import { SystemService } from './services/system.service.js';
import { TerminalService } from './services/terminal.service.js';
import { AlertService } from './services/alert.service.js';
import { CaddyService } from './services/caddy.service.js';
import { CronService } from './services/cron.service.js';
import { AnalyticsService } from './services/analytics.service.js';
import { CicdService } from './services/cicd.service.js';
import { WatchdogService } from './services/watchdog.service.js';
import { authenticateToken, AuthUser } from './middleware/auth.js';
import { dbStorage } from './db/storage.js';
import { AuditStore } from './utils/audit.store.js';
import { releasePanelLock } from './utils/panel-lock.js';

// Routers
import { authRouter } from './routes/auth.routes.js';
import { systemRouter } from './routes/system.routes.js';
import { dockerRouter } from './routes/docker.routes.js';
import { databaseRouter } from './routes/database.routes.js';
import { appRouter } from './routes/app.routes.js';
import { domainRouter } from './routes/domain.routes.js';
import { backupRouter } from './routes/backup.routes.js';
import { fileRouter } from './routes/file.routes.js';
import { queryRouter } from './routes/query.routes.js';
import { firewallRouter } from './routes/firewall.routes.js';
import { webhookRouter } from './routes/webhook.routes.js';
import { nodeRouter } from './routes/node.routes.js';
import { templateRouter } from './routes/template.routes.js';
import { cronRouter } from './routes/cron.routes.js';
import { analyticsRouter } from './routes/analytics.routes.js';

const app = express();
const server = http.createServer(app);

// An empty allowlist means same-origin only, which is the deployed topology:
// the browser talks to Caddy/nginx, which proxies /api to this process.
function allowedBrowserOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  if (CONFIG.CORS_ORIGINS.includes(origin)) return true;
  if (CONFIG.CORS_ORIGINS.length) return false;
  const domain = dbStorage.getSettings().panelDomain?.toLowerCase().trim();
  if (!domain) return false;
  if (origin === `https://${domain}`) return true;
  return CONFIG.LOCAL_MODE && origin === `http://${domain}`;
}

const corsOrigin: cors.CorsOptions['origin'] = (origin, cb) => {
  if (!origin) {
    cb(null, true);
    return;
  }
  cb(null, allowedBrowserOrigin(origin));
};

const corsOptions: cors.CorsOptions = { origin: corsOrigin, credentials: true };

export const io = new SocketIOServer(server, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'], credentials: true },
});
setIo(io);

/**
 * The realtime channel exposes an interactive shell. It must be authenticated
 * at the handshake, before any listener is attached: an open socket here is an
 * unauthenticated shell on a host that has the Docker socket mounted.
 */
io.use((socket, next) => {
  const token =
    (socket.handshake.auth?.token as string | undefined) ||
    (socket.handshake.headers.authorization as string | undefined)?.replace('Bearer ', '');

  if (!token) {
    return next(new Error('unauthorized: token ausente'));
  }

  try {
    socket.data.user = authenticateToken(token);
    socket.data.authToken = token;
    next();
  } catch {
    next(new Error('unauthorized: token inválido ou expirado'));
  }
});

// Trust only explicitly configured proxy addresses. `1` would also trust a
// client-controlled X-Forwarded-For header when the API is reached directly.
app.set('trust proxy', CONFIG.TRUSTED_PROXIES.length ? CONFIG.TRUSTED_PROXIES : false);

app.disable('x-powered-by');
app.use(cors(corsOptions));

// Capture GitHub's exact request bytes before the general JSON parser runs.
// Signature verification cannot operate on a re-serialized object.
app.use(
  '/api/webhooks',
  express.json({
    limit: '512kb',
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString('utf-8');
    },
  })
);

// This router owns a 50 MB parser for administrator uploads. Mount it before
// the general 1 MB parser so the larger route-specific limit is reachable.
app.use('/api/files', fileRouter);

// Small default body limit. Routes that legitimately accept large payloads
// raise it locally, so an unauthenticated endpoint can never be used to buffer
// tens of megabytes per request.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Healthcheck
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'Aegis VPS & Cloud Manager',
    platform: process.platform,
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/system', systemRouter);
app.use('/api/docker', dockerRouter);
app.use('/api/databases', databaseRouter);
app.use('/api/apps', appRouter);
app.use('/api/templates', templateRouter);
app.use('/api/cron', cronRouter);
app.use('/api/domains', domainRouter);
app.use('/api/backups', backupRouter);
app.use('/api/query', queryRouter);
app.use('/api/firewall', firewallRouter);
app.use('/api/webhooks', webhookRouter);
app.use('/api/nodes', nodeRouter);
app.use('/api/analytics', analyticsRouter);

// WebSocket Setup
io.on('connection', (socket) => {
  const user = socket.data.user as AuthUser;
  console.log(`🔌 WebSocket conectado: ${socket.id} (usuário: ${user.username}, perfil: ${user.role})`);

  TerminalService.handleSocketConnection(socket, user);

  socket.on('disconnect', () => {
    console.log(`🔌 WebSocket desconectado: ${socket.id}`);
  });
});

/**
 * Re-check the session on every connected socket. A revoke in the UI must
 * drop the terminal within one interval, not at the next JWT expiry.
 */
const SESSION_WATCH_MS = 30_000;
const sessionWatchTimer = setInterval(() => {
  for (const socket of io.sockets.sockets.values()) {
    const token = socket.data.authToken as string | undefined;
    if (!token) {
      socket.disconnect(true);
      continue;
    }
    try {
      socket.data.user = authenticateToken(token);
    } catch {
      socket.emit('session:revoked');
      socket.disconnect(true);
    }
  }
}, SESSION_WATCH_MS);

/**
 * Broadcast realtime system metrics.
 *
 * Skips the sample entirely when nobody is listening, and never lets two
 * collections overlap: systeminformation can take longer than the interval on
 * a loaded host, which would otherwise stack calls until the process stalls.
 */
const METRICS_INTERVAL_MS = 2000;
let metricsInFlight = false;

const metricsTimer = setInterval(async () => {
  if (metricsInFlight) return;
  if (connectedClients() === 0) return;

  metricsInFlight = true;
  try {
    const stats = await SystemService.getRealtimeStats();
    io.emit('system:metrics', stats);
    await AlertService.checkThresholds(
      stats.cpu.usagePercent,
      stats.memory.usedPercent,
      stats.disks[0]?.usePercent || 0
    );
  } catch (err: any) {
    console.warn('Falha ao coletar métricas:', err?.message);
  } finally {
    metricsInFlight = false;
  }
}, METRICS_INTERVAL_MS);

/**
 * Storage health monitor — checks the panel_db.json size periodically.
 *
 * Build logs are the main unbounded growth vector: each deploy can add
 * hundreds of KB, and the entire document is rewritten on every mutation.
 * When the file exceeds 10 MB, old deployment logs are pruned automatically.
 * At 20 MB an alert is sent, because the file is big enough to cause visible
 * write latency on every state change.
 */
const STORAGE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 min
const STORAGE_PRUNE_THRESHOLD_MB = 10;
const STORAGE_ALERT_THRESHOLD_MB = 20;
let lastStorageAlertAt = 0;

const storageTimer = setInterval(() => {
  try {
    dbStorage.pruneSessions();
    AuditStore.archiveAndPrune(12, path.join(CONFIG.DATA_DIR, 'backups', 'audit-archive'));

    const health = dbStorage.getStorageHealth();

    // Auto-prune old deployment logs when the file gets large.
    if (health.fileSizeMB >= STORAGE_PRUNE_THRESHOLD_MB) {
      const pruned = dbStorage.pruneDeployments();
      if (pruned > 0) {
        console.warn(
          `📦 Storage auto-prune: ${pruned} registros de deploy antigos limpos ` +
          `(panel_db.json estava em ${health.fileSizeMB} MB).`
        );
      }
    }

    // Alert when the file is still large after pruning.
    const now = Date.now();
    if (
      health.fileSizeMB >= STORAGE_ALERT_THRESHOLD_MB &&
      now - lastStorageAlertAt > 60 * 60 * 1000 // at most once per hour
    ) {
      lastStorageAlertAt = now;
      const detail =
        `panel_db.json atingiu ${health.fileSizeMB} MB. ` +
        `Registros: ${Object.entries(health.recordCounts).map(([k, v]) => `${k}: ${v}`).join(', ')}.`;
      console.warn(`⚠️ ${detail}`);

      AlertService.broadcastNotification(
        '⚠️ Alerta: Armazenamento do painel crescendo',
        detail,
        'alert',
        true
      );
      dbStorage.addActivity({
        type: 'system',
        title: 'Armazenamento do painel elevado',
        description: detail,
        status: 'warning',
        metadata: { fileSizeMB: health.fileSizeMB, ...health.recordCounts },
      });
    }
  } catch (err: any) {
    console.warn('Falha ao verificar saúde do storage:', err?.message);
  }
}, STORAGE_CHECK_INTERVAL_MS);

server.listen(CONFIG.PORT, () => {
  console.log(`========================================================`);
  console.log(`🛡️  AegisPanel Daemon running on port ${CONFIG.PORT}`);
  console.log(`🚀 Mode: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📂 Data directory: ${CONFIG.DATA_DIR}`);
  if (CONFIG.LOCAL_MODE) {
    console.log(`🧪 MODO LOCAL ATIVO`);
    console.log(`   - Certificados TLS internos (nenhuma chamada ao Let's Encrypt)`);
    console.log(`   - Notificações externas bloqueadas`);
    console.log(`   - Agendador de cron desativado`);
    console.log(`   Para rodar como servidor de verdade: NODE_ENV=production`);
  }
  console.log(`========================================================`);

  CronService.start();
  AnalyticsService.start();
  // Independent of the metrics loop, which skips when no client is connected —
  // precisely when an unattended app is being OOM-killed unnoticed.
  WatchdogService.start();

  const abandoned = CicdService.abandonInFlightDeploys();
  if (abandoned > 0) {
    console.warn(
      `⚠️ ${abandoned} deploy(s) interrompido(s) na inicialização (ficaram em building após um restart).`
    );
  }

  // Auto-heal: Sync Caddyfile with correct email and domains on every startup
  setTimeout(async () => {
    try {
      await CaddyService.syncCaddyfile();
      console.log('🔒 Caddy SSL auto-heal: Caddyfile sincronizado com sucesso na inicialização.');
    } catch (err: any) {
      console.warn('⚠️ Caddy auto-heal notice:', err.message);
    }
  }, 3000);
});

function shutdown(signal: string) {
  console.log(`\n${signal} recebido, encerrando...`);
  // Released first: a self-update recreates this container, and the replacement
  // starts before the heartbeat of a hard-killed owner would look abandoned.
  // Without this the new backend refuses to boot for up to 30s.
  releasePanelLock();
  clearInterval(metricsTimer);
  clearInterval(storageTimer);
  clearInterval(sessionWatchTimer);
  CronService.stop();
  AnalyticsService.stop();
  WatchdogService.stop();
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
