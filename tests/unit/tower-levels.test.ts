import { describe, expect, it } from 'vitest';
import { level, fresh, cid } from './helpers';
import { executeCommand } from '../../src/commands/execute';
import { advanceOneTick } from '../../src/simulation/engine';
import {
  LATE_WAVE_HP_BONUS, MAX_TOWER_LEVEL, TOWER_DEFS, TOWER_LEVELS, highGroundBonus, nextTowerLevel, towerStats, upgradeCost, waveHpMultiplier,
} from '../../src/domain/definitions';
import { effectiveRange } from '../../src/navigation/line-of-sight';
import { TOWER_KINDS, type GameEvent, type GameState } from '../../src/domain/types';

describe('tower level table (v2.8)', () => {
  it('every level is strictly stronger and upgrades cost gold', () => {
    for (const k of TOWER_KINDS) {
      for (const lv of TOWER_LEVELS.slice(1)) {
        const a = towerStats(k, (lv - 1) as typeof lv), b = towerStats(k, lv);
        expect(b.damage).toBeGreaterThan(a.damage);
        expect(b.rangeBonus).toBeGreaterThan(a.rangeBonus);
        expect(upgradeCost(k, lv)).toBeGreaterThan(0);
      }
    }
    expect(nextTowerLevel(MAX_TOWER_LEVEL)).toBeNull();
  });

  it('frost slow and cannon blast grow with level', () => {
    expect(TOWER_LEVELS.map((l) => towerStats('frost', l).slow!.ratio)).toEqual([0.3, 0.38, 0.45]);
    expect(TOWER_LEVELS.map((l) => towerStats('cannon', l).blastRadiusWorld)).toEqual([1.05, 1.2, 1.35]);
    expect(towerStats('arrow', 3).damage).toBe(TOWER_DEFS.arrow.baseDamage * 2);
  });

  it('upgrading is better value per gold than before (Lv3 arrow ≥ 0.25 DPS per gold)', () => {
    const d = TOWER_DEFS.arrow;
    const invested = d.buildCost + upgradeCost('arrow', 2) + upgradeCost('arrow', 3);
    const dps = towerStats('arrow', 3).damage * 20 / d.cooldownTicks;
    expect(dps / invested).toBeGreaterThanOrEqual(0.25);
  });

  it('high-ground bonus is relative and capped at three levels', () => {
    expect(highGroundBonus(0)).toBe(0);
    expect(highGroundBonus(-2)).toBe(0);
    expect(highGroundBonus(6)).toBeCloseTo(0.9);
    expect(effectiveRange('arrow', 1, 6, 6)).toBe(TOWER_DEFS.arrow.baseRangeWorld);
    expect(effectiveRange('arrow', 1, 6, 0)).toBeCloseTo(TOWER_DEFS.arrow.baseRangeWorld + 0.9);
  });

  it('late-wave HP bonus leaves the first wave alone and is full by wave 6 or the last wave', () => {
    expect(waveHpMultiplier(0, 5)).toBe(1);
    expect(waveHpMultiplier(4, 5)).toBeCloseTo(1 + LATE_WAVE_HP_BONUS);
    expect(waveHpMultiplier(5, 99)).toBeCloseTo(1 + LATE_WAVE_HP_BONUS);
    expect(waveHpMultiplier(50, 99)).toBeCloseTo(1 + LATE_WAVE_HP_BONUS);
    expect(waveHpMultiplier(2, 7)).toBeGreaterThan(1);
    expect(waveHpMultiplier(0, 1)).toBe(1);
  });

  it('a Lv3 frost tower applies its stronger slow in combat', () => {
    let s: GameState = { ...fresh(), coreHp: 9999, gold: 9999 };
    for (const c of [
      { type: 'BUILD_TOWER', kind: 'frost', anchorCellId: cid(23, 15) },
    ] as const) { const r = executeCommand(level, s, c); if (!r.ok) throw new Error(r.message); s = r.state; }
    const id = s.towers[0]!.id;
    for (let i = 0; i < 2; i++) { const r = executeCommand(level, s, { type: 'UPGRADE_TOWER', towerId: id }); if (!r.ok) throw new Error(r.message); s = r.state; }
    expect(executeCommand(level, s, { type: 'UPGRADE_TOWER', towerId: id }).ok).toBe(false);
    const st = executeCommand(level, s, { type: 'START_WAVE' });
    if (!st.ok) throw new Error(st.message);
    s = st.state;
    const events: GameEvent[] = [];
    let ratio: number | undefined;
    for (let i = 0; i < 20 * 60 && s.phase === 'COMBAT' && ratio === undefined; i++) {
      const t = advanceOneTick(s, level);
      s = t.state; events.push(...t.events);
      ratio = s.enemies.find((e) => e.slowUntilTick > s.tick)?.slowRatio;
    }
    expect(events.some((e) => e.type === 'ENEMY_SLOWED')).toBe(true);
    expect(ratio).toBe(0.45);
  });
});
