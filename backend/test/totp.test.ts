import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTotpSecret, totpAt, verifyTotp, generateRecoveryCodes, otpauthUrl } from '../src/utils/totp.js';

test('gera e verifica um código TOTP no instante atual', () => {
  const secret = generateTotpSecret();
  const code = totpAt(secret);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotp(secret, code), true);
});

test('rejeita um código fora da janela', () => {
  const secret = generateTotpSecret();
  assert.equal(verifyTotp(secret, '000000'), false);
  assert.equal(verifyTotp(secret, 'abcdef'), false);
});

test('aceita o passo anterior da janela (±1)', () => {
  const secret = generateTotpSecret();
  const previous = totpAt(secret, Date.now() - 30_000);
  assert.equal(verifyTotp(secret, previous), true);
});

test('otpauth aponta para o usuário e o issuer', () => {
  const url = otpauthUrl('admin', 'MFRGGZDF');
  assert.match(url, /^otpauth:\/\/totp\//);
  assert.ok(url.includes('AegisPanel'));
  assert.ok(url.includes('admin'));
});

test('gera 10 códigos de recuperação no formato XXXX-XXXX', () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[0-9A-F]{4}-[0-9A-F]{4}$/);
});
