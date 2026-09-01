import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dbStorage, User } from '../src/db/storage.js';
import { authenticateToken, signToken } from '../src/middleware/auth.js';
import { AppService } from '../src/services/app.service.js';
import { assertSafeGitUrl } from '../src/utils/url-security.js';
import { isValidDomain } from '../src/utils/naming.js';

test('revoga tokens quando o papel do usuário muda', () => {
  const user: User = {
    id: `auth-test-${Date.now()}`,
    username: `auth-test-${Date.now()}`,
    passwordHash: 'not-used-in-this-test',
    role: 'admin',
    tokenVersion: 0,
    createdAt: new Date().toISOString(),
  };

  dbStorage.saveUser(user);
  try {
    const token = signToken(user);
    assert.equal(authenticateToken(token).role, 'admin');

    user.role = 'viewer';
    dbStorage.saveUser(user);
    assert.throws(() => authenticateToken(token));
  } finally {
    dbStorage.removeUser(user.id);
  }
});

test('não expõe valores de variáveis de ambiente na representação pública', () => {
  const publicApp = AppService.toPublic({
    id: 'app-test',
    name: 'teste',
    sourceType: 'image',
    imageName: 'nginx:alpine',
    port: 4100,
    internalPort: 80,
    env: { API_KEY: 'segredo-super-secreto' },
    status: 'stopped',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  assert.equal(publicApp.env.API_KEY, '••••••••');
  assert.ok(!JSON.stringify(publicApp).includes('segredo-super-secreto'));
});

test('rejeita repositórios Git em HTTP ou redes privadas', async () => {
  await assert.rejects(() => assertSafeGitUrl('http://example.com/repo.git'));
  await assert.rejects(() => assertSafeGitUrl('https://127.0.0.1/repo.git'));
  await assert.rejects(() => assertSafeGitUrl('https://localhost/repo.git'));
});

test('aceita nomes DNS e rejeita literais de IP como domínio de aplicação', () => {
  assert.equal(isValidDomain('painel.example.com'), true);
  assert.equal(isValidDomain('127.0.0.1'), false);
  assert.equal(isValidDomain('https://[::1]'), false);
});
