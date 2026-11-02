import type { ConnectorDef, Elevation, LevelDef, PlatformDef, SpawnEntry, SurfaceCell, WaveDef } from '../domain/types';
import {
  L1_01_CONNECTORS, L1_01_CORE, L1_01_EDIT_ZONES, L1_01_MAP, L1_01_PORTALS, L1_01_ROCKS, L1_01_TREES,
} from './l1-01.definition';

export const cellIdAt = (x: number, z: number): string => `c${x}_${z}`;

const PLATFORM_BY_CHAR: Record<string, { platformId: string; elevation: Elevation } | undefined> = {
  l: { platformId: 'P_LOW', elevation: 0 },
  L: { platformId: 'P_LOW', elevation: 1 },
  m: { platformId: 'P_MID', elevation: 2 },
  M: { platformId: 'P_MID', elevation: 3 },
  '#': { platformId: 'P_MID', elevation: 5 },
  h: { platformId: 'P_HIGH', elevation: 4 },
  H: { platformId: 'P_HIGH', elevation: 5 },
};

const PLATFORM_NAMES: Record<string, string> = {
  P_LOW: '低平台', P_MID: '中平台', P_HIGH: '高平台',
};

type Portal = 'A' | 'B';
const AB: Portal[] = ['A', 'B'];
/** Spawn group helper: `count` enemies round-robin over `portals`, `every` ticks apart per portal. */
const g = (enemyKind: SpawnEntry['enemyKind'], count: number, portals: Portal[], every: number, delay = 0): SpawnEntry =>
  ({ enemyKind, count, portalIds: portals, intervalTicks: every, ...(delay ? { delayTicks: delay } : {}) });

/**
 * v2.2 wave plan: every wave keeps spawning for at least 120 s (2400 ticks) on both portals,
 * so a wave can never be cleared in under two minutes, and throws 90–200 enemies at the core.
 * Tower commands remain available mid-wave so kill gold can be reinvested.
 */
export const L1_01_WAVES: WaveDef[] = [
  { id: 'w1', hpScale: 1.0, clearGold: 60, entries: [
    g('slime', 10, ['A'], 50),
    g('slime', 6, ['B'], 60, 360),
    g('runner', 8, AB, 60, 80),
    g('mini', 16, AB, 24, 160),
    g('slime', 16, AB, 50, 160),
    g('runner', 12, AB, 44, 140),
    g('slime', 14, AB, 44, 160),
    g('mini', 12, ['A'], 30, 120),
  ] },
  { id: 'w2', hpScale: 1.15, clearGold: 80, entries: [
    g('slime', 16, AB, 44),
    g('runner', 12, AB, 36, 120),
    g('splitter', 6, AB, 80, 140),
    g('golem', 4, AB, 100, 140),
    g('mini', 24, AB, 18, 120),
    g('slime', 16, AB, 40, 140),
    g('splitter', 6, AB, 70, 120),
    g('runner', 14, AB, 30, 120),
  ] },
  { id: 'w3', hpScale: 1.5, clearGold: 100, entries: [
    g('runner', 16, AB, 30),
    g('knight', 6, AB, 90, 120),
    g('slime', 20, AB, 36, 100),
    g('wisp', 4, AB, 120, 60),
    g('golem', 6, AB, 90, 100),
    g('mini', 30, AB, 16, 120),
    g('knight', 8, AB, 70, 140),
    g('splitter', 8, AB, 60, 100),
    g('wisp', 4, AB, 100),
  ] },
  { id: 'w4', hpScale: 1.8, clearGold: 120, entries: [
    g('slime', 24, AB, 30),
    g('splitter', 10, AB, 60, 100),
    g('knight', 8, AB, 70, 100),
    g('wisp', 6, AB, 80),
    g('runner', 24, AB, 22, 120),
    g('golem', 8, AB, 80, 120),
    g('mini', 36, AB, 14, 100),
    g('knight', 10, AB, 60, 120),
    g('wisp', 6, AB, 70),
  ] },
  { id: 'w5', hpScale: 2.0, clearGold: 0, entries: [
    g('slime', 24, AB, 30),
    g('runner', 20, AB, 26, 80),
    g('knight', 10, AB, 60, 100),
    g('wisp', 6, AB, 70),
    g('splitter', 12, AB, 50, 100),
    g('golem', 10, AB, 70, 100),
    g('mini', 40, AB, 12, 80),
    g('boss', 1, ['A'], 1, 120),
    g('boss', 1, ['B'], 1, 120),
    g('knight', 10, AB, 60, 60),
    g('wisp', 6, AB, 60),
    g('runner', 20, AB, 22, 60),
  ] },
];

