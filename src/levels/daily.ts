import type { EnemyKind, LevelDef, LevelTheme, WeatherKind } from '../domain/types';
import { generateLevel, rng, type Corner, type GeneratedLevelSpec, type Side } from './procgen';

/**
 * Daily seeded challenge (GDD §16 T3「每日種子挑戰」): one generated island per calendar day,
 * the same for every player on that date. The seed is the date, so the layout, roster, weather
 * and the day's modifier never change once the day is known; saves and records are keyed by the
 * daily id (`D-2026-11-03`) like any other level.
 */

export const DAILY_PREFIX = 'D-';
export const isDailyId = (id: string) => /^D-\d{4}-\d{2}-\d{2}$/.test(id);
export const dailyIdFor = (date: string) => `${DAILY_PREFIX}${date}`;
export const dateOfDaily = (id: string) => id.slice(DAILY_PREFIX.length);

/** Local calendar date as YYYY-MM-DD. */
export function todayString(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function hashDate(date: string): number {
  let h = 2166136261;
  for (let i = 0; i < date.length; i++) h = Math.imul(h ^ date.charCodeAt(i), 16777619);
  return (h >>> 0) % 1_000_000 + 1;
}

const POOLS: EnemyKind[][] = [
  ['slime', 'runner', 'mini', 'bat'],
  ['splitter', 'boar', 'mole', 'imp', 'salamander', 'ghost'],
  ['knight', 'crab', 'yeti', 'wisp', 'shaman'],
  ['wyvern', 'ram'],
];
const BOSSES: EnemyKind[] = ['boss', 'queen', 'frostGiant', 'phoenix'];
const THEMES: LevelTheme[] = ['day', 'dusk', 'snow', 'ember'];
const WEATHERS: WeatherKind[] = ['clear', 'rain', 'snow', 'fog', 'clear'];
const PLACE = ['晨曦', '薄暮', '流雲', '星砂', '琥珀', '霜月', '翠羽', '赤焰', '碧空', '銀河'];
const NOUN = ['浮島', '群嶼', '天台', '飛岩', '雲港', '斷崖'];

/** Modifiers are pure level data, so the engine needs no special cases. */
interface Modifier { label: string; gold?: number; coreHp?: number; density?: number; hp?: number; waves?: number }
const MODIFIERS: Modifier[] = [
  { label: '豐收日：起始金幣 +30%', gold: 1.3, density: 1.1 },
  { label: '節約日：起始金幣 −20%', gold: 0.8, density: 0.85 },
  { label: '脆弱之心：核心生命只有 12', coreHp: 12, density: 0.9 },
  { label: '大軍壓境：怪物數量 +25%', density: 1.25, gold: 1.15 },
  { label: '鋼鐵之軀：怪物生命 +15%', hp: 1.15, gold: 1.1 },
  { label: '長夜：多一波', waves: 1 },
];

export function dailySpec(date: string): GeneratedLevelSpec & { modifier: string } {
  const seed = hashDate(date);
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  // islands: 3 or 4 outer islands, 1–2 of them hubs; every non-hub joins a neighbour round a corner
  const all: Side[] = ['N', 'E', 'S', 'W'];
  const sides = r() < 0.6 ? all : all.filter((s) => s !== pick(all));
  const hubCount = sides.length === 4 && r() < 0.6 ? 2 : 1;
  const hubs = hubCount === 2 ? (r() < 0.5 ? (['N', 'S'] as Side[]) : (['E', 'W'] as Side[])).filter((s) => sides.includes(s)) : [pick(sides)];
  if (!hubs.length) hubs.push(sides[0]!);
  const corners: Corner[] = (['NE', 'SE', 'SW', 'NW'] as Corner[]).filter((c) => sides.includes(c[0] as Side) && sides.includes(c[1] as Side));
  const portals: Partial<Record<Side, number>> = {};
  if (r() < 0.5) portals[pick(sides)] = 2;
  const mod = pick(MODIFIERS);
  const roster = [...POOLS[0]!.slice(0, 3), pick(POOLS[1]!), pick(POOLS[3]!), pick(POOLS[1]!), pick(POOLS[2]!), pick(POOLS[2]!)]
    .filter((k, i, a) => a.indexOf(k) === i);
  const portalCount = sides.length + Object.values(portals).reduce((a, b) => a + b - 1, 0);
  const theme = pick(THEMES);
  return {
    id: dailyIdFor(date),
    name: `${pick(PLACE)}${pick(NOUN)}`,
    subtitle: `${date} 每日挑戰`,
    theme,
    weather: theme === 'ember' ? pick(['clear', 'fog'] as WeatherKind[]) : theme === 'snow' ? pick(['snow', 'fog', 'clear'] as WeatherKind[]) : pick(WEATHERS.filter((w) => w !== 'snow')),
    seed,
    initialGold: Math.round((360 + 60 * portalCount) * (mod.gold ?? 1) / 10) * 10,
    coreHp: mod.coreHp,
    layout: { sides, hubs, corners, portals, doubleBridge: [pick(hubs)], coreElevation: 2 + Math.floor(r() * 3), pillars: 2 + Math.floor(r() * 3) },
    plan: {
      roster, finalBoss: pick(BOSSES), waves: 6 + (mod.waves ?? 0),
      hp: [0.6 * (mod.hp ?? 1), 1.2 * (mod.hp ?? 1)],
      density: Math.round(0.62 * (mod.density ?? 1) * (portalCount >= 5 ? 0.85 : 1) * 100) / 100,
    },
    modifier: mod.label,
  };
}

const cache = new Map<string, LevelDef>();

export function makeDailyLevel(date: string): LevelDef {
  const hit = cache.get(date);
  if (hit) return hit;
  const spec = dailySpec(date);
  const level: LevelDef = { ...generateLevel(spec), daily: { date, modifiers: [spec.modifier] } };
  cache.set(date, level);
  return level;
}
