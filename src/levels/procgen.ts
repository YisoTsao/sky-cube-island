import type { ConnectorKind, EnemyKind, GridPos, LevelDef, LevelTheme, WaveDef, WeatherKind } from '../domain/types';
import { ENEMY_DEFS } from '../domain/definitions';
import { buildLevel, paced, type LegendEntry, type Rect } from './builder';
import { validateLevel } from './level-validator';
import { computeRoutes } from '../navigation/connectivity';

/**
 * Island generator for the later chapters, the daily challenge and the level editor's "random
 * island" button. A level is a fixed 32×32 frame: the core sits on a central island and up to
 * four outer islands (N/E/S/W) hold the portals. Every outer island is linked to the centre by one
 * or two straight bridges, and neighbouring outer islands can be linked round the corners, which
 * gives the player bridges worth collapsing. Everything is driven by a seeded RNG, so the same
 * descriptor always yields the same LevelDef; when a seed produces an invalid map the next seed
 * is tried (deterministically).
 */

export type Side = 'N' | 'E' | 'S' | 'W';
export type Corner = 'NW' | 'NE' | 'SE' | 'SW';

export interface IslandLayout {
  /** Outer islands present (2–4). */
  sides: Side[];
  /** Portals on each outer island (default 1). */
  portals?: Partial<Record<Side, number>>;
  /** Outer islands with a bridge to the centre (default: all). The others reach it only round the
   *  corners, so their enemies merge with a neighbour's — the generator's chokepoints. */
  hubs?: Side[];
  /** Outer islands joined to the centre by two bridges instead of one. */
  doubleBridge?: Side[];
  /** Corner links between neighbouring outer islands (both sides must be present). */
  corners?: Corner[];
  /** Elevation of the core island (2–4). */
  coreElevation?: number;
  /** Number of cliff pillars scattered over the islands. */
  pillars?: number;
}

export interface WavePlan {
  /** Normal enemy kinds, introduced in this order. */
  roster: EnemyKind[];
  /** Boss for the final wave, plus optional mid-bosses (wave index → kind). */
  finalBoss: EnemyKind;
  midBosses?: Record<number, EnemyKind>;
  waves: number;
  /** hpScale for the first and the last wave (linear in between). */
  hp: [number, number];
  /** Spawn budget multiplier (1 = roughly 100 enemies a wave with two portals). */
  density?: number;
  /** Minimum seconds a wave keeps spawning (default 125). */
  minSeconds?: number;
}

export interface GeneratedLevelSpec {
  id: string;
  name: string;
  subtitle?: string;
  theme: LevelTheme;
  weather?: WeatherKind;
  seed: number;
  layout: IslandLayout;
  plan: WavePlan;
  initialGold: number;
  coreHp?: number;
  /** Hand edits from the level editor, keyed "x,z": raise a cell one step, make it a cliff pillar,
   *  cut it out (void) or add a ground cell over the void (joined to the nearest island). */
  overrides?: Record<string, CellOverride>;
}

export type CellOverride = 'raise' | 'pillar' | 'void' | 'ground';

const SIZE = 32;
const CORE_RECT: Rect = { x0: 11, x1: 20, z0: 11, z1: 20 };
const CORE_X0 = 14, CORE_Z0 = 14;
const PORTAL_IDS = 'ABCDEFGH';
const SIDE_NAMES: Record<Side, string> = { N: '北', E: '東', S: '南', W: '西' };
const ISLAND_NAMES: Record<LevelTheme, string[]> = {
  day: ['草原', '花丘', '果園', '風車原'],
  dusk: ['晶石台', '霧谷', '紫晶崖', '星砂灘'],
  snow: ['雪原', '冰湖', '松林', '霜崖'],
  ember: ['焦土', '熔岩台', '灰燼丘', '黑曜崖'],
};
const BRIDGE_NAMES = ['木橋', '吊橋', '石橋', '長橋', '索橋', '拱橋'];

