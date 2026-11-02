import type { EnemyKind, LevelDef, WaveDef } from '../domain/types';
import { buildLevel, group, paced, type LegendEntry } from './builder';
import {
  L1_04_CONNECTORS, L1_04_CORE, L1_04_EDIT_ZONES, L1_04_MAP, L1_04_PORTALS, L1_04_ROCKS, L1_04_TREES,
} from './l1-04.definition';

type Portal = 'A' | 'B' | 'C' | 'D';
const ALL: Portal[] = ['A', 'B', 'C', 'D'];
const BC: Portal[] = ['B', 'C'];
const g = (kind: EnemyKind, count: number, portals: Portal[], every: number, delay = 0) => group(kind, count, portals, every, delay);

/**
 * L1-04 wave plan: seven waves from four portals. Lava imps join the full roster, the Slime Queen
 * and Rock King return as mid-bosses, and the finale is the Phoenix, which rises once after dying.
 */
const RAW_WAVES: WaveDef[] = [
  // w1 — imps and runners test the outer walls.
  { id: 'w1', hpScale: 0.6, clearGold: 100, entries: [
    g('slime', 24, ALL, 80),
    g('imp', 8, ALL, 80, 100),
    g('runner', 16, ALL, 64, 100),
    g('bat', 24, ALL, 44, 100),
    g('mini', 16, ALL, 40, 80),
    g('imp', 8, ALL, 70, 80),
    g('salamander', 8, ALL, 70, 80),
  ] },
  // w2 — boars and moles break through while splitters soak shots.
  { id: 'w2', hpScale: 0.7, clearGold: 120, entries: [
    g('slime', 28, ALL, 50),
    g('boar', 4, ALL, 110, 100),
    g('mole', 4, ALL, 100, 80),
    g('imp', 8, ALL, 60, 80),
    g('splitter', 8, ALL, 100, 80),
    g('bat', 28, ALL, 36, 80),
    g('salamander', 12, BC, 60, 60),
  ] },
  // w3 — armour check: knights, crabs, ghosts with shaman support.
  { id: 'w3', hpScale: 1.1, clearGold: 130, entries: [
    g('runner', 16, ALL, 56),
    g('knight', 8, ALL, 110, 100),
    g('ghost', 12, ALL, 80, 80),
    g('shaman', 8, ALL, 110, 60),
    g('crab', 8, ALL, 110, 80),
    g('imp', 12, ALL, 70, 80),
    g('bat', 28, ALL, 34, 60),
  ] },
  // w4 — the Slime Queen returns from the north gates.
  { id: 'w4', hpScale: 1.25, clearGold: 150, entries: [
    g('slime', 24, ALL, 46),
    g('splitter', 8, ALL, 90, 80),
    g('wisp', 8, ALL, 100, 60),
    g('queen', 1, ['A'], 1, 120),
    g('boar', 8, ALL, 90, 80),
    g('mini', 24, ALL, 30, 60),
    g('imp', 16, ALL, 50, 60),
    g('mole', 8, ALL, 80, 60),
  ] },
  // w5 — the Rock King and yetis grind forward.
  { id: 'w5', hpScale: 1.4, clearGold: 170, entries: [
    g('runner', 24, ALL, 46),
    g('bat', 16, ALL, 40, 60),
    g('golem', 8, ALL, 100, 80),
    g('yeti', 8, ALL, 100, 60),
    g('boss', 1, ['B'], 1, 120),
    g('shaman', 8, ALL, 90, 60),
    g('ghost', 12, ALL, 60, 60),
    g('salamander', 16, ALL, 46, 60),
    g('crab', 8, ALL, 90, 60),
  ] },
  // w6 — everything at once.
  { id: 'w6', hpScale: 1.55, clearGold: 190, entries: [
    g('imp', 24, ALL, 36),
    g('knight', 8, ALL, 90, 60),
    g('bat', 32, ALL, 24, 60),
    g('boar', 8, ALL, 90, 60),
    g('wisp', 8, ALL, 90, 60),
    g('shaman', 8, ALL, 90, 60),
    g('mole', 12, ALL, 60, 60),
    g('splitter', 8, ALL, 80, 60),
    g('ghost', 12, ALL, 56, 60),
  ] },
  // w7 — the Phoenix descends; it rises once more after its first death.
  { id: 'w7', hpScale: 1.35, clearGold: 0, entries: [
    g('slime', 24, ALL, 44),
    g('imp', 16, ALL, 50, 60),
    g('crab', 8, ALL, 90, 60),
    g('phoenix', 1, ['C'], 1, 140),
    g('shaman', 8, ALL, 60, 0),
    g('yeti', 8, ALL, 90, 60),
    g('boar', 8, ALL, 80, 60),
    g('bat', 24, ALL, 30, 60),
    g('runner', 16, ALL, 40, 60),
  ] },
];

/** Final waves: every wave keeps spawning for 2+ minutes. */
export const L1_04_WAVES: WaveDef[] = RAW_WAVES.map((w) => paced(w, ['A', 'B', 'C', 'D']));

const L1_04_LEGEND: Record<string, LegendEntry> = {
  n: { platformId: 'P_N', elevation: 2, flat: true },
  N: { platformId: 'P_N', elevation: 3, plateau: true, stone: true },
  l: { platformId: 'P_W', elevation: 0, flat: true },
  L: { platformId: 'P_W', elevation: 1, plateau: true },
  e: { platformId: 'P_E', elevation: 1, flat: true },
  E: { platformId: 'P_E', elevation: 2, plateau: true, stone: true },
  s: { platformId: 'P_S', elevation: 2, flat: true },
  S: { platformId: 'P_S', elevation: 3, plateau: true, stone: true },
  '#': { platformId: 'P_S', elevation: 5, pillar: true },
  h: { platformId: 'P_KEEP', elevation: 4, flat: true, stone: true },
  H: { platformId: 'P_KEEP', elevation: 5, plateau: true, stone: true },
};

/** Deterministically generate the L1-04 LevelDef from the authoring map. */
export function generateL1_04(): LevelDef {
  return buildLevel({
    id: 'L1-04',
    name: '熔岩天空城',
    subtitle: '四座城門・火山上的最終決戰',
    theme: 'ember',
    width: 32,
    depth: 32,
    map: L1_04_MAP,
    legend: L1_04_LEGEND,
    platformNames: { P_N: '北城牆', P_W: '西崖', P_E: '東台', P_S: '南區', P_KEEP: '天空城堡' },
    editZones: L1_04_EDIT_ZONES,
    portals: L1_04_PORTALS,
    connectors: L1_04_CONNECTORS,
    core: { ...L1_04_CORE, maxHp: 20 },
    trees: L1_04_TREES,
    rocks: L1_04_ROCKS,
    initialGold: 480,
    maxShortestPathCost: 220,
    waves: L1_04_WAVES,
  });
}
