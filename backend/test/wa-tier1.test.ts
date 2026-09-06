import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dbStorage, type WaFlowNode, type WaFlowEdge, type WaFlowRecord } from '../src/db/storage.js';
import { WaFlowEngine } from '../src/services/wa-flow-engine.js';
import { WaSessionStore } from '../src/utils/wa-session.store.js';
import { WaContactStore } from '../src/utils/wa-contact.store.js';
import { WaHandoffStore } from '../src/utils/wa-handoff.store.js';
import { resetDedupe } from '../src/utils/wa-dedupe.js';
import { phoneHash } from '../src/utils/phone.js';
import { validateFlowGraph } from '../src/services/wa-flow-validator.js';
import { classifyEvolutionInbound } from '../src/utils/evolution.client.js';
import { restoreWaDb, snapshotWaDb } from '../src/utils/wa-db.js';
import { TEST_DATA_DIR } from './setup.js';
import path from 'path';
import type { AiCompletionRequest, FlowPorts } from '../src/services/wa-flow-ports.js';

function flow(id: string, nodes: WaFlowNode[], edges: WaFlowEdge[], extra?: Partial<WaFlowRecord>): WaFlowRecord {
  const record: WaFlowRecord = {
    id,
    name: id,
    published: true,
    instanceNames: ['clinic'],
    priority: 0,
    sessionTtlMinutes: 30,
    aiBudgetTokensPerDay: 50_000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes,
    edges,
    ...extra,
  };
  return dbStorage.saveWaFlow(record);
}

function upsert(text: string, phone = '5511977770000', instance = 'clinic', extra?: Record<string, unknown>) {
  return {
    event: 'messages.upsert',
    instance,
    data: {
      key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id: `id-${Math.random()}` },
      pushName: 'Ana',
      message: { conversation: text },
      ...extra,
    },
  };
}

function audioUpsert(phone = '5511977770000', seconds = 4, base64 = 'AAAA') {
  return {
    event: 'messages.upsert',
    instance: 'clinic',
    data: {
      key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id: `audio-${Math.random()}` },
      pushName: 'Ana',
      message: { audioMessage: { mimetype: 'audio/ogg', seconds, base64 } },
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
      sendMedia: async (_c: unknown, _n: string, options: { kind: string; media: string; caption?: string }) => {
        sent.push({ kind: options.kind, text: options.caption || options.media });
      },
    },
  };
}

test.beforeEach(() => {
  resetDedupe();
  WaHandoffStore.clear();
});

// --- session store ---------------------------------------------------------

test('a conversation is not evicted when the panel passes 400 open sessions', () => {
  // The file store pruned by mtime past this exact number, so the customer who
  // started first silently lost their place mid-answer.
  for (let i = 0; i < 450; i += 1) {
    WaSessionStore.write('clinic', `55119${String(i).padStart(8, '0')}`, {
      flowId: 'waflow-load',
      nodeId: 'n1',
      waiting: true,
      lastText: 'oi',
      vars: {},
      updatedAt: new Date().toISOString(),
    });
  }

  const first = WaSessionStore.read('clinic', '5511900000000');
  assert.ok(first, 'a primeira conversa não pode ser despejada pela 401ª');
  assert.equal(first?.nodeId, 'n1');
  assert.ok(WaSessionStore.activeCount() >= 450);
});

test('an expired session is gone on the next read', () => {
  WaSessionStore.write('clinic', '5511911112222', {
    flowId: 'waflow-ttl',
    nodeId: 'n1',
    waiting: true,
    lastText: 'oi',
    vars: { a: '1' },
    updatedAt: new Date().toISOString(),
  }, 5);

  assert.ok(WaSessionStore.read('clinic', '5511911112222'));

  // Reach past the store to age the row, since the TTL floor is five minutes.
  WaSessionStore.clear('clinic', '5511911112222');
  assert.equal(WaSessionStore.read('clinic', '5511911112222'), null);
});

test('unpublishing a flow drops only its own sessions', () => {
  WaSessionStore.write('clinic', '5511922223333', {
    flowId: 'waflow-a', nodeId: 'n1', waiting: true, lastText: '', vars: {}, updatedAt: new Date().toISOString(),
  });
  WaSessionStore.write('clinic', '5511933334444', {
    flowId: 'waflow-b', nodeId: 'n1', waiting: true, lastText: '', vars: {}, updatedAt: new Date().toISOString(),
  });

  WaSessionStore.clearFlow('waflow-a');
  assert.equal(WaSessionStore.read('clinic', '5511922223333'), null);
  assert.ok(WaSessionStore.read('clinic', '5511933334444'));
});

