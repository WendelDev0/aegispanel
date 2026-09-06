import { describe, it, expect } from 'vitest';
import { layoutFlow } from './flow-layout';

const at = (id: string) => ({ id, position: { x: 0, y: 0 } });

describe('layoutFlow', () => {
  it('puts the trigger above what it feeds', () => {
    const laid = layoutFlow(
      [at('t1'), at('s1'), at('e1')],
      [
        { source: 't1', target: 's1' },
        { source: 's1', target: 'e1' },
      ]
    );
    const y = Object.fromEntries(laid.map((n) => [n.id, n.position.y]));
    expect(y.t1).toBeLessThan(y.s1);
    expect(y.s1).toBeLessThan(y.e1);
  });

  it('spreads a branch sideways instead of stacking it', () => {
    const laid = layoutFlow(
      [at('c1'), at('yes'), at('no')],
      [
        { source: 'c1', target: 'yes' },
        { source: 'c1', target: 'no' },
      ]
    );
    const yes = laid.find((n) => n.id === 'yes')!;
    const no = laid.find((n) => n.id === 'no')!;
    expect(yes.position.y).toBe(no.position.y);
    expect(yes.position.x).not.toBe(no.position.x);
  });

  it('uses the longest path, so an edge never runs back up the canvas', () => {
    // `join` is reachable in one hop from the trigger and in three through the
    // branch. Shortest-path depth would sit it beside the trigger and draw its
    // second incoming edge upwards.
    const laid = layoutFlow(
      [at('t1'), at('a'), at('b'), at('join')],
      [
        { source: 't1', target: 'join' },
        { source: 't1', target: 'a' },
        { source: 'a', target: 'b' },
        { source: 'b', target: 'join' },
      ]
    );
    const y = Object.fromEntries(laid.map((n) => [n.id, n.position.y]));
    expect(y.join).toBeGreaterThan(y.b);
  });

  it('survives a menu that loops back on itself', () => {
    const laid = layoutFlow(
      [at('t1'), at('m1')],
      [
        { source: 't1', target: 'm1' },
        { source: 'm1', target: 'm1' },
      ]
    );
    expect(laid).toHaveLength(2);
    expect(laid.every((n) => Number.isFinite(n.position.x) && Number.isFinite(n.position.y))).toBe(true);
  });

  it('gives a disconnected block a place instead of dropping it', () => {
    const laid = layoutFlow([at('t1'), at('lonely')], [{ source: 't1', target: 't1' }]);
    const lonely = laid.find((n) => n.id === 'lonely')!;
    expect(Number.isFinite(lonely.position.x)).toBe(true);
    expect(Number.isFinite(lonely.position.y)).toBe(true);
  });

  it('is stable: laying out twice does not shuffle the canvas', () => {
    const nodes = [at('t1'), at('a'), at('b')];
    const edges = [
      { source: 't1', target: 'a' },
      { source: 't1', target: 'b' },
    ];
    expect(layoutFlow(layoutFlow(nodes, edges), edges)).toEqual(layoutFlow(nodes, edges));
  });

  it('ignores an edge pointing at a block that is gone', () => {
    const laid = layoutFlow([at('t1')], [{ source: 't1', target: 'apagado' }]);
    expect(laid).toHaveLength(1);
    expect(Number.isFinite(laid[0].position.y)).toBe(true);
  });
});
