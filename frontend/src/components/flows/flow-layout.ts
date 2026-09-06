export interface LayoutNode {
  id: string;
  position: { x: number; y: number };
}

export interface LayoutEdge {
  source: string;
  target: string;
}

const NODE_WIDTH = 248;
const GAP_X = 72;
const LAYER_HEIGHT = 190;
const ORIGIN = { x: 60, y: 40 };

/**
 * Lays a flow out top to bottom, triggers first.
 *
 * Blocks were dropped at `80 + count * 20`, so a flow of any size became a
 * diagonal staircase the operator had to untangle by hand before it could be
 * read at all. This puts every block one layer below the furthest block that
 * reaches it, which is what makes a branch look like a branch.
 *
 * Longest path, not shortest: with shortest-path depth a node fed by both a
 * trigger and the end of a long branch lands next to the trigger, and its
 * incoming edge runs backwards up the canvas.
 *
 * Cycles are ordinary here — a menu that loops back on itself is a normal
 * flow — so the relaxation is bounded by the node count rather than trusting
 * the graph to be acyclic.
 */
export function layoutFlow<T extends LayoutNode>(nodes: T[], edges: LayoutEdge[]): T[] {
  if (nodes.length === 0) return nodes;

  const ids = new Set(nodes.map((n) => n.id));
  const clean = edges.filter((e) => ids.has(e.source) && ids.has(e.target));

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const edge of clean) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge.target]);
    incoming.set(edge.target, [...(incoming.get(edge.target) || []), edge.source]);
  }

  // Roots keep the operator's own reading order: a block nothing points at is
  // an entry point, and a disconnected block is its own root rather than
  // being dropped off the canvas.
  const roots = nodes.filter((n) => (incoming.get(n.id) || []).length === 0).map((n) => n.id);
  const seeds = roots.length ? roots : [nodes[0].id];

  const depth = new Map<string, number>();
  for (const id of seeds) depth.set(id, 0);

  for (let pass = 0; pass < nodes.length; pass += 1) {
    let moved = false;
    for (const edge of clean) {
      const from = depth.get(edge.source);
      if (from === undefined) continue;
      const want = from + 1;
      const current = depth.get(edge.target);
      if (current === undefined || want > current) {
        depth.set(edge.target, want);
        moved = true;
      }
    }
    if (!moved) break;
  }

  // Anything a cycle kept out of the walk still needs a home.
  let orphanLayer = Math.max(0, ...Array.from(depth.values(), (d) => d)) + 1;
  for (const node of nodes) {
    if (!depth.has(node.id)) {
      depth.set(node.id, orphanLayer);
      orphanLayer += 1;
    }
  }

  const layers = new Map<number, string[]>();
  for (const node of nodes) {
    const level = depth.get(node.id) ?? 0;
    layers.set(level, [...(layers.get(level) || []), node.id]);
  }

  // Order inside a layer by where the parents sit, so sibling branches stay
  // under the block that split them instead of crossing over each other.
  const columnOf = new Map<string, number>();
  const sortedLevels = Array.from(layers.keys()).sort((a, b) => a - b);

  for (const level of sortedLevels) {
    const row = layers.get(level)!;
    const weight = (id: string): number => {
      const parents = (incoming.get(id) || []).map((p) => columnOf.get(p)).filter((c): c is number => c !== undefined);
      if (!parents.length) return Number.MAX_SAFE_INTEGER;
      return parents.reduce((a, b) => a + b, 0) / parents.length;
    };
    row.sort((a, b) => {
      const diff = weight(a) - weight(b);
      if (diff !== 0) return diff;
      // Stable tiebreak so repeated runs do not shuffle the canvas.
      return a.localeCompare(b);
    });
    row.forEach((id, index) => columnOf.set(id, index));
  }

  const widest = Math.max(...sortedLevels.map((level) => layers.get(level)!.length));
  const totalWidth = widest * NODE_WIDTH + (widest - 1) * GAP_X;

  const positions = new Map<string, { x: number; y: number }>();
  for (const level of sortedLevels) {
    const row = layers.get(level)!;
    const rowWidth = row.length * NODE_WIDTH + (row.length - 1) * GAP_X;
    const offset = ORIGIN.x + (totalWidth - rowWidth) / 2;
    row.forEach((id, index) => {
      positions.set(id, {
        x: Math.round(offset + index * (NODE_WIDTH + GAP_X)),
        y: ORIGIN.y + level * LAYER_HEIGHT,
      });
    });
  }

  return nodes.map((node) => ({ ...node, position: positions.get(node.id) || node.position }));
}
