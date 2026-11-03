import type { EnemyKind, LevelDef, SpawnEntry, WaveDef } from '../domain/types';
import { ENEMY_DEFS } from '../domain/definitions';

/**
 * Endless mode (GDD §16 T3 「無盡模式」): the same island and rules as a cleared campaign level,
 * but the waves never stop. Each endless level is an ordinary LevelDef whose wave list is generated
 * deterministically from the base level's roster, so the engine, saves, undo and replays need no
 * special cases: wave n gets more enemies, tougher HP and, every fifth wave, the level's bosses.
 */

export const ENDLESS_SUFFIX = '-E';
/** Long enough that nobody reaches the end; the run is scored by waves cleared. */
export const ENDLESS_WAVE_COUNT = 99;

export const endlessIdOf = (baseId: string) => `${baseId}${ENDLESS_SUFFIX}`;
export const isEndlessId = (id: string) => id.endsWith(ENDLESS_SUFFIX);
export const baseIdOf = (id: string) => (isEndlessId(id) ? id.slice(0, -ENDLESS_SUFFIX.length) : id);

const BOSS_HP = 1000;
const TPS = 20;

/** Enemy kinds of the base level in order of first appearance (normal ones and bosses apart). */
export function rosterOf(base: LevelDef): { normal: EnemyKind[]; bosses: EnemyKind[] } {
  const seen: EnemyKind[] = [];
  for (const w of base.waves) for (const e of w.entries) if (!seen.includes(e.enemyKind)) seen.push(e.enemyKind);
  return {
    // weakest first so tougher kinds join the pool in later waves
    normal: seen.filter((k) => ENEMY_DEFS[k].hp < BOSS_HP).sort((a, b) => ENEMY_DEFS[a].hp - ENEMY_DEFS[b].hp),
    bosses: seen.filter((k) => ENEMY_DEFS[k].hp >= BOSS_HP),
  };
}

/** HP multiplier for endless wave n (0-based): gentle at first, then compounding. */
export function endlessHpScale(base: LevelDef, n: number): number {
  const start = base.waves[0]?.hpScale ?? 1;
  return Math.round(Math.min(start, 0.6) * (1 + 0.09 * n) * Math.pow(1.03, n) * 100) / 100;
}

export function endlessWave(base: LevelDef, n: number): WaveDef {
  const portals = base.portals.map((p) => p.id);
  const P = portals.length;
  const { normal, bosses } = rosterOf(base);
  // new kinds join gradually: wave 0 uses the first three, every wave adds one more to the pool
  const pool = normal.slice(0, Math.min(normal.length, 3 + n));
  const kindsThisWave = Math.min(pool.length, 3 + Math.floor(n / 4));
  // a rotating window over the pool, so consecutive waves mix different kinds
  const start = (n * 2) % pool.length;
  const kinds: EnemyKind[] = Array.from({ length: kindsThisWave }, (_, j) => pool[(start + j) % pool.length]!);
  const seconds = Math.min(110, 55 + 4 * n);
  const budget = (36 + 7 * n) * Math.max(1, P / 2); // "slime-equivalents" for the whole wave
  const slotTicks = Math.floor((seconds * TPS) / kinds.length);
  const entries: SpawnEntry[] = kinds.map((k) => {
    // tougher kinds come in smaller numbers so every wave weighs about the same per slot
    const weight = Math.sqrt(ENEMY_DEFS[k].hp / 90);
    const perPortal = Math.max(1, Math.round(budget / kinds.length / weight / P));
    return { enemyKind: k, count: perPortal * P, portalIds: portals, intervalTicks: Math.max(8, Math.floor(slotTicks / perPortal)) };
  });
  if (bosses.length && n % 5 === 4) {
    const boss = bosses[Math.floor(n / 5) % bosses.length]!;
    const count = 1 + Math.floor(n / 15);
    // the boss walks in halfway through, from the first portals
    entries.splice(Math.ceil(entries.length / 2), 0, { enemyKind: boss, count, portalIds: portals.slice(0, Math.max(1, Math.min(P, count))), intervalTicks: 60, delayTicks: 40 });
  }
  return { id: `e${n + 1}`, entries, clearGold: Math.min(260, 90 + 12 * n), hpScale: endlessHpScale(base, n) };
}

const cache = new Map<string, LevelDef>();

/** The endless variant of a campaign level (same map, generated waves, its own save slot). */
export function makeEndlessLevel(base: LevelDef): LevelDef {
  const hit = cache.get(base.id);
  if (hit) return hit;
  const level: LevelDef = {
    ...base,
    id: endlessIdOf(base.id),
    name: `${base.name}・無盡`,
    subtitle: '波次永不停止，看你能撐到第幾波',
    endless: { baseId: base.id },
    waves: Array.from({ length: ENDLESS_WAVE_COUNT }, (_, n) => endlessWave(base, n)),
  };
  cache.set(base.id, level);
  return level;
}
