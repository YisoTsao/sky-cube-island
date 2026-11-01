import type { ConnectorDef, Elevation, LevelDef, PlatformDef, SurfaceCell, WaveDef } from '../domain/types';
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

const INTERVAL = 23; // 1.15s @ 20 TPS

export const L1_01_WAVES: WaveDef[] = [
  { id: 'w1', clearGold: 35, entries: [{ enemyKind: 'slime', count: 6, portalIds: ['A'], intervalTicks: INTERVAL }] },
  { id: 'w2', clearGold: 40, entries: [
    { enemyKind: 'slime', count: 8, portalIds: ['A', 'B'], intervalTicks: INTERVAL },
    { enemyKind: 'runner', count: 3, portalIds: ['A', 'B'], intervalTicks: INTERVAL },
  ] },
  { id: 'w3', clearGold: 45, entries: [
    { enemyKind: 'slime', count: 6, portalIds: ['A', 'B'], intervalTicks: INTERVAL },
    { enemyKind: 'runner', count: 5, portalIds: ['A', 'B'], intervalTicks: INTERVAL },
    { enemyKind: 'golem', count: 2, portalIds: ['A', 'B'], intervalTicks: INTERVAL },
  ] },
  { id: 'w4', clearGold: 50, entries: [
    { enemyKind: 'slime', count: 3, portalIds: ['A', 'B'], intervalTicks: INTERVAL },
    { enemyKind: 'runner', count: 8, portalIds: ['A', 'B'], intervalTicks: INTERVAL },
    { enemyKind: 'golem', count: 4, portalIds: ['A', 'B'], intervalTicks: INTERVAL },
  ] },
  { id: 'w5', clearGold: 70, entries: [
    { enemyKind: 'slime', count: 8, portalIds: ['A', 'B'], intervalTicks: INTERVAL },
    { enemyKind: 'runner', count: 8, portalIds: ['A', 'B'], intervalTicks: INTERVAL },
    { enemyKind: 'golem', count: 5, portalIds: ['A', 'B'], intervalTicks: INTERVAL },
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
    initialGold: 220,
    maxShortestPathCost: 160,
    waves: L1_01_WAVES,
    decor: { trees: [...L1_01_TREES], rocks: [...L1_01_ROCKS], flowers: [] },
  };
}
