import { describe, expect, it } from 'vitest';
import { level, fresh, cid, clone } from './helpers';
import { executeCommand } from '../../src/commands/execute';
import { createSession, dispatch } from '../../src/session/undo-history';
import { computeRoutes } from '../../src/navigation/connectivity';
import type { GameState } from '../../src/domain/types';

const run = (s: GameState, cmd: Parameters<typeof executeCommand>[2]) => executeCommand(level, s, cmd);

describe('Edit commands (Tech §6, §12.2)', () => {
  it('builds a 2x2 tower and charges gold', () => {
    const r = run(fresh(), { type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: cid(14, 11) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.gold).toBe(150);
    expect(r.state.towers[0]!.footprintCellIds).toHaveLength(4);
  });
  it('rejects a footprint across two heights', () => {
    const r = run(fresh(), { type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: cid(15, 12) }); // touches hill (16,12)
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_FOOTPRINT');
  });
  it('rejects a footprint touching void / bridge', () => {
    for (const a of [cid(20, 14), cid(9, 18), cid(8, 13)]) {
      const r = run(fresh(), { type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: a });
      expect(r.ok, a).toBe(false);
    }
  });
  it('rejects protected connector edits', () => {
    const r = run(fresh(), { type: 'SET_ELEVATION', cellId: cid(9, 14), next: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('PROTECTED_CONNECTOR');
  });
  it('requires single-step elevation changes (pay twice for two levels)', () => {
    const s = fresh();
    expect(run(s, { type: 'SET_ELEVATION', cellId: cid(6, 12), next: 2 }).ok).toBe(false);
    const r1 = run(s, { type: 'SET_ELEVATION', cellId: cid(6, 12), next: 1 });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = run(r1.state, { type: 'SET_ELEVATION', cellId: cid(6, 12), next: 2 });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.state.gold).toBe(220 - 24);
  });
  it('rejects blocking every route with zero side effects', () => {
    // Test-only clone: make the ring around Portal A editable, then try to wall it in completely.
    const l = clone(level);
    const ring: string[] = [];
    for (let z = 12; z <= 16; z++) for (let x = 1; x <= 5; x++) {
      if (Math.max(Math.abs(x - 3), Math.abs(z - 14)) !== 2) continue;
      const c = l.cells.find((k) => k.id === cid(x, z));
      if (c) { c.editable = true; c.immutable = false; ring.push(c.id); }
    }
    let s = { ...fresh(), gold: 5000 };
    let lastFail: ReturnType<typeof executeCommand> | null = null;
    let inputOfFail: typeof s | null = null;
    for (const w of ring) {
      const r = executeCommand(l, s, { type: 'PLACE_WALL', cellId: w });
      if (r.ok) s = r.state; else { lastFail = r; inputOfFail = s; }
    }
    expect(computeRoutes(l, s).ok).toBe(true);
    expect(lastFail).not.toBeNull();
    if (lastFail && !lastFail.ok) {
      expect(lastFail.code).toBe('NO_ROUTE_FROM_PORTAL');
      expect(lastFail.portalId).toBe('A');
      expect(lastFail.state).toBe(inputOfFail);
    }
  });
  it('rejects with insufficient gold and keeps state', () => {
    const s = { ...fresh(), gold: 10 };
    const r = run(s, { type: 'PLACE_WALL', cellId: cid(6, 12) });
    expect(r.ok).toBe(false);
    expect(r.state).toBe(s);
  });
  it('upgrades and sells with the right economy', () => {
    let s = fresh();
    const b = run(s, { type: 'BUILD_TOWER', kind: 'cannon', anchorCellId: cid(14, 11) });
    if (!b.ok) throw new Error('build');
    s = b.state;
    const id = s.towers[0]!.id;
    const u1 = run(s, { type: 'UPGRADE_TOWER', towerId: id });
    if (!u1.ok) throw new Error('up');
    expect(u1.state.gold).toBe(220 - 105 - 74);
    const sell = run(u1.state, { type: 'SELL_TOWER', towerId: id });
    if (!sell.ok) throw new Error('sell');
    expect(sell.state.gold).toBe(u1.state.gold + Math.floor((105 + 74) * 0.65));
    expect(sell.state.towers).toHaveLength(0);
  });
  it('wall remove refunds 7', () => {
    const p = run(fresh(), { type: 'PLACE_WALL', cellId: cid(6, 12) });
    if (!p.ok) throw new Error();
    const r = run(p.state, { type: 'REMOVE_WALL', wallId: p.state.walls[0]!.id });
    expect(r.ok && r.state.gold).toBe(220 - 15 + 7);
  });
  it('commands are rejected outside PREPARE', () => {
    const s: GameState = { ...fresh(), phase: 'COMBAT' };
    const r = run(s, { type: 'PLACE_WALL', cellId: cid(6, 12) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_PHASE');
  });
  it('wall that detours lengthens the route used by the wave', () => {
    const base = computeRoutes(level, fresh());
    const p = run(fresh(), { type: 'PLACE_WALL', cellId: cid(18, 13) });
    expect(p.ok).toBe(true);
    if (!p.ok || !base.ok) return;
    const after = computeRoutes(level, p.state);
    expect(after.ok).toBe(true);
    const sw = run(p.state, { type: 'START_WAVE' });
    if (!sw.ok || !after.ok) throw new Error();
    expect(sw.state.frozenRoutes).toEqual(after.routes);
    expect(after.routes.A).not.toContain(cid(18, 13));
  });
});

describe('Undo (Tech §6.4, §12.2)', () => {
  it('build → raise → undo twice restores exactly', () => {
    const session = createSession();
    const s0 = fresh();
    const r1 = dispatch(level, session, s0, { type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: cid(14, 11) });
    if (!r1.ok) throw new Error();
    const r2 = dispatch(level, session, r1.state, { type: 'SET_ELEVATION', cellId: cid(6, 12), next: 1 });
    if (!r2.ok) throw new Error();
    const u1 = dispatch(level, session, r2.state, { type: 'UNDO_PREPARE' });
    if (!u1.ok) throw new Error();
    const u2 = dispatch(level, session, u1.state, { type: 'UNDO_PREPARE' });
    if (!u2.ok) throw new Error();
    expect(u2.state).toEqual(s0);
    const u3 = dispatch(level, session, u2.state, { type: 'UNDO_PREPARE' });
    expect(u3.ok).toBe(false);
    if (!u3.ok) { expect(u3.code).toBe('NOTHING_TO_UNDO'); expect(u3.state).toBe(u2.state); }
  });
  it('keeps only the last 20 steps', () => {
    const session = createSession();
    let s = { ...fresh(), gold: 9999 };
    const cells = [cid(5, 11), cid(6, 11)];
    for (let i = 0; i < 25; i++) {
      const c = cells[i % 2]!;
      const cur = (s.editedElevations[c] ?? 0);
      const r = dispatch(level, session, s, { type: 'SET_ELEVATION', cellId: c, next: (cur === 0 ? 1 : 0) as 0 | 1 });
      if (!r.ok) throw new Error(r.message);
      s = r.state;
    }
    expect(session.history).toHaveLength(20);
  });
  it('is rejected during COMBAT and cleared by START_WAVE', () => {
    const session = createSession();
    const r1 = dispatch(level, session, fresh(), { type: 'PLACE_WALL', cellId: cid(6, 12) });
    if (!r1.ok) throw new Error();
    const sw = dispatch(level, session, r1.state, { type: 'START_WAVE' });
    if (!sw.ok) throw new Error();
    const u = dispatch(level, session, sw.state, { type: 'UNDO_PREPARE' });
    expect(!u.ok && u.code).toBe('INVALID_PHASE');
    expect(session.history).toHaveLength(0);
  });
});
