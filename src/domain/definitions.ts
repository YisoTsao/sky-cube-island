import type { EnemyDef, EnemyInstance, EnemyKind, TowerDef, TowerKind, TowerLevel } from './types';

/** Fixed simulation rate (Tech §8.1). */
export const TPS = 20;
export const STEP_SECONDS = 1 / TPS;

/** GDD §7 — times stored in ticks (Tech §3.1: 0.80s=16, 1.35s=27, 2.60s=52, 1.8s=36). */
export const TOWER_DEFS: Record<TowerKind, TowerDef> = {
  arrow: {
    kind: 'arrow', name: '木製箭塔', buildCost: 70, baseDamage: 20, baseRangeWorld: 3.5,
    cooldownTicks: 16, damageType: 'physical', muzzleOffsetWorld: 1.6, projectileTicks: 4,
  },
  frost: {
    kind: 'frost', name: '冰晶塔', buildCost: 85, baseDamage: 16, baseRangeWorld: 2.8,
    cooldownTicks: 27, damageType: 'magic', muzzleOffsetWorld: 1.4, projectileTicks: 5,
    slow: { ratio: 0.3, durationTicks: 36 },
    // v2.8: the slow itself grows with the tower (30% / 38% / 45%).
    perLevel: { slowRatio: [0.3, 0.38, 0.45] },
  },
  cannon: {
    kind: 'cannon', name: '岩石砲塔', buildCost: 105, baseDamage: 45, baseRangeWorld: 3.1,
    cooldownTicks: 52, damageType: 'physical', muzzleOffsetWorld: 1.1, projectileTicks: 8,
    blastRadiusWorld: 1.05,
    // v2.8: the blast widens with each level.
    perLevel: { blastRadiusWorld: [1.05, 1.2, 1.35] },
  },
  // v2.5 (GDD §16 T2): chain lightning and knock-back wind.
  lightning: {
    kind: 'lightning', name: '雷光塔', buildCost: 115, baseDamage: 24, baseRangeWorld: 3.0,
    cooldownTicks: 34, damageType: 'magic', muzzleOffsetWorld: 1.7, projectileTicks: 1,
    chain: { jumps: 2, radiusWorld: 1.7, falloff: 0.75 },
  },
  wind: {
    kind: 'wind', name: '風車塔', buildCost: 95, baseDamage: 8, baseRangeWorld: 2.6,
    cooldownTicks: 56, damageType: 'physical', muzzleOffsetWorld: 1.5, projectileTicks: 2,
    knockback: { cells: 0.9, perLevel: 0.3, immuneTicks: 70, maxTargets: 4 },
  },
};

