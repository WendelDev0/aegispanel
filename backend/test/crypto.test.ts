import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EncryptionService, DecryptionError } from '../src/utils/crypto.js';

test('encrypt/decrypt round-trips a value', () => {
  const secret = 'senha-com-símbolos-!@#$%&*_+=-';
  const encrypted = EncryptionService.encrypt(secret);

  assert.notEqual(encrypted, secret);
  assert.ok(EncryptionService.isEncrypted(encrypted));
  assert.equal(EncryptionService.decrypt(secret === encrypted ? '' : encrypted), secret);
});

test('encrypt produces a different ciphertext each time', () => {
  const a = EncryptionService.encrypt('mesmo-valor');
  const b = EncryptionService.encrypt('mesmo-valor');
  assert.notEqual(a, b, 'IV reuse would make identical values recognisable');
  assert.equal(EncryptionService.decrypt(a), EncryptionService.decrypt(b));
});

test('decrypt throws on tampered ciphertext instead of returning a placeholder', () => {
  const encrypted = EncryptionService.encrypt('valor-original');
  const parts = encrypted.split(':');
  // Flip the last byte of the payload.
  const lastChar = parts[3].slice(-1) === 'a' ? 'b' : 'a';
  const tampered = [parts[0], parts[1], parts[2], parts[3].slice(0, -1) + lastChar].join(':');

  assert.throws(() => EncryptionService.decrypt(tampered), DecryptionError);
  // The non-throwing variant must report failure rather than invent a value,
  // otherwise a caller persists the placeholder over the real secret.
  assert.equal(EncryptionService.tryDecrypt(tampered), null);
});

test('decrypt passes through plain legacy values', () => {
  assert.equal(EncryptionService.decrypt('senha-em-texto-puro'), 'senha-em-texto-puro');
  assert.equal(EncryptionService.decrypt(''), '');
});

test('generated password respects length and character classes', () => {
  for (let i = 0; i < 50; i++) {
    const pw = EncryptionService.generateStrongPassword(24, true);
    assert.equal(pw.length, 24);
    assert.match(pw, /[A-Z]/, `sem maiúscula: ${pw}`);
    assert.match(pw, /[a-z]/, `sem minúscula: ${pw}`);
    assert.match(pw, /[0-9]/, `sem dígito: ${pw}`);
    assert.match(pw, /[!@#$%&*_+=-]/, `sem símbolo: ${pw}`);
  }
});

test('generated passwords are not repeated', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    seen.add(EncryptionService.generateStrongPassword(16));
  }
  assert.equal(seen.size, 200);
});

test('generateToken produces url-safe high-entropy tokens', () => {
  const token = EncryptionService.generateToken(32);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.ok(token.length >= 40);
});

test('a value encrypted with another key fails loudly instead of leaking the blob', () => {
  // Shape of the pre-v1 format (iv:authTag:payload) but not openable with the
  // current key. Returning it verbatim would hand the caller a hex string as
  // if it were the password, and persist it on the next save.
  const foreign = `${'a'.repeat(32)}:${'b'.repeat(32)}:${'c'.repeat(20)}`;
  assert.throws(() => EncryptionService.decrypt(foreign), DecryptionError);
  assert.equal(EncryptionService.tryDecrypt(foreign), null);
});
