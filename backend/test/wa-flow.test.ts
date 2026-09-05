import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { dbStorage } from '../src/db/storage.js';
import { WaFlowService } from '../src/services/wa-flow.service.js';
import { HandoffManager, WaFlowEngine } from '../src/services/wa-flow-engine.js';
import { evolutionOutboundBlocked, parseEvolutionUpsert } from '../src/utils/evolution.client.js';
import { WaSessionStore } from '../src/utils/wa-session.store.js';
import { waFlowRouter } from '../src/routes/wa-flow.routes.js';
import { phoneHash } from '../src/utils/phone.js';
import { WA_FLOW_TEMPLATES } from '../src/services/wa-flow-templates.js';
import { providedWaWebhookSecret } from '../src/utils/wa-webhook-auth.js';

function upsert(text: string, phone = '5511999999999', instance = 'clinic') {
  return {
    event: 'messages.upsert',
    instance,
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

test('parseEvolutionUpsert reads ephemeral, array and LID payloads', () => {
  const ephemeral = parseEvolutionUpsert({
    event: 'messages.upsert',
    instance: 'clinic',
    data: {
      key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
      pushName: 'Ana',
      message: { ephemeralMessage: { message: { conversation: 'Ajuda' } } },
    },
  });
  assert.equal(ephemeral?.text, 'Ajuda');
  assert.equal(ephemeral?.instance, 'clinic');

  const asArray = parseEvolutionUpsert({
    event: 'MESSAGES_UPSERT',
    instance: 'clinic',
    data: [
      {
        key: { remoteJid: '5511888888888@s.whatsapp.net', fromMe: false },
        message: { extendedTextMessage: { text: 'ajuda por favor' } },
      },
    ],
  });
  assert.equal(asArray?.text, 'ajuda por favor');
  assert.equal(asArray?.phone, '5511888888888');

  const lid = parseEvolutionUpsert({
    instance: 'clinic',
    data: {
      key: {
        remoteJid: '123456789012345@lid',
        remoteJidAlt: '5511777777777@s.whatsapp.net',
        fromMe: false,
      },
      message: { conversation: 'oi' },
    },
  });
  assert.equal(lid?.phone, '5511777777777');
});

test('webhook secret ignores Evolution apikey and prefers the Aegis header', () => {
  assert.equal(
    providedWaWebhookSecret({
      aegisHeader: '',
      queryToken: 'aegis-token',
    }),
    'aegis-token'
  );
  assert.equal(
    providedWaWebhookSecret({
      aegisHeader: 'from-header',
      queryToken: 'from-query',
    }),
    'from-header'
  );
});

test('engine matches keyword, interpolates name and advances after a menu reply', async () => {
  dbStorage.saveWaFlow({
    id: 'waflow-menu',
    name: 'Menu',
    published: true,
    instanceNames: ['clinic'],
    priority: 0,
    sessionTtlMinutes: 30,
    aiBudgetTokensPerDay: 50_000,
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

test('multi-instance routing routes to the correct instance binding', async () => {
  dbStorage.saveWaFlow({
    id: 'waflow-inst-a',
    name: 'Flow Loja A',
    published: true,
    instanceNames: ['instance-loja-a'],
    priority: 0,
    sessionTtlMinutes: 30,
    aiBudgetTokensPerDay: 50_000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes: [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { match: 'any' } },
      { id: 's1', type: 'send_text', position: { x: 0, y: 1 }, data: { text: 'Resposta Loja A' } },
      { id: 'e1', type: 'end', position: { x: 0, y: 2 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 't1', target: 's1' },
      { id: 'e2', source: 's1', target: 'e1' },
    ],
  });

  dbStorage.saveWaFlow({
    id: 'waflow-inst-b',
    name: 'Flow Loja B',
    published: true,
    instanceNames: ['instance-loja-b'],
    priority: 0,
    sessionTtlMinutes: 30,
    aiBudgetTokensPerDay: 50_000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes: [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { match: 'any' } },
      { id: 's1', type: 'send_text', position: { x: 0, y: 1 }, data: { text: 'Resposta Loja B' } },
      { id: 'e1', type: 'end', position: { x: 0, y: 2 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 't1', target: 's1' },
      { id: 'e2', source: 's1', target: 'e1' },
    ],
  });

  const mockA = mockSender();
  const handledA = await WaFlowEngine.handleInbound(upsert('oi', '5511111111111', 'instance-loja-a'), mockA.sender);
  assert.equal(handledA, true);
  assert.equal(mockA.sent[0]?.text, 'Resposta Loja A');

  const mockB = mockSender();
  const handledB = await WaFlowEngine.handleInbound(upsert('oi', '5511222222222', 'instance-loja-b'), mockB.sender);
  assert.equal(handledB, true);
  assert.equal(mockB.sent[0]?.text, 'Resposta Loja B');
});

test('condition splits yes and no', async () => {
  dbStorage.saveWaFlow({
    id: 'waflow-cond',
    name: 'Cond',
    published: true,
    instanceNames: ['clinic'],
    priority: 0,
    sessionTtlMinutes: 30,
    aiBudgetTokensPerDay: 50_000,
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

test('priority and specificity choose the best matching flow', async () => {
  dbStorage.saveWaFlow({
    id: 'waflow-generic',
    name: 'Generic Flow',
    published: true,
    instanceNames: ['shop'],
    priority: 0,
    sessionTtlMinutes: 30,
    aiBudgetTokensPerDay: 50_000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes: [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { match: 'any' } },
      { id: 's1', type: 'send_text', position: { x: 0, y: 1 }, data: { text: 'Resposta Genérica' } },
      { id: 'e1', type: 'end', position: { x: 0, y: 2 }, data: {} },
    ],
    edges: [{ id: 'e1', source: 't1', target: 's1' }, { id: 'e2', source: 's1', target: 'e1' }],
  });

  dbStorage.saveWaFlow({
    id: 'waflow-specific',
    name: 'Specific Flow',
    published: true,
    instanceNames: ['shop'],
    priority: 10, // Higher priority wins!
    sessionTtlMinutes: 30,
    aiBudgetTokensPerDay: 50_000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes: [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { match: 'contains', keyword: 'especial' } },
      { id: 's1', type: 'send_text', position: { x: 0, y: 1 }, data: { text: 'Resposta Especial Prioritária' } },
      { id: 'e1', type: 'end', position: { x: 0, y: 2 }, data: {} },
    ],
    edges: [{ id: 'e1', source: 't1', target: 's1' }, { id: 'e2', source: 's1', target: 'e1' }],
  });

  const m = mockSender();
  await WaFlowEngine.handleInbound(upsert('quero o especial', '5511333333333', 'shop'), m.sender);
  assert.equal(m.sent[0]?.text, 'Resposta Especial Prioritária');
});

test('human handoff silences the bot until released', async () => {
  const phone = '5511444444444';
  const instance = 'shop';
  const pHash = phoneHash(phone);

  HandoffManager.set(instance, pHash, 60);
  assert.equal(HandoffManager.isActive(instance, pHash), true);

  const m = mockSender();
  const handled = await WaFlowEngine.handleInbound(upsert('ola atendente', phone, instance), m.sender);
  // Absorbed silently by handoff
  assert.equal(handled, true);
  assert.equal(m.sent.length, 0);

  // Release handoff
  HandoffManager.release(instance, pHash);
  assert.equal(HandoffManager.isActive(instance, pHash), false);
});

test('simulate executes in memory without network calls', async () => {
  const res = await WaFlowEngine.simulate('waflow-menu', ['bomdia', '1']);
  assert.ok(res.turns.length >= 3);
  assert.equal(res.turns[0].text, 'bomdia');
  assert.match(res.turns[1].text, /Olá Visitante/);
  assert.equal(res.turns[2].text, '1');
  assert.equal(res.turns[3].text, 'Tabela enviada');
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
    instanceNames: ['clinic'],
    priority: 0,
    sessionTtlMinutes: 30,
    aiBudgetTokensPerDay: 50_000,
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

test('suporte-handoff template fires on Ajuda and sends the menu', async () => {
  const tmpl = WA_FLOW_TEMPLATES.find((t) => t.id === 'suporte-handoff');
  assert.ok(tmpl);
  dbStorage.saveWaFlow({
    id: 'waflow-ajuda-template',
    name: tmpl.name,
    published: true,
    instanceNames: ['clinic'],
    priority: 0,
    sessionTtlMinutes: 30,
    aiBudgetTokensPerDay: 50_000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes: tmpl.nodes,
    edges: tmpl.edges,
  });

  const first = mockSender();
  assert.equal(await WaFlowEngine.handleInbound(upsert('Ajuda'), first.sender), true);
  assert.equal(first.sent[0]?.kind, 'menu');
  assert.ok(first.sent[0]?.buttons?.includes('Horários'));
  assert.ok(first.sent[0]?.buttons?.includes('Falar com Humano'));
});

test('inbound replies from the receiving instance, not Settings leftover', async () => {
  dbStorage.updateSettings({
    alertConfig: {
      ...dbStorage.getSettings().alertConfig,
      whatsappApiUrl: 'http://127.0.0.1:4103',
      whatsappApiKey: 'test-key',
      whatsappInstance: 'ops-number',
    },
  });
  dbStorage.saveWaFlow({
    id: 'waflow-instance-send',
    name: 'Clinic',
    published: true,
    instanceNames: ['Clinic'],
    priority: 0,
    sessionTtlMinutes: 30,
    aiBudgetTokensPerDay: 50_000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes: [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { match: 'contains', keyword: 'ajuda' } },
      { id: 's1', type: 'send_text', position: { x: 0, y: 1 }, data: { text: 'menu real' } },
    ],
    edges: [{ id: 'e1', source: 't1', target: 's1' }],
  });

  const sent: string[] = [];
  const handled = await WaFlowEngine.handleInbound(upsert('Ajuda', '5511666666666', 'clinic'), {
    sendText: async (creds, _n, text) => {
      sent.push(`${creds.instance}:${text}`);
    },
    sendButtons: async () => {},
  });
  assert.equal(handled, true);
  assert.equal(sent[0], 'clinic:menu real');
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

test('webhook accepts ?token= even when Evolution sends its own apikey header', async () => {
  const token = WaFlowService.webhookSecret();
  const app = express();
  app.use(express.json());
  app.use('/api/wa-flows', waFlowRouter);

  const res = await new Promise<{ status: number; body: any }>((resolve) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as { port: number }).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/wa-flows/webhook?token=${token}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: 'evolution-global-key-NOT-ours',
        },
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
