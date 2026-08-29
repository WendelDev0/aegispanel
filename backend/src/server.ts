import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { CONFIG } from './config.js';
import { SystemService } from './services/system.service.js';
import { TerminalService } from './services/terminal.service.js';
import { AlertService } from './services/alert.service.js';
import { CaddyService } from './services/caddy.service.js';

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

const app = express();
const server = http.createServer(app);
export const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

// WebSocket Setup
io.on('connection', (socket) => {
  console.log(`🔌 Client connected to WebSocket: ${socket.id}`);

  TerminalService.handleSocketConnection(socket);

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected from WebSocket: ${socket.id}`);
  });
});

// Broadcast Realtime System Metrics every 2000ms
setInterval(async () => {
  try {
    const stats = await SystemService.getRealtimeStats();
    io.emit('system:metrics', stats);
    await AlertService.checkThresholds(
      stats.cpu.usagePercent,
      stats.memory.usedPercent,
      stats.disks[0]?.usePercent || 0
    );
  } catch (err) {
    // ignore
  }
}, 2000);

server.listen(CONFIG.PORT, () => {
  console.log(`========================================================`);
  console.log(`🛡️  AegisPanel Daemon running on port ${CONFIG.PORT}`);
  console.log(`🚀 Mode: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📂 Data directory: ${CONFIG.DATA_DIR}`);
  console.log(`========================================================`);

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

