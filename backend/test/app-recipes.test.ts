import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRecipe, type RecipeProjectType } from '../src/utils/app-recipes.js';

const cases: Array<{ type: RecipeProjectType; runtime: Parameters<typeof generateRecipe>[0]['runtime']; version: string; pm: Parameters<typeof generateRecipe>[0]['packageManager'] }> = [
  { type: 'python-django', runtime: 'python', version: '3.12', pm: 'poetry' },
  { type: 'python-fastapi', runtime: 'python', version: '3.12', pm: 'uv' },
  { type: 'python-flask', runtime: 'python', version: '3.11', pm: 'pip' },
  { type: 'nextjs', runtime: 'node', version: '22', pm: 'pnpm' },
  { type: 'go', runtime: 'go', version: '1.23', pm: 'go' },
  { type: 'rust', runtime: 'rust', version: 'stable', pm: 'cargo' },
  { type: 'php-laravel', runtime: 'php', version: '8.3', pm: 'composer' },
  { type: 'java-spring', runtime: 'java', version: '21', pm: 'maven' },
  { type: 'ruby-rails', runtime: 'ruby', version: '3.3', pm: 'bundler' },
  { type: 'bun', runtime: 'bun', version: '1', pm: 'bun' },
  { type: 'deno', runtime: 'deno', version: '2', pm: 'deno' },
];

for (const item of cases) {
  test(`recipe ${item.type} is non-root and has a healthcheck`, () => {
    const recipe = generateRecipe({
      type: item.type,
      runtime: item.runtime,
      version: item.version,
      packageManager: item.pm,
      internalPort: 8000,
    });
    assert.match(recipe.dockerfile, /USER /);
    assert.match(recipe.dockerfile, /HEALTHCHECK/);
    assert.match(recipe.dockerfile, /EXPOSE 8000|EXPOSE 80/);
    assert.ok(!recipe.dockerfile.includes('python:3.11-slim') || item.version === '3.11');
  });
}

test('uv django uses uv sync, not pip install -r only', () => {
  const recipe = generateRecipe({
    type: 'python-django',
    runtime: 'python',
    version: '3.12',
    packageManager: 'uv',
    internalPort: 8000,
  });
  assert.match(recipe.dockerfile, /uv sync|uv pip/);
  assert.match(recipe.dockerfile, /python:3\.12-slim/);
  assert.match(recipe.dockerfile, /USER app/);
});