// --- contacts --------------------------------------------------------------

test('a contact never exposes the phone number it can still send to', () => {
  const contact = WaContactStore.touch('clinic', '5511955556666', { pushName: 'Bia' });

  assert.equal(contact.phoneTail, '6666');
  assert.equal(contact.phoneHash, phoneHash('5511955556666'));
  assert.equal(JSON.stringify(contact).includes('5511955556666'), false, 'o número não pode vazar no registro público');

  // The send path is the only reader of the encrypted column.
  assert.equal(WaContactStore.revealPhone('clinic', contact.phoneHash), '5511955556666');
});

test('an empty pushName does not erase the name the first message taught us', () => {
  WaContactStore.touch('clinic', '5511944445555', { pushName: 'Carla' });
  const second = WaContactStore.touch('clinic', '5511944445555', { pushName: '' });
  assert.equal(second.pushName, 'Carla');
  assert.equal(second.inboundCount, 2);
});

test('tags filter without matching a longer tag that starts the same way', () => {
  const hash = phoneHash('5511900001111');
  WaContactStore.touch('clinic', '5511900001111');
  WaContactStore.setTags('clinic', hash, ['lead', 'vip']);

  const otherHash = phoneHash('5511900002222');
  WaContactStore.touch('clinic', '5511900002222');
  WaContactStore.setTags('clinic', otherHash, ['lead-frio']);

  const found = WaContactStore.list({ instance: 'clinic', tag: 'lead' });
  assert.equal(found.contacts.length, 1);
  assert.equal(found.contacts[0].phoneHash, hash);
});

test('an attribute set to empty is removed, not stored blank', () => {
  const hash = phoneHash('5511900003333');
  WaContactStore.touch('clinic', '5511900003333');
  WaContactStore.setAttrs('clinic', hash, { plano: 'premium', cidade: 'SP' });
  const cleared = WaContactStore.setAttrs('clinic', hash, { cidade: '' });

  assert.deepEqual(cleared?.attrs, { plano: 'premium' });
});

test('conversation history is a bounded ring, oldest first on read', () => {
  const hash = phoneHash('5511900004444');
  WaContactStore.touch('clinic', '5511900004444');
  for (let i = 0; i < 80; i += 1) {
    WaContactStore.appendMessage('clinic', hash, i % 2 === 0 ? 'user' : 'assistant', `msg ${i}`);
  }

  const history = WaContactStore.history('clinic', hash, 10);
  assert.equal(history.length, 10);
  assert.equal(history[9].content, 'msg 79');
  assert.equal(history[0].content, 'msg 70', 'a leitura tem que sair em ordem cronológica');
  assert.ok(WaContactStore.history('clinic', hash, 100).length <= 60, 'o anel não pode crescer sem limite');
});

// --- capture writes through to the contact ---------------------------------

test('a capture marked as lead survives the end of the session', async () => {
  flow(
    'waflow-lead',
    [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { match: 'contains', keyword: 'orcamento' } },
      { id: 'c1', type: 'capture', position: { x: 0, y: 1 }, data: { text: 'Qual seu e-mail?', varName: 'email', captureType: 'email', saveLead: true } },
      { id: 's1', type: 'send_text', position: { x: 0, y: 2 }, data: { text: 'Obrigado, {{email}}' } },
      { id: 'e1', type: 'end', position: { x: 0, y: 3 }, data: {} },
    ],
    [
      { id: 'a', source: 't1', target: 'c1' },
      { id: 'b', source: 'c1', target: 's1', sourceHandle: 'next' },
      { id: 'c', source: 's1', target: 'e1' },
    ]
  );

  const phone = '5511966660000';
  const first = mockSender();
  await WaFlowEngine.handleInbound(upsert('orcamento', phone), first.sender);
  assert.equal(first.sent[0]?.text, 'Qual seu e-mail?');

  const second = mockSender();
  await WaFlowEngine.handleInbound(upsert('ana@exemplo.com', phone), second.sender);
  assert.equal(second.sent[0]?.text, 'Obrigado, ana@exemplo.com');

  // The session is over; the value has to be on the contact, not in it.
  assert.equal(WaSessionStore.read('clinic', phone), null);
  const contact = WaContactStore.get('clinic', phoneHash(phone));
  assert.equal(contact?.attrs.email, 'ana@exemplo.com');
});

