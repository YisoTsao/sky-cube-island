import { describe, expect, it } from 'vitest';
import { level, fresh, cid } from './helpers';
import { getLevel } from '../../src/levels/registry';
import { createInitialState, advanceOneTick, remainingDistance } from '../../src/simulation/engine';
import { executeCommand } from '../../src/commands/execute';
import { computeRoutes } from '../../src/navigation/connectivity';
import { createSession, dispatch } from '../../src/session/undo-history';
import { ECONOMY, TRAP_DEF } from '../../src/domain/definitions';
import type { EnemyKind, GameEvent, GameState, LevelDef } from '../../src/domain/types';
import { GameStateSchema } from '../../src/domain/schemas';
import { toSaveFile, parseSave } from '../../src/persistence/save';

/** L1-01 with a single wave of `n` enemies of one kind from portal A. */
function oneKind(kind: EnemyKind, n = 1, base: LevelDef = level): LevelDef {
  return { ...base, waves: [{ id: 'w1', clearGold: 10, entries: [{ enemyKind: kind, count: n, portalIds: [base.portals[0]!.id], intervalTicks: 20 }] }] };
}

function runWave(l: LevelDef, s: GameState, maxTicks = 20000): { state: GameState; events: GameEvent[] } {
  const st = executeCommand(l, s, { type: 'START_WAVE' });
  expect(st.ok).toBe(true);
  let cur = st.state;
  const events: GameEvent[] = [];
  for (let i = 0; i < maxTicks && cur.phase === 'COMBAT'; i++) {
    const r = advanceOneTick(cur, l);
    cur = r.state; events.push(...r.events);
  }
  return { state: cur, events };
}

describe('1×1 spike traps', () => {
  it('sit on a route cell without changing routes, cost gold and refund half', () => {
    const s = fresh();
    const route = computeRoutes(level, s);
    expect(route.ok).toBe(true);
    const onRoute = (route.ok ? route.routes.A! : [])[4]!;
    const r = executeCommand(level, s, { type: 'PLACE_TRAP', cellId: onRoute });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.gold).toBe(s.gold - TRAP_DEF.cost);
    expect(r.events.some((e) => e.type === 'ROUTES_CHANGED')).toBe(false);
    const again = executeCommand(level, r.state, { type: 'PLACE_TRAP', cellId: onRoute });
    expect(again.ok).toBe(false);
    const rm = executeCommand(level, r.state, { type: 'REMOVE_TRAP', trapId: r.state.traps![0]!.id });
    expect(rm.ok && rm.state.gold).toBe(r.state.gold + TRAP_DEF.refund);
  });

  it('cannot go on portals, bridges or the core approach', () => {
    const s = fresh();
    for (const id of [level.portals[0]!.cellId, level.connectors[0]!.chain[1]!, level.core.approachNodeIds[0]!]) {
      const r = executeCommand(level, s, { type: 'PLACE_TRAP', cellId: id });
      expect(r.ok, id).toBe(false);
    }
  });

  it('damages ground enemies walking over it, never flyers', () => {
    for (const [kind, expectHit] of [['slime', true], ['wyvern', false]] as const) {
      const l = oneKind(kind, 1);
      const s0 = createInitialState(l, 1);
      const route = computeRoutes(l, s0);
      const cell = (route.ok ? route.routes.A! : [])[3]!;
      const placed = executeCommand(l, s0, { type: 'PLACE_TRAP', cellId: cell });
      expect(placed.ok).toBe(true);
      const { events } = runWave(l, placed.state);
      expect(events.some((e) => e.type === 'TRAP_TRIGGERED'), kind).toBe(expectHit);
    }
  });

  it('survive save/load', () => {
    const s = fresh();
    const r = executeCommand(level, s, { type: 'PLACE_TRAP', cellId: cid(5, 14) });
    if (!r.ok) throw new Error(r.message);
    expect(GameStateSchema.safeParse(r.state).success).toBe(true);
    expect(parseSave(toSaveFile(r.state), level.id)?.traps).toEqual(r.state.traps);
  });
});

