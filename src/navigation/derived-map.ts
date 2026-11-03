import type { CellId, Elevation, GameState, LevelDef, SurfaceCell } from '../domain/types';
import { HEIGHT_STEP_WORLD } from '../domain/types';

export type Occupant =
  | { type: 'tower'; id: string }
  | { type: 'wall'; id: string }
  | { type: 'core' };

/** Static, per-level lookup tables (computed once per LevelDef). */
export interface LevelIndex {
  level: LevelDef;
  cells: Map<CellId, SurfaceCell>;
  byPos: Map<string, CellId>;
  connectorCellIds: Set<CellId>;
  connectorEndpointIds: Set<CellId>;
  /** connector id per deck/endpoint cell (first match). */
  connectorOf: Map<CellId, string>;
  coreFootprint: Set<CellId>;
  approachIds: Set<CellId>;
  portalCellIds: Set<CellId>;
  platformName: Map<string, string>;
}

const indexCache = new WeakMap<LevelDef, LevelIndex>();

export const posKey = (x: number, z: number): string => `${x},${z}`;

export function indexLevel(level: LevelDef): LevelIndex {
  const cached = indexCache.get(level);
  if (cached) return cached;
  const cells = new Map<CellId, SurfaceCell>();
  const byPos = new Map<string, CellId>();
  for (const c of level.cells) {
    cells.set(c.id, c);
    byPos.set(posKey(c.pos.x, c.pos.z), c.id);
  }
  const connectorCellIds = new Set<CellId>();
  const connectorEndpointIds = new Set<CellId>();
  const connectorOf = new Map<CellId, string>();
  for (const con of level.connectors) {
    con.chain.forEach((id, i) => {
      connectorCellIds.add(id);
      if (!connectorOf.has(id)) connectorOf.set(id, con.id);
      if (i === 0 || i === con.chain.length - 1) connectorEndpointIds.add(id);
    });
  }
  const platformName = new Map<string, string>();
  for (const p of level.platforms) platformName.set(p.id, p.name);
  for (const c of level.connectors) platformName.set(c.id, c.name);
  const idx: LevelIndex = {
    level, cells, byPos, connectorCellIds, connectorEndpointIds, connectorOf,
    coreFootprint: new Set(level.core.footprintCellIds),
    approachIds: new Set(level.core.approachNodeIds),
    portalCellIds: new Set(level.portals.map((p) => p.cellId)),
    platformName,
  };
  indexCache.set(level, idx);
  return idx;
}

/** Map state derived from immutable LevelDef + GameState diff (Tech §3.2). */
export interface DerivedMap {
  index: LevelIndex;
  elevationOf(cellId: CellId): Elevation;
  occupantOf(cellId: CellId): Occupant | undefined;
  cellAt(x: number, z: number): SurfaceCell | undefined;
  topWorldY(cellId: CellId): number;
  /** Connectors collapsed by the player (not walkable). */
  broken: ReadonlySet<string>;
}

export function deriveMap(level: LevelDef, state: Pick<GameState, 'editedElevations' | 'towers' | 'walls' | 'brokenConnectors'>): DerivedMap {
  const index = indexLevel(level);
  const occ = new Map<CellId, Occupant>();
  for (const id of index.coreFootprint) occ.set(id, { type: 'core' });
  for (const t of state.towers) for (const id of t.footprintCellIds) occ.set(id, { type: 'tower', id: t.id });
  for (const w of state.walls) occ.set(w.cellId, { type: 'wall', id: w.id });
  const edited = state.editedElevations;
  const elevationOf = (cellId: CellId): Elevation => {
    const e = edited[cellId];
    if (e !== undefined) return e;
    return index.cells.get(cellId)?.elevation ?? 0;
  };
  return {
    index,
    elevationOf,
    occupantOf: (id) => occ.get(id),
    cellAt: (x, z) => {
      const id = index.byPos.get(posKey(x, z));
      return id ? index.cells.get(id) : undefined;
    },
    topWorldY: (id) => elevationOf(id) * HEIGHT_STEP_WORLD,
    broken: new Set(state.brokenConnectors ?? []),
  };
}

export function cellCenter(cell: SurfaceCell): { x: number; z: number } {
  return { x: cell.pos.x + 0.5, z: cell.pos.z + 0.5 };
}
