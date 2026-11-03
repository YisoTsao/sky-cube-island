import type { CellId } from '../domain/types';
import type { DerivedMap } from './derived-map';

export interface NavEdge { to: CellId; cost: 1; via?: string }
export interface NavigationGraph {
  neighbors: Map<CellId, NavEdge[]>;
  /** Walkable node ids. */
  nodes: Set<CellId>;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Build the walkable graph (Tech §4.1):
 *  - ordinary edges only between adjacent `ground` cells of the same platform with |Δelevation| ≤ 1
 *  - cross-platform edges only along Connector chains (deck nodes never link sideways)
 *  - core footprint, towers, walls and water are not walkable
 */
export function buildNavigationGraph(map: DerivedMap): NavigationGraph {
  const { index } = map;
  const nodes = new Set<CellId>();
  for (const cell of index.level.cells) {
    if (cell.terrain === 'water') continue;
    if (map.occupantOf(cell.id)) continue;
    nodes.add(cell.id);
  }
  const neighbors = new Map<CellId, NavEdge[]>();
  const add = (a: CellId, b: CellId, via?: string) => {
    const list = neighbors.get(a) ?? [];
    if (!list.some((e) => e.to === b)) list.push(via ? { to: b, cost: 1, via } : { to: b, cost: 1 });
    neighbors.set(a, list);
  };

  for (const id of nodes) {
    const cell = index.cells.get(id)!;
    if (cell.kind !== 'ground') continue;
    const e = map.elevationOf(id);
    for (const [dx, dz] of DIRS) {
      const n = map.cellAt(cell.pos.x + dx, cell.pos.z + dz);
      if (!n || n.kind !== 'ground' || !nodes.has(n.id)) continue;
      if (n.platformId !== cell.platformId) continue;
      if (Math.abs(map.elevationOf(n.id) - e) > 1) continue;
      add(id, n.id);
    }
  }

  for (const con of index.level.connectors) {
    if (map.broken.has(con.id)) continue;
    for (let i = 0; i + 1 < con.chain.length; i++) {
      const a = con.chain[i]!;
      const b = con.chain[i + 1]!;
      if (!nodes.has(a) || !nodes.has(b)) continue;
      add(a, b, con.id);
      add(b, a, con.id);
    }
  }

  // Deterministic neighbour order (Tech §4.1 step 6).
  for (const list of neighbors.values()) list.sort((p, q) => (p.to < q.to ? -1 : p.to > q.to ? 1 : 0));
  return { neighbors, nodes };
}
