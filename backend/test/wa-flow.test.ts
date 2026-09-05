import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { dbStorage } from '../src/db/storage.js';
import { WaFlowService } from '../src/services/wa-flow.service.js';
import { WaFlowEngine } from '../src/services/wa-flow-engine.js';
import { evolutionOutboundBlocked, parseEvolutionUpsert } from '../src/utils/evolution.client.js';
import { WaSessionStore } from '../src/utils/wa-session.store.js';
import { waFlowRouter } from '../src/routes/wa-flow.routes.js';

function upsert(text: string, phone = '5511999999999') {
  return {
    event: 'messages.upsert',
    instance: 'clinic',
    data: {
      key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false },
      pushName: 'Ana',
      message: { conversation: text },
    },
  };
}

function mockSender() {
  const sent: Array<{ kind: string; text: string; buttons?: string[] }> = [];
  return {
    sent,
    sender: {
      sendText: async (_c: unknown, _n: string, text: string) => {
        sent.push({ kind: 'text', text });
      },
      sendButtons: async (_c: unknown, _n: string, text: string, buttons: Array<{ label: string }>) => {
        sent.push({ kind: 'menu', text, buttons: buttons.map((b) => b.label) });
      },
    },
  };
}

test('parseEvolutionUpsert ignores groups and empty bodies', () => {
  assert.equal(parseEvolutionUpsert({ data: { key: { remoteJid: 'x@g.us' }, message: { conversation: 'oi' } } }), null);
  assert.ok(parseEvolutionUpsert(upsert('oi'))?.phone === '5511999999999');
});

test('engine matches keyword, interpolates name and advances after a menu reply', async () => {
  dbStorage.saveWaFlow({
    id: 'waflow-menu',
    name: 'Menu',
    published: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes: [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { match: 'contains', keyword: 'bomdia' } },
      { id: 'm1', type: 'menu', position: { x: 0, y: 1 }, data: { text: 'Olá {{nome}}', buttons: [{ id: 'a', label: 'Preços' }, { id: 'b', label: 'Horário' }] } },
      { id: 's1', type: 'send_text', position: { x: 0, y: 2 }, data: { text: 'Tabela enviada' } },
      { id: 'e1', type: 'end', position: { x: 0, y: 3 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'm1' },
      { id: 'e2', source: 'm1', target: 's1', sourceHandle: 'a' },
      { id: 'e3', source: 's1', target: 'e1' },
    ],
  });

  const first = mockSender();
  assert.equal(await WaFlowEngine.handleInbound(upsert('bomdia, tudo bem?'), first.sender), true);
  assert.equal(first.sent[0]?.kind, 'menu');
  assert.match(first.sent[0]?.text || '', /Olá Ana/);

  const second = mockSender();
  assert.equal(await WaFlowEngine.handleInbound(upsert('1'), second.sender), true);
  assert.equal(second.sent[0]?.text, 'Tabela enviada');
  assert.equal(WaSessionStore.read('clinic', '5511999999999'), null);
});

test('condition splits yes and no', async () => {
  dbStorage.saveWaFlow({
    id: 'waflow-cond',
    name: 'Cond',
    published: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes: [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { match: 'contains', keyword: 'confirmar' } },
      { id: 'c1', type: 'condition', position: { x: 0, y: 1 }, data: { operator: 'contains', value: 'sim' } },
      { id: 'yes', type: 'send_text', position: { x: 0, y: 2 }, data: { text: 'positivo' } },
      { id: 'no', type: 'send_text', position: { x: 0, y: 3 }, data: { text: 'negativo' } },
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'c1' },
      { id: 'e2', source: 'c1', target: 'yes', sourceHandle: 'yes' },
      { id: 'e3', source: 'c1', target: 'no', sourceHandle: 'no' },
    ],
  });

  const yes = mockSender();
  await WaFlowEngine.handleInbound(upsert('confirmar sim'), yes.sender);
  assert.equal(yes.sent[0]?.text, 'positivo');

  const no = mockSender();
  await WaFlowEngine.handleInbound(upsert('confirmar nao'), no.sender);
  assert.equal(no.sent[0]?.text, 'negativo');
});

test('panel event trigger sends to the settings recipient', async () => {
  dbStorage.updateSettings({
    alertConfig: {
      ...dbStorage.getSettings().alertConfig,
      whatsappApiUrl: 'http://127.0.0.1:4103',
      whatsappApiKey: 'test-key',
      whatsappInstance: 'clinic',
      whatsappRecipientNumber: '5511888888888',
    },
  });
  dbStorage.saveWaFlow({
    id: 'waflow-event',
    name: 'Deploy',
    published: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes: [
      { id: 't1', type: 'trigger_event', position: { x: 0, y: 0 }, data: { event: 'deploy_fail' } },
      { id: 's1', type: 'send_text', position: { x: 0, y: 1 }, data: { text: 'Falhou {{app}}' } },
    ],
    edges: [{ id: 'e1', source: 't1', target: 's1' }],
  });

  const mock = mockSender();
  const ran = await WaFlowEngine.handlePanelEvent('deploy_fail', { app: 'bomdebolao' }, mock.sender);
  assert.equal(ran, 1);
  assert.equal(mock.sent[0]?.text, 'Falhou bomdebolao');
  assert.equal(WaFlowEngine.mapBroadcast('deploy', true), 'deploy_fail');
});

test('LOCAL_MODE blocks Evolution calls', () => {
  assert.equal(evolutionOutboundBlocked(), true);
});

test('webhook refuses a missing secret', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/wa-flows', waFlowRouter);

  const res = await new Promise<{ status: number; body: any }>((resolve) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as { port: number }).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/wa-flows/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(upsert('oi')),
      });
      const body = await response.json();
      server.close();
      resolve({ status: response.status, body });
    });
  });

  assert.equal(res.status, 401);
  assert.match(res.body.error, /segredo/i);
});

test('webhook accepts the configured token', async () => {
  const token = WaFlowService.webhookSecret();
  const app = express();
  app.use(express.json());
  app.use('/api/wa-flows', waFlowRouter);

  const res = await new Promise<{ status: number; body: any }>((resolve) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as { port: number }).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/wa-flows/webhook?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(upsert('oi')),
      });
      const body = await response.json();
      server.close();
      resolve({ status: response.status, body });
    });
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});
