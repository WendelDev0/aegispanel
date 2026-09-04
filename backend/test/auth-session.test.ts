import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import express from 'express';
import { dbStorage, User } from '../src/db/storage.js';
import { authenticateToken, signToken, sessionExpiresAt } from '../src/middleware/auth.js';
import { EncryptionService } from '../src/utils/crypto.js';
import { generateTotpSecret, totpAt } from '../src/utils/totp.js';
import { authRouter } from '../src/routes/auth.routes.js';

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

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: `usr-sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    username: `sess-${Date.now().toString(36)}`,
    passwordHash: 'not-used',
    role: 'admin',
    tokenVersion: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test('JWT de acesso sem sid é rejeitado', () => {
  const user = makeUser();
  dbStorage.saveUser(user);
  try {
    assert.throws(() => signToken(user));
  } finally {
    dbStorage.removeUser(user.id);
  }
});

test('revogar a sessão invalida o token mesmo com tokenVersion intacto', () => {
  const user = makeUser();
  dbStorage.saveUser(user);
  const session = dbStorage.createSession({
    userId: user.id,
    expiresAt: sessionExpiresAt(),
  });
  const token = signToken({ ...user, sid: session.id, tokenVersion: 0 });
  try {
    assert.equal(authenticateToken(token).sid, session.id);
    dbStorage.revokeSession(session.id);
    assert.throws(() => authenticateToken(token));
  } finally {
    dbStorage.removeUser(user.id);
  }
});

test('login com 2FA devolve pendingToken e só então o JWT completo', async () => {
  const password = 'senha-de-teste-12';
  const secret = generateTotpSecret();
  const user = makeUser({
    passwordHash: await bcrypt.hash(password, 4),
    totpEnabled: true,
    totpSecret: EncryptionService.encrypt(secret),
  });
  dbStorage.saveUser(user);

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  const { url, close } = await listen(app);

  try {
    const login = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, password }),
    });
    assert.equal(login.status, 200);
    const pending = (await login.json()) as { requires2fa?: boolean; pendingToken?: string; token?: string };
    assert.equal(pending.requires2fa, true);
    assert.ok(pending.pendingToken);
    assert.equal(pending.token, undefined);

    const blocked = await fetch(`${url}/api/auth/me`, {
      headers: { Authorization: `Bearer ${pending.pendingToken}` },
    });
    assert.equal(blocked.status, 401);

    const verify = await fetch(`${url}/api/auth/2fa/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pending.pendingToken}`,
      },
      body: JSON.stringify({ code: totpAt(secret) }),
    });
    assert.equal(verify.status, 200);
    const done = (await verify.json()) as { token: string; user: { totpEnabled: boolean } };
    assert.ok(done.token);
    assert.equal(done.user.totpEnabled, true);
    assert.equal(authenticateToken(done.token).id, user.id);
    assert.ok(!JSON.stringify(done.user).includes(secret));
  } finally {
    await close();
    dbStorage.removeUser(user.id);
  }
});
