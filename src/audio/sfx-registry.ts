import type { GameEventType } from '../domain/types';

export type SfxId =
  | 'build' | 'upgrade' | 'sell' | 'raise' | 'lower' | 'wallPlace' | 'wallRemove' | 'illegal' | 'undo'
  | 'arrowFire' | 'arrowHit' | 'frostFire' | 'frostHit' | 'cannonFire' | 'explosion' | 'resist'
  | 'deathSlime' | 'deathRunner' | 'deathGolem' | 'coreHit' | 'waveStart' | 'waveClear' | 'victory' | 'defeat'
  | 'spawn' | 'coin' | 'click' | 'hover' | 'blocked';

/**
 * GameEvent → audio mapping (Tech §9.9). Every event type maps to a sound or explicitly 'none';
 * per-event refinement (tower kind, enemy kind) happens in the audio director.
 */
export const SFX_FOR_EVENT: Record<GameEventType, SfxId | 'none' | 'dynamic'> = {
  PHASE_CHANGED: 'dynamic',   // music layer crossfade
  WAVE_STARTED: 'waveStart',
  WAVE_CLEARED: 'waveClear',
  ENEMY_SPAWNED: 'spawn',
  TOWER_FIRED: 'dynamic',     // arrowFire / frostFire / cannonFire
  TOWER_BLOCKED: 'none',
  ENEMY_DAMAGED: 'dynamic',   // arrowHit / frostHit / resist
  ENEMY_SLOWED: 'none',
  CANNON_EXPLODED: 'explosion',
  ENEMY_KILLED: 'dynamic',    // deathSlime / deathRunner / deathGolem
  ENEMY_REACHED_CORE: 'none',
  CORE_DAMAGED: 'coreHit',
  GOLD_CHANGED: 'none',
  TERRAIN_CHANGED: 'dynamic', // raise / lower
  WALL_PLACED: 'wallPlace',
  WALL_REMOVED: 'wallRemove',
  TOWER_BUILT: 'build',
  TOWER_UPGRADED: 'upgrade',
  TOWER_SOLD: 'sell',
  ROUTES_CHANGED: 'none',
  UNDO_APPLIED: 'undo',
  VICTORY: 'victory',
  DEFEAT: 'defeat',
};

export const MAX_VOICES: Partial<Record<SfxId, number>> = {
  arrowFire: 6, arrowHit: 8, frostFire: 4, frostHit: 6, cannonFire: 3, explosion: 3, resist: 4,
  deathSlime: 6, deathRunner: 6, deathGolem: 4, spawn: 4, coin: 6, hover: 2, click: 3,
};
