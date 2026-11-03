import { describe, expect, it } from 'vitest';
import { CHAPTERS, GENERATED_SPECS } from '../../src/levels/campaign';
import { generateLevel } from '../../src/levels/procgen';
import { getLevel, LEVEL_IDS, nextLevelId } from '../../src/levels/registry';
import { validateLevel } from '../../src/levels/level-validator';
import { ENEMY_DEFS } from '../../src/domain/definitions';
import { executeCommand } from '../../src/commands/execute';
import { createInitialState } from '../../src/simulation/engine';
import { buildSpawnQueue } from '../../src/simulation/waves';

describe('campaign: 3 chapters × 5 islands', () => {
  it('chapters list every campaign level once, in order', () => {
    expect(CHAPTERS).toHaveLength(3);
    for (const c of CHAPTERS) expect(c.levelIds).toHaveLength(5);
    expect(CHAPTERS.flatMap((c) => c.levelIds)).toEqual([...LEVEL_IDS]);
    expect(nextLevelId('L1-05')).toBe('L2-01');
    expect(nextLevelId('L3-05')).toBeNull();
  });

  it.each(LEVEL_IDS.slice(4))('%s is a valid generated island', (id) => {
    const l = getLevel(id);
    expect(validateLevel(l).errors).toEqual([]);
    expect(l.waves.length).toBeGreaterThanOrEqual(6);
    // the final wave has a boss; every portal spawns something
    const last = l.waves[l.waves.length - 1]!;
    expect(last.entries.some((e) => ENEMY_DEFS[e.enemyKind].hp >= 1000)).toBe(true);
    for (const w of l.waves) {
      const q = buildSpawnQueue(w, l.portals.map((p) => p.id));
      expect(Math.max(...q.map((x) => x.tick)) / 20, `${id} ${w.id}`).toBeGreaterThanOrEqual(120);
      expect(q.length, `${id} ${w.id}`).toBeGreaterThanOrEqual(30);
      expect(q.length, `${id} ${w.id}`).toBeLessThanOrEqual(320);
    }
    for (const p of l.portals) expect(l.waves.some((w) => w.entries.some((e) => e.portalIds.includes(p.id)))).toBe(true);
  });

  it('generation is deterministic', () => {
    const spec = GENERATED_SPECS.find((s) => s.id === 'L2-04')!;
    const a = generateLevel({ ...spec, id: 'X1' });
    const b = generateLevel({ ...spec, id: 'X2' });
    expect(JSON.stringify({ ...a, id: '' })).toBe(JSON.stringify({ ...b, id: '' }));
  });

  it('later chapters feature the new enemies and collapsible bridges', () => {
    const kinds = new Set(LEVEL_IDS.slice(5).flatMap((id) => getLevel(id).waves.flatMap((w) => w.entries.map((e) => e.enemyKind))));
    expect(kinds.has('wyvern')).toBe(true);
    expect(kinds.has('ram')).toBe(true);
    for (const id of LEVEL_IDS.slice(5)) {
      const l = getLevel(id);
      const s = { ...createInitialState(l, 1), gold: 9999 };
      expect(l.connectors.some((c) => executeCommand(l, s, { type: 'TOGGLE_BRIDGE', connectorId: c.id }).ok), id).toBe(true);
    }
  });
});
