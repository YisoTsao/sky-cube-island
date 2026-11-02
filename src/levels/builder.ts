import type {
  ConnectorDef, ConnectorKind, Elevation, GridPos, LevelDef, LevelTheme, PlatformDef, SpawnEntry, SurfaceCell, WaveDef,
} from '../domain/types';
import { buildSpawnQueue } from '../simulation/waves';

export const cellIdAt = (x: number, z: number): string => `c${x}_${z}`;

export type Rect = { x0: number; x1: number; z0: number; z1: number };

/** One legend character of an authoring map. */
export interface LegendEntry {
  platformId: string;
  elevation: Elevation;
  /** Base ground of its platform: may be editable when inside an edit zone. */
  flat?: boolean;
  /** Cliff pillar: blocks walking & LOS, never buildable. */
  pillar?: boolean;
  /** Raised terrace on its platform (purely a tag). */
  plateau?: boolean;
  /** Rendered as stone instead of grass. */
  stone?: boolean;
}

export interface LevelSpec {
  id: string;
  name: string;
  subtitle?: string;
  theme?: LevelTheme;
  width: number;
  depth: number;
  map: readonly string[];
  legend: Record<string, LegendEntry>;
  platformNames: Record<string, string>;
  editZones: readonly Rect[];
  portals: readonly { id: string; name: string; x: number; z: number }[];
  connectors: readonly {
    id: string; name: string; kind: ConnectorKind;
    cells: readonly (readonly [number, number])[];
    deckElevations: readonly number[];
  }[];
  core: { x0: number; z0: number; approaches: readonly (readonly [number, number])[]; maxHp: number };
  trees: readonly GridPos[];
  rocks: readonly GridPos[];
  initialGold: number;
  maxShortestPathCost: number;
  waves: WaveDef[];
}

/** Spawn group helper: `count` enemies round-robin over `portals`, `every` ticks apart per portal. */
export const group = (enemyKind: SpawnEntry['enemyKind'], count: number, portals: string[], every: number, delay = 0): SpawnEntry =>
  ({ enemyKind, count, portalIds: portals, intervalTicks: every, ...(delay ? { delayTicks: delay } : {}) });

/**
 * Stretch a wave's spacing (intervals and delays, uniformly) so its last spawn lands at or after
 * `minSeconds`. Waves that are already long enough are returned unchanged.
 */
export function paced(wave: WaveDef, portalIds: readonly string[], minSeconds = 125): WaveDef {
  const last = (w: WaveDef) => Math.max(...buildSpawnQueue(w, portalIds).map((q) => q.tick));
  const target = minSeconds * 20;
  const now = last(wave);
  if (now >= target) return wave;
  let f = target / Math.max(1, now);
  for (let i = 0; i < 20; i++) {
    const w: WaveDef = {
      ...wave,
      entries: wave.entries.map((e) => ({
        ...e, intervalTicks: Math.max(1, Math.round(e.intervalTicks * f)),
        ...(e.delayTicks ? { delayTicks: Math.round(e.delayTicks * f) } : {}),
      })),
    };
    if (last(w) >= target) return w;
    f *= 1.02;
  }
  throw new Error(`could not pace wave ${wave.id}`);
}

