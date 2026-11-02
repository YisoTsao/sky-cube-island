import type { EnemyKind, LevelDef, WaveDef } from '../domain/types';
import { buildLevel, group, paced, type LegendEntry } from './builder';
import {
  L1_03_CONNECTORS, L1_03_CORE, L1_03_EDIT_ZONES, L1_03_MAP, L1_03_PORTALS, L1_03_ROCKS, L1_03_TREES,
} from './l1-03.definition';

type Portal = 'A' | 'B' | 'C';
const ABC: Portal[] = ['A', 'B', 'C'];
const AC: Portal[] = ['A', 'C'];
const g = (kind: EnemyKind, count: number, portals: Portal[], every: number, delay = 0) => group(kind, count, portals, every, delay);

/**
 * L1-03 wave plan: six waves, three portals. Introduces bats (swarms), yetis (slow-immune,
 * magic-resistant) and shield shamans, and ends with the Frost Giant.
 */
const RAW_WAVES: WaveDef[] = [
  // w1 — bat swarms and slimes on the snow.
  { id: 'w1', hpScale: 0.7, clearGold: 90, entries: [
    g('slime', 21, ABC, 80),
    g('bat', 12, ABC, 70, 120),
    g('slime', 18, ABC, 80, 120),
    g('mini', 18, ABC, 44, 120),
    g('bat', 12, ABC, 60, 120),
    g('runner', 12, ABC, 80, 100),
  ] },
  // w2 — yetis shrug off frost; mix in ghosts so pure-arrow builds also struggle.
  { id: 'w2', hpScale: 0.85, clearGold: 120, entries: [
    g('runner', 15, ABC, 50),
    g('yeti', 3, ABC, 160, 100),
    g('slime', 12, ABC, 70, 60),
    g('ghost', 6, ABC, 100, 100),
    g('bat', 21, ABC, 34, 80),
    g('splitter', 6, ABC, 90, 100),
    g('mini', 18, ABC, 34, 80),
    g('yeti', 3, ABC, 140, 80),
    g('slime', 18, ABC, 50, 80),
  ] },
  // w3 — shield shamans escort knights and golems.
  { id: 'w3', hpScale: 1.1, clearGold: 120, entries: [
    g('slime', 21, ABC, 44),
    g('shaman', 6, ABC, 120, 100),
    g('knight', 9, ABC, 90, 60),
    g('bat', 24, ABC, 30, 80),
    g('golem', 6, ABC, 120, 80),
    g('shaman', 6, ABC, 100, 80),
    g('mole', 9, ABC, 80, 60),
    g('runner', 15, ABC, 40, 80),
  ] },
  // w4 — healers + shields make a sturdy blob.
  { id: 'w4', hpScale: 1.25, clearGold: 140, entries: [
    g('runner', 18, ABC, 40),
    g('yeti', 9, ABC, 90, 80),
    g('wisp', 6, ABC, 110, 60),
    g('shaman', 6, ABC, 100, 60),
    g('ghost', 12, ABC, 60, 80),
    g('crab', 6, ABC, 110, 80),
    g('bat', 30, ABC, 24, 80),
    g('splitter', 9, ABC, 70, 80),
  ] },
  // w5 — everything the snow can throw.
  { id: 'w5', hpScale: 1.4, clearGold: 160, entries: [
    g('slime', 24, ABC, 36),
    g('knight', 9, ABC, 80, 80),
    g('yeti', 9, ABC, 80, 80),
    g('shaman', 9, ABC, 80, 60),
    g('mole', 12, ABC, 60, 80),
    g('bat', 30, ABC, 22, 60),
    g('golem', 6, ABC, 110, 80),
    g('wisp', 6, ABC, 90, 60),
    g('mini', 24, ABC, 26, 60),
  ] },
  // w6 — the Frost Giant marches with two shamans at its side.
  { id: 'w6', hpScale: 1.45, clearGold: 0, entries: [
    g('runner', 24, ABC, 34),
    g('yeti', 9, ABC, 80, 80),
    g('ghost', 12, ABC, 60, 60),
    g('bat', 30, ABC, 24, 60),
    g('frostGiant', 2, AC, 1, 120),
    g('shaman', 6, ABC, 40, 0),
    g('knight', 9, ABC, 70, 80),
    g('crab', 6, ABC, 90, 60),
    g('splitter', 9, ABC, 60, 60),
    g('slime', 18, ABC, 40, 60),
  ] },
];

/** Final waves: every wave keeps spawning for 2+ minutes. */
export const L1_03_WAVES: WaveDef[] = RAW_WAVES.map((w) => paced(w, ['A', 'B', 'C']));

const L1_03_LEGEND: Record<string, LegendEntry> = {
  l: { platformId: 'P_NW', elevation: 0, flat: true },
  L: { platformId: 'P_NW', elevation: 1, plateau: true },
  w: { platformId: 'P_W', elevation: 2, flat: true },
  W: { platformId: 'P_W', elevation: 3, plateau: true, stone: true },
  n: { platformId: 'P_NE', elevation: 2, flat: true },
  N: { platformId: 'P_NE', elevation: 3, plateau: true, stone: true },
  e: { platformId: 'P_E', elevation: 3, flat: true },
  E: { platformId: 'P_E', elevation: 4, plateau: true, stone: true },
  c: { platformId: 'P_S', elevation: 1, flat: true },
  C: { platformId: 'P_S', elevation: 2, plateau: true },
  '#': { platformId: 'P_S', elevation: 5, pillar: true },
  h: { platformId: 'P_PEAK', elevation: 4, flat: true },
  H: { platformId: 'P_PEAK', elevation: 5, plateau: true, stone: true },
};

/** Deterministically generate the L1-03 LevelDef from the authoring map. */
export function generateL1_03(): LevelDef {
  return buildLevel({
    id: 'L1-03',
    name: '冰封雪峰',
    subtitle: '風雪中的五座冰島',
    theme: 'snow',
    width: 32,
    depth: 32,
    map: L1_03_MAP,
    legend: L1_03_LEGEND,
    platformNames: { P_NW: '西北雪原', P_W: '西側冰棚', P_NE: '東北山脊', P_E: '東側冰川', P_S: '南方雪谷', P_PEAK: '峰頂' },
    editZones: L1_03_EDIT_ZONES,
    portals: L1_03_PORTALS,
    connectors: L1_03_CONNECTORS,
    core: { ...L1_03_CORE, maxHp: 20 },
    trees: L1_03_TREES,
    rocks: L1_03_ROCKS,
    initialGold: 560,
    maxShortestPathCost: 200,
    waves: L1_03_WAVES,
  });
}
