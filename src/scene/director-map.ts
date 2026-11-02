import type { GameEventType } from '../domain/types';

/**
 * Presentation Director coverage table (Tech §9.8): every GameEvent type is either handled by a
 * visual reaction or explicitly 'none'. A unit test asserts full coverage.
 */
export const DIRECTOR_REACTIONS: Record<GameEventType, string> = {
  PHASE_CHANGED: 'route overlay visibility, camera orbit on victory, portal idle',
  WAVE_STARTED: 'portal pulse + ring burst',
  WAVE_CLEARED: 'golden particles rising from the core',
  ENEMY_SPAWNED: 'spawn enemy view with portal sparkle',
  TOWER_FIRED: 'aim head, recoil, projectile flight (impact queued)',
  TOWER_BLOCKED: 'LOS-blocked eye icon above tower (1 s)',
  ENEMY_DAMAGED: 'on impact: white flash, squash, damage number, resist sparks',
  ENEMY_SLOWED: 'frost tint + frost sparkles',
  ENEMY_HEALED: 'green heal sparkles on the healed enemy',
  ENEMY_REBORN: 'fire burst + ring as the phoenix rises again',
  CANNON_EXPLODED: 'on impact: fireball sparks, voxel debris, scorch decal, small shake',
  LIGHTNING_CHAINED: 'jagged bolt from the orb through every chained enemy + sparks',
  WIND_GUST: 'sails spin up, swirling wind puffs + ground ring',
  ENEMY_KNOCKED_BACK: 'dust puff where the pushed enemy lands',
  TOWER_TARGETING_CHANGED: 'none',
  ENEMY_KILLED: 'on impact: voxel shatter + coin fly to HUD',
  ENEMY_REACHED_CORE: 'enemy dissolves into the core',
  CORE_DAMAGED: 'core red flash, shockwave ring, camera trauma, crack stage',
  GOLD_CHANGED: 'none',
  TERRAIN_CHANGED: 'spring elevation tween + dust ring + stone chips',
  WALL_PLACED: 'drop + slam ring + dust',
  WALL_REMOVED: 'voxel shatter',
  TOWER_BUILT: 'layer assembly animation + dust ring',
  TOWER_UPGRADED: 'swap parts with pop + sparkle',
  TOWER_SOLD: 'voxel shatter + coins fly to HUD',
  ROUTES_CHANGED: 'route ribbons rebuilt with light sweep',
  UNDO_APPLIED: 'rewind: resync terrain/entities with short tween',
  VICTORY: 'camera orbit + stars (HUD)',
  DEFEAT: 'core shatter burst',
};
