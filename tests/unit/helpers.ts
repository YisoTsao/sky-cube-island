import { generateL1_01, cellIdAt } from '../../src/levels/l1-01.generator';
import { createInitialState } from '../../src/simulation/engine';
import type { GameState, LevelDef } from '../../src/domain/types';

export const level: LevelDef = generateL1_01();
export const fresh = (): GameState => createInitialState(level, 7);
export const cid = cellIdAt;
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
