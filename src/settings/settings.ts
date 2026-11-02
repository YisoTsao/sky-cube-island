import { SettingsSchema, type SettingsV1 } from '../domain/schemas';

export type { SettingsV1 };
const KEY = 'skybound.settings.v1';

export const DEFAULT_SETTINGS: SettingsV1 = {
  schemaVersion: 1,
  quality: 'auto',
  dynamicResolution: true,
  colorblindSafe: false,
  reducedMotion: false,
  screenShake: 0.7,
  damageNumbers: true,
  uiScale: 1,
  volume: { master: 0.8, music: 0.55, sfx: 0.8, ui: 0.7, ambience: 0.6 },
  language: 'zh-TW',
};

/** Settings live apart from game saves (D21-11). Every access is try/catch'd. */
export function loadSettings(): SettingsV1 {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = SettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: SettingsV1): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}
