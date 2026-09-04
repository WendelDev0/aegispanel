/**
 * Disaster recovery: rebuild panel state and databases from an offsite prefix.
 *
 * Credentials come from the environment, not panel_db.json — on a new VPS
 * that file does not exist yet. ENCRYPTION_KEY must be the key that ciphered
 * the dumps; a freshly generated one cannot open them.
 *
 *   node dist/scripts/dr-restore.js --from s3://bucket/prefix [--dry-run]
 */
import { OffsiteService } from '../services/offsite.service.js';
import { BackupService } from '../services/backup.service.js';
import { DatabaseService } from '../services/database.service.js';
import { CaddyService } from '../services/caddy.service.js';
import { dbStorage } from '../db/storage.js';
import { CONFIG } from '../config.js';
import fs from 'fs';
import path from 'path';

function parseArgs(argv: string[]): { from: string; dryRun: boolean } {
  let from = '';
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--from') from = argv[++i] || '';
    else if (arg.startsWith('--from=')) from = arg.slice('--from='.length);
  }
  if (!from) {
    console.error('Uso: node dist/scripts/dr-restore.js --from s3://bucket/prefix [--dry-run]');
    process.exit(1);
  }
  return { from, dryRun };
}

function latestOf(keys: { key: string; lastModified: string }[], pred: (key: string) => boolean) {
  return keys.filter((o) => pred(o.key)).sort((a, b) => b.lastModified.localeCompare(a.lastModified))[0];
}

async function main(): Promise<void> {
  const { from, dryRun } = parseArgs(process.argv.slice(2));
  const { bucket, prefix } = OffsiteService.parseS3Uri(from);
  const backend = OffsiteService.s3BackendFromEnv(bucket);
  const objects = await OffsiteService.listRemote(backend, prefix);

  const panelObj = latestOf(objects, (key) => key.includes('/panel/') && key.endsWith('.enc'));
  if (!panelObj) {
    throw new Error(`Nenhum snapshot do painel em s3://${bucket}/${prefix}`);
  }

  const tmpDir = path.join(CONFIG.DATA_DIR, 'backups');
  fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  const panelPath = path.join(tmpDir, 'dr-panel-state.json');
  await OffsiteService.downloadTo(panelObj.key, panelPath, backend);
  const payload = JSON.parse(fs.readFileSync(panelPath, 'utf-8'));
  const problems = dbStorage.validateState(payload);
  if (problems.length) {
    throw new Error(`Snapshot inválido: ${problems.join(' ')}`);
  }

  const databases = Array.isArray(payload.databases) ? payload.databases : [];
  console.log(`Snapshot: ${panelObj.key} (${databases.length} banco(s))`);
  for (const db of databases) {
    const dump = latestOf(objects, (key) => key.includes(`/db/${db.id}/`) && key.endsWith('.enc'));
    console.log(`  - ${db.name} (${db.type}) dump: ${dump ? dump.key : '(nenhum)'}`);
  }

  if (dryRun) {
    console.log('Dry-run: nenhum estado foi importado.');
    return;
  }

  dbStorage.importState(payload);
  console.log('Estado do painel importado.');

  for (const db of dbStorage.getDatabases()) {
    console.log(`Recriando ${db.name}...`);
    const containerId = await DatabaseService.recreateContainer(db);
    await DatabaseService.waitUntilReady(containerId, db);

    if (db.type === 'redis') continue;
    const dump = latestOf(objects, (key) => key.includes(`/db/${db.id}/`) && key.endsWith('.enc'));
    if (!dump) {
      console.log(`  sem dump offsite para ${db.name}`);
      continue;
    }
    const dumpPath = path.join(tmpDir, path.basename(OffsiteService.parseRemoteKey(dump.key).filename));
    await OffsiteService.downloadTo(dump.key, dumpPath, backend);
    const live = dbStorage.getDatabaseById(db.id);
    if (!live?.containerId) continue;
    await BackupService.restoreDumpInto(live, dumpPath, live.containerId);
    console.log(`  restore ${dump.key} OK`);
  }

  try {
    await CaddyService.syncCaddyfile();
    console.log('Caddyfile sincronizado.');
  } catch (err: any) {
    console.warn('Caddy sync falhou (o painel já está restaurado):', err.message);
  }
}

main().catch((err) => {
  console.error('DR restore falhou:', err.message || err);
  process.exit(1);
});
