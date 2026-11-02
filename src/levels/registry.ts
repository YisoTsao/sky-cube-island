import type { LevelDef } from '../domain/types';
import { generateL1_01 } from './l1-01.generator';
import { generateL1_02 } from './l1-02.generator';
import { generateL1_03 } from './l1-03.generator';
import { generateL1_04 } from './l1-04.generator';

/** Campaign order. A level unlocks once the previous one has been cleared. */
export const LEVEL_IDS = ['L1-01', 'L1-02', 'L1-03', 'L1-04'] as const;
export type LevelId = (typeof LEVEL_IDS)[number];

const GENERATORS: Record<LevelId, () => LevelDef> = {
  'L1-01': generateL1_01,
  'L1-02': generateL1_02,
  'L1-03': generateL1_03,
  'L1-04': generateL1_04,
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

export function nextLevelId(id: string): LevelId | null {
  const i = (LEVEL_IDS as readonly string[]).indexOf(id);
  return i >= 0 && i + 1 < LEVEL_IDS.length ? LEVEL_IDS[i + 1]! : null;
}
