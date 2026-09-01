import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { emptyVisitors, addVisitor, VisitorAccumulator, EXACT_LIMIT } from '../src/utils/hll.js';

/** The service feeds truncated SHA-256 digests, so the tests must too. */
function visitorHash(seed: string): string {
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

test('a small set of visitors is counted exactly', () => {
  let set = emptyVisitors();
  for (let i = 0; i < 50; i++) set = addVisitor(set, visitorHash(`ip-${i}`));

  const acc = new VisitorAccumulator();
  acc.add(set);

  assert.equal(acc.count(), 50);
  assert.equal(acc.exactCount, true);
});

test('repeated visits from the same address count once', () => {
  let set = emptyVisitors();
  for (let i = 0; i < 500; i++) set = addVisitor(set, visitorHash('same-visitor'));

  const acc = new VisitorAccumulator();
  acc.add(set);
  assert.equal(acc.count(), 1);
});

test('the set promotes to a sketch instead of growing without bound', () => {
  let set = emptyVisitors();
  for (let i = 0; i < EXACT_LIMIT + 10; i++) set = addVisitor(set, visitorHash(`ip-${i}`));

  assert.equal(set.k, 'h', 'deveria ter promovido para o sketch');
  // Whatever the cardinality, the stored form stays a fixed 512 registers.
  assert.equal(Buffer.from((set as { k: 'h'; r: string }).r, 'base64').length, 512);
});

test('the sketch stays within its error bound at high cardinality', () => {
  // The old implementation capped at 5000 and then silently stopped counting,
  // reporting the cap as if it were the real number of visitors.
  for (const truth of [1_000, 10_000, 100_000]) {
    let set = emptyVisitors();
    for (let i = 0; i < truth; i++) set = addVisitor(set, visitorHash(`visitor-${truth}-${i}`));

    const acc = new VisitorAccumulator();
    acc.add(set);
    const estimate = acc.count();
    const error = Math.abs(estimate - truth) / truth;

    assert.equal(acc.exactCount, false);
    // 512 registers give a ~4.6% standard error; allow three of them.
    assert.ok(error < 0.15, `cardinalidade ${truth}: estimativa ${estimate}, erro ${(error * 100).toFixed(1)}%`);
  }
});

test('merging buckets counts the union, not the sum', () => {
  // Reports union buckets across time and across domains. A visitor present in
  // two hours of the same day is one visitor for the day, not two.
  const overlap = 300;
  const build = (offset: number, size: number) => {
    let set = emptyVisitors();
    for (let i = offset; i < offset + size; i++) set = addVisitor(set, visitorHash(`shared-${i}`));
    return set;
  };

  const a = build(0, 1000);
  const b = build(1000 - overlap, 1000);

  const acc = new VisitorAccumulator();
  acc.add(a);
  acc.add(b);

  const truth = 2000 - overlap;
  const error = Math.abs(acc.count() - truth) / truth;
  assert.ok(error < 0.15, `união estimada em ${acc.count()}, esperado ~${truth}`);
});

test('an exact set and a sketch merge without losing either side', () => {
  let small = emptyVisitors();
  for (let i = 0; i < 20; i++) small = addVisitor(small, visitorHash(`small-${i}`));

  let big = emptyVisitors();
  for (let i = 0; i < 5000; i++) big = addVisitor(big, visitorHash(`big-${i}`));

  // Order must not matter: the accumulator has to promote itself when the
  // sketch arrives first as well as when it arrives last.
  for (const order of [[small, big], [big, small]]) {
    const acc = new VisitorAccumulator();
    for (const set of order) acc.add(set);
    const error = Math.abs(acc.count() - 5020) / 5020;
    assert.ok(error < 0.15, `mesclagem estimada em ${acc.count()}, esperado ~5020`);
  }
});

test('a corrupted register block degrades to empty rather than reading garbage', () => {
  const acc = new VisitorAccumulator();
  acc.add({ k: 'h', r: 'dHJ1bmNhdGVk' });
  assert.equal(acc.count(), 0);
});
