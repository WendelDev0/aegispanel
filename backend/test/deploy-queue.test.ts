import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  admit,
  nextRunnable,
  positionInQueue,
  type QueueEntry,
} from '../src/utils/deploy-queue.js';

function entry(id: string, appId: string, nodeId: string, at: number): QueueEntry<string> {
  return { id, appId, nodeId, enqueuedAtMs: at, payload: id };
}

const alwaysOne = () => 1;

test('an empty queue has nothing to run', () => {
  assert.equal(nextRunnable([], [], alwaysOne), null);
});

test('the oldest request on a free node runs first', () => {
  const queue = [
    entry('d2', 'app-b', 'node-local', 200),
    entry('d1', 'app-a', 'node-local', 100),
  ];
  assert.equal(nextRunnable(queue, [], alwaysOne)?.id, 'd1');
});

/**
 * Two builds on one daemon compete for CPU and disk, and on a small VPS the
 * second `docker build` starting mid-way through the first is what turns a slow
 * deploy into a failed one.
 */
test('a node already at its limit blocks its own queue', () => {
  const queue = [entry('d2', 'app-b', 'node-local', 200)];
  const running = [entry('d1', 'app-a', 'node-local', 100)];
  assert.equal(nextRunnable(queue, running, alwaysOne), null);
});

test('a busy node does not block a different one', () => {
  const queue = [entry('d2', 'app-b', 'node-remote', 200)];
  const running = [entry('d1', 'app-a', 'node-local', 100)];
  assert.equal(nextRunnable(queue, running, alwaysOne)?.id, 'd2');
});

test('a node with room for two starts a second deploy', () => {
  const queue = [entry('d2', 'app-b', 'node-local', 200)];
  const running = [entry('d1', 'app-a', 'node-local', 100)];
  assert.equal(nextRunnable(queue, running, () => 2)?.id, 'd2');
});

/**
 * Two deploys of one app race over a single container name and host port: the
 * second create renames the first's container aside while the first is still
 * starting it.
 */
test('an app already deploying never starts a second time', () => {
  const queue = [entry('d2', 'app-a', 'node-local', 200)];
  const running = [entry('d1', 'app-a', 'node-local', 100)];
  assert.equal(nextRunnable(queue, running, () => 5), null, 'mesmo com folga no nó');
});

test('a blocked app does not stall the rest of the queue', () => {
  const queue = [
    entry('d2', 'app-a', 'node-local', 200),
    entry('d3', 'app-b', 'node-local', 300),
  ];
  const running = [entry('d1', 'app-a', 'node-local', 100)];
  assert.equal(nextRunnable(queue, running, () => 2)?.id, 'd3');
});

/**
 * Five pushes in a minute is one intent — deploy the latest commit. Building
 * the three in between spends minutes to publish states nobody asked to see.
 */
test('a second request for a waiting app supersedes it', () => {
  const queue = [entry('d1', 'app-a', 'node-local', 100)];
  const decision = admit(queue, new Set(), entry('d2', 'app-a', 'node-local', 200));

  assert.equal(decision.admitted, true);
  assert.equal(decision.supersededId, 'd1');
});

test('a preview does not supersede production of the same app', () => {
  const queue = [{ ...entry('d1', 'app-a', 'node-local', 100), lane: 'production' }];
  const decision = admit(queue, new Set(), {
    ...entry('d2', 'app-a', 'node-local', 200),
    lane: 'preview-12',
  });
  assert.equal(decision.admitted, true);
  assert.equal(decision.supersededId, undefined);
});

test('a request for a different app supersedes nothing', () => {
  const queue = [entry('d1', 'app-a', 'node-local', 100)];
  const decision = admit(queue, new Set(), entry('d2', 'app-b', 'node-local', 200));

  assert.equal(decision.admitted, true);
  assert.equal(decision.supersededId, undefined);
});

/**
 * The running deploy is never superseded: it may already be halfway through a
 * container swap, with the previous container renamed aside.
 */
test('a running deploy is not superseded, only queued behind', () => {
  const decision = admit([], new Set(['app-a']), entry('d2', 'app-a', 'node-local', 200));
  assert.equal(decision.admitted, true);
  assert.equal(decision.supersededId, undefined);
});

test('position is 1-based within the same node', () => {
  const queue = [
    entry('d1', 'app-a', 'node-local', 100),
    entry('d2', 'app-b', 'node-local', 200),
    entry('d3', 'app-c', 'node-local', 300),
  ];

  assert.equal(positionInQueue(queue, 'd1'), 1);
  assert.equal(positionInQueue(queue, 'd3'), 3);
});

/**
 * A deploy waiting behind another node's queue is not actually behind it, and
 * telling the operator "position 3" when nothing is in front would be a lie.
 */
test('another node\'s entries do not inflate the position', () => {
  const queue = [
    entry('d1', 'app-a', 'node-remote', 100),
    entry('d2', 'app-b', 'node-remote', 200),
    entry('d3', 'app-c', 'node-local', 300),
  ];

  assert.equal(positionInQueue(queue, 'd3'), 1);
});

test('an unknown id has no position', () => {
  assert.equal(positionInQueue([entry('d1', 'app-a', 'node-local', 100)], 'nope'), 0);
});
