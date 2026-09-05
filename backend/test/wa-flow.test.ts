import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { dbStorage } from '../src/db/storage.js';
import { WaFlowService } from '../src/services/wa-flow.service.js';
import { HandoffManager, WaFlowEngine } from '../src/services/wa-flow-engine.js';
import { classifyEvolutionInbound, evolutionOutboundBlocked, parseEvolutionUpsert } from '../src/utils/evolution.client.js';
import { localDayStamp } from '../src/utils/day-stamp.js';
import {
  internalPanelBaseUrl,
  preferInternalUrl,
  suggestInternalEvolutionUrl,
} from '../src/utils/wa-internal-route.js';
import { WaSessionStore } from '../src/utils/wa-session.store.js';
import { waFlowRouter } from '../src/routes/wa-flow.routes.js';
import { phoneHash } from '../src/utils/phone.js';
import { WA_FLOW_TEMPLATES } from '../src/services/wa-flow-templates.js';
import { providedWaWebhookSecret } from '../src/utils/wa-webhook-auth.js';
import { assessBoundInstances } from '../src/utils/wa-publish-ready.js';
import { evolutionSendFailed, evolutionManagerUrl } from '../src/utils/evolution.client.js';
import { WaInboundStore } from '../src/utils/wa-inbound.store.js';
import { isDuplicateMessage, resetDedupe } from '../src/utils/wa-dedupe.js';
import { runSerial, pendingSerialKeys } from '../src/utils/serial-queue.js';

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

test('publish readiness refuses a disconnected instance', () => {
  const closed = assessBoundInstances(
    ['loja'],
    [{ name: 'loja', connectionStatus: 'close', number: '5511999990000' }]
  );
  assert.equal(closed.ok, false);
  assert.match(closed.error || '', /desconectada/i);

  const missing = assessBoundInstances(['clinica'], [{ name: 'loja', connectionStatus: 'open' }]);
  assert.equal(missing.ok, false);
  assert.match(missing.error || '', /não existe/i);

  const rival = assessBoundInstances(
    ['loja'],
    [{ name: 'loja', connectionStatus: 'open', competitors: ['Typebot'] }]
  );
  assert.equal(rival.ok, true);
  assert.match(rival.warnings.join(' '), /Typebot/);
});