test('a returning customer starts with what they already told us', async () => {
  const phone = '5511966661111';
  WaContactStore.touch('clinic', phone);
  WaContactStore.setAttrs('clinic', phoneHash(phone), { plano: 'premium' });

  flow(
    'waflow-returning',
    [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { match: 'contains', keyword: 'plano' } },
      { id: 's1', type: 'send_text', position: { x: 0, y: 1 }, data: { text: 'Seu plano é {{plano}}' } },
      { id: 'e1', type: 'end', position: { x: 0, y: 2 }, data: {} },
    ],
    [
      { id: 'a', source: 't1', target: 's1' },
      { id: 'b', source: 's1', target: 'e1' },
    ]
  );

  const sender = mockSender();
  await WaFlowEngine.handleInbound(upsert('plano', phone), sender.sender);
  assert.equal(sender.sent[0]?.text, 'Seu plano é premium');
});

// --- contact block ---------------------------------------------------------

test('the contact block writes tags that outlive the conversation', async () => {
  const phone = '5511966662222';
  flow(
    'waflow-tag',
    [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { match: 'contains', keyword: 'comprar' } },
      { id: 'k1', type: 'contact', position: { x: 0, y: 1 }, data: { addTags: ['lead-quente'], contactAttrs: [{ key: 'origem', value: 'whatsapp' }] } },
      { id: 'e1', type: 'end', position: { x: 0, y: 2 }, data: {} },
    ],
    [
      { id: 'a', source: 't1', target: 'k1' },
      { id: 'b', source: 'k1', target: 'e1' },
    ]
  );

  await WaFlowEngine.handleInbound(upsert('comprar', phone), mockSender().sender);

  const contact = WaContactStore.get('clinic', phoneHash(phone));
  assert.deepEqual(contact?.tags, ['lead-quente']);
  assert.equal(contact?.attrs.origem, 'whatsapp');
});

// --- media -----------------------------------------------------------------

test('a voice note is transcribed and drives the flow like typed text', async () => {
  flow(
    'waflow-audio',
    [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { match: 'contains', keyword: 'pizza' } },
      { id: 's1', type: 'send_text', position: { x: 0, y: 1 }, data: { text: 'Pedido: {{ultima_mensagem}}' } },
      { id: 'e1', type: 'end', position: { x: 0, y: 2 }, data: {} },
    ],
    [
      { id: 'a', source: 't1', target: 's1' },
      { id: 'b', source: 's1', target: 'e1' },
    ]
  );

  const sender = mockSender();
  const handled = await WaFlowEngine.handleInbound(audioUpsert('5511955550001'), sender.sender, {
    ai: { complete: async () => ({ text: '', tokensIn: 0, tokensOut: 0 }), transcribe: async () => 'quero uma pizza grande' },
  } as Partial<FlowPorts>);

  assert.equal(handled, true);
  assert.equal(sender.sent[0]?.text, 'Pedido: quero uma pizza grande');
});

test('with transcription off the audio arrives as a placeholder a condition can route', async () => {
  flow(
    'waflow-audio-off',
    [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { match: 'any' } },
      { id: 'c1', type: 'condition', position: { x: 0, y: 1 }, data: { source: 'var', varName: 'midia_tipo', operator: 'equals', value: 'audio' } },
      { id: 's1', type: 'send_text', position: { x: 0, y: 2 }, data: { text: 'Recebi seu áudio, já te respondo.' } },
      { id: 's2', type: 'send_text', position: { x: 1, y: 2 }, data: { text: 'Texto normal' } },
      { id: 'e1', type: 'end', position: { x: 0, y: 3 }, data: {} },
      { id: 'e2', type: 'end', position: { x: 1, y: 3 }, data: {} },
    ],
    [
      { id: 'a', source: 't1', target: 'c1' },
      { id: 'b', source: 'c1', target: 's1', sourceHandle: 'yes' },
      { id: 'c', source: 'c1', target: 's2', sourceHandle: 'no' },
      { id: 'd', source: 's1', target: 'e1' },
      { id: 'e', source: 's2', target: 'e2' },
    ],
    { transcribeAudio: false }
  );

  // No session yet, so the flow is chosen by trigger; the placeholder still
  // matches an "any" trigger, which is the point — silence was the old bug.
  const sender = mockSender();
  await WaFlowEngine.handleInbound(audioUpsert('5511955550002'), sender.sender);
  assert.equal(sender.sent[0]?.text, 'Recebi seu áudio, já te respondo.');
});

