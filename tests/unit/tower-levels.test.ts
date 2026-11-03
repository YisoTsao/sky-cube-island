import { describe, expect, it } from 'vitest';
import { level, fresh, cid } from './helpers';
import { executeCommand } from '../../src/commands/execute';
import { advanceOneTick } from '../../src/simulation/engine';
import {
  LATE_WAVE_HP_BONUS, MAX_TOWER_LEVEL, TOWER_DEFS, TOWER_LEVELS, highGroundBonus, nextTowerLevel, towerStats, upgradeCost, waveHpMultiplier,
} from '../../src/domain/definitions';
import { effectiveRange } from '../../src/navigation/line-of-sight';
import { TOWER_BRANCHES, TOWER_KINDS, type GameEvent, type GameState, type TowerBranch } from '../../src/domain/types';
import { GameStateSchema } from '../../src/domain/schemas';

describe('tower level table (v2.8)', () => {
  it('every level is strictly stronger and upgrades cost gold', () => {
    for (const k of TOWER_KINDS) {
      for (const lv of TOWER_LEVELS.slice(1)) {
        for (const br of TOWER_BRANCHES) {
          const a = towerStats(k, (lv - 1) as typeof lv, br), b = towerStats(k, lv, br);
          expect(b.damage / b.cooldownTicks).toBeGreaterThan(a.damage / a.cooldownTicks);
          expect(b.rangeBonus).toBeGreaterThanOrEqual(a.rangeBonus);
        }
        expect(upgradeCost(k, lv)).toBeGreaterThan(0);
      }
    }
    expect(nextTowerLevel(MAX_TOWER_LEVEL)).toBeNull();
  });

  it('frost slow and cannon blast grow with level', () => {
    expect(TOWER_LEVELS.slice(0, 3).map((l) => towerStats('frost', l).slow!.ratio)).toEqual([0.3, 0.38, 0.45]);
    expect(TOWER_LEVELS.slice(0, 3).map((l) => towerStats('cannon', l).blastRadiusWorld)).toEqual([1.05, 1.2, 1.35]);
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

describe('Lv4 branches (v2.9)', () => {
  function lv4(kind: 'arrow' | 'frost' | 'cannon' | 'lightning' | 'wind', branch: TowerBranch, extra: Partial<GameState> = {}): GameState {
    let s: GameState = { ...fresh(), coreHp: 9999, gold: 9999, ...extra };
    const b = executeCommand(level, s, { type: 'BUILD_TOWER', kind, anchorCellId: cid(23, 15) });
    if (!b.ok) throw new Error(b.message);
    s = b.state;
    const id = s.towers[0]!.id;
    for (let i = 0; i < 2; i++) { const r = executeCommand(level, s, { type: 'UPGRADE_TOWER', towerId: id }); if (!r.ok) throw new Error(r.message); s = r.state; }
    const noBranch = executeCommand(level, s, { type: 'UPGRADE_TOWER', towerId: id });
    expect(noBranch.ok).toBe(false);
    if (!noBranch.ok) expect(noBranch.code).toBe('BRANCH_REQUIRED');
    const r = executeCommand(level, s, { type: 'UPGRADE_TOWER', towerId: id, branch });
    if (!r.ok) throw new Error(r.message);
    expect(r.state.towers[0]!.level).toBe(4);
    expect(r.state.towers[0]!.branch).toBe(branch);
    expect(r.state.gold).toBe(s.gold - upgradeCost(kind, 4));
    expect(executeCommand(level, r.state, { type: 'UPGRADE_TOWER', towerId: id, branch }).ok).toBe(false);
    return r.state;
  }
  /** Enemies are kept alive (huge HP) so on-hit effects have survivors to land on. */
  function fight(s: GameState, ticks = 20 * 60, tweak: (e: GameState['enemies'][number]) => Partial<GameState['enemies'][number]> = () => ({})) {
    const st = executeCommand(level, s, { type: 'START_WAVE' });
    if (!st.ok) throw new Error(st.message);
    s = st.state;
    const events: GameEvent[] = [];
    const seen: GameState[] = [];
    for (let i = 0; i < ticks && s.phase === 'COMBAT'; i++) {
      s = { ...s, enemies: s.enemies.map((e) => ({ ...e, hp: 1e6, maxHp: 1e6, ...tweak(e) })) };
      const t = advanceOneTick(s, level); s = t.state; events.push(...t.events); seen.push(s);
    }
    return { s, events, seen };
  }

  it('saves keep the level and branch, and Lv4 costs 1.8× the build cost', () => {
    const s = lv4('arrow', 'B');
    expect(GameStateSchema.parse(s).towers[0]!.branch).toBe('B');
    expect(upgradeCost('arrow', 4)).toBe(Math.ceil(TOWER_DEFS.arrow.buildCost * 1.8));
  });

  it('branch stats differ from each other and from Lv3', () => {
    for (const k of TOWER_KINDS) {
      const a = towerStats(k, 4, 'A'), b = towerStats(k, 4, 'B'), l3 = towerStats(k, 3);
      expect(a).not.toEqual(b);
      // every branch out-damages Lv3 per second (the repeater trades hit size for rate of fire)
      expect(a.damage / a.cooldownTicks).toBeGreaterThan(l3.damage / l3.cooldownTicks);
      expect(b.damage / b.cooldownTicks).toBeGreaterThan(l3.damage / l3.cooldownTicks);
    }
    expect(towerStats('arrow', 4, 'A').rangeBonus).toBeGreaterThan(towerStats('arrow', 3).rangeBonus + 1);
    expect(towerStats('arrow', 4, 'B').cooldownTicks).toBeLessThan(TOWER_DEFS.arrow.cooldownTicks);
  });

  it('permafrost freezes enemies in place', () => {
    // enemies only stay in this test tower's range for ~4 shots, so start them one hit short
    const { seen } = fight(lv4('frost', 'A'), 20 * 60, (e) => ({ frostHits: Math.max(e.frostHits ?? 0, 4) }));
    expect(seen.some((st) => st.enemies.some((e) => (e.stunUntilTick ?? -1) > st.tick))).toBe(true);
    // a frozen enemy does not move on the next tick
    for (let i = 0; i + 1 < seen.length; i++) {
      const a = seen[i]!, b = seen[i + 1]!;
      const frozen = a.enemies.find((e) => (e.stunUntilTick ?? -1) > a.tick + 1);
      if (!frozen) continue;
      const after = b.enemies.find((e) => e.id === frozen.id);
      if (after) { expect(after.edgeIndex + after.segmentProgress).toBeCloseTo(frozen.edgeIndex + frozen.segmentProgress); return; }
    }
    throw new Error('no frozen enemy observed across two ticks');
  });

  it('blizzard damages and slows enemies around the target', () => {
    const { events } = fight(lv4('frost', 'B'));
    const byTick = new Map<number, Set<string>>();
    for (const e of events) if (e.type === 'ENEMY_DAMAGED' && e.sourceTowerId === 't1') {
      const set = byTick.get(e.tick) ?? new Set<string>(); set.add(e.enemyId); byTick.set(e.tick, set);
    }
    expect([...byTick.values()].some((v) => v.size >= 2)).toBe(true);
  });

  it('shredder shells lower resistances and heavy shells stun', () => {
    const shred = fight(lv4('cannon', 'B')).seen;
    expect(shred.some((st) => st.enemies.some((e) => (e.shredUntilTick ?? -1) > st.tick && e.shredAmount === 0.25))).toBe(true);
    const heavy = fight(lv4('cannon', 'A')).seen;
    expect(heavy.some((st) => st.enemies.some((e) => (e.stunUntilTick ?? -1) > st.tick))).toBe(true);
  });

  it('storm lightning chains further than Lv3; overload switches off support auras', () => {
    const { events } = fight(lv4('lightning', 'A'));
    const chains = events.filter((e): e is Extract<GameEvent, { type: 'LIGHTNING_CHAINED' }> => e.type === 'LIGHTNING_CHAINED');
    expect(towerStats('lightning', 4, 'A').chainJumps!).toBeGreaterThan(towerStats('lightning', 3).chainJumps!);
    expect(chains.some((c) => c.hitIds.length >= 2)).toBe(true);
    expect(chains.every((c) => c.hitIds.length <= towerStats('lightning', 4, 'A').chainJumps! + 1)).toBe(true);
    expect(towerStats('lightning', 4, 'B').disruptTicks).toBeGreaterThan(0);
  });

  it('hurricane gusts slow every enemy they hit', () => {
    const { events } = fight(lv4('wind', 'B'));
    const gust = events.find((e): e is Extract<GameEvent, { type: 'WIND_GUST' }> => e.type === 'WIND_GUST' && e.hitIds.length > 0)!;
    expect(gust).toBeTruthy();
    const slowed = events.filter((e) => e.type === 'ENEMY_SLOWED' && e.tick === gust.tick).map((e) => (e as { enemyId: string }).enemyId);
    expect(gust.hitIds.every((id) => slowed.includes(id))).toBe(true);
  });
});
