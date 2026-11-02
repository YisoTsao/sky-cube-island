import { LEVEL_IDS } from '../levels/registry';

/** Campaign progress: best stars per cleared level (localStorage, apart from game saves). */
export interface ProgressV1 { schemaVersion: 1; best: Record<string, 1 | 2 | 3> }

const KEY = 'skybound.progress.v1';
const empty = (): ProgressV1 => ({ schemaVersion: 1, best: {} });

export function loadProgress(): ProgressV1 {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return empty();
    const p = JSON.parse(raw) as Partial<ProgressV1>;
    if (p?.schemaVersion !== 1 || typeof p.best !== 'object' || !p.best) return empty();
    const best: ProgressV1['best'] = {};
    for (const [k, v] of Object.entries(p.best)) if (v === 1 || v === 2 || v === 3) best[k] = v;
    return { schemaVersion: 1, best };
  } catch {
    return empty();
  }
}

function saveProgress(p: ProgressV1): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

/** Store a clear (keeping the best star count) and return the updated progress. */
export function recordVictory(levelId: string, stars: 1 | 2 | 3, p: ProgressV1 = loadProgress()): ProgressV1 {
  const next: ProgressV1 = { schemaVersion: 1, best: { ...p.best, [levelId]: Math.max(stars, p.best[levelId] ?? 0) as 1 | 2 | 3 } };
  saveProgress(next);
  return next;
}

/** The first level is always open; every other level opens once the previous one is cleared. */
export function isUnlocked(levelId: string, p: ProgressV1): boolean {
  const i = (LEVEL_IDS as readonly string[]).indexOf(levelId);
  if (i <= 0) return i === 0;
  return !!p.best[LEVEL_IDS[i - 1]!];
}
