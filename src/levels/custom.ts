import { z } from 'zod';
import type { LevelDef } from '../domain/types';
import { tryGenerateLevel, type GeneratedLevelSpec } from './procgen';

/**
 * Player-made levels (GDD §16 T3「關卡編輯器與分享」). A custom level is a generator descriptor plus
 * hand edits, so it stays small enough to share as a URL (`?custom=…`) without any server. Shared
 * data is untrusted: it is parsed with a strict schema (bounded sizes, known enemy kinds only)
 * before it reaches the generator, and the generated level must pass the normal validator.
 */

const enemyKind = z.enum([
  'slime', 'runner', 'golem', 'mini', 'splitter', 'knight', 'wisp', 'boss', 'boar', 'ghost', 'crab', 'mole',
  'salamander', 'queen', 'bat', 'yeti', 'shaman', 'frostGiant', 'imp', 'phoenix', 'wyvern', 'ram',
]);
const side = z.enum(['N', 'E', 'S', 'W']);
const corner = z.enum(['NE', 'SE', 'SW', 'NW']);

export const CustomSpecSchema = z.object({
  v: z.literal(1),
  name: z.string().trim().min(1).max(20),
  theme: z.enum(['day', 'dusk', 'snow', 'ember']),
  weather: z.enum(['clear', 'rain', 'snow', 'fog']).default('clear'),
  seed: z.number().int().min(1).max(999_999),
  initialGold: z.number().int().min(100).max(3000),
  coreHp: z.number().int().min(1).max(50),
  layout: z.object({
    sides: z.array(side).min(2).max(4),
    portals: z.partialRecord(side, z.number().int().min(1).max(2)).optional(),
    hubs: z.array(side).max(4).optional(),
    doubleBridge: z.array(side).max(4).optional(),
    corners: z.array(corner).max(4).optional(),
    coreElevation: z.number().int().min(1).max(4),
    pillars: z.number().int().min(0).max(8),
  }),
  plan: z.object({
    roster: z.array(enemyKind).min(1).max(12),
    finalBoss: enemyKind,
    waves: z.number().int().min(1).max(12),
    hp: z.tuple([z.number().min(0.2).max(5), z.number().min(0.2).max(5)]),
    density: z.number().min(0.2).max(3),
  }),
  overrides: z.record(z.string().regex(/^\d{1,2},\d{1,2}$/), z.enum(['raise', 'pillar', 'void', 'ground'])).optional()
    .refine((o) => !o || Object.keys(o).length <= 600, 'too many edits'),
});
export type CustomSpec = z.infer<typeof CustomSpecSchema>;

export const CUSTOM_PREFIX = 'C-';
export const isCustomId = (id: string) => /^C-[0-9a-z]{4,12}$/.test(id);

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export const customIdOf = (spec: CustomSpec) => `${CUSTOM_PREFIX}${hash(JSON.stringify(spec))}`;

export function toGeneratorSpec(spec: CustomSpec): GeneratedLevelSpec {
  return {
    id: customIdOf(spec), name: spec.name, subtitle: '自訂關卡', theme: spec.theme, weather: spec.weather, seed: spec.seed,
    initialGold: spec.initialGold, coreHp: spec.coreHp, layout: spec.layout, plan: spec.plan, overrides: spec.overrides,
  };
}

export function buildCustomLevel(spec: CustomSpec) {
  return tryGenerateLevel(toGeneratorSpec(spec));
}

// ---- share codes: base64url(JSON) ------------------------------------------------------------
function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(code: string): string {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((code.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export const encodeCustom = (spec: CustomSpec) => b64urlEncode(JSON.stringify(spec));

export function decodeCustom(code: string): { ok: true; spec: CustomSpec } | { ok: false; error: string } {
  if (code.length > 12_000) return { ok: false, error: '分享碼太長' };
  try {
    const parsed = CustomSpecSchema.safeParse(JSON.parse(b64urlDecode(code)));
    return parsed.success ? { ok: true, spec: parsed.data } : { ok: false, error: '分享碼格式不正確' };
  } catch {
    return { ok: false, error: '無法讀取分享碼' };
  }
}

// ---- registry of custom levels known in this session + the player's saved list --------------
const registered = new Map<string, LevelDef>();

/** Make a custom level playable by id (validated). Returns the id, or the validation errors. */
export function registerCustom(spec: CustomSpec): { ok: true; id: string; level: LevelDef } | { ok: false; errors: string[] } {
  const r = buildCustomLevel(spec);
  if (!r.ok) return { ok: false, errors: r.errors };
  registered.set(r.level.id, r.level);
  return { ok: true, id: r.level.id, level: r.level };
}
export const getCustomLevel = (id: string) => registered.get(id) ?? null;

const KEY = 'skybound.custom.v1';
export interface SavedCustom { id: string; spec: CustomSpec; savedAt: number }

export function loadSavedCustom(): SavedCustom[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    const out: SavedCustom[] = [];
    for (const item of list) {
      const p = CustomSpecSchema.safeParse((item as SavedCustom)?.spec);
      if (p.success) out.push({ id: customIdOf(p.data), spec: p.data, savedAt: Number((item as SavedCustom).savedAt) || 0 });
    }
    return out;
  } catch {
    return [];
  }
}

export function saveCustom(spec: CustomSpec): SavedCustom[] {
  const id = customIdOf(spec);
  const list = [{ id, spec, savedAt: Date.now() }, ...loadSavedCustom().filter((s) => s.id !== id && s.spec.name !== spec.name)].slice(0, 30);
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
  return list;
}

export function deleteCustom(id: string): SavedCustom[] {
  const list = loadSavedCustom().filter((s) => s.id !== id);
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
  return list;
}

/**
 * Not every seed yields a valid island for a given layout (a rim bite can eat a bridge head), and the
 * editor works on one exact seed so that hand edits stay where they were painted. This walks from
 * `start` to the nearest seed whose unedited island validates.
 */
export function findValidSeed(spec: CustomSpec, start = spec.seed): number {
  for (let k = 0; k < 60; k++) {
    const seed = ((start - 1 + k * 7919) % 999_999) + 1;
    if (buildCustomLevel({ ...spec, seed, overrides: {} }).ok) return seed;
  }
  return start;
}

/** A sensible starting point for the editor (always a seed that validates). */
export function defaultCustomSpec(seed = 4242): CustomSpec {
  const spec = baseSpec(seed);
  return { ...spec, seed: findValidSeed(spec) };
}

function baseSpec(seed: number): CustomSpec {
  return {
    v: 1, name: '我的浮島', theme: 'day', weather: 'clear', seed, initialGold: 450, coreHp: 20,
    layout: { sides: ['N', 'E', 'W'], portals: {}, hubs: ['N'], doubleBridge: ['N'], corners: ['NE', 'NW'], coreElevation: 3, pillars: 2 },
    plan: { roster: ['slime', 'runner', 'bat', 'wyvern', 'knight', 'ram'], finalBoss: 'boss', waves: 6, hp: [0.6, 1.3], density: 0.8 },
    overrides: {},
  };
}
