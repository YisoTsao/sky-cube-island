import type { SpawnQueueItem, WaveDef } from '../domain/types';

/**
 * Materialise a wave's spawn schedule (D21-07): the i-th enemy of an entry goes to
 * portalIds[i % length]; every portal keeps its own next-spawn tick advancing by intervalTicks.
 * Entries are consumed in order; an entry's optional delayTicks pushes each of its portals' clocks
 * forward before its first spawn (breathing room between groups). Ties on the same tick are ordered by portal list order, then
 * entry order — the stable sort below keeps insertion order for equal ticks.
 */
export function buildSpawnQueue(wave: WaveDef, portalOrder: readonly string[]): SpawnQueueItem[] {
  const next = new Map<string, number>();
  const items: (SpawnQueueItem & { portalRank: number; seq: number })[] = [];
  let seq = 0;
  for (const entry of wave.entries) {
    if (entry.delayTicks) for (const p of new Set(entry.portalIds)) next.set(p, (next.get(p) ?? 0) + entry.delayTicks);
    for (let i = 0; i < entry.count; i++) {
      const portalId = entry.portalIds[i % entry.portalIds.length]!;
      const tick = next.get(portalId) ?? 0;
      next.set(portalId, tick + entry.intervalTicks);
      items.push({ enemyKind: entry.enemyKind, portalId, tick, portalRank: portalOrder.indexOf(portalId), seq: seq++ });
    }
  }
  items.sort((a, b) => a.tick - b.tick || a.portalRank - b.portalRank || a.seq - b.seq);
  return items.map(({ enemyKind, portalId, tick }) => ({ enemyKind, portalId, tick }));
}

/** Enemy counts per portal for the wave preview cards (GDD §9.1). */
export function wavePreview(wave: WaveDef, portalOrder: readonly string[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const item of buildSpawnQueue(wave, portalOrder)) {
    const p = (out[item.portalId] ??= {});
    p[item.enemyKind] = (p[item.enemyKind] ?? 0) + 1;
  }
  return out;
}
