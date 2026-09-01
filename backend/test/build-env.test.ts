import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { injectPublicBuildArgs, publicBuildArgs } from '../src/utils/build-env.js';

test('somente variáveis explicitamente públicas entram no build Docker', () => {
  const env = {
    VITE_API_URL: 'https://api.example.com',
    NEXT_PUBLIC_ANALYTICS: 'enabled',
    DATABASE_URL: 'postgres://user:secret@example.com/db',
    JWT_SECRET: 'secret-not-for-build',
  };

  const args = publicBuildArgs(env);
  assert.deepEqual(args, [
    '--build-arg',
    'VITE_API_URL=https://api.example.com',
    '--build-arg',
    'NEXT_PUBLIC_ANALYTICS=enabled',
  ]);
  assert.equal(args.some((arg) => arg.includes('secret')), false);
});

test('Dockerfile gerado recebe apenas ARG/ENV públicos', () => {
  const dockerfile = injectPublicBuildArgs('FROM node:20-alpine\nRUN npm run build\n', {
    VITE_API_URL: 'https://api.example.com',
    API_SECRET: 'do-not-copy',
  });

  assert.match(dockerfile, /ARG VITE_API_URL/);
  assert.match(dockerfile, /ENV VITE_API_URL=\$VITE_API_URL/);
  assert.doesNotMatch(dockerfile, /API_SECRET/);
});
