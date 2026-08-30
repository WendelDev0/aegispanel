import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { GeoIpService } from '../src/services/geoip.service.js';

test('private and reserved addresses are never sent to the geo provider', () => {
  for (const ip of [
    '127.0.0.1',
    '::1',
    '10.0.0.5',
    '192.168.1.20',
    '172.17.0.1',
    '172.31.255.254',
    '169.254.10.1',
    'fd00::1',
    '',
  ]) {
    assert.equal(GeoIpService.isPrivate(ip), true, `deveria ser privado: ${ip}`);
  }
});

test('public addresses are eligible for lookup', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '45.176.122.27', '172.15.0.1', '172.32.0.1']) {
    assert.equal(GeoIpService.isPrivate(ip), false, `deveria ser público: ${ip}`);
  }
});

test('lookup does not resolve private addresses', () => {
  assert.equal(GeoIpService.lookup('192.168.0.10'), null);
});
