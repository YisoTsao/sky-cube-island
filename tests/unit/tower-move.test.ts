import { describe, expect, it } from 'vitest';
import { level, fresh, cid } from './helpers';
import { executeCommand } from '../../src/commands/execute';
import { createSession, dispatch } from '../../src/session/undo-history';
import { GameController } from '../../src/state/game-controller';
import { TouchGestures } from '../../src/ui/touch-gestures';
import type { GameState } from '../../src/domain/types';

const run = (s: GameState, cmd: Parameters<typeof executeCommand>[2]) => executeCommand(level, s, cmd);
const built = () => {
  const r = run({ ...fresh(), gold: 1000 }, { type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: cid(14, 11) });
  if (!r.ok) throw new Error(r.message);
  const up = run(r.state, { type: 'UPGRADE_TOWER', towerId: r.state.towers[0]!.id });
  if (!up.ok) throw new Error(up.message);
  return up.state;
};

describe('MOVE_TOWER', () => {
  it('relocates a tower for free, keeping its level and investment', () => {
    const s = built();
    const t = s.towers[0]!;
    const r = run(s, { type: 'MOVE_TOWER', towerId: t.id, anchorCellId: cid(4, 10) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = r.state.towers[0]!;
    expect(m.id).toBe(t.id);
    expect(m.anchorCellId).toBe(cid(4, 10));
    expect(m.footprintCellIds).toHaveLength(4);
    expect(m.footprintCellIds).not.toContain(cid(14, 11));
    expect([m.level, m.investedGold, r.state.gold]).toEqual([t.level, t.investedGold, s.gold]);
    expect(r.events.map((e) => e.type)).toContain('TOWER_MOVED');
  });
  it('may slide over its own cells', () => {
    const s = built();
    const r = run(s, { type: 'MOVE_TOWER', towerId: s.towers[0]!.id, anchorCellId: cid(13, 11) });
    expect(r.ok).toBe(true);
  });
  it('rejects the same spot, illegal footprints and other towers', () => {
    let s = built();
    const t = s.towers[0]!;
    const same = run(s, { type: 'MOVE_TOWER', towerId: t.id, anchorCellId: t.anchorCellId });
    expect(!same.ok && same.code).toBe('SAME_POSITION');
    const hill = run(s, { type: 'MOVE_TOWER', towerId: t.id, anchorCellId: cid(15, 12) });
    expect(hill.ok).toBe(false);
    const b = run(s, { type: 'BUILD_TOWER', kind: 'frost', anchorCellId: cid(4, 10) });
    if (!b.ok) throw new Error(b.message);
    s = b.state;
    const onto = run(s, { type: 'MOVE_TOWER', towerId: t.id, anchorCellId: cid(4, 10) });
    expect(!onto.ok && onto.code).toBe('OCCUPIED');
  });
  it('is undoable during PREPARE', () => {
    const s = built();
    const session = createSession();
    const t = s.towers[0]!;
    const r = dispatch(level, session, s, { type: 'MOVE_TOWER', towerId: t.id, anchorCellId: cid(4, 10) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = dispatch(level, session, r.state, { type: 'UNDO_PREPARE' });
    expect(u.ok && u.state.towers[0]!.anchorCellId).toBe(t.anchorCellId);
  });
  it('controller lists move targets that all preview as legal footprints', () => {
    const c = new GameController(level);
    c.persist = false;
    c.state = { ...c.state, gold: 1000 };
    expect(c.dispatch({ type: 'BUILD_TOWER', kind: 'arrow', anchorCellId: cid(14, 11) }).ok).toBe(true);
    const id = c.state.towers[0]!.id;
    const targets = c.moveTargets(id);
    expect(targets.size).toBeGreaterThan(20);
    expect(targets.has(cid(4, 10))).toBe(true);
    const p = c.preview({ type: 'move', towerId: id }, cid(4, 10));
    expect(p?.ok).toBe(true);
    expect(p?.cost).toBe(0);
  });
});

describe('long press candidate', () => {
  it('only a single resting finger qualifies', () => {
    const g = new TouchGestures();
    g.down(1, 100, 100, 0);
    expect(g.stillSingle(1)).toBe(true);
    g.move(1, 103, 102);
    expect(g.stillSingle(1)).toBe(true);
    g.move(1, 140, 100);
    expect(g.stillSingle(1)).toBe(false);
    g.up(1, 140, 100, 300);
    g.down(2, 0, 0, 1000); g.down(3, 50, 0, 1001);
    expect(g.stillSingle(2)).toBe(false);
  });
});