/** Deterministically generate the L1-01 LevelDef from the authoring map. */
export function generateL1_01(): LevelDef {
  const width = 32;
  const depth = 32;
  const cells = new Map<string, SurfaceCell>();

  const protectedSet = new Set<string>();
  const protect = (x: number, z: number, radius: number) => {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) protectedSet.add(cellIdAt(x + dx, z + dz));
    }
  };
  for (const p of L1_01_PORTALS) protect(p.x, p.z, 1);
  for (const c of L1_01_CONNECTORS) {
    const a = c.cells[0];
    const b = c.cells[c.cells.length - 1]!;
    protect(a[0], a[1], 1);
    protect(b[0], b[1], 1);
  }
  const coreIds = new Set<string>();
  for (let dz = 0; dz < 3; dz++) {
    for (let dx = 0; dx < 3; dx++) coreIds.add(cellIdAt(L1_01_CORE.x0 + dx, L1_01_CORE.z0 + dz));
  }
  // Core plaza ring is sacred ground: not editable / buildable.
  for (let dz = -1; dz <= 3; dz++) {
    for (let dx = -1; dx <= 3; dx++) protectedSet.add(cellIdAt(L1_01_CORE.x0 + dx, L1_01_CORE.z0 + dz));
  }

  const inEditZone = (x: number, z: number) =>
    L1_01_EDIT_ZONES.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  const decorTag = new Map<string, string>();
  for (const t of L1_01_TREES) decorTag.set(cellIdAt(t.x, t.z), 'tree');
  for (const r of L1_01_ROCKS) decorTag.set(cellIdAt(r.x, r.z), 'rock');
  const portalCells = new Map(L1_01_PORTALS.map((p) => [cellIdAt(p.x, p.z), p.id]));

  for (let z = 0; z < depth; z++) {
    const row = L1_01_MAP[z] ?? '';
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? '.';
      const def = PLATFORM_BY_CHAR[ch];
      if (!def) continue;
      const id = cellIdAt(x, z);
      const isProtected = protectedSet.has(id);
      const isCore = coreIds.has(id);
      const tag = decorTag.get(id);
      const flatBase = ch === 'l' || ch === 'm' || ch === 'h';
      const isPillar = ch === '#';
      const tags: string[] = [];
      if (tag) tags.push(tag);
      if (isCore) tags.push('core');
      if (portalCells.has(id)) tags.push('portal');
      if (isProtected && !isCore) tags.push('protected');
      if (isPillar) tags.push('pillar');
      if (ch === 'M' || ch === 'H' || ch === 'L') tags.push('plateau');
      const nearCore = Math.abs(x - (L1_01_CORE.x0 + 1)) <= 2 && Math.abs(z - (L1_01_CORE.z0 + 1)) <= 2;
      cells.set(id, {
        id,
        platformId: def.platformId,
        pos: { x, z },
        elevation: def.elevation,
        kind: 'ground',
        terrain: isPillar || nearCore ? 'stone' : 'grass',
        editable: flatBase && !isProtected && !isCore && !tag && inEditZone(x, z),
        buildable: !isProtected && !isCore && !tag && !isPillar,
        immutable: isProtected || isCore || isPillar,
        tags: tags.length ? tags : undefined,
      });
    }
  }

  const connectors: ConnectorDef[] = [];
  for (const c of L1_01_CONNECTORS) {
    const chain: string[] = [];
    c.cells.forEach(([x, z], i) => {
      const id = cellIdAt(x, z);
      chain.push(id);
      if (i === 0 || i === c.cells.length - 1) return;
      const elevation = c.deckElevations[i - 1] as Elevation;
      cells.set(id, {
        id, platformId: c.id, pos: { x, z }, elevation,
        kind: 'rampDeck', terrain: 'wood',
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
    id, name: PLATFORM_NAMES[id] ?? id, cellIds,
  }));

  return {
    schemaVersion: 2,
    id: 'L1-01',
    name: '天空斷崖島',
    width,
    depth,
    heightStepWorld: 0.5,
    cells: [...cells.values()].sort((a, b) => (a.pos.z - b.pos.z) || (a.pos.x - b.pos.x)),
    platforms,
    connectors,
    portals: L1_01_PORTALS.map((p) => ({ id: p.id, name: p.name, cellId: cellIdAt(p.x, p.z) })),
    core: {
      footprintCellIds: [...coreIds],
      approachNodeIds: L1_01_CORE.approaches.map(([x, z]) => cellIdAt(x, z)),
      maxHp: 20,
    },
    initialGold: 300,
    maxShortestPathCost: 160,
    waves: L1_01_WAVES,
    decor: { trees: [...L1_01_TREES], rocks: [...L1_01_ROCKS], flowers: [] },
  };
}
