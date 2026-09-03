import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import express from 'express';
import bcrypt from 'bcryptjs';
import { dbStorage, User } from '../src/db/storage.js';
import { signToken, sessionExpiresAt, requireWrite, authMiddleware } from '../src/middleware/auth.js';
import { AuditStore } from '../src/utils/audit.store.js';
import { redactSecrets } from '../src/utils/redact.js';
import { authRouter } from '../src/routes/auth.routes.js';
import { cronRouter } from '../src/routes/cron.routes.js';

const routesDir = path.join(process.cwd(), 'src/routes');

function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

async function seedAdmin(): Promise<{ user: User; token: string }> {
  const user: User = {
    id: `usr-audit-${Date.now()}`,
    username: `audit-${Date.now().toString(36)}`,
    passwordHash: await bcrypt.hash('senha-de-teste-12', 4),
    role: 'admin',
    tokenVersion: 0,
    createdAt: new Date().toISOString(),
  };
  dbStorage.saveUser(user);
  const session = dbStorage.createSession({ userId: user.id, expiresAt: sessionExpiresAt() });
  const token = signToken({ ...user, sid: session.id, tokenVersion: 0 });
  return { user, token };
}

test('redactSecrets remove token, senha e prefixo aegis.v1', () => {
  const raw = JSON.stringify({
    password: 'super-secret-pass',
    token: 'ghp_abcdefghijklmnopqrstuvwxyz0123',
    blob: 'aegis.v1:cipherpayload',
  });
  const safe = redactSecrets(raw);
  assert.ok(!safe.includes('super-secret-pass'));
  assert.ok(!safe.includes('ghp_abcdefghijklmnopqrstuvwxyz0123'));
  assert.ok(!safe.includes('cipherpayload'));
});

test('append grava jsonl e query encontra o evento', () => {
  AuditStore.append({
    action: 'test.probe',
    outcome: 'success',
    actor: { id: 'u1', username: 'probe', role: 'admin' },
    meta: { token: 'should-not-leak-12345678' },
  });
  const found = AuditStore.query({ action: 'test.probe' });
  assert.ok(found.some((e) => e.action === 'test.probe' && e.actor?.username === 'probe'));
  const line = JSON.stringify(found[0]);
  assert.ok(!line.includes('should-not-leak-12345678'));
});

test('rota mutante requireWrite grava sucesso e 403', async () => {
  const { user, token } = await seedAdmin();
  const viewer: User = {
    id: `usr-view-${Date.now()}`,
    username: `view-${Date.now().toString(36)}`,
    passwordHash: 'x',
    role: 'viewer',
    tokenVersion: 0,
    createdAt: new Date().toISOString(),
  };
  dbStorage.saveUser(viewer);
  const viewerSession = dbStorage.createSession({ userId: viewer.id, expiresAt: sessionExpiresAt() });
  const viewerToken = signToken({ ...viewer, sid: viewerSession.id, tokenVersion: 0 });

  const app = express();
  app.use(express.json());
  app.post('/probe', authMiddleware, requireWrite, (_req, res) => {
    res.json({ ok: true });
  });
  const { url, close } = await listen(app);

  try {
    const ok = await fetch(`${url}/probe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(ok.status, 200);

    const forbidden = await fetch(`${url}/probe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${viewerToken}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(forbidden.status, 403);

    await new Promise((r) => setTimeout(r, 20));
    const events = AuditStore.query({ action: 'POST /probe' });
    assert.ok(
      events.some((e) => e.outcome === 'success' && e.actor?.id === user.id),
      'sucesso da rota mutante deve gerar evento'
    );
    assert.ok(
      events.some((e) => e.outcome === 'forbidden' && e.actor?.id === viewer.id),
      '403 da rota mutante deve gerar evento'
    );
  } finally {
    await close();
    dbStorage.removeUser(user.id);
    dbStorage.removeUser(viewer.id);
  }
});

test('login escreve evento de auditoria', async () => {
  const password = 'senha-de-teste-12';
  const { user } = await seedAdmin();
  user.passwordHash = await bcrypt.hash(password, 4);
  dbStorage.saveUser(user);

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use('/api/cron', cronRouter);
  const { url, close } = await listen(app);

  try {
    const fail = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, password: 'senha-errada-12x' }),
    });
    assert.equal(fail.status, 401);

    const ok = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, password }),
    });
    assert.equal(ok.status, 200);

    const events = AuditStore.query({ action: 'auth.login' });
    assert.ok(events.some((e) => e.outcome === 'failure'));
    assert.ok(events.some((e) => e.outcome === 'success' && e.actor?.id === user.id));
  } finally {
    await close();
    dbStorage.removeUser(user.id);
  }
});

test('toda rota mutante registrada usa requireWrite ou requireAdmin', () => {
  const publicMutations = new Set([
    'auth.routes.ts POST /login',
    'auth.routes.ts POST /setup',
    'auth.routes.ts POST /2fa/verify',
  ]);
  const selfService = new Set([
    'auth.routes.ts POST /2fa/setup',
    'auth.routes.ts POST /2fa/confirm',
    'auth.routes.ts POST /2fa/disable',
    'auth.routes.ts POST /refresh',
    'auth.routes.ts POST /logout',
    'auth.routes.ts DELETE /sessions/:id',
    'auth.routes.ts POST /change-password',
  ]);

  const ungated: string[] = [];
  for (const file of fs.readdirSync(routesDir).filter((f) => f.endsWith('.routes.ts'))) {
    if (file === 'webhook.routes.ts') continue;
    const src = fs.readFileSync(path.join(routesDir, file), 'utf-8');
    const routerGate = /\.use\(\s*require(Admin|Write)\s*\)/.test(src);
    const re = /\.(post|put|patch|delete)\(\s*'([^']+)'/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(src))) {
      const key = `${file} ${match[1].toUpperCase()} ${match[2]}`;
      if (publicMutations.has(key) || selfService.has(key)) continue;
      const window = src.slice(match.index, match.index + 500);
      const gated = routerGate || /requireWrite|requireAdmin/.test(window);
      if (!gated) ungated.push(key);
    }
  }
  assert.deepEqual(ungated, [], `rotas mutantes sem gate de papel:\n${ungated.join('\n')}`);
});
