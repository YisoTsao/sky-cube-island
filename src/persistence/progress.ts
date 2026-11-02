import { LEVEL_IDS } from '../levels/registry';

/** Best local result for one level (GDD §16 T1 「關卡內最佳成績紀錄」). */
export interface LevelRecord {
  /** Highest core HP left on any clear. */
  bestHp: number;
  /** Challenge ids completed on any clear (union over runs). */
  challenges: string[];
  /** Number of clears. */
  clears: number;
}

/** Campaign progress: best stars per cleared level (localStorage, apart from game saves). */
export interface ProgressV1 { schemaVersion: 1; best: Record<string, 1 | 2 | 3>; records?: Record<string, LevelRecord> }

const KEY = 'skybound.progress.v1';
const empty = (): ProgressV1 => ({ schemaVersion: 1, best: {}, records: {} });

function cleanRecord(v: unknown): LevelRecord | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Partial<LevelRecord>;
  const bestHp = Number.isFinite(r.bestHp) ? Math.max(0, Math.floor(r.bestHp!)) : 0;
  const clears = Number.isFinite(r.clears) ? Math.max(0, Math.floor(r.clears!)) : 0;
  const challenges = Array.isArray(r.challenges) ? r.challenges.filter((x): x is string => typeof x === 'string') : [];
  return { bestHp, clears, challenges };
}

export function loadProgress(): ProgressV1 {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return empty();
    const p = JSON.parse(raw) as Partial<ProgressV1>;
    if (p?.schemaVersion !== 1 || typeof p.best !== 'object' || !p.best) return empty();
    const best: ProgressV1['best'] = {};
    for (const [k, v] of Object.entries(p.best)) if (v === 1 || v === 2 || v === 3) best[k] = v;
    const records: Record<string, LevelRecord> = {};
    if (p.records && typeof p.records === 'object') {
      for (const [k, v] of Object.entries(p.records)) { const r = cleanRecord(v); if (r) records[k] = r; }
    }
    return { schemaVersion: 1, best, records };
  } catch {
    return empty();
  }
}

function saveProgress(p: ProgressV1): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

export interface ClearResult { coreHp: number; challenges: string[] }

/** Store a clear (keeping the best star count / HP and the union of challenges) and return the updated progress. */
export function recordVictory(levelId: string, stars: 1 | 2 | 3, p: ProgressV1 = loadProgress(), clear?: ClearResult): ProgressV1 {
  const prev = p.records?.[levelId] ?? { bestHp: 0, challenges: [], clears: 0 };
  const rec: LevelRecord = clear
    ? { bestHp: Math.max(prev.bestHp, clear.coreHp), clears: prev.clears + 1, challenges: [...new Set([...prev.challenges, ...clear.challenges])] }
    : { ...prev, clears: prev.clears + 1 };
  const next: ProgressV1 = {
    schemaVersion: 1,
    best: { ...p.best, [levelId]: Math.max(stars, p.best[levelId] ?? 0) as 1 | 2 | 3 },
    records: { ...(p.records ?? {}), [levelId]: rec },
  };
  saveProgress(next);
  return next;
}

/** The first level is always open; every other level opens once the previous one is cleared. */
export function isUnlocked(levelId: string, p: ProgressV1): boolean {
  const i = (LEVEL_IDS as readonly string[]).indexOf(levelId);
  if (i <= 0) return i === 0;
  return !!p.best[LEVEL_IDS[i - 1]!];
}
