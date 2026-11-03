import type { EnemyKind, LevelDef, WaveDef } from '../domain/types';
import { buildLevel, cellIdAt, group, type LegendEntry } from './builder';
import {
  L1_01_CONNECTORS, L1_01_CORE, L1_01_EDIT_ZONES, L1_01_MAP, L1_01_PORTALS, L1_01_ROCKS, L1_01_TREES,
} from './l1-01.definition';

export { cellIdAt };

type Portal = 'A' | 'B';
const AB: Portal[] = ['A', 'B'];
/** Spawn group helper: `count` enemies round-robin over `portals`, `every` ticks apart per portal. */
const g = (kind: EnemyKind, count: number, portals: Portal[], every: number, delay = 0) => group(kind, count, portals, every, delay);

/**
 * v2.3: ten enemy kinds (boars and ghosts join from wave 2/3).
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
    g('boar', 4, AB, 90, 120),
    g('splitter', 6, AB, 70, 120),
    g('runner', 14, AB, 30, 120),
  ] },
  { id: 'w3', hpScale: 1.5, clearGold: 100, entries: [
    g('runner', 16, AB, 30),
    g('knight', 6, AB, 90, 120),
    g('slime', 20, AB, 36, 100),
    g('wisp', 4, AB, 120, 60),
    g('ghost', 6, AB, 80, 100),
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
    g('runner', 18, AB, 22, 120),
    g('boar', 6, AB, 70, 100),
    g('golem', 8, AB, 80, 120),
    g('ghost', 6, AB, 70, 80),
    g('mini', 36, AB, 14, 100),
    g('knight', 8, AB, 60, 120),
    g('wisp', 6, AB, 70),
  ] },
  { id: 'w5', hpScale: 2.1, clearGold: 0, entries: [
    g('slime', 18, AB, 30),
    g('runner', 20, AB, 26, 80),
    g('knight', 10, AB, 60, 100),
    g('wisp', 6, AB, 70),
    g('splitter', 12, AB, 50, 100),
    g('ghost', 6, AB, 60, 60),
    g('golem', 10, AB, 70, 100),
    g('mini', 40, AB, 12, 80),
    g('boss', 1, ['A'], 1, 120),
    g('boss', 1, ['B'], 1, 120),
    g('knight', 8, AB, 60, 60),
    g('wisp', 6, AB, 60),
    g('runner', 16, AB, 22, 60),
  ] },
];

const L1_01_LEGEND: Record<string, LegendEntry> = {
  l: { platformId: 'P_LOW', elevation: 0, flat: true },
  L: { platformId: 'P_LOW', elevation: 1, plateau: true },
  m: { platformId: 'P_MID', elevation: 2, flat: true },
  M: { platformId: 'P_MID', elevation: 3, plateau: true },
  '#': { platformId: 'P_MID', elevation: 5, pillar: true },
  h: { platformId: 'P_HIGH', elevation: 4, flat: true },
  H: { platformId: 'P_HIGH', elevation: 5, plateau: true },
};

/** Deterministically generate the L1-01 LevelDef from the authoring map. */
export function generateL1_01(): LevelDef {
  return buildLevel({
    id: 'L1-01',
    name: '天空斷崖島',
    subtitle: '漂浮的三座島',
    width: 32,
    depth: 32,
    map: L1_01_MAP,
    legend: L1_01_LEGEND,
    platformNames: { P_LOW: '低平台', P_MID: '中平台', P_HIGH: '高平台' },
    editZones: L1_01_EDIT_ZONES,
    portals: L1_01_PORTALS,
    connectors: L1_01_CONNECTORS,
    core: { ...L1_01_CORE, maxHp: 20 },
    trees: L1_01_TREES,
    rocks: L1_01_ROCKS,
    initialGold: 300,
    maxShortestPathCost: 160,
    waves: L1_01_WAVES,
  });
}