/** Small fast deterministic RNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Island { side: Side | 'C'; rect: Rect; elevation: number; platformId: string }
interface Bridge { id: string; name: string; kind: ConnectorKind; cells: [number, number][]; deckElevations: number[] }

const key = (x: number, z: number) => `${x},${z}`;

function layoutOnce(spec: GeneratedLevelSpec, seed: number) {
  const r = rng(seed);
  const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const L = spec.layout;
  const has = (s: Side) => L.sides.includes(s);
  const cornerOn = (c: Corner) => (L.corners ?? []).includes(c) && has(c[0] as Side) && has(c[1] as Side);
  const coreElev = L.coreElevation ?? 3;

  // ---- islands: N/S span x, E/W span z; they shrink away from corners that have no link
  const islands: Island[] = [{ side: 'C', rect: CORE_RECT, elevation: coreElev, platformId: 'P_C' }];
  const ns = (west: boolean, east: boolean): [number, number] => [west ? int(1, 2) : int(3, 6), east ? SIZE - 1 - int(1, 2) : SIZE - 1 - int(3, 6)];
  const ew = (): [number, number] => [int(9, 10), int(21, 22)];
  const elev = () => Math.max(0, Math.min(coreElev + 1, int(0, coreElev + 1)));
  if (has('N')) { const [x0, x1] = ns(cornerOn('NW'), cornerOn('NE')); islands.push({ side: 'N', rect: { x0, x1, z0: 1, z1: 6 }, elevation: elev(), platformId: 'P_N' }); }
  if (has('S')) { const [x0, x1] = ns(cornerOn('SW'), cornerOn('SE')); islands.push({ side: 'S', rect: { x0, x1, z0: 25, z1: 30 }, elevation: elev(), platformId: 'P_S' }); }
  if (has('W')) { const [z0, z1] = ew(); islands.push({ side: 'W', rect: { x0: 1, x1: 6, z0, z1 }, elevation: elev(), platformId: 'P_W' }); }
  if (has('E')) { const [z0, z1] = ew(); islands.push({ side: 'E', rect: { x0: 25, x1: 30, z0, z1 }, elevation: elev(), platformId: 'P_E' }); }
  const isl = (s: Side | 'C') => islands.find((i) => i.side === s)!;

  // ---- bridges
  const bridges: Bridge[] = [];
  let bridgeNo = 0;
  const addBridge = (from: Island, to: Island, cells: [number, number][]) => {
    const n = cells.length - 1;
    const a = from.elevation, b = to.elevation;
    const decks: number[] = [];
    for (let i = 1; i < n; i++) decks.push(Math.round(a + ((b - a) * i) / n));
    const id = `C${bridges.length + 1}`;
    const kind: ConnectorKind = Math.abs(a - b) >= 2 && n <= 4 ? 'RAMP' : 'BRIDGE';
    const theme = ISLAND_NAMES[spec.theme];
    const nm = `${from.side === 'C' ? '中央' : SIDE_NAMES[from.side as Side]}${to.side === 'C' ? '' : SIDE_NAMES[to.side as Side]}${BRIDGE_NAMES[bridgeNo++ % BRIDGE_NAMES.length]}`;
    void theme;
    bridges.push({ id, name: nm, kind, cells, deckElevations: decks });
  };
  const used: Record<Side, number[]> = { N: [], E: [], S: [], W: [] };
  for (const s of L.sides) {
    if (L.hubs && !L.hubs.includes(s)) continue;
    const count = (L.doubleBridge ?? []).includes(s) ? 2 : 1;
    for (let k = 0; k < count; k++) {
      let p = 0;
      for (let tries = 0; tries < 30; tries++) {
        p = count === 2 ? (k === 0 ? int(11, 13) : int(18, 20)) : int(12, 19);
        if (p === 15) continue; // keep the core's own approach lines clear
        if (used[s].every((q) => Math.abs(q - p) >= 3)) break;
      }
      used[s].push(p);
      const o = isl(s);
      const cells: [number, number][] = [];
      if (s === 'N') for (let z = 6; z <= 11; z++) cells.push([p, z]);
      if (s === 'S') for (let z = 25; z >= 20; z--) cells.push([p, z]);
      if (s === 'W') for (let x = 6; x <= 11; x++) cells.push([x, p]);
      if (s === 'E') for (let x = 25; x >= 20; x--) cells.push([x, p]);
      addBridge(o, isl('C'), cells);
    }
  }
  for (const c of L.corners ?? []) {
    if (!cornerOn(c)) continue;
    const vert = isl(c[0] as Side); // N or S island
    const side = isl(c[1] as Side); // W or E island
    const west = c[1] === 'W';
    const x = west ? int(3, 4) : SIZE - 1 - int(3, 4);
    const cells: [number, number][] = [];
    if (c[0] === 'N') for (let z = vert.rect.z1; z <= side.rect.z0; z++) cells.push([x, z]);
    else for (let z = vert.rect.z0; z >= side.rect.z1; z--) cells.push([x, z]);
    // decks must change by at most one per step
    if (Math.abs(vert.elevation - side.elevation) > cells.length - 1) side.elevation = vert.elevation + Math.sign(side.elevation - vert.elevation) * (cells.length - 1);
    addBridge(vert, side, cells);
  }

  // ---- portals on the far edge of each outer island, away from its bridges
  const portals: { id: string; name: string; x: number; z: number }[] = [];
  for (const s of L.sides) {
    const n = L.portals?.[s] ?? 1;
    const o = isl(s);
    const horiz = s === 'N' || s === 'S';
    const lo = horiz ? o.rect.x0 + 2 : o.rect.z0 + 2;
    const hi = horiz ? o.rect.x1 - 2 : o.rect.z1 - 2;
    const fixed = s === 'N' ? 2 : s === 'S' ? 29 : s === 'W' ? 2 : 29;
    const picks: number[] = [];
    for (let k = 0; k < n; k++) {
      let best = lo, bestScore = -1;
      for (let tries = 0; tries < 24; tries++) {
        const p = int(lo, hi);
        const score = Math.min(...used[s].map((q) => Math.abs(q - p)), ...picks.map((q) => Math.abs(q - p) * 0.8), 99) + r() * 0.5;
        if (score > bestScore) { bestScore = score; best = p; }
      }
      picks.push(best);
      portals.push({
        id: PORTAL_IDS[portals.length]!,
        name: `${SIDE_NAMES[s]}方${n > 1 ? (k === 0 ? '甲' : k === 1 ? '乙' : '丙') : ''}傳送門`,
        x: horiz ? best : fixed, z: horiz ? fixed : best,
      });
    }
  }

  // ---- terrain grid
  const ground = new Map<string, { island: Island; elevation: number; kind: 'flat' | 'plateau' | 'pillar' }>();
  for (const o of islands) {
    const { x0, x1, z0, z1 } = o.rect;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
      if (corner) continue;
      ground.set(key(x, z), { island: o, elevation: o.elevation, kind: 'flat' });
    }
  }
  // keep-out: portals, bridge ends, core plaza, core approach lines
  const keepOut = new Set<string>();
  const ko = (x: number, z: number, rad: number) => { for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) keepOut.add(key(x + dx, z + dz)); };
  for (const p of portals) ko(p.x, p.z, 2);
  for (const b of bridges) { const a = b.cells[0]!, e = b.cells[b.cells.length - 1]!; ko(a[0], a[1], 2); ko(e[0], e[1], 2); }
  ko(CORE_X0 + 1, CORE_Z0 + 1, 2);
  for (let i = CORE_RECT.x0; i <= CORE_RECT.x1; i++) { keepOut.add(key(i, CORE_Z0 + 1)); keepOut.add(key(CORE_X0 + 1, i)); }
  // bitten edges: drop a few rim cells so the islands read as rough rock, not rectangles
  for (const o of islands) {
    const { x0, x1, z0, z1 } = o.rect;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const rim = x === x0 || x === x1 || z === z0 || z === z1;
      if (!rim || keepOut.has(key(x, z)) || r() > 0.22) continue;
      ground.delete(key(x, z));
    }
  }
  const free = (x: number, z: number) => ground.has(key(x, z)) && !keepOut.has(key(x, z));
  // plateaus: 2–3 raised terraces per island (great tower spots)
  for (const o of islands) {
    const count = o.side === 'C' ? 2 : int(1, 2);
    for (let k = 0; k < count; k++) {
      const w = int(2, 3), d = int(2, 3);
      for (let tries = 0; tries < 20; tries++) {
        const x = int(o.rect.x0 + 1, o.rect.x1 - w), z = int(o.rect.z0 + 1, o.rect.z1 - d);
        const cells: [number, number][] = [];
        for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) cells.push([x + dx, z + dz]);
        if (!cells.every(([cx, cz]) => free(cx, cz) && ground.get(key(cx, cz))!.kind === 'flat')) continue;
        for (const [cx, cz] of cells) { const g = ground.get(key(cx, cz))!; g.kind = 'plateau'; g.elevation = Math.min(5, o.elevation + 1); }
        break;
      }
    }
  }
  for (let k = 0; k < (L.pillars ?? 2); k++) {
    for (let tries = 0; tries < 20; tries++) {
      const o = islands[int(1, islands.length - 1)] ?? islands[0]!;
      const x = int(o.rect.x0 + 1, o.rect.x1 - 1), z = int(o.rect.z0 + 1, o.rect.z1 - 1);
      if (!free(x, z) || ground.get(key(x, z))!.kind !== 'flat') continue;
      const g = ground.get(key(x, z))!; g.kind = 'pillar'; g.elevation = Math.min(6, o.elevation + 4);
      break;
    }
  }
  // editor overrides (applied before decor so trees never sit on an edited cell)
  for (const [k, o] of Object.entries(spec.overrides ?? {})) {
    const [x, z] = k.split(',').map(Number) as [number, number];
    if (!(x >= 0 && x < SIZE && z >= 0 && z < SIZE)) continue;
    const g = ground.get(k);
    if (o === 'void') { if (g) ground.delete(k); continue; }
    if (o === 'ground') {
      if (g) continue;
      // join the closest island at its base height
      let best: Island | null = null, bd = Infinity;
      for (const isl of islands) {
        const dx = Math.max(isl.rect.x0 - x, 0, x - isl.rect.x1), dz = Math.max(isl.rect.z0 - z, 0, z - isl.rect.z1);
        if (dx + dz < bd) { bd = dx + dz; best = isl; }
      }
      if (best) ground.set(k, { island: best, elevation: best.elevation, kind: 'flat' });
      continue;
    }
    if (!g) continue;
    if (o === 'raise') { g.kind = 'plateau'; g.elevation = Math.min(6, g.island.elevation + 1); }
    if (o === 'pillar') { g.kind = 'pillar'; g.elevation = Math.min(6, g.island.elevation + 4); }
  }
  // decor
  const trees: GridPos[] = [], rocks: GridPos[] = [];
  const decor = new Set<string>();
  const place = (list: GridPos[], n: number) => {
    for (let k = 0; k < n; k++) for (let tries = 0; tries < 20; tries++) {
      const o = islands[int(0, islands.length - 1)]!;
      const x = int(o.rect.x0, o.rect.x1), z = int(o.rect.z0, o.rect.z1);
      const g = ground.get(key(x, z));
      if (!g || g.kind === 'pillar' || keepOut.has(key(x, z)) || decor.has(key(x, z))) continue;
      decor.add(key(x, z)); list.push({ x, z }); break;
    }
  };
  place(trees, 6 + int(0, 3));
  place(rocks, 4 + int(0, 2));

  return { islands, bridges, portals, ground, trees, rocks };
}

function toLevel(spec: GeneratedLevelSpec, waves: WaveDef[], seed: number): LevelDef {
  const g = layoutOnce(spec, seed);
  // legend: one char per (platform, elevation, kind)
  const legend: Record<string, LegendEntry> = {};
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const charOf = new Map<string, string>();
  const rows: string[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => '.'));
  for (const [k, c] of g.ground) {
    const [x, z] = k.split(',').map(Number) as [number, number];
    const lk = `${c.island.platformId}|${c.elevation}|${c.kind}`;
    let ch = charOf.get(lk);
    if (!ch) {
      ch = chars[charOf.size]!;
      charOf.set(lk, ch);
      legend[ch] = {
        platformId: c.island.platformId, elevation: c.elevation as never,
        ...(c.kind === 'flat' ? { flat: true } : c.kind === 'plateau' ? { plateau: true, stone: c.island.side === 'C' } : { pillar: true }),
        ...(c.island.side === 'C' && c.kind === 'flat' ? { stone: false } : {}),
      };
    }
    rows[z]![x] = ch;
  }
  const names = ISLAND_NAMES[spec.theme];
  const platformNames: Record<string, string> = { P_C: '中央浮島' };
  for (const o of g.islands) if (o.side !== 'C') platformNames[o.platformId] = `${SIDE_NAMES[o.side as Side]}${names[['N', 'E', 'S', 'W'].indexOf(o.side)]!}`;
  const editZones: Rect[] = g.islands.map((o) => ({ x0: o.rect.x0 + 1, x1: o.rect.x1 - 1, z0: o.rect.z0 + 1, z1: o.rect.z1 - 1 }));
  const level = buildLevel({
    id: spec.id, name: spec.name, subtitle: spec.subtitle, theme: spec.theme,
    width: SIZE, depth: SIZE,
    map: rows.map((r) => r.join('')),
    legend, platformNames, editZones,
    portals: g.portals,
    connectors: g.bridges.map((b) => ({ id: b.id, name: b.name, kind: b.kind, cells: b.cells, deckElevations: b.deckElevations })),
    core: { x0: CORE_X0, z0: CORE_Z0, approaches: [[CORE_X0 - 1, CORE_Z0 + 1], [CORE_X0 + 3, CORE_Z0 + 1], [CORE_X0 + 1, CORE_Z0 - 1], [CORE_X0 + 1, CORE_Z0 + 3]], maxHp: spec.coreHp ?? 20 },
    trees: g.trees, rocks: g.rocks,
    initialGold: spec.initialGold,
    maxShortestPathCost: 260,
    waves: waves.map((w) => ({ ...w, entries: w.entries.map((e) => ({ ...e, portalIds: e.portalIds.filter((p) => g.portals.some((q) => q.id === p)) })) })),
  });
  return spec.weather && spec.weather !== 'clear' ? { ...level, weather: spec.weather } : level;
}

/** Wave list from a plan: kinds join in roster order, budgets grow, bosses on their waves. */
export function planWaves(plan: WavePlan, portalCount: number): WaveDef[] {
  const portals = PORTAL_IDS.slice(0, portalCount).split('');
  const out: WaveDef[] = [];
  const N = plan.waves;
  for (let n = 0; n < N; n++) {
    const t = N === 1 ? 1 : n / (N - 1);
    const unlocked = plan.roster.slice(0, Math.min(plan.roster.length, 3 + Math.ceil(n * (plan.roster.length - 3) / Math.max(1, N - 2))));
    const kinds = Math.min(unlocked.length, 3 + Math.floor(n / 2));
    // the newest kind always appears (it is what this wave teaches); the rest rotate
    const picks: EnemyKind[] = [unlocked[unlocked.length - 1]!];
    for (let j = 0; picks.length < kinds && j < unlocked.length * 2; j++) {
      const k = unlocked[(n * 2 + j) % unlocked.length]!;
      if (!picks.includes(k)) picks.push(k);
    }
    picks.reverse();
    const budget = (50 + 50 * t) * (plan.density ?? 1) * (1 + 0.3 * (portalCount - 2));
    const entries = picks.map((k, j) => {
      // flyers skip the maze, so they come in smaller flights
      const weight = Math.sqrt(ENEMY_DEFS[k].hp / 90) * (ENEMY_DEFS[k].flying ? 2.2 : 1);
      const per = Math.max(1, Math.round(budget / picks.length / weight / portalCount));
      return { enemyKind: k, count: per * portalCount, portalIds: portals, intervalTicks: 40, ...(j ? { delayTicks: 60 } : {}) };
    });
    const boss = n === N - 1 ? plan.finalBoss : plan.midBosses?.[n];
    if (boss) entries.splice(Math.ceil(entries.length / 2), 0, { enemyKind: boss, count: 1, portalIds: [portals[n % portals.length]!], intervalTicks: 1, delayTicks: 120 });
    const hpScale = Math.round((plan.hp[0] + (plan.hp[1] - plan.hp[0]) * t) * 100) / 100;
    out.push(paced({ id: `w${n + 1}`, hpScale, clearGold: n === N - 1 ? 0 : 100 + 15 * n, entries }, portals, plan.minSeconds ?? 125));
  }
  return out;
}

