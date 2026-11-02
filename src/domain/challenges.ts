import type { GameState, LevelDef, TowerKind } from './types';

/**
 * Per-level optional challenges (GDD §16 T1). They only READ the run log and the final state;
 * they never change any game rule. The run log lives in GameState.run (updated by commands,
 * reverted by undo, carried by saves) so a resumed checkpoint keeps its progress.
 */
export interface RunLog {
  wallsPlaced: number;
  terrainEdits: number;
  towersSold: number;
  upgrades: number;
  maxTowers: number;
  kindsBuilt: TowerKind[];
}

export const emptyRunLog = (): RunLog => ({ wallsPlaced: 0, terrainEdits: 0, towersSold: 0, upgrades: 0, maxTowers: 0, kindsBuilt: [] });

export type ChallengeRule =
  | { kind: 'coreAtLeast'; hp: number }
  | { kind: 'noWalls' }
  | { kind: 'noTerrain' }
  | { kind: 'noSell' }
  | { kind: 'maxTowers'; count: number }
  | { kind: 'maxUpgrades'; count: number }
  | { kind: 'onlyKinds'; kinds: TowerKind[] };

export interface ChallengeDef { id: string; label: string; rule: ChallengeRule }

const TOWER_NAME: Record<TowerKind, string> = { arrow: '箭塔', frost: '冰晶塔', cannon: '砲塔', lightning: '雷光塔', wind: '風車塔' };

function label(rule: ChallengeRule, maxHp: number): string {
  switch (rule.kind) {
    case 'coreAtLeast': return rule.hp >= maxHp ? '守護之心毫髮無傷' : `守護之心保留 ${rule.hp} 以上生命`;
    case 'noWalls': return '不放任何木牆通關';
    case 'noTerrain': return '不改動任何地形通關';
    case 'noSell': return '不出售任何塔通關';
    case 'maxTowers': return `同時最多只有 ${rule.count} 座塔`;
    case 'maxUpgrades': return `升級次數不超過 ${rule.count} 次`;
    case 'onlyKinds': return `只用${rule.kinds.map((k) => TOWER_NAME[k]).join('、')}`;
  }
}

const RULES: Record<string, ChallengeRule[]> = {
  'L1-01': [{ kind: 'coreAtLeast', hp: 20 }, { kind: 'noWalls' }, { kind: 'maxTowers', count: 8 }],
  'L1-02': [{ kind: 'coreAtLeast', hp: 15 }, { kind: 'noTerrain' }, { kind: 'onlyKinds', kinds: ['arrow', 'frost', 'cannon'] }],
  'L1-03': [{ kind: 'coreAtLeast', hp: 12 }, { kind: 'noWalls' }, { kind: 'maxUpgrades', count: 6 }],
  'L1-04': [{ kind: 'coreAtLeast', hp: 10 }, { kind: 'noSell' }, { kind: 'maxTowers', count: 12 }],
};

export function challengesFor(level: Pick<LevelDef, 'id' | 'core'>): ChallengeDef[] {
  return (RULES[level.id] ?? []).map((rule, i) => ({ id: `${level.id}#${i + 1}`, label: label(rule, level.core.maxHp), rule }));
}

/** True when the challenge holds for this state (use at VICTORY; mid-run it means "still on track"). */
export function challengeMet(c: ChallengeDef, state: Pick<GameState, 'coreHp' | 'run'>): boolean {
  const run = state.run ?? emptyRunLog();
  const r = c.rule;
  switch (r.kind) {
    case 'coreAtLeast': return state.coreHp >= r.hp;
    case 'noWalls': return run.wallsPlaced === 0;
    case 'noTerrain': return run.terrainEdits === 0;
    case 'noSell': return run.towersSold === 0;
    case 'maxTowers': return run.maxTowers <= r.count;
    case 'maxUpgrades': return run.upgrades <= r.count;
    case 'onlyKinds': return run.kindsBuilt.every((k) => r.kinds.includes(k));
  }
}

/** Fold one successful command into the run log (pure). */
export function logCommand(run: RunLog | undefined, type: string, after: Pick<GameState, 'towers'>, kind?: TowerKind): RunLog {
  const r: RunLog = { ...(run ?? emptyRunLog()) };
  if (type === 'PLACE_WALL') r.wallsPlaced += 1;
  else if (type === 'SET_ELEVATION') r.terrainEdits += 1;
  else if (type === 'SELL_TOWER') r.towersSold += 1;
  else if (type === 'UPGRADE_TOWER') r.upgrades += 1;
  else if (type === 'BUILD_TOWER' && kind && !r.kindsBuilt.includes(kind)) r.kindsBuilt = [...r.kindsBuilt, kind];
  r.maxTowers = Math.max(r.maxTowers, after.towers.length);
  return r;
}
