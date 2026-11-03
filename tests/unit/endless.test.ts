import { beforeEach, describe, expect, it } from 'vitest';
import { getLevel, getPlayableLevel, isPlayableId, LEVEL_IDS } from '../../src/levels/registry';
import { ENDLESS_WAVE_COUNT, baseIdOf, endlessIdOf, isEndlessId, makeEndlessLevel, rosterOf } from '../../src/levels/endless';
import { validateLevel } from '../../src/levels/level-validator';
import { LevelDefSchema } from '../../src/domain/schemas';
import { ENEMY_DEFS } from '../../src/domain/definitions';
import { isEndlessUnlocked, loadProgress, recordEndless, recordVictory } from '../../src/persistence/progress';
import { createInitialState } from '../../src/simulation/engine';
import { executeCommand } from '../../src/commands/execute';
import { AmbientLife } from '../../src/scene/environment/ambient-life';

describe('endless mode levels', () => {
  it('ids round-trip and resolve through the registry', () => {
    expect(endlessIdOf('L1-02')).toBe('L1-02-E');
    expect(isEndlessId('L1-02-E')).toBe(true);
    expect(baseIdOf('L1-02-E')).toBe('L1-02');
    expect(isPlayableId('L1-03-E')).toBe(true);
    expect(isPlayableId('L9-01-E')).toBe(false);
    expect(getPlayableLevel('L1-01-E').endless).toEqual({ baseId: 'L1-01' });
  });

  it.each(LEVEL_IDS)('%s endless variant is a valid level on the same map', (id) => {
    const base = getLevel(id);
    const e = makeEndlessLevel(base);
    expect(e.id).toBe(`${id}-E`);
    expect(e.cells).toBe(base.cells);
    expect(e.waves).toHaveLength(ENDLESS_WAVE_COUNT);
    expect(LevelDefSchema.safeParse(e).success).toBe(true);
    expect(validateLevel(e).ok).toBe(true);
    // deterministic
    expect(JSON.stringify(makeEndlessLevel(base).waves)).toBe(JSON.stringify(e.waves));
  });

  it.each(LEVEL_IDS)('%s endless waves only use the base roster, grow tougher, and bring bosses every fifth wave', (id) => {
    const base = getLevel(id);
    const e = makeEndlessLevel(base);
    const { normal, bosses } = rosterOf(base);
    const allowed = new Set([...normal, ...bosses]);
    let prevScale = 0;
    e.waves.forEach((w, n) => {
      for (const en of w.entries) {
        expect(allowed.has(en.enemyKind)).toBe(true);
        expect(en.portalIds.every((p) => base.portals.some((x) => x.id === p))).toBe(true);
      }
      expect(w.hpScale!).toBeGreaterThan(prevScale);
      prevScale = w.hpScale!;
      const hasBoss = w.entries.some((en) => ENEMY_DEFS[en.enemyKind].hp >= 1000);
      expect(hasBoss).toBe(bosses.length > 0 && n % 5 === 4);
    });
    // the first wave starts with the weakest kinds only
    const firstKinds = e.waves[0]!.entries.map((x) => ENEMY_DEFS[x.enemyKind].hp);
    expect(Math.max(...firstKinds)).toBeLessThanOrEqual(ENEMY_DEFS[normal[2]!].hp);
  });

  it('runs through the ordinary engine (start wave, saves use their own level id)', () => {
    const e = makeEndlessLevel(getLevel('L1-01'));
    const s = createInitialState(e, 1);
    expect(s.levelId).toBe('L1-01-E');
    const r = executeCommand(e, s, { type: 'START_WAVE' });
    expect(r.ok).toBe(true);
  });
});

describe('endless records', () => {
  beforeEach(() => { globalThis.localStorage?.clear(); });
  it('unlocks after the campaign clear and keeps only the best wave count', () => {
    let p = loadProgress();
    expect(isEndlessUnlocked('L1-01', p)).toBe(false);
    p = recordVictory('L1-01', 2, p);
    expect(isEndlessUnlocked('L1-01', p)).toBe(true);
    p = recordEndless('L1-01', 7, p);
    expect(p.endless?.['L1-01']).toBe(7);
    p = recordEndless('L1-01', 4, p);
    expect(p.endless?.['L1-01']).toBe(7);
    p = recordVictory('L1-02', 3, p);
    expect(p.endless?.['L1-01']).toBe(7);
  });
});

describe('ambient life (presentation)', () => {
  it.each(LEVEL_IDS)('%s finds spaced waterfall spots on open cliff edges', (id) => {
    const level = getLevel(id);
    const spots = AmbientLife.fallSpots(level);
    expect(spots.length).toBeGreaterThan(0);
    const byPos = new Set(level.cells.map((c) => `${c.pos.x},${c.pos.z}`));
    for (const s of spots) {
      expect(byPos.has(`${s.cell.pos.x + s.dir[0]},${s.cell.pos.z + s.dir[1]}`)).toBe(false);
      expect(level.core.footprintCellIds).not.toContain(s.cell.id);
    }
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
      expect(Math.hypot(spots[i]!.cell.pos.x - spots[j]!.cell.pos.x, spots[i]!.cell.pos.z - spots[j]!.cell.pos.z)).toBeGreaterThanOrEqual(7);
    }
  });
});