test('evolutionSendFailed ignores mocks and LOCAL_MODE skips', () => {
  assert.equal(evolutionSendFailed(undefined), null);
  assert.equal(evolutionSendFailed({ ok: true }), null);
  assert.equal(evolutionSendFailed({ ok: false, skipped: 'local_mode' }), null);
  assert.match(evolutionSendFailed({ ok: false, error: 'HTTP 400' }) || '', /HTTP 400/);
  assert.match(evolutionManagerUrl('https://evo.selvamarketing.com'), /\/manager$/);
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

test('failed Evolution send is recorded and does not look like a handled reply', async () => {
  dbStorage.saveWaFlow({
    id: 'waflow-send-fail',
    name: 'Falha de envio',
    published: true,
    instanceNames: ['clinic'],
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

  const handled = await WaFlowEngine.handleInbound(upsert('Ajuda', '5511555555555', 'clinic'), {
    sendText: async () => ({ ok: false, error: 'HTTP 400 botões recusados' }),
    sendButtons: async () => ({ ok: false, error: 'HTTP 400 botões recusados' }),
  });
  assert.equal(handled, true);
  const last = WaInboundStore.list(5).find((e) => e.phoneTail === '5555' || e.textExcerpt === 'Ajuda');
  assert.ok(last);
  assert.equal(last?.outcome, 'send_failed');
  assert.match(last?.error || '', /400/);
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

// --- Etapa 1: contadores diários no fuso do painel ---

test('localDayStamp follows the panel timezone, not UTC', () => {
  // 2026-09-06T01:30:00Z is still 05/09 in São Paulo (UTC-3). The counters
  // used toISOString() and rolled "hoje" over at 21:00 local.
  const lateNightUtc = new Date('2026-09-06T01:30:00Z');
  assert.equal(lateNightUtc.toISOString().slice(0, 10), '2026-09-06');
  assert.equal(localDayStamp(lateNightUtc), '2026-09-05');
});

// --- Etapa 2: ruído de grupo separado de falha real ---

test('classifyEvolutionInbound separates group noise from unreadable payloads', () => {
  const group = classifyEvolutionInbound({
    instance: 'clinic',
    data: { key: { remoteJid: '120363083506002733@g.us', participant: '5511999999999@s.whatsapp.net' }, message: { conversation: 'oi' } },
  });
  assert.deepEqual(group, { kind: 'skipped', reason: 'group', instance: 'clinic' });

  const own = classifyEvolutionInbound({
    instance: 'clinic',
    data: { key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: true }, message: { conversation: 'oi' } },
  });
  assert.equal(own.kind === 'skipped' && own.reason, 'from_me');

  const status = classifyEvolutionInbound({
    instance: 'clinic',
    data: { key: { remoteJid: 'status@broadcast' }, message: { conversation: 'oi' } },
  });
  assert.equal(status.kind === 'skipped' && status.reason, 'broadcast');

  // A sticker in a real 1:1 chat is signal: someone wrote and got nothing.
  const sticker = classifyEvolutionInbound({
    instance: 'clinic',
    data: { key: { remoteJid: '5511999999999@s.whatsapp.net' }, message: { stickerMessage: { url: 'x' } } },
  });
  assert.equal(sticker.kind === 'skipped' && sticker.reason, 'no_text');
  assert.equal(sticker.kind === 'skipped' && sticker.phone, '5511999999999');

  const real = classifyEvolutionInbound(upsert('oi'));
  assert.equal(real.kind, 'message');
});

test('group traffic is counted, never listed on the inbound strip', async () => {
  WaInboundStore.resetSkipped();
  const before = WaInboundStore.list(80).length;

  for (let i = 0; i < 5; i += 1) {
    const handled = await WaFlowEngine.handleInbound({
      instance: 'clinic',
      data: { key: { remoteJid: '120363083506002733@g.us' }, message: { conversation: `msg ${i}` } },
    });
    assert.equal(handled, false);
  }

  assert.equal(WaInboundStore.list(80).length, before, 'grupo não pode entrar no ring de eventos');
  assert.equal(WaInboundStore.skipSummary().group, 5);
  assert.equal(WaInboundStore.skipSummary().total, 5);
});

test('repeated config failures collapse instead of burying the ring', () => {
  for (let i = 0; i < 4; i += 1) {
    WaInboundStore.record({ outcome: 'rejected_secret', instance: 'clinic', error: 'segredo inválido' });
  }
  const head = WaInboundStore.list(80)[0];
  assert.equal(head.outcome, 'rejected_secret');
  assert.equal(head.repeated, 4);

  // Two messages from the same person are two facts; they must not collapse.
  WaInboundStore.record({ outcome: 'handled', instance: 'clinic', phoneTail: '9999', textExcerpt: 'oi' });
  WaInboundStore.record({ outcome: 'handled', instance: 'clinic', phoneTail: '9999', textExcerpt: 'tudo bem?' });
  const events = WaInboundStore.list(80);
  assert.equal(events[0].outcome, 'handled');
  assert.equal(events[0].repeated, undefined);
  assert.equal(events[1].outcome, 'handled');
});

// --- Etapa 3: rota interna Evolution <-> painel ---

function appRecord(name: string, domain: string, extra: Record<string, unknown> = {}) {
  return {
    id: `app-${name}`,
    name,
    sourceType: 'image' as const,
    port: 4103,
    internalPort: 8080,
    env: {},
    domain,
    createdAt: new Date().toISOString(),
    ...extra,
  } as any;
}

test('suggestInternalEvolutionUrl maps the public domain to the Caddy upstream', () => {
  const apps = [appRecord('outra', 'site.exemplo.com'), appRecord('evolution-api-v2-app', 'evo.exemplo.com')];

  const found = suggestInternalEvolutionUrl('https://evo.exemplo.com', apps, []);
  assert.equal(found?.url, 'http://aegis-app-evolution-api-v2-app:8080');
  assert.equal(found?.appName, 'evolution-api-v2-app');

  // A blue/green swap moves the upstream; the suggestion must follow it.
  const swapped = suggestInternalEvolutionUrl(
    'https://evo.exemplo.com',
    [appRecord('evolution-api-v2-app', 'evo.exemplo.com', { activeContainerName: 'aegis-app-evolution-api-v2-app--abc' })],
    []
  );
  assert.equal(swapped?.url, 'http://aegis-app-evolution-api-v2-app--abc:8080');

  // Evolution hosted elsewhere has no internal address at all.
  assert.equal(suggestInternalEvolutionUrl('https://evo.terceiro.com', apps, []), null);
});

test('suggestInternalEvolutionUrl refuses a remote node: it is not on this network', () => {
  const apps = [appRecord('evolution-api-v2-app', 'evo.exemplo.com', { nodeId: 'node-remoto' })];
  const nodes = [{ id: 'node-remoto', isLocal: false, sshHost: '10.0.0.9' }] as any;
  assert.equal(suggestInternalEvolutionUrl('https://evo.exemplo.com', apps, nodes), null);
});

test('preferInternalUrl falls back to public unless a bridge URL is enabled', () => {
  const pub = 'https://evo.exemplo.com';
  const internal = 'http://aegis-app-evo:8080';

  assert.equal(preferInternalUrl(pub, internal, false), pub, 'desligado usa o público');
  assert.equal(preferInternalUrl(pub, undefined, true), pub, 'sem valor usa o público');
  assert.equal(preferInternalUrl(pub, internal, true), internal);
  assert.equal(preferInternalUrl(pub, 'http://aegis-app-evo:8080/', true), internal, 'sem barra final');

  // An https value here would reintroduce exactly the hop this removes.
  assert.equal(preferInternalUrl(pub, 'https://evo.exemplo.com', true), pub);
  assert.equal(preferInternalUrl(pub, 'nao-e-url', true), pub);
});

test('internalPanelBaseUrl builds the address neighbours use', () => {
  assert.equal(internalPanelBaseUrl('aegis-backend', 4000), 'http://aegis-backend:4000');
});

test('webhookUrl prefers the verified internal route over the public domain', () => {
  const before = dbStorage.getSettings();
  dbStorage.updateSettings({ panelDomain: 'painel.exemplo.com' });

  dbStorage.updateSettings({ waFlowInternalRoute: { enabled: false } });
  assert.match(WaFlowService.webhookBaseUrl(), /painel\.exemplo\.com$/);

  dbStorage.updateSettings({
    waFlowInternalRoute: { enabled: true, panelBaseUrl: 'http://aegis-backend:4000', verifiedAt: new Date().toISOString() },
  });
  assert.equal(WaFlowService.webhookBaseUrl(), 'http://aegis-backend:4000');
  assert.match(WaFlowService.webhookUrl(), /^http:\/\/aegis-backend:4000\/api\/wa-flows\/webhook\?token=/);

  dbStorage.updateSettings({ waFlowInternalRoute: before.waFlowInternalRoute, panelDomain: before.panelDomain });
});

test('the manager link stays public even when the internal route is on', () => {
  const before = dbStorage.getSettings();
  dbStorage.updateSettings({
    evolution: { apiUrl: 'https://evo.exemplo.com', apiKey: 'k', internalApiUrl: 'http://aegis-app-evo:8080' },
    waFlowInternalRoute: { enabled: true, panelBaseUrl: 'http://aegis-backend:4000' },
  });

  // Server-side calls take the bridge...
  assert.equal(WaFlowService.evolutionCreds()?.apiUrl, 'http://aegis-app-evo:8080');
  // ...but the link the operator clicks must resolve in a browser.
  assert.equal(WaFlowService.publicEvolutionApiUrl(), 'https://evo.exemplo.com');

  dbStorage.updateSettings({ evolution: before.evolution, waFlowInternalRoute: before.waFlowInternalRoute });
});

// --- Etapa 4: ACK imediato + dedupe de reentrega ---

test('runSerial keeps one conversation in order and lets others run in parallel', async () => {
  const order: string[] = [];
  const slow = (tag: string, ms: number) => async () => {
    order.push(`${tag}:start`);
    await new Promise((r) => setTimeout(r, ms));
    order.push(`${tag}:end`);
    return tag;
  };

  // Same key: the second task must not start before the first finishes, even
  // though it is queued while the first is still awaiting.
  const a1 = runSerial('ana', slow('a1', 30));
  const a2 = runSerial('ana', slow('a2', 1));
  // Different key: no reason to wait behind Ana.
  const b1 = runSerial('bruno', slow('b1', 1));

  await Promise.all([a1, a2, b1]);

  assert.deepEqual(
    order.filter((o) => o.startsWith('a')),
    ['a1:start', 'a1:end', 'a2:start', 'a2:end']
  );
  assert.ok(order.indexOf('b1:end') < order.indexOf('a1:end'), 'bruno não espera a fila da ana');
});

test('runSerial survives a task that throws', async () => {
  const done: string[] = [];
  const boom = runSerial('zeca', async () => {
    throw new Error('falhou');
  });
  await assert.rejects(boom, /falhou/);

  // A failed turn must not wedge the queue for that contact.
  await runSerial('zeca', async () => {
    done.push('depois');
  });
  assert.deepEqual(done, ['depois']);

  // A limpeza do mapa é encadeada depois da tarefa, então roda um tick após
  // o await de quem chamou. Sem isso o mapa cresceria uma entrada por contato.
  await new Promise((r) => setImmediate(r));
  assert.equal(pendingSerialKeys(), 0, 'a fila se limpa quando esvazia');
});

test('isDuplicateMessage recognises a retried delivery, per instance', () => {
  resetDedupe();
  assert.equal(isDuplicateMessage('clinic', 'WAMSG1'), false, 'primeira entrega');
  assert.equal(isDuplicateMessage('clinic', 'WAMSG1'), true, 'reentrega');

  // The same id on another line is a different conversation.
  assert.equal(isDuplicateMessage('loja', 'WAMSG1'), false);

  // No id: never dropped. Descartar mensagem real é bot mudo, pior que
  // responder duas vezes.
  assert.equal(isDuplicateMessage('clinic', undefined), false);
  assert.equal(isDuplicateMessage('clinic', undefined), false);
  assert.equal(isDuplicateMessage('clinic', '   '), false);
});

test('a retried webhook does not replay the flow', async () => {
  resetDedupe();
  WaInboundStore.resetSkipped();
  WaSessionStore.clear('clinic', '5511999999999');

  dbStorage.saveWaFlow({
    id: 'waflow-retry',
    name: 'Retry',
    published: true,
    instanceNames: ['clinic'],
    priority: 50,
    sessionTtlMinutes: 30,
    aiBudgetTokensPerDay: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes: [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { match: 'contains', keyword: 'orcamento' } },
      { id: 's1', type: 'send_text', position: { x: 0, y: 1 }, data: { text: 'Orçamento a caminho' } },
      { id: 'e1', type: 'end', position: { x: 0, y: 2 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 't1', target: 's1' },
      { id: 'e2', source: 's1', target: 'e1' },
    ],
  });

  const payload = upsert('orcamento');
  (payload.data.key as any).id = 'WAMSG-RETRY-1';

  const first = mockSender();
  assert.equal(await WaFlowEngine.handleInbound(payload, first.sender), true);
  assert.equal(first.sent.length, 1);

  // Evolution reenvia o mesmo key.id: precisa ser aceito (true) sem reenviar.
  const retry = mockSender();
  assert.equal(await WaFlowEngine.handleInbound(payload, retry.sender), true);
  assert.equal(retry.sent.length, 0, 'reentrega não pode disparar envio de novo');
  assert.equal(WaInboundStore.skipSummary().duplicate, 1);

  dbStorage.removeWaFlow('waflow-retry');
});

test('webhook answers before the flow runs so Evolution stops retrying', async () => {
  resetDedupe();
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
  assert.equal(res.body.queued, true, 'a resposta não espera o fluxo terminar');
});
