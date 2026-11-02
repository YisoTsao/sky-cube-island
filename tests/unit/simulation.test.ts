import { describe, expect, it } from 'vitest';
import { level, fresh, cid } from './helpers';
import { executeCommand } from '../../src/commands/execute';
import { advanceOneTick } from '../../src/simulation/engine';
import { buildSpawnQueue } from '../../src/simulation/waves';
import type { GameCommand, GameEvent, GameState } from '../../src/domain/types';

function apply(s: GameState, cmds: GameCommand[]): GameState {
  for (const c of cmds) {
    const r = executeCommand(level, s, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.message}`);
    s = r.state;
  }
  return s;
}
function runWave(s: GameState, maxTicks = 20 * 400): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const r = executeCommand(level, s, { type: 'START_WAVE' });
  if (!r.ok) throw new Error(r.message);
  s = r.state; events.push(...r.events);
  for (let i = 0; i < maxTicks && s.phase === 'COMBAT'; i++) {
    const t = advanceOneTick(s, level);
    s = t.state; events.push(...t.events);
  }
  return { state: s, events };
}

describe('Waves (D21-07)', () => {
  it('round-robins wave 2 slimes A,B with independent 23-tick schedules', () => {
    const q = buildSpawnQueue(level.waves[1]!, ['A', 'B']);
    const slimes = q.filter((x) => x.enemyKind === 'slime');
    expect(slimes.filter((x) => x.portalId === 'A')).toHaveLength(4);
    expect(slimes.filter((x) => x.portalId === 'B')).toHaveLength(4);
    expect(slimes.slice(0, 4).map((x) => x.portalId)).toEqual(['A', 'B', 'A', 'B']);
    expect(slimes.filter((x) => x.portalId === 'A').map((x) => x.tick)).toEqual([0, 23, 46, 69]);
  });
});

describe('Simulation (Tech §8, §12.3)', () => {
  it('undefended wave 1 leaks 6 slimes into the core; no gold for leaks', () => {
    const { state, events } = runWave(fresh());
    expect(state.phase).toBe('WAVE_RESULT');
    expect(state.coreHp).toBe(14);
    expect(state.gold).toBe(220 + 35);
    expect(events.filter((e) => e.type === 'ENEMY_REACHED_CORE')).toHaveLength(6);
    expect(events.some((e) => e.type === 'ENEMY_KILLED')).toBe(false);
  });
  it('arrow tower on the high ground kills slimes and pays gold; kill and leak are exclusive', () => {
    const s = apply(fresh(), [
      { type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: cid(23, 15) },
    ]);
    const { state, events } = runWave(s);
    const killed = new Set(events.filter((e) => e.type === 'ENEMY_KILLED').map((e) => (e as { enemyId: string }).enemyId));
    const leaked = new Set(events.filter((e) => e.type === 'ENEMY_REACHED_CORE').map((e) => (e as { enemyId: string }).enemyId));
    expect(killed.size).toBeGreaterThan(0);
    for (const id of killed) expect(leaked.has(id)).toBe(false);
    expect(killed.size + leaked.size).toBe(6);
    expect(state.coreHp).toBe(20 - leaked.size);
  });
  it('is fully deterministic including the event sequence', () => {
    const s = apply(fresh(), [{ type: 'BUILD_TOWER', kind: 'cannon', anchorCellId: cid(14, 11) }, { type: 'BUILD_TOWER', kind: 'frost', anchorCellId: cid(18, 15) }]);
    const a = runWave(s); const b = runWave(s);
    expect(a.events).toEqual(b.events);
    expect(a.state).toEqual(b.state);
  });
  it('awards wave-clear gold exactly once', () => {
    const { state } = runWave(fresh());
    expect(state.awardedWaveIds).toEqual(['w1']);
    // Re-running a cleared wave id must not award again.
    const again = runWave({ ...state, phase: 'PREPARE', currentWaveIndex: 0 });
    expect(again.state.gold - state.gold).toBe(0);
  });
  it('cannon hits each enemy at most once per shot; frost slow refreshes, never stacks', () => {
    const s = apply({ ...fresh(), gold: 2000 }, [
      { type: 'BUILD_TOWER', kind: 'cannon', anchorCellId: cid(14, 11) },
      { type: 'BUILD_TOWER', kind: 'frost', anchorCellId: cid(18, 15) },
    ]);
    const { events } = runWave(s);
    const explosions = events.filter((e): e is Extract<GameEvent, { type: 'CANNON_EXPLODED' }> => e.type === 'CANNON_EXPLODED');
    for (const ex of explosions) expect(new Set(ex.hitIds).size).toBe(ex.hitIds.length);
    const slows = events.filter((e): e is Extract<GameEvent, { type: 'ENEMY_SLOWED' }> => e.type === 'ENEMY_SLOWED');
    for (const sl of slows) expect(sl.untilTick - sl.tick).toBe(36);
  });
  it('golem takes 20% less physical damage', () => {
    let s = apply({ ...fresh(), gold: 5000 }, [{ type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: cid(14, 13) }]);
    for (let w = 0; w < 2; w++) { s = runWave(s).state; s = executeCommand(level, s, { type: 'CONTINUE' }).state; }
    const { events } = runWave(s);
    const golemIds = new Set(events.filter((e) => e.type === 'ENEMY_SPAWNED' && e.kind === 'golem').map((e) => (e as { enemyId: string }).enemyId));
    const hits = events.filter((e): e is Extract<GameEvent, { type: 'ENEMY_DAMAGED' }> => e.type === 'ENEMY_DAMAGED' && golemIds.has(e.enemyId));
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) { expect(h.amount).toBe(16); expect(h.resisted).toBe(true); }
  });
  it('a reasonable defence can win all five waves (balance smoke test)', () => {
    let s = fresh();
    const plan: GameCommand[][] = [
      [{ type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: cid(14, 13) }, { type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: cid(16, 12) }],
      [{ type: 'BUILD_TOWER', kind: 'frost', anchorCellId: cid(17, 15) }],
      [{ type: 'BUILD_TOWER', kind: 'cannon', anchorCellId: cid(15, 16) }],
      [{ type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: cid(19, 15) }],
      [{ type: 'BUILD_TOWER', kind: 'cannon', anchorCellId: cid(13, 16) }],
    ];
    const upgrades = (st: GameState): GameState => {
      for (const t of st.towers) {
        const r = executeCommand(level, st, { type: 'UPGRADE_TOWER', towerId: t.id });
        if (r.ok) st = r.state;
      }
      return st;
    };
    for (let w = 0; w < 5; w++) {
      for (const c of plan[w]!) { const r = executeCommand(level, s, c); if (r.ok) s = r.state; }
      s = upgrades(s);
      s = runWave(s).state;
      if (s.phase === 'WAVE_RESULT') s = executeCommand(level, s, { type: 'CONTINUE' }).state;
      else break;
    }
    expect(s.phase).toBe('VICTORY');
    expect(s.coreHp).toBeGreaterThan(0);
  });
});