describe('flying enemies', () => {
  it('fly a straight two-node path to the nearest core approach, faster than the road', () => {
    const l = oneKind('wyvern', 1);
    const st = executeCommand(l, createInitialState(l, 1), { type: 'START_WAVE' });
    if (!st.ok) throw new Error(st.message);
    const r = advanceOneTick(st.state, l);
    const e = r.state.enemies[0]!;
    expect(e.pathNodeIds).toHaveLength(2);
    expect(e.flightDist).toBeGreaterThan(5);
    expect(l.core.approachNodeIds).toContain(e.pathNodeIds[1]);
    expect(remainingDistance(e)).toBeCloseTo(e.flightDist! * (1 - e.segmentProgress), 5);
    const road = st.state.frozenRoutes.A!.length - 1;
    expect(e.flightDist!).toBeLessThan(road);
    const { events } = runWave(l, createInitialState(l, 1));
    expect(events.some((x) => x.type === 'ENEMY_REACHED_CORE')).toBe(true);
  });

  it('ignore walls entirely', () => {
    const l = oneKind('wyvern', 1);
    const s = createInitialState(l, 1);
    const w = executeCommand(l, s, { type: 'PLACE_WALL', cellId: cid(6, 12) });
    if (!w.ok) throw new Error(w.message);
    const { events } = runWave(l, w.state);
    expect(events.some((x) => x.type === 'WALL_DESTROYED')).toBe(false);
  });
});

describe('wall-breaking enemies', () => {
  it('walk through where a wall forced a detour and smash it', () => {
    const l = oneKind('ram', 1);
    const s = createInitialState(l, 1);
    const before = computeRoutes(l, s);
    if (!before.ok) throw new Error('route');
    // find a wall cell on route A that keeps every portal connected
    let walled: GameState | null = null; let wallCell = '';
    for (const c of before.routes.A!) {
      const r = executeCommand(l, s, { type: 'PLACE_WALL', cellId: c });
      if (r.ok) { walled = r.state; wallCell = c; break; }
    }
    expect(walled).not.toBeNull();
    const { state, events } = runWave(l, walled!);
    const smash = events.find((e) => e.type === 'WALL_DESTROYED');
    expect(smash && smash.type === 'WALL_DESTROYED' && smash.cellId).toBe(wallCell);
    expect(state.walls.some((w) => w.cellId === wallCell)).toBe(false);
    expect(events.some((e) => e.type === 'ENEMY_REACHED_CORE')).toBe(true);
  });

  it('use the normal road when there are no walls', () => {
    const l = oneKind('ram', 1);
    const st = executeCommand(l, createInitialState(l, 1), { type: 'START_WAVE' });
    if (!st.ok) throw new Error(st.message);
    const r = advanceOneTick(st.state, l);
    expect(r.state.enemies[0]!.pathNodeIds).toEqual(st.state.frozenRoutes.A);
  });
});

describe('collapsible bridges', () => {
  it('refuses to drop a bridge every portal depends on', () => {
    const r = executeCommand(level, fresh(), { type: 'TOGGLE_BRIDGE', connectorId: level.connectors[0]!.id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NO_ROUTE_FROM_PORTAL');
  });

  it('drops a redundant bridge, reroutes, repairs, and undo restores it', () => {
    const l = getLevel('L1-02');
    const s = createInitialState(l, 1);
    const session = createSession();
    const before = computeRoutes(l, s);
    const con = l.connectors.find((c) => before.ok && Object.values(before.routes).some((r) => r.includes(c.chain[1]!)))!;
    const r = dispatch(l, session, s, { type: 'TOGGLE_BRIDGE', connectorId: con.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.brokenConnectors).toEqual([con.id]);
    expect(r.state.gold).toBe(s.gold - ECONOMY.bridgeCollapseCost);
    const after = computeRoutes(l, r.state);
    expect(after.ok).toBe(true);
    if (after.ok) for (const route of Object.values(after.routes)) expect(route.some((id) => con.chain.slice(1, -1).includes(id))).toBe(false);
    const fix = executeCommand(l, r.state, { type: 'TOGGLE_BRIDGE', connectorId: con.id });
    expect(fix.ok && fix.state.brokenConnectors).toEqual([]);
    expect(fix.ok && fix.state.gold).toBe(r.state.gold - ECONOMY.bridgeRepairCost);
    const undo = dispatch(l, session, r.state, { type: 'UNDO_PREPARE' });
    expect(undo.ok && (undo.state.brokenConnectors ?? [])).toEqual([]);
    expect(undo.ok && undo.state.gold).toBe(s.gold);
  });
});
