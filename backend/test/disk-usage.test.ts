import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  directorySizeBytes,
  measureBuildDirs,
  planArtifactEviction,
  planImagePrune,
  type BuildDirUsage,
} from '../src/utils/disk-usage.js';

const MB = 1024 * 1024;

function buildDir(
  appId: string,
  sizeMb: number,
  lastUsedMs: number,
  artifacts: Array<[string, number]>
): BuildDirUsage {
  return {
    appId,
    path: `/data/builds/${appId}`,
    sizeBytes: sizeMb * MB,
    lastUsedMs,
    artifacts: artifacts.map(([name, mb]) => ({
      path: `/data/builds/${appId}/${name}`,
      sizeBytes: mb * MB,
    })),
  };
}

test('nothing is deleted while the tree fits the cap', () => {
  const plan = planArtifactEviction([buildDir('a', 100, 1, [['node_modules', 80]])], 5000 * MB);
  assert.deepEqual(plan.remove, []);
  assert.equal(plan.freedBytes, 0);
  assert.equal(plan.stillOverCap, false);
});

/**
 * Evicting the most recent build first would guarantee that the next deploy is
 * always the slow one — the copy about to be reused is the copy we destroyed.
 */
test('the least recently built app is evicted first', () => {
  const plan = planArtifactEviction(
    [
      buildDir('recent', 600, 9_000, [['node_modules', 500]]),
      buildDir('old', 600, 1_000, [['node_modules', 500]]),
    ],
    800 * MB
  );

  assert.deepEqual(plan.remove, ['/data/builds/old/node_modules']);
  assert.equal(plan.projectedBytes, 700 * MB);
});

/**
 * The cleanup runs right after a deploy, from inside that deploy's own
 * pipeline: deleting its node_modules would pull the tree out from under the
 * build that just triggered the cleanup.
 */
test('the app currently deploying is never evicted', () => {
  const plan = planArtifactEviction(
    [
      buildDir('deploying', 900, 1, [['node_modules', 800]]),
      buildDir('other', 300, 9_000, [['node_modules', 200]]),
    ],
    500 * MB,
    'deploying'
  );

  assert.deepEqual(plan.remove, ['/data/builds/other/node_modules']);
  assert.ok(!plan.remove.some((p) => p.includes('deploying')));
});

test('the largest artifact inside an app goes first', () => {
  const plan = planArtifactEviction(
    [buildDir('a', 1000, 1, [['dist', 50], ['node_modules', 700], ['.next', 200]])],
    500 * MB
  );

  assert.equal(plan.remove[0], '/data/builds/a/node_modules');
});

test('eviction stops as soon as the tree fits', () => {
  const plan = planArtifactEviction(
    [
      buildDir('a', 500, 1, [['node_modules', 400]]),
      buildDir('b', 500, 2, [['node_modules', 400]]),
    ],
    700 * MB
  );

  assert.equal(plan.remove.length, 1, 'não apaga mais do que o necessário');
  assert.equal(plan.stillOverCap, false);
});

/**
 * Reported rather than hidden: if the working copies alone exceed the cap,
 * deleting every reclaimable directory is not enough and the operator has to
 * raise the cap or remove apps.
 */
test('an impossible cap is reported instead of silently passing', () => {
  const plan = planArtifactEviction([buildDir('a', 900, 1, [['node_modules', 100]])], 100 * MB);
  assert.equal(plan.stillOverCap, true);
  assert.ok(plan.projectedBytes > 100 * MB);
});

test('an app with no reclaimable directory is skipped without error', () => {
  const plan = planArtifactEviction(
    [buildDir('empty', 900, 1, []), buildDir('full', 900, 2, [['node_modules', 800]])],
    1000 * MB
  );
  assert.deepEqual(plan.remove, ['/data/builds/full/node_modules']);
});

/**
 * Rollback restarts the image tagged with a deployment id, so an image whose
 * deployment record is gone is unreachable — but the newest three per app stay
 * regardless, because those are what the rollback UI offers.
 */
test('orphan images are pruned but the newest three per app are kept', () => {
  const tags = [
    { tag: 'aegis-app-web:d5', appTag: 'aegis-app-web', deploymentId: 'd5', createdMs: 500 },
    { tag: 'aegis-app-web:d4', appTag: 'aegis-app-web', deploymentId: 'd4', createdMs: 400 },
    { tag: 'aegis-app-web:d3', appTag: 'aegis-app-web', deploymentId: 'd3', createdMs: 300 },
    { tag: 'aegis-app-web:d2', appTag: 'aegis-app-web', deploymentId: 'd2', createdMs: 200 },
    { tag: 'aegis-app-web:d1', appTag: 'aegis-app-web', deploymentId: 'd1', createdMs: 100 },
  ];

  const remove = planImagePrune(tags, new Set());
  assert.deepEqual(remove.sort(), ['aegis-app-web:d1', 'aegis-app-web:d2']);
});

test('an image a deployment record still points at is never pruned', () => {
  const tags = [
    { tag: 'aegis-app-web:d4', appTag: 'aegis-app-web', deploymentId: 'd4', createdMs: 400 },
    { tag: 'aegis-app-web:d3', appTag: 'aegis-app-web', deploymentId: 'd3', createdMs: 300 },
    { tag: 'aegis-app-web:d2', appTag: 'aegis-app-web', deploymentId: 'd2', createdMs: 200 },
    { tag: 'aegis-app-web:d1', appTag: 'aegis-app-web', deploymentId: 'd1', createdMs: 100 },
  ];

  assert.deepEqual(planImagePrune(tags, new Set(['d1'])), []);
});

test('each app keeps its own three newest', () => {
  const tags = [
    { tag: 'aegis-app-a:d4', appTag: 'aegis-app-a', deploymentId: 'd4', createdMs: 400 },
    { tag: 'aegis-app-a:d1', appTag: 'aegis-app-a', deploymentId: 'd1', createdMs: 100 },
    { tag: 'aegis-app-b:d3', appTag: 'aegis-app-b', deploymentId: 'd3', createdMs: 300 },
    { tag: 'aegis-app-b:d2', appTag: 'aegis-app-b', deploymentId: 'd2', createdMs: 200 },
  ];

  assert.deepEqual(planImagePrune(tags, new Set()), [], 'nenhum app passou de 3 tags');
});

test('directory size counts nested files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-size-'));
  fs.mkdirSync(path.join(root, 'nested', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(root, 'a.txt'), 'x'.repeat(1000));
  fs.writeFileSync(path.join(root, 'nested', 'b.txt'), 'y'.repeat(2000));
  fs.writeFileSync(path.join(root, 'nested', 'deep', 'c.txt'), 'z'.repeat(3000));

  assert.equal(directorySizeBytes(root), 6000);
});

test('a missing directory measures zero rather than throwing', () => {
  assert.equal(directorySizeBytes(path.join(os.tmpdir(), 'aegis-does-not-exist-xyz')), 0);
});

test('build directories are measured with their reclaimable artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-builds-'));
  const app = path.join(root, 'app-1');
  fs.mkdirSync(path.join(app, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(app, 'src'), { recursive: true });
  fs.writeFileSync(path.join(app, 'node_modules', 'big.js'), 'a'.repeat(5000));
  fs.writeFileSync(path.join(app, 'src', 'index.js'), 'b'.repeat(100));

  const usage = measureBuildDirs(root);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].appId, 'app-1');
  assert.equal(usage[0].sizeBytes, 5100);
  assert.equal(usage[0].artifacts.length, 1, 'src não é reclamável');
  assert.equal(usage[0].artifacts[0].sizeBytes, 5000);
});