/** One attempt at exactly this seed (the level editor: overrides only make sense for one layout). */
export function tryGenerateLevel(spec: GeneratedLevelSpec): { ok: true; level: LevelDef } | { ok: false; errors: string[]; level: LevelDef | null } {
  const portalCount = spec.layout.sides.reduce((n, s) => n + (spec.layout.portals?.[s] ?? 1), 0);
  let level: LevelDef;
  try {
    level = toLevel(spec, planWaves(spec.plan, portalCount), spec.seed);
  } catch (e) {
    return { ok: false, errors: [String((e as Error).message ?? e)], level: null };
  }
  const v = validateLevel(level);
  return v.ok ? { ok: true, level } : { ok: false, errors: v.errors, level };
}

const generated = new Map<string, LevelDef>();

/** Deterministically generate a valid level from a descriptor (tries successive seeds). */
export function generateLevel(spec: GeneratedLevelSpec): LevelDef {
  const cacheKey = `${spec.id}:${spec.seed}`;
  const hit = generated.get(cacheKey);
  if (hit) return hit;
  const portalCount = spec.layout.sides.reduce((n, s) => n + (spec.layout.portals?.[s] ?? 1), 0);
  const waves = planWaves(spec.plan, portalCount);
  let lastErr: string[] = [];
  for (let k = 0; k < 40; k++) {
    const level = toLevel(spec, waves, spec.seed + k * 7919);
    const v = validateLevel(level);
    if (v.ok) {
      const routes = computeRoutes(level, { editedElevations: {}, towers: [], walls: [] });
      if (routes.ok) {
        const longest = Math.max(...Object.values(routes.routes).map((r) => r.length));
        void longest;
        const final = level;
        generated.set(cacheKey, final);
        return final;
      }
    }
    lastErr = v.errors;
  }
  throw new Error(`could not generate ${spec.id}: ${lastErr.slice(0, 3).join('; ')}`);
}
