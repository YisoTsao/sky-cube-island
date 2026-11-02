import { describe, expect, it } from 'vitest';
import { level, fresh, cid } from './helpers';
import { executeCommand } from '../../src/commands/execute';
import { advanceOneTick } from '../../src/simulation/engine';
import { buildSpawnQueue } from '../../src/simulation/waves';
import type { EnemyInstance, EnemyKind, GameCommand, GameEvent, GameState } from '../../src/domain/types';
import { ENEMY_DEFS } from '../../src/domain/definitions';

function apply(s: GameState, cmds: GameCommand[]): GameState {
  for (const c of cmds) {
    const r = executeCommand(level, s, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.message}`);
    s = r.state;
  }
  return s;
}
function runWave(s: GameState, maxTicks = 20 * 600): { state: GameState; events: GameEvent[] } {
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
  it('round-robins wave 2 slimes A,B with independent per-portal schedules', () => {
    const q = buildSpawnQueue(level.waves[1]!, ['A', 'B']);
    const slimes = q.filter((x) => x.enemyKind === 'slime');
    expect(slimes.slice(0, 4).map((x) => x.portalId)).toEqual(['A', 'B', 'A', 'B']);
    const first = level.waves[1]!.entries[0]!;
    expect(slimes.filter((x) => x.portalId === 'A').slice(0, 4).map((x) => x.tick)).toEqual([0, 1, 2, 3].map((i) => i * first.intervalTicks));
  });
  it('delayTicks pushes only that entry\'s portals forward', () => {
    const q = buildSpawnQueue({ id: 't', clearGold: 0, entries: [
      { enemyKind: 'slime', count: 2, portalIds: ['A'], intervalTicks: 10 },
      { enemyKind: 'runner', count: 1, portalIds: ['A'], intervalTicks: 10, delayTicks: 50 },
      { enemyKind: 'golem', count: 1, portalIds: ['B'], intervalTicks: 10, delayTicks: 5 },
    ] }, ['A', 'B']);
    expect(q.map((x) => [x.enemyKind, x.portalId, x.tick])).toEqual([
      ['slime', 'A', 0], ['golem', 'B', 5], ['slime', 'A', 10], ['runner', 'A', 70],
    ]);
  });
  it('every wave keeps spawning for at least two minutes on every portal', () => {
    for (const w of level.waves) {
      const q = buildSpawnQueue(w, ['A', 'B']);
      for (const p of ['A', 'B']) {
        const last = Math.max(...q.filter((x) => x.portalId === p).map((x) => x.tick));
        expect(last, `${w.id} portal ${p}`).toBeGreaterThanOrEqual(120 * 20);
      }
      expect(q.length, w.id).toBeGreaterThanOrEqual(90);
    }
  });
});

describe('Simulation (Tech §8, §12.3)', () => {
  it('undefended wave 1 overruns the core; no gold for leaks', () => {
    const { state, events } = runWave(fresh());
    expect(state.phase).toBe('DEFEAT');
    expect(state.coreHp).toBe(0);
    expect(state.gold).toBe(level.initialGold);
    expect(events.filter((e) => e.type === 'ENEMY_REACHED_CORE').length).toBeGreaterThanOrEqual(20);
    expect(events.some((e) => e.type === 'ENEMY_KILLED')).toBe(false);
  });
  it('arrow tower on the high ground kills slimes and pays gold; kill and leak are exclusive', () => {
    const s = apply({ ...fresh(), coreHp: 9999 }, [
      { type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: cid(23, 15) },
    ]);
    const { state, events } = runWave(s);
    const killed = new Set(events.filter((e) => e.type === 'ENEMY_KILLED').map((e) => (e as { enemyId: string }).enemyId));
    const leaked = new Set(events.filter((e) => e.type === 'ENEMY_REACHED_CORE').map((e) => (e as { enemyId: string }).enemyId));
    expect(killed.size).toBeGreaterThan(0);
    for (const id of killed) expect(leaked.has(id)).toBe(false);
    const spawned = events.filter((e) => e.type === 'ENEMY_SPAWNED').length;
    expect(killed.size + leaked.size + state.enemies.length).toBe(spawned);
    const bounty = events.reduce((g, e) => g + (e.type === 'ENEMY_KILLED' ? e.gold : 0), 0);
    expect(state.gold).toBe(level.initialGold - 70 + bounty + level.waves[0]!.clearGold);
  });
  it('is fully deterministic including the event sequence', () => {
    const s = apply(fresh(), [{ type: 'BUILD_TOWER', kind: 'cannon', anchorCellId: cid(14, 11) }, { type: 'BUILD_TOWER', kind: 'frost', anchorCellId: cid(18, 15) }]);
    const a = runWave(s); const b = runWave(s);
    expect(a.events).toEqual(b.events);
    expect(a.state).toEqual(b.state);
  });
  it('awards wave-clear gold exactly once', () => {
    const { state } = runWave({ ...fresh(), coreHp: 9999 });
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
    let s = apply({ ...fresh(), gold: 5000, coreHp: 9999 }, [{ type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: cid(14, 13) }]);
    for (let w = 0; w < 1; w++) { s = runWave(s).state; s = executeCommand(level, s, { type: 'CONTINUE' }).state; }
    const { events } = runWave(s);
    const golemIds = new Set(events.filter((e) => e.type === 'ENEMY_SPAWNED' && e.kind === 'golem').map((e) => (e as { enemyId: string }).enemyId));
    const hits = events.filter((e): e is Extract<GameEvent, { type: 'ENEMY_DAMAGED' }> => e.type === 'ENEMY_DAMAGED' && golemIds.has(e.enemyId));
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) { expect(h.amount).toBe(16); expect(h.resisted).toBe(true); }
  });
  it('the old six-tower defence that used to clear L1-01 is no longer enough', () => {
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
    expect(s.phase).toBe('DEFEAT');
  });
});

/** Put a single enemy of `kind` on portal A's route, `edge` nodes in. */
function withEnemy(s: GameState, kind: EnemyKind, edge: number, extra: Partial<EnemyInstance> = {}): GameState {
  const route = s.frozenRoutes.A!;
  const hp = ENEMY_DEFS[kind].hp;
  const e: EnemyInstance = {
    id: `e${s.nextEntityId}`, kind, portalId: 'A', hp, maxHp: hp, state: 'moving', pathNodeIds: route,
    edgeIndex: edge, segmentProgress: 0, slowUntilTick: -1, spawnTick: s.tick, ...extra,
  };
  return { ...s, enemies: [...s.enemies, e], nextEntityId: s.nextEntityId + 1 };
}
function combat(s: GameState): GameState {
  const r = executeCommand(level, s, { type: 'START_WAVE' });
  if (!r.ok) throw new Error(r.message);
  return { ...r.state, spawnQueue: [], spawnCursor: 0 };
}

describe('Enemy roster v2.2', () => {
  it('splitter breaks into three minis on the same route when killed', () => {
    let s = combat(apply(fresh(), [{ type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: cid(23, 15) }]));
    s = withEnemy(s, 'splitter', 16, { hp: 1 });
    const events: GameEvent[] = [];
    for (let i = 0; i < 400 && !events.some((e) => e.type === 'ENEMY_KILLED' && e.kind === 'splitter'); i++) {
      const t = advanceOneTick(s, level); s = t.state; events.push(...t.events);
    }
    const kills = events.filter((e) => e.type === 'ENEMY_KILLED' && e.kind === 'splitter');
    expect(kills).toHaveLength(1);
    const minis = events.filter((e) => e.type === 'ENEMY_SPAWNED' && e.kind === 'mini');
    expect(minis).toHaveLength(3);
    for (const m of s.enemies.filter((e) => e.kind === 'mini')) expect(m.pathNodeIds).toBe(s.frozenRoutes.A);
  });
  it('wisp heals nearby wounded allies by a flat amount, never above max HP', () => {
    let s = combat(fresh());
    s = withEnemy(s, 'wisp', 3);
    s = withEnemy(s, 'golem', 3, { hp: 100 });
    s = withEnemy(s, 'slime', 3, { hp: ENEMY_DEFS.slime.hp - 5 });
    const heals: Extract<GameEvent, { type: 'ENEMY_HEALED' }>[] = [];
    for (let i = 0; i < 41; i++) {
      const t = advanceOneTick(s, level); s = t.state;
      for (const e of t.events) if (e.type === 'ENEMY_HEALED') heals.push(e);
    }
    const golem = s.enemies.find((e) => e.kind === 'golem')!;
    const slime = s.enemies.find((e) => e.kind === 'slime')!;
    expect(heals.length).toBe(2);
    expect(golem.hp).toBe(100 + ENEMY_DEFS.wisp.healAura!.amount);
    expect(slime.hp).toBe(ENEMY_DEFS.slime.hp);
  });
  it('boss shrugs off half of the frost slow', () => {
    let s = combat(fresh());
    s = withEnemy(s, 'boss', 2, { slowUntilTick: 10_000 });
    s = withEnemy(s, 'slime', 2, { slowUntilTick: 10_000 });
    const t = advanceOneTick(s, level).state;
    const boss = t.enemies.find((e) => e.kind === 'boss')!;
    const slime = t.enemies.find((e) => e.kind === 'slime')!;
    expect(boss.segmentProgress).toBeCloseTo(ENEMY_DEFS.boss.speedCellsPerSecond * (1 - 0.3 * 0.5) / 20);
    expect(slime.segmentProgress).toBeCloseTo(ENEMY_DEFS.slime.speedCellsPerSecond * 0.7 / 20);
  });
  it('wave hpScale raises spawned HP and max HP', () => {
    let s = { ...fresh(), currentWaveIndex: 4 };
    s = executeCommand(level, s, { type: 'START_WAVE' }).state;
    s = advanceOneTick(s, level).state;
    const e = s.enemies[0]!;
    expect(e.maxHp).toBe(Math.round(ENEMY_DEFS[e.kind].hp * level.waves[4]!.hpScale!));
    expect(e.hp).toBe(e.maxHp);
  });
});

describe('Combat-time tower commands', () => {
  it('build, upgrade and sell work mid-wave; terrain and walls do not', () => {
    let s = combat({ ...fresh(), gold: 1000 });
    const b = executeCommand(level, s, { type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: cid(23, 15) });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    s = b.state;
    const id = s.towers[0]!.id;
    const u = executeCommand(level, s, { type: 'UPGRADE_TOWER', towerId: id });
    expect(u.ok).toBe(true);
    if (u.ok) s = u.state;
    expect(executeCommand(level, s, { type: 'SELL_TOWER', towerId: id }).ok).toBe(true);
    expect(executeCommand(level, s, { type: 'PLACE_WALL', cellId: cid(6, 12) })).toMatchObject({ ok: false, code: 'INVALID_PHASE' });
  });
  it('never builds on a frozen route mid-wave', () => {
    const s = combat({ ...fresh(), gold: 1000 });
    const route = new Set(s.frozenRoutes.A);
    const anchor = level.cells.find((c) => route.has(c.id) && executeCommand(level, { ...s, phase: 'PREPARE' }, { type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: c.id }).ok);
    expect(anchor).toBeDefined();
    expect(executeCommand(level, s, { type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: anchor!.id })).toMatchObject({ ok: false, code: 'ON_ACTIVE_ROUTE' });
  });
});

describe('Enemy roster v2.3', () => {
  /** Run until the first damage event lands on an enemy of `kind`. */
  const firstHit = (s: GameState, kind: EnemyKind) => {
    for (let i = 0; i < 400; i++) {
      const t = advanceOneTick(s, level); s = t.state;
      const hit = t.events.find((e): e is Extract<GameEvent, { type: 'ENEMY_DAMAGED' }> =>
        e.type === 'ENEMY_DAMAGED' && s.enemies.concat().some((x) => x.id === e.enemyId && x.kind === kind));
      if (hit) return hit;
    }
    throw new Error('no hit');
  };
  it('ghosts shrug off most magic damage', () => {
    let s = combat(apply(fresh(), [{ type: 'BUILD_TOWER', kind: 'frost', anchorCellId: cid(23, 15) }]));
    s = withEnemy(s, 'ghost', 16);
    const hit = firstHit(s, 'ghost');
    expect(hit.resisted).toBe(true);
    expect(hit.amount).toBe(Math.round(16 * (1 - ENEMY_DEFS.ghost.magicResistance!)));
  });
  it('salamanders ignore frost slow entirely', () => {
    let s = combat(fresh());
    s = withEnemy(s, 'salamander', 3, { slowUntilTick: 10_000 });
    const before = s.enemies[0]!.segmentProgress;
    s = advanceOneTick(s, level).state;
    expect(s.enemies[0]!.segmentProgress - before).toBeCloseTo(ENEMY_DEFS.salamander.speedCellsPerSecond / 20, 6);
  });
  it('boars speed up once below half HP', () => {
    let s = combat(fresh());
    s = withEnemy(s, 'boar', 3, { hp: 90, maxHp: 200 });
    const before = s.enemies[0]!.segmentProgress;
    s = advanceOneTick(s, level).state;
    const rage = ENEMY_DEFS.boar.enrage!.speedMult;
    expect(s.enemies[0]!.segmentProgress - before).toBeCloseTo(ENEMY_DEFS.boar.speedCellsPerSecond * rage / 20, 6);
  });
  it('moles cannot be targeted while burrowed', async () => {
    const { isBurrowed } = await import('../../src/simulation/engine');
    const b = ENEMY_DEFS.mole.burrow!;
    let s = combat(apply(fresh(), [{ type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: cid(23, 15) }]));
    s = withEnemy(s, 'mole', 16, { spawnTick: s.tick - (b.cycleTicks - b.underTicks) });
    expect(isBurrowed(s.enemies[0]!, s.tick)).toBe(true);
    for (let i = 0; i < b.underTicks - 1; i++) {
      const t = advanceOneTick(s, level); s = t.state;
      expect(t.events.some((e) => e.type === 'TOWER_FIRED')).toBe(false);
    }
  });
  it('the Slime Queen splits into splitters', () => {
    let s = combat(apply(fresh(), [{ type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: cid(23, 15) }]));
    s = withEnemy(s, 'queen', 16, { hp: 1 });
    const events: GameEvent[] = [];
    for (let i = 0; i < 400 && !events.some((e) => e.type === 'ENEMY_KILLED' && e.kind === 'queen'); i++) {
      const t = advanceOneTick(s, level); s = t.state; events.push(...t.events);
    }
    expect(events.filter((e) => e.type === 'ENEMY_SPAWNED' && e.kind === 'splitter')).toHaveLength(ENEMY_DEFS.queen.splitInto!.count);
  });
});