test('a sticker is still nothing a flow can answer', () => {
  const sticker = classifyEvolutionInbound({
    instance: 'clinic',
    data: { key: { remoteJid: '5511999999999@s.whatsapp.net' }, message: { stickerMessage: { url: 'x' } } },
  });
  assert.equal(sticker.kind === 'skipped' && sticker.reason, 'no_text');

  const image = classifyEvolutionInbound({
    instance: 'clinic',
    data: { key: { remoteJid: '5511999999999@s.whatsapp.net' }, message: { imageMessage: { mimetype: 'image/jpeg' } } },
  });
  assert.equal(image.kind, 'message');
  assert.equal(image.kind === 'message' && image.message.media?.kind, 'image');
});

test('the media block sends a caption and a file', async () => {
  const phone = '5511955550003';
  flow(
    'waflow-media',
    [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { match: 'contains', keyword: 'boleto' } },
      { id: 'm1', type: 'send_media', position: { x: 0, y: 1 }, data: { mediaKind: 'document', mediaUrl: 'https://exemplo.com/b.pdf', mediaFileName: 'boleto.pdf', text: 'Segue, {{nome}}' } },
      { id: 'e1', type: 'end', position: { x: 0, y: 2 }, data: {} },
    ],
    [
      { id: 'a', source: 't1', target: 'm1' },
      { id: 'b', source: 'm1', target: 'e1' },
    ]
  );

  const sender = mockSender();
  await WaFlowEngine.handleInbound(upsert('boleto', phone), sender.sender);
  assert.equal(sender.sent[0]?.kind, 'document');
  assert.equal(sender.sent[0]?.text, 'Segue, Ana');
});

// --- AI memory and tools ---------------------------------------------------

test('the agent is given the conversation, not just the last message', async () => {
  const phone = '5511955550004';
  flow(
    'waflow-memory',
    [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { match: 'any' } },
      { id: 'a1', type: 'agent', position: { x: 0, y: 1 }, data: { model: 'gpt-4o-mini', systemPrompt: 'Seja breve.', memoryTurns: 5 } },
      { id: 'e1', type: 'end', position: { x: 0, y: 2 }, data: {} },
    ],
    [
      { id: 'a', source: 't1', target: 'a1' },
      { id: 'b', source: 'a1', target: 'e1' },
    ]
  );

  const seen: AiCompletionRequest[] = [];
  const ai = {
    complete: async (req: AiCompletionRequest) => {
      seen.push(req);
      return { text: 'Claro!', tokensIn: 5, tokensOut: 5 };
    },
  };

  await WaFlowEngine.handleInbound(upsert('meu nome é Ana', phone), mockSender().sender, { ai });
  await WaFlowEngine.handleInbound(upsert('qual é o meu nome?', phone), mockSender().sender, { ai });

  const second = seen[1];
  const roles = second.messages.map((m) => m.role);
  assert.equal(roles[0], 'system');
  assert.ok(second.messages.some((m) => m.content === 'meu nome é Ana'), 'a primeira mensagem tem que estar na memória');
  assert.ok(second.messages.some((m) => m.role === 'assistant' && m.content === 'Claro!'));
  assert.equal(second.messages[second.messages.length - 1].content, 'qual é o meu nome?');
});

