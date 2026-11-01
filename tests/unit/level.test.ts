import { describe, expect, it } from 'vitest';
import { validateLevel } from '../../src/levels/level-validator';
import { level, cid, clone } from './helpers';
import type { LevelDef } from '../../src/domain/types';

describe('L1-01 level data (Tech §3.3, §12.1)', () => {
  it('is valid', () => {
    const r = validateLevel(level);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it('is a sparse 32x32 map with three platforms at different heights', () => {
    expect(level.width).toBe(32);
    expect(level.cells.length).toBeLessThan(1024);
    const elev = (pid: string) => level.cells.find((c) => c.platformId === pid && c.kind === 'ground' && !c.tags?.includes('plateau') && !c.tags?.includes('pillar'))!.elevation;
    expect([elev('P_LOW'), elev('P_MID'), elev('P_HIGH')]).toEqual([0, 2, 4]);
    expect(level.connectors).toHaveLength(2);
    expect(level.portals).toHaveLength(2);
  });
  it('has at least two 2x2 tower spots on each platform', async () => {
    const { deriveMap } = await import('../../src/navigation/derived-map');
    const { resolveTowerFootprint } = await import('../../src/commands/execute');
    const map = deriveMap(level, { editedElevations: {}, towers: [], walls: [] });
    for (const p of level.platforms) {
      const ok = p.cellIds.filter((id) => resolveTowerFootprint(map, id).ok);
      expect(ok.length, p.id).toBeGreaterThanOrEqual(2);
    }
  });
  it('has 4~6 edit zones worth of editable cells', () => {
    expect(level.cells.filter((c) => c.editable).length).toBeGreaterThan(40);
  });

  const mutate = (fn: (l: LevelDef) => void) => { const l = clone(level); fn(l); return validateLevel(l); };

  it('rejects a connector with a missing middle node', () => {
    expect(mutate((l) => { l.connectors[0]!.chain.splice(1, 1); }).ok).toBe(false);
  });
  it('rejects a connector with a height jump > 1', () => {
    expect(mutate((l) => { l.cells.find((c) => c.id === cid(10, 14))!.elevation = 3; }).ok).toBe(false);
  });
  it('rejects a non-3x3 core', () => {
    expect(mutate((l) => { l.core.footprintCellIds[8] = cid(24, 9); }).ok).toBe(false);
    expect(mutate((l) => { l.core.footprintCellIds[8] = l.core.footprintCellIds[0]!; }).ok).toBe(false);
  });
  it('rejects an approach not adjacent to the core', () => {
    expect(mutate((l) => { l.core.approachNodeIds[0] = cid(23, 9); }).ok).toBe(false);
  });
  it('rejects overlapping surfaces at the same x/z', () => {
    expect(mutate((l) => { l.cells.push({ ...l.cells[0]!, id: 'dup' }); }).ok).toBe(false);
  });
  it('rejects editable connector endpoints', () => {
    expect(mutate((l) => { const c = l.cells.find((x) => x.id === cid(9, 14))!; c.editable = true; c.immutable = false; }).ok).toBe(false);
  });
  it('rejects a level where a portal cannot reach the core', () => {
    expect(mutate((l) => { l.connectors = l.connectors.slice(0, 1); }).ok).toBe(false);
  });
});
