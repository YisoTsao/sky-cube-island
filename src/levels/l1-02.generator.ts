import type { EnemyKind, LevelDef, WaveDef } from '../domain/types';
import { buildLevel, group, type LegendEntry } from './builder';
import {
  L1_02_CONNECTORS, L1_02_CORE, L1_02_EDIT_ZONES, L1_02_MAP, L1_02_PORTALS, L1_02_ROCKS, L1_02_TREES,
} from './l1-02.definition';

type Portal = 'A' | 'B' | 'C';
const ABC: Portal[] = ['A', 'B', 'C'];
const AB: Portal[] = ['A', 'B'];
const BC: Portal[] = ['B', 'C'];
const AC: Portal[] = ['A', 'C'];
const g = (kind: EnemyKind, count: number, portals: Portal[], every: number, delay = 0) => group(kind, count, portals, every, delay);

/**
 * L1-02 wave plan: six waves over three portals, 13 enemy kinds (plus the L1 boss as a guest in
 * the finale). Like L1-01, every wave keeps spawning for over two minutes and sends 90–200
 * enemies; the new kinds are introduced two per wave so each one gets its own moment.
 */
export const L1_02_WAVES: WaveDef[] = [
  // w1 — warm-up; salamanders (ignore frost) and ghosts (resist frost) debut.
  { id: 'w1', hpScale: 0.8, clearGold: 80, entries: [
    g('slime', 18, ABC, 66),
    g('runner', 9, ABC, 70, 100),
    g('salamander', 9, ABC, 90, 120),
    g('mini', 24, ABC, 30, 120),
    g('ghost', 9, ABC, 90, 120),
    g('slime', 18, ABC, 60, 100),
    g('runner', 12, ABC, 56, 100),
    g('salamander', 9, ABC, 86, 80),
  ] },
  // w2 — boars (enrage) and moles (burrow).
  { id: 'w2', hpScale: 0.95, clearGold: 100, entries: [
    g('slime', 18, ABC, 50),
    g('boar', 9, ABC, 90, 100),
    g('mole', 9, ABC, 90, 100),
    g('splitter', 6, ABC, 90, 100),
    g('mini', 21, ABC, 32, 100),
    g('ghost', 12, ABC, 66, 80),
    g('boar', 6, ABC, 90, 100),
    g('mole', 9, ABC, 76, 60),
    g('runner', 15, ABC, 46, 80),
  ] },
  // w3 — crystal crabs (resist everything) escorted by healers.
  { id: 'w3', hpScale: 1.4, clearGold: 110, entries: [
    g('runner', 18, ABC, 40),
    g('crab', 6, ABC, 120, 100),
    g('wisp', 6, ABC, 120, 60),
    g('slime', 24, ABC, 40, 100),
    g('salamander', 12, ABC, 60, 80),
    g('knight', 9, ABC, 90, 100),
    g('crab', 6, ABC, 100, 100),
    g('mini', 30, ABC, 22, 80),
    g('ghost', 12, ABC, 60, 60),
  ] },
  // w4 — mixed armour check: knights vs ghosts force a tower mix.
  { id: 'w4', hpScale: 1.7, clearGold: 130, entries: [
    g('slime', 24, ABC, 36),
    g('knight', 9, AB, 90, 100),
    g('ghost', 15, ABC, 50, 60),
    g('golem', 6, ABC, 120, 100),
    g('mole', 12, ABC, 60, 80),
    g('splitter', 12, ABC, 70, 100),
    g('boar', 12, ABC, 60, 80),
    g('wisp', 6, BC, 100, 60),
    g('mini', 30, ABC, 20, 80),
    g('salamander', 12, ABC, 50, 60),
  ] },
  // w5 — the long push: every mechanic at once.
  { id: 'w5', hpScale: 2.0, clearGold: 150, entries: [
    g('runner', 24, ABC, 30),
    g('crab', 9, ABC, 90, 80),
    g('knight', 9, ABC, 90, 60),
    g('ghost', 15, ABC, 50, 80),
    g('boar', 12, ABC, 60, 80),
    g('golem', 9, ABC, 90, 80),
    g('wisp', 6, ABC, 90, 60),
    g('mole', 15, ABC, 50, 80),
    g('mini', 36, ABC, 18, 80),
    g('salamander', 15, ABC, 40, 60),
  ] },
  // w6 — finale: the Slime Queen from the north/west, the Rock King from the south.
  { id: 'w6', hpScale: 1.7, clearGold: 0, entries: [
    g('slime', 30, ABC, 34),
    g('ghost', 12, ABC, 56, 80),
    g('crab', 6, ABC, 90, 80),
    g('boar', 9, ABC, 66, 60),
    g('wisp', 6, ABC, 80, 60),
    g('queen', 2, AC, 1, 120),
    g('boss', 1, ['B'], 1, 120),
    g('mole', 12, ABC, 50, 80),
    g('knight', 6, ABC, 80, 60),
    g('salamander', 12, ABC, 46, 60),
    g('splitter', 9, ABC, 56, 60),
    g('runner', 18, ABC, 34, 60),
  ] },
];

const L1_02_LEGEND: Record<string, LegendEntry> = {
  l: { platformId: 'P_WEST', elevation: 0, flat: true },
  L: { platformId: 'P_WEST', elevation: 1, plateau: true },
  n: { platformId: 'P_NORTH', elevation: 2, flat: true },
  N: { platformId: 'P_NORTH', elevation: 3, plateau: true, stone: true },
  m: { platformId: 'P_SOUTH', elevation: 2, flat: true },
  M: { platformId: 'P_SOUTH', elevation: 3, plateau: true },
  '#': { platformId: 'P_SOUTH', elevation: 5, pillar: true },
  h: { platformId: 'P_HIGH', elevation: 4, flat: true },
  H: { platformId: 'P_HIGH', elevation: 5, plateau: true, stone: true },
};

/** Deterministically generate the L1-02 LevelDef from the authoring map. */
export function generateL1_02(): LevelDef {
  return buildLevel({
    id: 'L1-02',
    name: '霧谷晶石群島',
    subtitle: '三道裂隙・黃昏的四座島',
    theme: 'dusk',
    width: 32,
    depth: 32,
    map: L1_02_MAP,
    legend: L1_02_LEGEND,
    platformNames: { P_WEST: '西岸低地', P_NORTH: '北嶺台地', P_SOUTH: '南谷', P_HIGH: '晶石高原' },
    editZones: L1_02_EDIT_ZONES,
    portals: L1_02_PORTALS,
    connectors: L1_02_CONNECTORS,
    core: { ...L1_02_CORE, maxHp: 20 },
    trees: L1_02_TREES,
    rocks: L1_02_ROCKS,
    initialGold: 400,
    maxShortestPathCost: 200,
    waves: L1_02_WAVES,
  });
}
