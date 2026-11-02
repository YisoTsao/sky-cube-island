import { describe, expect, it } from 'vitest';
import { validateLevel } from '../../src/levels/level-validator';
import { LEVEL_IDS, getLevel, nextLevelId } from '../../src/levels/registry';
import { buildSpawnQueue } from '../../src/simulation/waves';
import { deriveMap } from '../../src/navigation/derived-map';
import { resolveTowerFootprint } from '../../src/commands/execute';
import { computeRoutes } from '../../src/navigation/connectivity';
import { isUnlocked, recordVictory, loadProgress } from '../../src/persistence/progress';
import { checkpointKey, saveKey } from '../../src/persistence/save';

describe('campaign levels', () => {
  it.each(LEVEL_IDS)('%s is valid', (id) => {
    expect(validateLevel(getLevel(id)).errors).toEqual([]);
  });
  it.each(LEVEL_IDS)('%s fields at least ten enemy kinds', (id) => {
    const kinds = new Set(getLevel(id).waves.flatMap((w) => w.entries.map((e) => e.enemyKind)));
    expect(kinds.size).toBeGreaterThanOrEqual(10);
  });
  it.each(LEVEL_IDS)('%s: every wave spawns for 2+ minutes and sends 90–200 enemies', (id) => {
    const l = getLevel(id);
    const ids = l.portals.map((p) => p.id);
    for (const w of l.waves) {
      const q = buildSpawnQueue(w, ids);
      expect(Math.max(...q.map((x) => x.tick)), w.id).toBeGreaterThanOrEqual(120 * 20);
      expect(q.length, w.id).toBeGreaterThanOrEqual(90);
      expect(q.length, w.id).toBeLessThanOrEqual(200);
      for (const p of ids) expect(q.some((x) => x.portalId === p), `${w.id} ${p}`).toBe(true);
    }
  });
  it('runs in campaign order', () => {
    expect(nextLevelId('L1-01')).toBe('L1-02');
    expect(nextLevelId('L1-02')).toBeNull();
  });
});

describe('L1-02 霧谷晶石群島', () => {
  const level = getLevel('L1-02');
  it('has four islands, four connectors and three portals', () => {
    expect(level.platforms.map((p) => p.id).sort()).toEqual(['P_HIGH', 'P_NORTH', 'P_SOUTH', 'P_WEST']);
    expect(level.connectors).toHaveLength(4);
    expect(level.portals.map((p) => p.id)).toEqual(['A', 'B', 'C']);
    expect(level.theme).toBe('dusk');
  });
  it('has plenty of 2x2 tower spots on every island', () => {
    const map = deriveMap(level, { editedElevations: {}, towers: [], walls: [] });
    for (const p of level.platforms) {
      expect(p.cellIds.filter((id) => resolveTowerFootprint(map, id).ok).length, p.id).toBeGreaterThanOrEqual(8);
    }
  });
  it('lets portal A reach the core through either the ridge or the valley', () => {
    const blocked = (connectorId: string) => {
      const l = structuredClone(level);
      l.connectors = l.connectors.filter((c) => c.id !== connectorId);
      return computeRoutes(l, { editedElevations: {}, towers: [], walls: [] });
    };
    expect(blocked('C_WS').ok).toBe(true); // valley ramp gone → north
    expect(blocked('C_WN').ok).toBe(true); // ridge bridge gone → south
  });
});

describe('campaign progress', () => {
  it('unlocks L1-02 after clearing L1-01 and keeps the best stars', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
    };
    let p = loadProgress();
    expect(isUnlocked('L1-01', p)).toBe(true);
    expect(isUnlocked('L1-02', p)).toBe(false);
    p = recordVictory('L1-01', 3);
    p = recordVictory('L1-01', 1);
    expect(p.best['L1-01']).toBe(3);
    expect(isUnlocked('L1-02', loadProgress())).toBe(true);
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
  it('gives each level its own save slot while L1-01 keeps the original keys', () => {
    expect(saveKey(0)).toBe('skybound.v2.save.0');
    expect(saveKey(0, 'L1-01')).toBe('skybound.v2.save.0');
    expect(saveKey(0, 'L1-02')).not.toBe(saveKey(0));
    expect(checkpointKey(0, 'L1-02')).not.toBe(checkpointKey(0));
  });
});
