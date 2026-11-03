import type { LevelDef } from '../domain/types';
import { generateL1_01 } from './l1-01.generator';
import { generateL1_02 } from './l1-02.generator';
import { generateL1_03 } from './l1-03.generator';
import { generateL1_04 } from './l1-04.generator';
import { baseIdOf, isEndlessId, makeEndlessLevel } from './endless';
import { GENERATED_SPECS } from './campaign';
import { generateLevel } from './procgen';

/** Campaign order (3 chapters × 5 islands). A level unlocks once the previous one has been cleared. */
export const LEVEL_IDS = [
  'L1-01', 'L1-02', 'L1-03', 'L1-04', 'L1-05',
  'L2-01', 'L2-02', 'L2-03', 'L2-04', 'L2-05',
  'L3-01', 'L3-02', 'L3-03', 'L3-04', 'L3-05',
] as const;
export type LevelId = (typeof LEVEL_IDS)[number];

const generated = (id: LevelId) => () => generateLevel(GENERATED_SPECS.find((s) => s.id === id)!);
const GENERATORS: Record<LevelId, () => LevelDef> = {
  'L1-01': generateL1_01,
  'L1-02': generateL1_02,
  'L1-03': generateL1_03,
  'L1-04': generateL1_04,
  ...Object.fromEntries(LEVEL_IDS.slice(4).map((id) => [id, generated(id)])) as Record<Exclude<LevelId, 'L1-01' | 'L1-02' | 'L1-03' | 'L1-04'>, () => LevelDef>,
};

const cache = new Map<string, LevelDef>();

export function isLevelId(id: string): id is LevelId {
  return (LEVEL_IDS as readonly string[]).includes(id);
}

export function getLevel(id: LevelId): LevelDef {
  let l = cache.get(id);
  if (!l) { l = GENERATORS[id](); cache.set(id, l); }
  return l;
}

/** A campaign level or its endless variant (`L1-02-E`). */
export function isPlayableId(id: string): boolean {
  return isLevelId(id) || (isEndlessId(id) && isLevelId(baseIdOf(id)));
}

export function getPlayableLevel(id: string): LevelDef {
  if (isLevelId(id)) return getLevel(id);
  const base = baseIdOf(id);
  if (isEndlessId(id) && isLevelId(base)) return makeEndlessLevel(getLevel(base));
  throw new Error(`unknown level ${id}`);
}

export function nextLevelId(id: string): LevelId | null {
  const i = (LEVEL_IDS as readonly string[]).indexOf(id);
  return i >= 0 && i + 1 < LEVEL_IDS.length ? LEVEL_IDS[i + 1]! : null;
}