test('the agent may call an HTTP block as a tool and answer with the result', async () => {
  const phone = '5511955550005';
  flow(
    'waflow-tools',
    [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { match: 'any' } },
      {
        id: 'a1',
        type: 'agent',
        position: { x: 0, y: 1 },
        data: {
          model: 'gpt-4o-mini',
          agentTools: [
            { nodeId: 'h1', name: 'consultar_pedido', description: 'Status do pedido', parameters: [{ name: 'numero', required: true }] },
          ],
        },
      },
      { id: 'h1', type: 'http', position: { x: 1, y: 1 }, data: { httpMethod: 'GET', httpUrl: 'https://exemplo.com/pedido/{{numero}}' } },
      { id: 'e1', type: 'end', position: { x: 0, y: 2 }, data: {} },
    ],
    [
      { id: 'a', source: 't1', target: 'a1' },
      { id: 'b', source: 'a1', target: 'e1', sourceHandle: 'next' },
      { id: 'c', source: 'h1', target: 'e1', sourceHandle: 'next' },
    ]
  );

  let round = 0;
  const requested: string[] = [];
  const sender = mockSender();

  await WaFlowEngine.handleInbound(upsert('cadê meu pedido 42?', phone), sender.sender, {
    ai: {
      complete: async (req: AiCompletionRequest) => {
        round += 1;
        if (round === 1) {
          assert.equal(req.tools?.[0]?.name, 'consultar_pedido');
          return {
            text: '',
            tokensIn: 10,
            tokensOut: 5,
            toolCalls: [{ id: 'call-1', name: 'consultar_pedido', arguments: { numero: '42' } }],
          };
        }
        const toolMessage = req.messages.find((m) => m.role === 'tool');
        assert.ok(toolMessage, 'o resultado da ferramenta tem que voltar para o modelo');
        return { text: `Pedido 42: ${toolMessage!.content}`, tokensIn: 10, tokensOut: 8 };
      },
    },
    http: {
      request: async (options) => {
        requested.push(options.url);
        return { status: 200, data: { status: 'a caminho' }, text: '{"status":"a caminho"}' };
      },
    },
  });

  assert.deepEqual(requested, ['https://exemplo.com/pedido/42'], 'o argumento do modelo vira variável só na chamada');
  assert.match(sender.sent[0]?.text || '', /a caminho/);
});

test('a tool that fails is reported to the model instead of killing the answer', async () => {
  const phone = '5511955550006';
  flow(
    'waflow-tool-fail',
    [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { match: 'any' } },
      {
        id: 'a1',
        type: 'agent',
        position: { x: 0, y: 1 },
        data: { model: 'gpt-4o-mini', agentTools: [{ nodeId: 'h1', name: 'buscar', parameters: [] }] },
      },
      { id: 'h1', type: 'http', position: { x: 1, y: 1 }, data: { httpMethod: 'GET', httpUrl: 'https://exemplo.com/x' } },
      { id: 'e1', type: 'end', position: { x: 0, y: 2 }, data: {} },
    ],
    [
      { id: 'a', source: 't1', target: 'a1' },
      { id: 'b', source: 'a1', target: 'e1', sourceHandle: 'next' },
    ]
  );

  let round = 0;
  const sender = mockSender();
  await WaFlowEngine.handleInbound(upsert('busca aí', phone), sender.sender, {
    ai: {
      complete: async (req: AiCompletionRequest) => {
        round += 1;
        if (round === 1) {
          return { text: '', tokensIn: 1, tokensOut: 1, toolCalls: [{ id: 'c1', name: 'buscar', arguments: {} }] };
        }
        const toolMessage = req.messages.find((m) => m.role === 'tool');
        assert.match(toolMessage?.content || '', /Erro ao executar "buscar"/);
        return { text: 'Não consegui consultar agora, mas posso te ajudar de outro jeito.', tokensIn: 1, tokensOut: 1 };
      },
    },
    http: {
      request: async () => {
        throw new Error('host bloqueado pelo guard');
      },
    },
  });

  assert.match(sender.sent[0]?.text || '', /outro jeito/);
});

// --- validator -------------------------------------------------------------

test('a loop with no pause in it is refused', () => {
  const result = validateFlowGraph(
    [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: {} },
      { id: 's1', type: 'send_text', position: { x: 0, y: 1 }, data: { text: 'oi' } },
      { id: 's2', type: 'send_text', position: { x: 0, y: 2 }, data: { text: 'de novo' } },
    ],
    [
      { id: 'a', source: 't1', target: 's1' },
      { id: 'b', source: 's1', target: 's2' },
      { id: 'c', source: 's2', target: 's1' },
    ]
  );

  assert.equal(result.valid, false);
  assert.match(result.errors.map((e) => e.message).join(' '), /ciclo sem nenhuma pausa/);
});

