import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getPublicBaseUrl } from '../src/utils/public-url.js';

test('usa o domínio salvo pelo administrador em vez do Host da requisição', () => {
  assert.equal(getPublicBaseUrl({ panelDomain: 'panel.example.com' }), 'http://panel.example.com');
});

test('recusa domínio salvo que não seja hostname válido', () => {
  assert.equal(getPublicBaseUrl({ panelDomain: 'https://[::1]' }), 'http://localhost:4000');
});