/** GDD §8 (+ v2.2 roster expansion: swarms, splitters, armour, healers and a boss). */
export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  slime: { kind: 'slime', name: '綠史萊姆', hp: 90, speedCellsPerSecond: 1.0, coreDamage: 1, goldReward: 4, physicalResistance: 0, targetOffsetWorld: 0.30 },
  runner: { kind: 'runner', name: '疾風獸', hp: 60, speedCellsPerSecond: 1.65, coreDamage: 1, goldReward: 4, physicalResistance: 0, targetOffsetWorld: 0.35 },
  golem: { kind: 'golem', name: '石殼巨人', hp: 320, speedCellsPerSecond: 0.62, coreDamage: 3, goldReward: 10, physicalResistance: 0.2, targetOffsetWorld: 0.55, knockbackResistance: 0.3 },
  mini: { kind: 'mini', name: '小果凍', hp: 30, speedCellsPerSecond: 1.3, coreDamage: 1, goldReward: 1, physicalResistance: 0, targetOffsetWorld: 0.2, scale: 0.6 },
  splitter: {
    kind: 'splitter', name: '分裂史萊姆', hp: 160, speedCellsPerSecond: 0.85, coreDamage: 2, goldReward: 5, physicalResistance: 0, targetOffsetWorld: 0.38,
    splitInto: { kind: 'mini', count: 3 }, scale: 1.25,
  },
  knight: { kind: 'knight', name: '鐵甲甲蟲', hp: 220, speedCellsPerSecond: 0.8, coreDamage: 2, goldReward: 9, physicalResistance: 0.5, targetOffsetWorld: 0.4 },
  wisp: {
    kind: 'wisp', name: '癒光精靈', hp: 110, speedCellsPerSecond: 1.1, coreDamage: 1, goldReward: 8, physicalResistance: 0, targetOffsetWorld: 0.55,
    healAura: { radiusWorld: 1.6, amount: 12, everyTicks: 40 },
  },
  boss: {
    kind: 'boss', name: '岩王巨像', hp: 1500, speedCellsPerSecond: 0.42, coreDamage: 5, goldReward: 100, physicalResistance: 0.25, targetOffsetWorld: 0.9,
    slowResistance: 0.5, scale: 1.7, knockbackResistance: 0.7,
  },
  // v2.3 roster: each level fields at least ten kinds.
  boar: {
    kind: 'boar', name: '狂暴野豬', hp: 200, speedCellsPerSecond: 0.9, coreDamage: 2, goldReward: 7, physicalResistance: 0.1, targetOffsetWorld: 0.42,
    enrage: { belowRatio: 0.5, speedMult: 1.8 },
  },
  ghost: {
    kind: 'ghost', name: '霧影幽靈', hp: 120, speedCellsPerSecond: 1.15, coreDamage: 1, goldReward: 6, physicalResistance: 0, magicResistance: 0.6, targetOffsetWorld: 0.55,
  },
  crab: {
    kind: 'crab', name: '晶殼蟹', hp: 260, speedCellsPerSecond: 0.7, coreDamage: 2, goldReward: 9, physicalResistance: 0.35, magicResistance: 0.35, targetOffsetWorld: 0.36,
    scale: 1.1, knockbackResistance: 0.3,
  },
  mole: {
    kind: 'mole', name: '鑽地鼴鼠', hp: 150, speedCellsPerSecond: 1.0, coreDamage: 1, goldReward: 6, physicalResistance: 0, targetOffsetWorld: 0.3,
    burrow: { cycleTicks: 100, underTicks: 40 },
  },
  salamander: {
    kind: 'salamander', name: '焰尾蜥蜴', hp: 140, speedCellsPerSecond: 1.35, coreDamage: 1, goldReward: 6, physicalResistance: 0, magicResistance: 0.25, targetOffsetWorld: 0.28,
    slowResistance: 1,
  },
  queen: {
    kind: 'queen', name: '史萊姆女王', hp: 1700, speedCellsPerSecond: 0.4, coreDamage: 5, goldReward: 120, physicalResistance: 0.15, targetOffsetWorld: 0.95,
    slowResistance: 0.5, splitInto: { kind: 'splitter', count: 3 }, scale: 1.9, knockbackResistance: 0.7,
  },
  // v2.4 roster (levels 3–4).
  bat: {
    kind: 'bat', name: '冰洞蝙蝠', hp: 45, speedCellsPerSecond: 1.9, coreDamage: 1, goldReward: 2, physicalResistance: 0, targetOffsetWorld: 0.7,
    scale: 0.85,
  },
  yeti: {
    kind: 'yeti', name: '雪原巨猿', hp: 380, speedCellsPerSecond: 0.75, coreDamage: 2, goldReward: 11, physicalResistance: 0.15, magicResistance: 0.4, targetOffsetWorld: 0.6,
    slowResistance: 1, scale: 1.1, knockbackResistance: 0.4,
  },
  shaman: {
    kind: 'shaman', name: '護盾薩滿', hp: 160, speedCellsPerSecond: 0.9, coreDamage: 1, goldReward: 9, physicalResistance: 0, targetOffsetWorld: 0.5,
    shieldAura: { radiusWorld: 1.8, reduction: 0.35 },
  },
  frostGiant: {
    kind: 'frostGiant', name: '冰霜巨人', hp: 2200, speedCellsPerSecond: 0.4, coreDamage: 5, goldReward: 130, physicalResistance: 0.3, magicResistance: 0.2, targetOffsetWorld: 0.95,
    slowResistance: 1, scale: 1.8, knockbackResistance: 0.8,
  },
  imp: {
    kind: 'imp', name: '熔岩小鬼', hp: 110, speedCellsPerSecond: 1.5, coreDamage: 1, goldReward: 5, physicalResistance: 0.3, targetOffsetWorld: 0.35,
    scale: 0.9,
  },
  phoenix: {
    kind: 'phoenix', name: '不死火鳥', hp: 2200, speedCellsPerSecond: 0.55, coreDamage: 5, goldReward: 150, physicalResistance: 0, magicResistance: 0.3, targetOffsetWorld: 1.0,
    slowResistance: 0.5, rebirth: { hpRatio: 0.6 }, scale: 1.5, knockbackResistance: 0.7,
  },
  // v2.7 roster (GDD §16 T2): a flyer that ignores the road and a ram that smashes wooden walls.
  wyvern: {
    kind: 'wyvern', name: '風翼飛龍', hp: 130, speedCellsPerSecond: 0.75, coreDamage: 1, goldReward: 7, physicalResistance: 0, targetOffsetWorld: 0.4,
    flying: { altitudeWorld: 1.7 }, knockbackResistance: 0.2,
  },
  ram: {
    kind: 'ram', name: '破牆角獸', hp: 280, speedCellsPerSecond: 0.75, coreDamage: 2, goldReward: 9, physicalResistance: 0.25, targetOffsetWorld: 0.42,
    breaksWalls: { ticks: 60 }, scale: 1.1, knockbackResistance: 0.4,
  },
};

/**
 * Late-wave enemy HP bonus (v2.8). Raised alongside the stronger tower upgrades so the campaign
 * keeps its difficulty. It ramps from +0% on the first wave to the full bonus by the sixth (or the
 * last) wave, because upgrades only exist later in a level: the opening waves stay as they were.
 */
export const LATE_WAVE_HP_BONUS = 0.28;