test('a menu looping back on itself is an ordinary flow, not a cycle error', () => {
  const result = validateFlowGraph(
    [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: {} },
      { id: 'm1', type: 'menu', position: { x: 0, y: 1 }, data: { text: 'Escolha', buttons: [{ id: 'a', label: 'De novo' }] } },
    ],
    [
      { id: 'a', source: 't1', target: 'm1' },
      { id: 'b', source: 'm1', target: 'm1', sourceHandle: 'a' },
    ]
  );

  assert.equal(result.errors.some((e) => /ciclo/.test(e.message)), false);
});

test('a tool pointing at a block that is not HTTP or SQL is refused', () => {
  const result = validateFlowGraph(
    [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: {} },
      {
        id: 'a1',
        type: 'agent',
        position: { x: 0, y: 1 },
        data: { model: 'gpt-4o-mini', agentTools: [{ nodeId: 's1', name: 'errado', parameters: [] }] },
      },
      { id: 's1', type: 'send_text', position: { x: 0, y: 2 }, data: { text: 'oi' } },
      { id: 'e1', type: 'end', position: { x: 0, y: 3 }, data: {} },
    ],
    [
      { id: 'a', source: 't1', target: 'a1' },
      { id: 'b', source: 'a1', target: 's1' },
      { id: 'c', source: 's1', target: 'e1' },
    ]
  );

  assert.equal(result.valid, false);
  assert.match(result.errors.map((e) => e.message).join(' '), /só pode apontar para um bloco HTTP ou SQL/);
});

test('a media block without a URL cannot be published', () => {
  const result = validateFlowGraph(
    [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: {} },
      { id: 'm1', type: 'send_media', position: { x: 0, y: 1 }, data: { mediaKind: 'image' } },
      { id: 'e1', type: 'end', position: { x: 0, y: 2 }, data: {} },
    ],
    [
      { id: 'a', source: 't1', target: 'm1' },
      { id: 'b', source: 'm1', target: 'e1' },
    ]
  );

  assert.equal(result.valid, false);
  assert.match(result.errors.map((e) => e.message).join(' '), /exige a URL/);
});

// --- simulator parity ------------------------------------------------------

test('the preview rejects what the live bot rejects', async () => {
  flow(
    'waflow-parity',
    [
      { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { match: 'any' } },
      { id: 'c1', type: 'capture', position: { x: 0, y: 1 }, data: { text: 'Seu e-mail?', varName: 'email', captureType: 'email' } },
      { id: 's1', type: 'send_text', position: { x: 0, y: 2 }, data: { text: 'Valeu {{email}}' } },
      { id: 'e1', type: 'end', position: { x: 0, y: 3 }, data: {} },
    ],
    [
      { id: 'a', source: 't1', target: 'c1' },
      { id: 'b', source: 'c1', target: 's1', sourceHandle: 'next' },
      { id: 'c', source: 's1', target: 'e1' },
    ],
    { published: false }
  );

  // "não tenho" is not an e-mail: the simulator used to accept it and store it
  // in the variable, so a flow looked correct in the preview and rejected the
  // customer in production.
  const result = await WaFlowEngine.simulate('waflow-parity', ['oi', 'não tenho']);
  const texts = result.turns.filter((t) => t.role === 'bot').map((t) => t.text);
  assert.match(texts.join(' '), /Formato inválido/);
  assert.equal(result.vars.email, undefined);
});

// --- backup ---------------------------------------------------------------

test('a panel snapshot carries the contacts back with it', () => {
  const phone = '5511900009999';
  const hash = phoneHash(phone);
  WaContactStore.touch('clinic', phone, { pushName: 'Dora' });
  WaContactStore.setAttrs('clinic', hash, { plano: 'ouro' });
  WaContactStore.appendMessage('clinic', hash, 'user', 'oi');

  const snapshot = path.join(TEST_DATA_DIR, 'wa-snapshot.db');
  snapshotWaDb(snapshot);

  // Everything is lost after the snapshot, the way a failed disk loses it.
  WaContactStore.remove('clinic', hash);
  assert.equal(WaContactStore.get('clinic', hash), null);

  restoreWaDb(snapshot);

  const restored = WaContactStore.get('clinic', hash);
  assert.equal(restored?.pushName, 'Dora');
  assert.equal(restored?.attrs.plano, 'ouro');
  assert.equal(WaContactStore.history('clinic', hash, 5)[0]?.content, 'oi');
});
