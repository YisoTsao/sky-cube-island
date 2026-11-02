import type { CellId } from '../domain/types';
import type { NavigationGraph } from './build-graph';
import type { LevelIndex } from './derived-map';

export interface PathResult { nodeIds: CellId[]; cost: number }

interface HeapNode { id: CellId; f: number; g: number; h: number }

function less(a: HeapNode, b: HeapNode): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.h !== b.h) return a.h < b.h;
  return a.id < b.id;
}

class MinHeap {
  private items: HeapNode[] = [];
  get size(): number { return this.items.length; }
  push(n: HeapNode): void {
    const a = this.items;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(a[i]!, a[p]!)) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }
  pop(): HeapNode | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l]!, a[m]!)) m = l;
        if (r < a.length && less(a[r]!, a[m]!)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Deterministic multi-goal A* (Tech §4.2). Returns the true shortest path regardless of
 * `maxCost` so callers can distinguish "no route" from "route too long" (Tech §6.3 note).
 */
export function findPathToCore(
  graph: NavigationGraph,
  index: LevelIndex,
  startNodeId: CellId,
  goalNodeIds: readonly CellId[],
): PathResult | null {
  if (!graph.nodes.has(startNodeId)) return null;
  const goals = goalNodeIds.filter((g) => graph.nodes.has(g));
  if (!goals.length) return null;
  const goalSet = new Set(goals);
  const goalPos = goals.map((g) => index.cells.get(g)!.pos);
  const h = (id: CellId): number => {
    const p = index.cells.get(id)!.pos;
    let best = Infinity;
    for (const gp of goalPos) best = Math.min(best, Math.abs(p.x - gp.x) + Math.abs(p.z - gp.z));
    return best;
  };
  const gScore = new Map<CellId, number>([[startNodeId, 0]]);
  const came = new Map<CellId, CellId>();
  const closed = new Set<CellId>();
  const open = new MinHeap();
  const h0 = h(startNodeId);
  open.push({ id: startNodeId, g: 0, h: h0, f: h0 });
  while (open.size) {
    const cur = open.pop()!;
    if (closed.has(cur.id)) continue;
    if (cur.g !== gScore.get(cur.id)) continue;
    if (goalSet.has(cur.id)) {
      const nodeIds: CellId[] = [cur.id];
      let k = cur.id;
      while (came.has(k)) { k = came.get(k)!; nodeIds.push(k); }
      nodeIds.reverse();
      return { nodeIds, cost: cur.g };
    }
    closed.add(cur.id);
    for (const e of graph.neighbors.get(cur.id) ?? []) {
      if (closed.has(e.to)) continue;
      const g = cur.g + e.cost;
      const prev = gScore.get(e.to);
      if (prev !== undefined && g >= prev) continue;
      gScore.set(e.to, g);
      came.set(e.to, cur.id);
      const hh = h(e.to);
      open.push({ id: e.to, g, h: hh, f: g + hh });
    }
  }
  return null;
}
