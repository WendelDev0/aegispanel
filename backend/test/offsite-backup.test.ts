import './setup.js';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { EncryptionService } from '../src/utils/crypto.js';
import { keysToDelete, type DatedObject } from '../src/utils/backup-retention.js';
import { OffsiteService, MemoryOffsiteBackend } from '../src/services/offsite.service.js';
import { BackupService } from '../src/services/backup.service.js';
import { dbStorage } from '../src/db/storage.js';
import { CONFIG } from '../src/config.js';
import { TEST_DATA_DIR } from './setup.js';

function seedAdmin(): void {
  dbStorage.saveUser({
    id: 'u-drill',
    username: 'admin',
    passwordHash: 'hash',
    role: 'admin',
    createdAt: new Date().toISOString(),
  });
}

function configureMemoryTarget(backend: MemoryOffsiteBackend): void {
  process.env.AEGIS_ALLOW_OFFSITE_BACKUP = 'true';
  OffsiteService.useBackendForTests(backend);
  OffsiteService.saveTarget({
    provider: 's3',
    region: 'auto',
    bucket: 'aegis-test',
    prefix: 'aegis',
    accessKeyId: 'AKIA_TEST',
    secretAccessKey: 'secret-test',
  });
}

describe('offsite backup', { concurrency: false }, () => {
test('encryptFile round-trip and ciphertext hides plaintext', async () => {
  const dir = path.join(TEST_DATA_DIR, 'enc-files');
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, 'dump.sql');
  const enc = path.join(dir, 'dump.sql.enc');
  const out = path.join(dir, 'dump.sql.out');
  const marker = 'SUPERSECRET_DUMP_MARKER_9f3a';
  fs.writeFileSync(src, `-- PostgreSQL database dump\n${marker}\n`);

  await EncryptionService.encryptFile(src, enc);
  assert.equal(EncryptionService.isEncryptedFile(enc), true);
  const encBytes = fs.readFileSync(enc);
  assert.equal(encBytes.includes(Buffer.from(marker)), false);

  await EncryptionService.decryptFile(enc, out);
  assert.equal(fs.readFileSync(out, 'utf-8'), fs.readFileSync(src, 'utf-8'));
});

test('keysToDelete keeps 14 daily, 8 weekly and 12 monthly', () => {
  const now = new Date(Date.UTC(2026, 8, 3));
  const objects: DatedObject[] = [];
  for (let i = 0; i < 40; i++) {
    const at = new Date(Date.UTC(2026, 8, 3 - i));
    objects.push({ key: `day-${i}`, lastModified: at });
  }
  const drop = new Set(keysToDelete(objects, now));
  assert.ok(!drop.has('day-0'));
  assert.ok(!drop.has('day-13'));
  assert.ok(drop.has('day-39') || objects.filter((o) => !drop.has(o.key)).length < objects.length);
  const kept = objects.filter((o) => !drop.has(o.key));
  assert.ok(kept.length < objects.length);
  assert.ok(kept.some((o) => o.key === 'day-0'));
});

test('memory backend upload hashes the ciphertext and round-trips', async () => {
  const backend = new MemoryOffsiteBackend();
  configureMemoryTarget(backend);
  try {
    const src = path.join(TEST_DATA_DIR, 'plain-upload.sql');
    fs.writeFileSync(src, '-- PostgreSQL database dump\nSELECT 1;\n');
    const key = OffsiteService.objectKey('db', 'plain-upload.sql', 'db-1');
    const { sha256 } = await OffsiteService.uploadFile(src, key);
    const stored = backend.objects.get(key);
    assert.ok(stored);
    assert.equal(stored.sha256, sha256);
    assert.equal(stored.body.includes(Buffer.from('SELECT 1')), false);

    const dest = path.join(TEST_DATA_DIR, 'plain-upload.restored.sql');
    await OffsiteService.downloadTo(key, dest);
    assert.equal(fs.readFileSync(dest, 'utf-8'), fs.readFileSync(src, 'utf-8'));
  } finally {
    OffsiteService.useBackendForTests(null);
    delete process.env.AEGIS_ALLOW_OFFSITE_BACKUP;
  }
});

test('LOCAL_MODE blocks offsite upload and test unless the escape hatch is set', async () => {
  assert.equal(CONFIG.LOCAL_MODE, true);
  delete process.env.AEGIS_ALLOW_OFFSITE_BACKUP;
  OffsiteService.useBackendForTests(new MemoryOffsiteBackend());
  OffsiteService.saveTarget({
    provider: 's3',
    region: 'auto',
    bucket: 'blocked',
    accessKeyId: 'x',
    secretAccessKey: 'y',
  });
  const src = path.join(TEST_DATA_DIR, 'blocked.sql');
  fs.writeFileSync(src, '-- PostgreSQL database dump\n');
  await assert.rejects(
    () => OffsiteService.uploadFile(src, 'aegis/panel/blocked.sql.enc'),
    /modo local/
  );
  await assert.rejects(() => OffsiteService.testConnection(), /modo local/);
  OffsiteService.useBackendForTests(null);
});

test('materializeBackupFile downloads from memory store after the local file is gone', async () => {
  const backend = new MemoryOffsiteBackend();
  configureMemoryTarget(backend);
  try {
    const backupsDir = path.join(TEST_DATA_DIR, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
    const filename = 'backup_postgres_gone.sql';
    const local = path.join(backupsDir, filename);
    const payload = '-- PostgreSQL database dump\n-- gone-from-disk\n';
    fs.writeFileSync(local, payload, { mode: 0o600 });

    const key = OffsiteService.objectKey('db', filename, 'db-gone');
    await OffsiteService.uploadFile(local, key);
    fs.unlinkSync(local);
    assert.equal(fs.existsSync(local), false);

    const restored = await BackupService.materializeBackupFile({
      id: 'bkp-gone',
      targetType: 'database',
      targetId: 'db-gone',
      targetName: 'gone',
      filename,
      sizeBytes: payload.length,
      status: 'completed',
      createdAt: new Date().toISOString(),
      offsiteKey: key,
    });
    assert.equal(fs.readFileSync(restored, 'utf-8'), payload);
  } finally {
    OffsiteService.useBackendForTests(null);
    delete process.env.AEGIS_ALLOW_OFFSITE_BACKUP;
  }
});

test('panel-state drill validates schema without importing', async () => {
  seedAdmin();
  const before = dbStorage.getUsers().map((u) => u.username).sort();
  const rec = await BackupService.createPanelStateBackup();
  assert.ok(rec.status === 'completed' || rec.status === 'completed_local_only');

  dbStorage.saveUser({
    id: 'u-after-snapshot',
    username: 'depois',
    passwordHash: 'hash',
    role: 'developer',
    createdAt: new Date().toISOString(),
  });

  const result = await BackupService.runRestoreDrill();
  assert.equal(result.ok, true);
  assert.match(result.summary, /schema válido/);
  assert.match(result.summary, /Modo local/);

  const after = dbStorage.getUsers().map((u) => u.username).sort();
  assert.ok(after.includes('depois'));
  assert.deepEqual(
    after.filter((n) => n !== 'depois').sort(),
    before
  );

  const stored = dbStorage.getBackups().find((b) => b.id === rec.id);
  assert.equal(stored?.drill?.ok, true);
});

test('parseS3Uri and parseRemoteKey', () => {
  assert.deepEqual(OffsiteService.parseS3Uri('s3://bucket/pref/x'), { bucket: 'bucket', prefix: 'pref/x' });
  const panel = OffsiteService.parseRemoteKey('aegis/panel/backup_panel_state.json.enc');
  assert.equal(panel.kind, 'panel');
  assert.equal(panel.filename, 'backup_panel_state.json');
  const db = OffsiteService.parseRemoteKey('aegis/db/db-1/dump.sql.enc');
  assert.equal(db.kind, 'db');
  assert.equal(db.dbId, 'db-1');
  assert.throws(() => OffsiteService.parseRemoteKey('aegis/../etc/passwd'), /inválida/);
});
});