export function waveHpMultiplier(waveIndex: number, waveCount: number): number {
  const ramp = Math.max(1, Math.min(waveCount - 1, 5));
  return 1 + LATE_WAVE_HP_BONUS * Math.min(1, waveIndex / ramp);
}

/** 1×1 spike trap (GDD §16 T2): hits every ground enemy standing on its cell, then recharges. */
export const TRAP_DEF = { cost: 40, refund: 20, damage: 34, damageType: 'physical' as const, cooldownTicks: 20 };

/** GDD §4.4 / §6 terrain economy. */
export const ECONOMY = {
  raiseCost: 12,
  lowerCost: 8,
  wallCost: 15 as const,
  wallRefund: Math.floor(15 * 0.5), // 7
  sellRatio: 0.65,
  /** Collapsing / repairing a bridge (GDD §16 T2 可破壞／可修復橋梁). */
  bridgeCollapseCost: 20,
  bridgeRepairCost: 30,
  maxUndo: 20,
} as const;

/** Highest tower level. Every per-level table below is indexed by level (1-based). */
export const MAX_TOWER_LEVEL = 3;
export const TOWER_LEVELS: readonly TowerLevel[] = [1, 2, 3];

/** Level multipliers relative to Lv1 (GDD §7; v2.8 raised 1.3/1.7 → 1.45/2.0 so upgrading pays). */
export const LEVEL_DAMAGE_MULT: Record<TowerLevel, number> = { 1: 1, 2: 1.45, 3: 2.0 };
export const LEVEL_RANGE_BONUS: Record<TowerLevel, number> = { 1: 0, 2: 0.2, 3: 0.4 };
/** Upgrade cost into each level, as a fraction of the build cost. */
const UPGRADE_COST_RATIO: Partial<Record<TowerLevel, number>> = { 2: 0.7, 3: 1.1 };

export function nextTowerLevel(level: TowerLevel): TowerLevel | null {
  return level < MAX_TOWER_LEVEL ? ((level + 1) as TowerLevel) : null;
}

export function upgradeCost(kind: TowerKind, toLevel: TowerLevel): number {
  return Math.ceil(TOWER_DEFS[kind].buildCost * (UPGRADE_COST_RATIO[toLevel] ?? 0));
}

/** Everything a tower does at a given level, resolved in one place (simulation, HUD, docs). */
export interface TowerLevelStats {
  damage: number;
  rangeBonus: number;
  slow?: { ratio: number; durationTicks: number };
  blastRadiusWorld?: number;
  chainJumps?: number;
  knockbackCells?: number;
  knockbackTargets?: number;
}

export function towerStats(kind: TowerKind, level: TowerLevel): TowerLevelStats {
  const d = TOWER_DEFS[kind];
  const i = level - 1;
  const out: TowerLevelStats = { damage: d.baseDamage * LEVEL_DAMAGE_MULT[level], rangeBonus: LEVEL_RANGE_BONUS[level] };
  if (d.slow) out.slow = { ratio: d.perLevel?.slowRatio?.[i] ?? d.slow.ratio, durationTicks: d.slow.durationTicks };
  if (d.blastRadiusWorld) out.blastRadiusWorld = d.perLevel?.blastRadiusWorld?.[i] ?? d.blastRadiusWorld;
  if (d.chain) out.chainJumps = d.chain.jumps + i;
  if (d.knockback) {
    out.knockbackCells = d.knockback.cells + d.knockback.perLevel * i;
    out.knockbackTargets = d.knockback.maxTargets + i;
  }
  return out;
}

/** High-ground range bonus for a tower `elevationDiff` levels above its target (capped). */
export function highGroundBonus(elevationDiff: number): number {
  return HIGH_GROUND_PER_LEVEL * Math.min(HIGH_GROUND_MAX_LEVELS, Math.max(0, elevationDiff));
}

export function sellRefund(investedGold: number): number {
  return Math.floor(investedGold * ECONOMY.sellRatio);
}

export const HIGH_GROUND_PER_LEVEL = 0.3;
export const HIGH_GROUND_MAX_LEVELS = 3;
/** Typical enemy aim height used for range-projection sampling (Tech §7.3). */
export const PREVIEW_TARGET_OFFSET = 0.35;

export function starsForHp(hp: number): 0 | 1 | 2 | 3 {
  if (hp >= 16) return 3;
  if (hp >= 10) return 2;
  if (hp >= 1) return 1;
  return 0;
}

/** True while a burrowing enemy is underground (untargetable, immune to blasts and auras). */
export function isBurrowed(e: Pick<EnemyInstance, 'kind' | 'spawnTick'>, tick: number): boolean {
  const b = ENEMY_DEFS[e.kind].burrow;
  if (!b) return false;
  const age = tick - e.spawnTick;
  return age > 0 && age % b.cycleTicks >= b.cycleTicks - b.underTicks;
}

/** True when an enraging enemy has dropped below its HP threshold. */
export function isEnraged(e: Pick<EnemyInstance, 'kind' | 'hp' | 'maxHp'>): boolean {
  const r = ENEMY_DEFS[e.kind].enrage;
  return !!r && e.hp > 0 && e.hp < e.maxHp * r.belowRatio;
}