/** Deterministically build a LevelDef from an authoring map + legend (shared by every level). */
export function buildLevel(spec: LevelSpec): LevelDef {
  const { width, depth } = spec;
  const cells = new Map<string, SurfaceCell>();

  const protectedSet = new Set<string>();
  const protect = (x: number, z: number, radius: number) => {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) protectedSet.add(cellIdAt(x + dx, z + dz));
    }
  };
  for (const p of spec.portals) protect(p.x, p.z, 1);
  for (const c of spec.connectors) {
    const a = c.cells[0]!;
    const b = c.cells[c.cells.length - 1]!;
    protect(a[0], a[1], 1);
    protect(b[0], b[1], 1);
  }
  const coreIds = new Set<string>();
  for (let dz = 0; dz < 3; dz++) {
    for (let dx = 0; dx < 3; dx++) coreIds.add(cellIdAt(spec.core.x0 + dx, spec.core.z0 + dz));
  }
  // Core plaza ring is sacred ground: not editable / buildable.
  for (let dz = -1; dz <= 3; dz++) {
    for (let dx = -1; dx <= 3; dx++) protectedSet.add(cellIdAt(spec.core.x0 + dx, spec.core.z0 + dz));
  }

  const inEditZone = (x: number, z: number) =>
    spec.editZones.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  const decorTag = new Map<string, string>();
  for (const t of spec.trees) decorTag.set(cellIdAt(t.x, t.z), 'tree');
  for (const r of spec.rocks) decorTag.set(cellIdAt(r.x, r.z), 'rock');
  const portalCells = new Set(spec.portals.map((p) => cellIdAt(p.x, p.z)));

  for (let z = 0; z < depth; z++) {
    const row = spec.map[z] ?? '';
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? '.';
      const def = spec.legend[ch];
      if (!def) continue;
      const id = cellIdAt(x, z);
      const isProtected = protectedSet.has(id);
      const isCore = coreIds.has(id);
      const tag = decorTag.get(id);
      const isPillar = !!def.pillar;
      const tags: string[] = [];
      if (tag) tags.push(tag);
      if (isCore) tags.push('core');
      if (portalCells.has(id)) tags.push('portal');
      if (isProtected && !isCore) tags.push('protected');
      if (isPillar) tags.push('pillar');
      if (def.plateau) tags.push('plateau');
      const nearCore = Math.abs(x - (spec.core.x0 + 1)) <= 2 && Math.abs(z - (spec.core.z0 + 1)) <= 2;
      cells.set(id, {
        id,
        platformId: def.platformId,
        pos: { x, z },
        elevation: def.elevation,
        kind: 'ground',
        terrain: isPillar || nearCore || def.stone ? 'stone' : 'grass',
        editable: !!def.flat && !isProtected && !isCore && !tag && inEditZone(x, z),
        buildable: !isProtected && !isCore && !tag && !isPillar,
        immutable: isProtected || isCore || isPillar,
        tags: tags.length ? tags : undefined,
      });
    }
  }

  const connectors: ConnectorDef[] = [];
  for (const c of spec.connectors) {
    const chain: string[] = [];
    c.cells.forEach(([x, z], i) => {
      const id = cellIdAt(x, z);
      chain.push(id);
      if (i === 0 || i === c.cells.length - 1) return;
      const elevation = c.deckElevations[i - 1] as Elevation;
      cells.set(id, {
        id, platformId: c.id, pos: { x, z }, elevation,
        kind: c.kind === 'BRIDGE' ? 'bridgeDeck' : c.kind === 'STAIR' ? 'stairDeck' : 'rampDeck', terrain: 'wood',
        editable: false, buildable: false, immutable: true, tags: ['connector'],
      });
    });
    connectors.push({ id: c.id, name: c.name, kind: c.kind, chain, bidirectional: true, immutable: true });
  }

  const platformsMap = new Map<string, string[]>();
  for (const cell of cells.values()) {
    if (cell.kind !== 'ground') continue;
    const list = platformsMap.get(cell.platformId) ?? [];
    list.push(cell.id);
    platformsMap.set(cell.platformId, list);
  }
  const platforms: PlatformDef[] = [...platformsMap.entries()].map(([id, cellIds]) => ({
    id, name: spec.platformNames[id] ?? id, cellIds,
  }));

  return {
    schemaVersion: 2,
    id: spec.id,
    name: spec.name,
    ...(spec.subtitle ? { subtitle: spec.subtitle } : {}),
    ...(spec.theme ? { theme: spec.theme } : {}),
    width,
    depth,
    heightStepWorld: 0.5,
    cells: [...cells.values()].sort((a, b) => (a.pos.z - b.pos.z) || (a.pos.x - b.pos.x)),
    platforms,
    connectors,
    portals: spec.portals.map((p) => ({ id: p.id, name: p.name, cellId: cellIdAt(p.x, p.z) })),
    core: {
      footprintCellIds: [...coreIds],
      approachNodeIds: spec.core.approaches.map(([x, z]) => cellIdAt(x, z)),
      maxHp: spec.core.maxHp,
    },
    initialGold: spec.initialGold,
    maxShortestPathCost: spec.maxShortestPathCost,
    waves: spec.waves,
    decor: { trees: [...spec.trees], rocks: [...spec.rocks], flowers: [] },
  };
}
