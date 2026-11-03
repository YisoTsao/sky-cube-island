import { describe, expect, it } from 'vitest';
import { ENEMY_KINDS } from '../../src/domain/types';
import { enemyGeometry } from '../../src/scene/models/enemies';

const tris = (g: ReturnType<typeof enemyGeometry>) => g.body.index!.count / 3 + (g.extra ? g.extra.index!.count / 3 : 0);

describe('enemy models', () => {
  it('builds every kind at both detail levels and shares the geometry per kind', () => {
    for (const k of ENEMY_KINDS) {
      for (const d of ['high', 'low'] as const) {
        const g = enemyGeometry(k, d);
        expect(g.body.index!.count, `${k}/${d}`).toBeGreaterThan(0);
        expect(g.height).toBeGreaterThan(0);
        expect(enemyGeometry(k, d)).toBe(g); // cached, not rebuilt per spawn
      }
    }
  });

  it('stays inside the phone triangle budget', () => {
    let high = 0, low = 0;
    for (const k of ENEMY_KINDS) {
      const h = tris(enemyGeometry(k, 'high')), l = tris(enemyGeometry(k, 'low'));
      expect(h, k).toBeLessThan(12000);
      expect(l, k).toBeLessThan(3500);
      high += h; low += l;
    }
    expect(high / ENEMY_KINDS.length).toBeLessThan(8000);
    expect(low / ENEMY_KINDS.length).toBeLessThan(2500);
  });
});
