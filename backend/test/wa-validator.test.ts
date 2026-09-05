import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFlowGraph } from '../src/services/wa-flow-validator.js';
import { phoneHash, phoneTail } from '../src/utils/phone.js';
import type { WaFlowEdge, WaFlowNode } from '../src/db/storage.js';

test('phoneHash and phoneTail sanitize PII properly', () => {
  const phone = '5511999998888';
  const hash = phoneHash(phone);
  assert.equal(hash.length, 16);
  // Deterministic
  assert.equal(hash, phoneHash(phone));
  assert.equal(phoneTail(phone), '8888');
  assert.notEqual(hash, phone);
  assert.ok(!hash.includes('8888'));
});

test('validateFlowGraph catches missing triggers', () => {
  const nodes: WaFlowNode[] = [
    { id: 't1', type: 'send_text', position: { x: 0, y: 0 }, data: { text: 'Oi' } },
    { id: 'e1', type: 'end', position: { x: 0, y: 1 }, data: {} },
  ];
  const edges: WaFlowEdge[] = [{ id: 'e', source: 't1', target: 'e1' }];

  const res = validateFlowGraph(nodes, edges);
  assert.equal(res.valid, false);
  assert.match(res.errors[0].message, /gatilho/i);
});

test('validateFlowGraph detects orphan nodes', () => {
  const nodes: WaFlowNode[] = [
    { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { keyword: 'oi' } },
    { id: 'e1', type: 'end', position: { x: 0, y: 1 }, data: {} },
    { id: 'orphan', type: 'send_text', position: { x: 0, y: 2 }, data: { text: 'Perdido' } },
  ];
  const edges: WaFlowEdge[] = [{ id: 'e', source: 't1', target: 'e1' }];

  const res = validateFlowGraph(nodes, edges);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.nodeId === 'orphan'));
});

test('validateFlowGraph checks regex validity', () => {
  const nodes: WaFlowNode[] = [
    { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { match: 'regex', keyword: '[invalid(' } },
    { id: 'e1', type: 'end', position: { x: 0, y: 1 }, data: {} },
  ];
  const edges: WaFlowEdge[] = [{ id: 'e', source: 't1', target: 'e1' }];

  const res = validateFlowGraph(nodes, edges);
  assert.equal(res.valid, false);
  assert.match(res.errors.find((e) => e.nodeId === 't1')?.message || '', /expressão regular/i);
});

test('validateFlowGraph enforces terminal or waiting blocks', () => {
  const nodes: WaFlowNode[] = [
    { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { keyword: 'oi' } },
    { id: 's1', type: 'send_text', position: { x: 0, y: 1 }, data: { text: 'Ola' } },
  ];
  const edges: WaFlowEdge[] = [{ id: 'e', source: 't1', target: 's1' }];

  const res = validateFlowGraph(nodes, edges);
  assert.equal(res.valid, false);
  assert.match(res.errors.find((e) => e.nodeId === 's1')?.message || '', /não encerra/i);
});

test('validateFlowGraph validates valid complete flow', () => {
  const nodes: WaFlowNode[] = [
    { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { keyword: 'oi' } },
    { id: 's1', type: 'send_text', position: { x: 0, y: 1 }, data: { text: 'Olá!' } },
    { id: 'e1', type: 'end', position: { x: 0, y: 2 }, data: {} },
  ];
  const edges: WaFlowEdge[] = [
    { id: 'e1', source: 't1', target: 's1' },
    { id: 'e2', source: 's1', target: 'e1' },
  ];

  const res = validateFlowGraph(nodes, edges);
  assert.equal(res.valid, true);
  assert.equal(res.errors.length, 0);
});

test('validateFlowGraph catches anti-injection violations in sql block', () => {
  const nodes: WaFlowNode[] = [
    { id: 't1', type: 'trigger_message', position: { x: 0, y: 0 }, data: { keyword: 'pedidos' } },
    { id: 'sql1', type: 'sql', position: { x: 0, y: 1 }, data: { sqlQuery: 'SELECT * FROM orders; DROP TABLE users', sqlMode: 'read' } },
    { id: 'e1', type: 'end', position: { x: 0, y: 2 }, data: {} },
  ];
  const edges: WaFlowEdge[] = [
    { id: 'e1', source: 't1', target: 'sql1' },
    { id: 'e2', source: 'sql1', target: 'e1' },
  ];

  const res = validateFlowGraph(nodes, edges);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.nodeId === 'sql1' && e.message.includes('ponto e vírgula')));
});

test('all built-in WA_FLOW_TEMPLATES pass validateFlowGraph', async () => {
  const { WA_FLOW_TEMPLATES } = await import('../src/services/wa-flow-templates.js');
  assert.ok(WA_FLOW_TEMPLATES.length >= 4);
  for (const t of WA_FLOW_TEMPLATES) {
    const res = validateFlowGraph(t.nodes, t.edges);
    assert.equal(res.valid, true, `Template ${t.id} failed validation: ${JSON.stringify(res.errors)}`);
  }
});

