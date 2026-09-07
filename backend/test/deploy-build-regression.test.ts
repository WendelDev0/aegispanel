import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectDetector } from '../src/services/project-detector.service.js';
import { mergeResolvedConfig, recipeFromResolved } from '../src/utils/app-deploy-build.js';

test('saved detection does not override new repository configuration on redeploy', () => {
  const first = mergeResolvedConfig(undefined, undefined, { runtime: 'node', version: '20', source: 'detected' });
  const next = mergeResolvedConfig(first.resolved, { build: { runtime: 'node', version: '22' } }, { runtime: 'node', version: '20' });
  assert.equal(next.resolved.version, '22');
  assert.equal(next.resolved.sourceByField.version, 'toml');
});

test('a detected Express app without a build script skips the build command', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-express-regression-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { start: 'node index.js' }, dependencies: { express: '*' } }));
  const detection = ProjectDetector.inspect(dir);
  const { resolved } = mergeResolvedConfig(undefined, undefined, detection.proposedBuildConfig);
  const recipe = recipeFromResolved(detection.type, resolved, detection.recommendedInternalPort);
  assert.equal(resolved.buildCommand, '');
  assert.doesNotMatch(recipe.dockerfile, /^RUN npm run build$/m);
});

test('detected Node projects produce Docker RUN instructions through the deploy pipeline', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-recipe-regression-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' }, dependencies: { vite: '*' } }));
  fs.writeFileSync(path.join(dir, 'vite.config.js'), 'export default {};');
  const detection = ProjectDetector.inspect(dir);
  const { resolved } = mergeResolvedConfig(undefined, undefined, detection.proposedBuildConfig);
  const recipe = recipeFromResolved(detection.type, resolved, detection.recommendedInternalPort);
  assert.match(recipe.dockerfile, /^RUN .*npm install/m);
  assert.doesNotMatch(recipe.dockerfile, /^(npm|pnpm|yarn) install/m);
});
