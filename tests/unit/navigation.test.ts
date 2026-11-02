import { describe, expect, it } from 'vitest';
import { level, fresh, cid } from './helpers';
import { deriveMap } from '../../src/navigation/derived-map';
import { buildNavigationGraph } from '../../src/navigation/build-graph';
import { computeRoutes } from '../../src/navigation/connectivity';
import { hasLineOfSight, sampleTowerRange } from '../../src/navigation/line-of-sight';

describe('NavigationGraph & A* (Tech §4, §12.2)', () => {
  const map = deriveMap(level, fresh());
  const g = buildNavigationGraph(map);

  it('crosses platforms only via connector chains', () => {
    const r = computeRoutes(level, fresh());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = r.routes.A!;
    expect(a[0]).toBe(cid(3, 14));
    for (const id of [cid(9, 14), cid(10, 14), cid(11, 14), cid(12, 14), cid(20, 13), cid(21, 13), cid(22, 13), cid(23, 13)]) {
      expect(a).toContain(id);
    }
    const b = r.routes.B!;
    expect(b).not.toContain(cid(10, 14));
    expect(b).toContain(cid(21, 13));
    // every step is 4-adjacent with |dh| <= 1
    for (const route of [a, b]) {
      for (let i = 0; i + 1 < route.length; i++) {
        const p = map.index.cells.get(route[i]!)!; const q = map.index.cells.get(route[i + 1]!)!;
        expect(Math.abs(p.pos.x - q.pos.x) + Math.abs(p.pos.z - q.pos.z)).toBe(1);
        expect(Math.abs(map.elevationOf(p.id) - map.elevationOf(q.id))).toBeLessThanOrEqual(1);
      }
      expect(level.core.approachNodeIds).toContain(route[route.length - 1]);
    }
  });
  it('deck nodes never link sideways', () => {
    for (const deck of [cid(10, 14), cid(11, 14), cid(21, 13), cid(22, 13)]) {
      expect(g.neighbors.get(deck)!.length).toBe(2);
    }
  });
  it('no ordinary edge across a 2+ level drop', () => {
    // rock pillar (elev 5) on the mid platform (elev 2)
    expect(g.neighbors.get(cid(17, 17)) ?? []).toHaveLength(0);
  });
  it('core footprint is not walkable', () => {
    for (const id of level.core.footprintCellIds) expect(g.nodes.has(id)).toBe(false);
  });
  it('is deterministic', () => {
    expect(computeRoutes(level, fresh())).toEqual(computeRoutes(level, fresh()));
  });
});

describe('Line of sight (Tech §7, §12.3)', () => {
  const map = deriveMap(level, fresh());
  it('is blocked by the rock pillar', () => {
    const from = { x: 16.5, y: 1 + 1.6, z: 17.5 };
    const to = { x: 18.5, y: 1 + 0.3, z: 17.5 };
    expect(hasLineOfSight(map, from, to, new Set([cid(16, 17), cid(18, 17)]))).toBe(false);
  });
  it('is clear over flat ground', () => {
    expect(hasLineOfSight(map, { x: 14, y: 2.6, z: 14 }, { x: 18.5, y: 1.3, z: 14.5 }, new Set([cid(18, 14)]))).toBe(true);
  });
  it('is blocked by the cliff of a higher platform', () => {
    // from low platform at ground level shooting into the mid-platform interior
    expect(hasLineOfSight(map, { x: 8, y: 0.4, z: 18 }, { x: 14.5, y: 1.3, z: 18.5 }, new Set([cid(14, 18)]))).toBe(false);
  });
  it('range projection marks the pillar shadow as occluded', () => {
    const samples = sampleTowerRange(map, { kind: 'arrow', level: 1, anchorCellId: cid(18, 15), footprintCellIds: [cid(18, 15), cid(19, 15), cid(18, 16), cid(19, 16)] });
    const s = new Map(samples.map((x) => [x.cellId, x.state]));
    expect(s.get(cid(17, 18))).toBe('occluded');
    expect(s.get(cid(17, 14))).toBe('visible');
  });
});
