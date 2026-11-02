import type { CellId, EnemyKind, GameEvent } from '../domain/types';

export interface TowerWaveStats { towerId: string; damage: number; kills: number }
export interface WaveStats {
  waveIndex: number;
  towers: Record<string, TowerWaveStats>;
  leaksByPortal: Record<string, number>;
  leakKinds: Partial<Record<EnemyKind, number>>;
  leakTrails: CellId[][];
  coreTimeline: { tick: number; hpAfter: number }[];
  kills: number;
  goldEarned: number;
}

export const emptyWaveStats = (waveIndex: number): WaveStats => ({
  waveIndex, towers: {}, leaksByPortal: {}, leakKinds: {}, leakTrails: [], coreTimeline: [], kills: 0, goldEarned: 0,
});

/** Pure event fold (Tech §8.4) — never feeds back into the simulation. */
export function foldWaveStats(stats: WaveStats, e: GameEvent): WaveStats {
  switch (e.type) {
    case 'WAVE_STARTED': return emptyWaveStats(e.waveIndex);
    case 'ENEMY_DAMAGED': {
      const t = stats.towers[e.sourceTowerId] ?? { towerId: e.sourceTowerId, damage: 0, kills: 0 };
      return { ...stats, towers: { ...stats.towers, [e.sourceTowerId]: { ...t, damage: t.damage + e.amount } } };
    }
    case 'ENEMY_KILLED': {
      const t = stats.towers[e.killerTowerId] ?? { towerId: e.killerTowerId, damage: 0, kills: 0 };
      return { ...stats, kills: stats.kills + 1, goldEarned: stats.goldEarned + e.gold, towers: { ...stats.towers, [e.killerTowerId]: { ...t, kills: t.kills + 1 } } };
    }
    case 'ENEMY_REACHED_CORE':
      return {
        ...stats,
        leaksByPortal: { ...stats.leaksByPortal, [e.portalId]: (stats.leaksByPortal[e.portalId] ?? 0) + 1 },
        leakKinds: { ...stats.leakKinds, [e.kind]: (stats.leakKinds[e.kind] ?? 0) + 1 },
        leakTrails: [...stats.leakTrails, e.lastNodeIds],
      };
    case 'CORE_DAMAGED': return { ...stats, coreTimeline: [...stats.coreTimeline, { tick: e.tick, hpAfter: e.hpAfter }] };
    case 'WAVE_CLEARED': return { ...stats, goldEarned: stats.goldEarned + e.clearGold };
    default: return stats;
  }
}

export interface FailureContext {
  stats: WaveStats;
  /** Frozen route per portal. */
  routes: Record<string, CellId[]>;
  /** Cells covered (visible) by at least one tower. */
  covered: Set<CellId>;
  /** Human name of the place a cell belongs to (platform / connector). */
  placeOf(cellId: CellId): string;
  portalName(portalId: string): string;
  towerCount: number;
}

/**
 * Rule-based one-line failure analysis (Tech §8.4): take the portal with most leaks, find the
 * longest uncovered stretch of its route, name the place.
 */
export function analyseFailure(ctx: FailureContext): string {
  const entries = Object.entries(ctx.stats.leaksByPortal).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '核心被擊破了。試著在敵人必經的橋口集中火力。';
  const [portalId, count] = entries[0]!;
  const route = ctx.routes[portalId] ?? [];
  if (ctx.towerCount === 0) return `${ctx.portalName(portalId)} 漏了 ${count} 隻：場上沒有防禦塔，先在高台或橋口建造箭塔。`;
  let best: { start: number; len: number } = { start: -1, len: 0 };
  let cur = { start: -1, len: 0 };
  route.forEach((id, i) => {
    if (!ctx.covered.has(id)) {
      if (cur.start < 0) cur = { start: i, len: 0 };
      cur.len++;
      if (cur.len > best.len) best = { ...cur };
    } else cur = { start: -1, len: 0 };
  });
  if (best.len >= 3) {
    const places = new Map<string, number>();
    for (let i = best.start; i < best.start + best.len; i++) {
      const p = ctx.placeOf(route[i]!);
      places.set(p, (places.get(p) ?? 0) + 1);
    }
    const place = [...places.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    return `${ctx.portalName(portalId)} 漏了 ${count} 隻：${place}有 ${best.len} 格路線沒有任何火力覆蓋。`;
  }
  const golems = ctx.stats.leakKinds.golem ?? 0;
  if (golems >= Math.max(1, count / 2)) return `${ctx.portalName(portalId)} 漏了 ${count} 隻，多數是石殼巨人：物理減傷 20%，試試冰晶塔減速或升級砲塔。`;
  return `${ctx.portalName(portalId)} 漏了 ${count} 隻：路線雖有覆蓋但火力不足，升級塔或用地形讓敵人多繞一段。`;
}
