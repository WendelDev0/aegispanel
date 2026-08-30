import express from 'express';
import http from 'http';
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
import { verifyToken, AuthUser } from './middleware/auth.js';

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
const corsOptions: cors.CorsOptions = CONFIG.CORS_ORIGINS.length
  ? { origin: CONFIG.CORS_ORIGINS, credentials: true }
  : { origin: false };

export const io = new SocketIOServer(server, {
  cors: CONFIG.CORS_ORIGINS.length
    ? { origin: CONFIG.CORS_ORIGINS, methods: ['GET', 'POST'], credentials: true }
    : { origin: false },
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
    socket.data.user = verifyToken(token);
    next();
  } catch {
    next(new Error('unauthorized: token inválido ou expirado'));
  }
});

// Trust the reverse proxy in front of us so req.ip reflects the real client.
// Without this, rate limiting reads a client-controlled header.
app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(cors(corsOptions));

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
app.use('/api/files', fileRouter);
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
  clearInterval(metricsTimer);
  CronService.stop();
  AnalyticsService.stop();
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
