import { describe, expect, it } from 'vitest';
import { level, fresh, cid } from './helpers';
import { executeCommand } from '../../src/commands/execute';
import { advanceOneTick, TARGET_ORDER } from '../../src/simulation/engine';
import { GameStateSchema } from '../../src/domain/schemas';
import { TOWER_DEFS } from '../../src/domain/definitions';
import type { EnemyInstance, GameCommand, GameEvent, GameState } from '../../src/domain/types';

function apply(s: GameState, cmds: GameCommand[]): GameState {
  for (const c of cmds) {
    const r = executeCommand(level, s, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.message}`);
    s = r.state;
  }
  return s;
}
function run(s: GameState, ticks: number): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const r = executeCommand(level, s, { type: 'START_WAVE' });
  if (!r.ok) throw new Error(r.message);
  s = r.state;
  for (let i = 0; i < ticks && s.phase === 'COMBAT'; i++) {
    const t = advanceOneTick(s, level);
    s = t.state; events.push(...t.events);
  }
  return { state: s, events };
}

describe('Lightning tower (chain)', () => {
  it('chains through several enemies with falling damage', () => {
    const s = apply({ ...fresh(), coreHp: 9999 }, [{ type: 'BUILD_TOWER', kind: 'lightning', anchorCellId: cid(23, 15) }]);
    const { events } = run(s, 20 * 90);
    const chains = events.filter((e): e is Extract<GameEvent, { type: 'LIGHTNING_CHAINED' }> => e.type === 'LIGHTNING_CHAINED');
    expect(chains.length).toBeGreaterThan(5);
    const max = TOWER_DEFS.lightning.chain!.jumps + 1;
    expect(chains.every((c) => c.hitIds.length >= 1 && c.hitIds.length <= max && new Set(c.hitIds).size === c.hitIds.length)).toBe(true);
    expect(chains.some((c) => c.hitIds.length >= 2)).toBe(true);
    expect(chains.every((c) => c.points.length === c.hitIds.length + 1)).toBe(true);
    // first hit full damage, later hits weaker (same tick, same tower)
    const multi = chains.find((c) => c.hitIds.length >= 2)!;
    const dmg = events.filter((e): e is Extract<GameEvent, { type: 'ENEMY_DAMAGED' }> => e.type === 'ENEMY_DAMAGED' && e.tick === multi.tick && e.sourceTowerId === multi.towerId);
    expect(dmg[0]!.amount).toBeGreaterThan(dmg[1]!.amount);
    expect(events.some((e) => e.type === 'ENEMY_KILLED')).toBe(true);
  });
});

/** First anchor (scanning the map) where a wind tower is legal and gusts within the first wave. */
function windAnchor(): string {
  for (let z = 0; z < level.depth; z++) for (let x = 0; x < level.width; x++) {
    const r = executeCommand(level, { ...fresh(), coreHp: 9999 }, { type: 'BUILD_TOWER', kind: 'wind', anchorCellId: cid(x, z) });
    if (!r.ok) continue;
    const { events } = run(r.state, 20 * 40);
    if (events.filter((e) => e.type === 'ENEMY_KNOCKED_BACK').length >= 3) return cid(x, z);
  }
  throw new Error('no wind spot');
}

describe('Wind tower (knockback)', () => {
  const anchor = windAnchor();
  it('pushes enemies back along their route, then grants a short immunity', () => {
    const s = apply({ ...fresh(), coreHp: 9999 }, [{ type: 'BUILD_TOWER', kind: 'wind', anchorCellId: anchor }]);
    const { events } = run(s, 20 * 90);
    const pushes = events.filter((e): e is Extract<GameEvent, { type: 'ENEMY_KNOCKED_BACK' }> => e.type === 'ENEMY_KNOCKED_BACK');
    expect(pushes.length).toBeGreaterThan(3);
    const imm = TOWER_DEFS.wind.knockback!.immuneTicks;
    const last = new Map<string, number>();
    for (const p of pushes) {
      const prev = last.get(p.enemyId);
      if (prev !== undefined) expect(p.tick - prev).toBeGreaterThanOrEqual(imm);
      last.set(p.enemyId, p.tick);
    }
    const gusts = events.filter((e) => e.type === 'WIND_GUST') as Extract<GameEvent, { type: 'WIND_GUST' }>[];
    expect(gusts.every((g) => g.hitIds.length <= TOWER_DEFS.wind.knockback!.maxTargets)).toBe(true);
  });

  it('moves the enemy backwards by the knockback distance', () => {
    let s = apply({ ...fresh(), coreHp: 9999 }, [{ type: 'BUILD_TOWER', kind: 'wind', anchorCellId: anchor }]);
    s = executeCommand(level, s, { type: 'START_WAVE' }).state;
    for (let i = 0; i < 20 * 120 && s.phase === 'COMBAT'; i++) {
      const before = new Map(s.enemies.map((e) => [e.id, e.edgeIndex + e.segmentProgress]));
      const t = advanceOneTick(s, level);
      const push = t.events.find((e): e is Extract<GameEvent, { type: 'ENEMY_KNOCKED_BACK' }> => e.type === 'ENEMY_KNOCKED_BACK');
      s = t.state;
      if (!push) continue;
      const after = s.enemies.find((e) => e.id === push.enemyId);
      if (!after) continue;
      expect(after.edgeIndex + after.segmentProgress).toBeLessThan(before.get(push.enemyId)!);
      return;
    }
    throw new Error('no knockback happened');
  });
});

describe('Targeting modes', () => {
  const mk = (id: string, along: number, hp: number, d: number) => ({
    e: { id, hp, spawnTick: 0, pathNodeIds: new Array(20).fill('x'), edgeIndex: Math.floor(along), segmentProgress: along % 1 } as unknown as EnemyInstance,
    p: { x: 0, y: 0, z: 0 }, d,
  });
  const list = [mk('a', 5, 50, 2), mk('b', 12, 30, 3), mk('c', 8, 90, 1)];
  const pick = (m: keyof typeof TARGET_ORDER) => [...list].sort(TARGET_ORDER[m])[0]!.e.id;
  it('orders candidates per mode', () => {
    expect(pick('FIRST')).toBe('b');
    expect(pick('LAST')).toBe('a');
    expect(pick('STRONGEST')).toBe('c');
    expect(pick('CLOSEST')).toBe('c');
  });
  it('SET_TARGETING works in PREPARE and COMBAT and survives the save schema', () => {
    let s = apply(fresh(), [{ type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: cid(23, 15) }]);
    const id = s.towers[0]!.id;
    expect(s.towers[0]!.targeting).toBe('FIRST');
    s = apply(s, [{ type: 'SET_TARGETING', towerId: id, targeting: 'STRONGEST' }]);
    expect(s.towers[0]!.targeting).toBe('STRONGEST');
    expect(GameStateSchema.safeParse(s).success).toBe(true);
    s = executeCommand(level, s, { type: 'START_WAVE' }).state;
    const r = executeCommand(level, s, { type: 'SET_TARGETING', towerId: id, targeting: 'LAST' });
    expect(r.ok && r.state.towers[0]!.targeting).toBe('LAST');
    expect(executeCommand(level, s, { type: 'SET_TARGETING', towerId: 'nope', targeting: 'LAST' }).ok).toBe(false);
  });
});
