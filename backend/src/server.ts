import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { CONFIG } from './config.js';
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
import { SystemService } from './services/system.service.js';
import { TerminalService } from './services/terminal.service.js';
import { AlertService } from './services/alert.service.js';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/system', systemRouter);
app.use('/api/docker', dockerRouter);
app.use('/api/databases', databaseRouter);
app.use('/api/apps', appRouter);
app.use('/api/domains', domainRouter);
app.use('/api/backups', backupRouter);
app.use('/api/files', fileRouter);
app.use('/api/query', queryRouter);
app.use('/api/firewall', firewallRouter);
app.use('/api/webhooks', webhookRouter);
app.use('/api/nodes', nodeRouter);

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// WebSockets Setup
io.on('connection', (socket) => {
  // Setup Terminal session
  TerminalService.handleSocketConnection(socket);
});

// Periodic real-time system metrics broadcast & threshold monitoring
setInterval(async () => {
  try {
    const stats = await SystemService.getRealtimeStats();
    
    // Broadcast to UI
    if (io.engine.clientsCount > 0) {
      io.emit('system:metrics', stats);
    }

    // Check alert thresholds (Discord / Telegram)
    const disk = stats.disks[0];
    await AlertService.checkThresholds(
      stats.cpu.usagePercent,
      stats.memory.usedPercent,
      disk ? disk.usePercent : 0
    );
  } catch (err) {
    // ignore
  }
}, 2000);

server.listen(CONFIG.PORT, () => {
  console.log(`=============================================`);
  console.log(`🛡️ Aegis VPS Cloud Manager running on port ${CONFIG.PORT}`);
  console.log(`⚡ Mode: ${CONFIG.IS_WINDOWS ? 'Windows' : 'Linux / VPS'}`);
  console.log(`📁 Data Directory: ${CONFIG.DATA_DIR}`);
  console.log(`=============================================`);
});
