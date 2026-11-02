import type { SfxId } from './sfx-registry';

/**
 * Recorded audio assets (all CC0 / public domain — sources and licences in public/audio/CREDITS.md).
 * Files live in public/audio and are fetched lazily after the first user gesture. Any SfxId that is
 * not listed here, or whose file fails to load, falls back to the procedural synth in audio.ts.
 */
export interface SampleDef {
  /** Variants, picked at random per play (paths relative to public/audio/). */
  files: string[];
  /** Linear gain applied on top of the bus volume. */
  gain: number;
  /** Apply the ±5% random pitch variation (off for musical stingers). */
  vary?: boolean;
}

const v = (base: string, n: number) => Array.from({ length: n }, (_, i) => `sfx/${base}-${i}.mp3`);

export const SFX_SAMPLES: Partial<Record<SfxId, SampleDef>> = {
  click: { files: ['sfx/ui-click.mp3'], gain: 0.45, vary: true },
  hover: { files: ['sfx/ui-hover.mp3'], gain: 0.2, vary: true },
  sell: { files: ['sfx/sell-coins.mp3'], gain: 0.55, vary: true },
  build: { files: v('build', 3), gain: 0.7, vary: true },
  upgrade: { files: ['sfx/upgrade.mp3'], gain: 0.45 },
  wallPlace: { files: v('wall-place', 2), gain: 0.6, vary: true },
  wallRemove: { files: ['sfx/wall-remove.mp3'], gain: 0.55, vary: true },
  arrowHit: { files: v('arrow-hit', 3), gain: 0.32, vary: true },
  frostHit: { files: v('frost-hit', 3), gain: 0.28, vary: true },
  cannonFire: { files: ['sfx/cannon-fire.mp3'], gain: 0.55, vary: true },
  explosion: { files: v('explosion', 3), gain: 0.5, vary: true },
  resist: { files: v('resist', 2), gain: 0.3, vary: true },
  deathSlime: { files: v('death-slime', 2), gain: 0.4, vary: true },
  deathRunner: { files: v('death-runner', 3), gain: 0.4, vary: true },
  deathGolem: { files: v('death-golem', 2), gain: 0.55, vary: true },
  coreHit: { files: ['sfx/core-hit.mp3'], gain: 0.75 },
  waveStart: { files: ['sfx/wave-start.mp3'], gain: 0.6 },
  waveClear: { files: ['sfx/wave-clear.mp3'], gain: 0.6 },
  victory: { files: ['sfx/victory.mp3'], gain: 0.7 },
  defeat: { files: ['sfx/defeat.mp3'], gain: 0.7 },
};

/** Looping background tracks per music state ('tension' reuses combat, sped up slightly). */
export const MUSIC_TRACKS = {
  prepare: 'music/town-theme.mp3',
  combat: 'music/battle-theme-a.mp3',
} as const;
export type MusicTrack = keyof typeof MUSIC_TRACKS;

/** Resolve an asset path against Vite's base URL (works on GitHub Pages sub-paths and ./ builds). */
export function audioUrl(path: string): string {
  const base = import.meta.env.BASE_URL ?? './';
  return `${base.endsWith('/') ? base : base + '/'}audio/${path}`;
}
