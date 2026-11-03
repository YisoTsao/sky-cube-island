import type { RunLog } from './challenges';

/**
 * Domain contracts (Tech §3). Pure TypeScript — no Three.js / React / DOM.
 */

export type CellId = string;
export type PlatformId = string;
export type Elevation = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type GridPos = { x: number; z: number };

export const MIN_ELEVATION = 0;
export const MAX_ELEVATION = 6;
export const HEIGHT_STEP_WORLD = 0.5;

export type SurfaceKind = 'ground' | 'bridgeDeck' | 'stairDeck' | 'rampDeck';
export type TerrainKind = 'grass' | 'stone' | 'wood' | 'water';
export type ConnectorKind = 'BRIDGE' | 'STAIR' | 'RAMP';

export interface SurfaceCell {
  id: CellId;
  platformId: PlatformId;
  pos: GridPos;
  elevation: Elevation;
  kind: SurfaceKind;
  terrain: TerrainKind;
  editable: boolean;
  buildable: boolean;
  immutable: boolean;
  tags?: string[];
}

export interface PlatformDef {
  id: PlatformId;
  name: string;
  cellIds: CellId[];
}

export interface ConnectorDef {
  id: string;
  name: string;
  kind: ConnectorKind;
  /** Includes ground endpoint A, intermediate deck nodes, endpoint B. */
  chain: CellId[];
  bidirectional: true;
  immutable: true;
}

export interface PortalDef { id: string; name: string; cellId: CellId }

export interface CoreDef {
  footprintCellIds: CellId[];
  approachNodeIds: CellId[];
  maxHp: number;
}

export type TowerKind = 'arrow' | 'frost' | 'cannon' | 'lightning' | 'wind';
export const TOWER_KINDS: readonly TowerKind[] = ['arrow', 'frost', 'cannon', 'lightning', 'wind'];

/** Which enemy in range a tower shoots (GDD §16 T2 targeting modes). */
export type TargetingMode = 'FIRST' | 'LAST' | 'STRONGEST' | 'CLOSEST';
export const TARGETING_MODES: readonly TargetingMode[] = ['FIRST', 'LAST', 'STRONGEST', 'CLOSEST'];
export type EnemyKind =
  | 'slime' | 'runner' | 'golem' | 'mini' | 'splitter' | 'knight' | 'wisp' | 'boss'
  | 'boar' | 'ghost' | 'crab' | 'mole' | 'salamander' | 'queen'
  | 'bat' | 'yeti' | 'shaman' | 'frostGiant' | 'imp' | 'phoenix'
  | 'wyvern' | 'ram';
export const ENEMY_KINDS: readonly EnemyKind[] = [
  'slime', 'runner', 'golem', 'mini', 'splitter', 'knight', 'wisp', 'boss',
  'boar', 'ghost', 'crab', 'mole', 'salamander', 'queen',
  'bat', 'yeti', 'shaman', 'frostGiant', 'imp', 'phoenix',
  'wyvern', 'ram',
];

export interface SpawnEntry {
  enemyKind: EnemyKind;
  count: number;
  /** Round-robin in list order: i-th enemy → portalIds[i % length] (D21-07). */
  portalIds: string[];
  intervalTicks: number;
  /** Pause (ticks) on each of this entry's portals before its first spawn. Default 0. */
  delayTicks?: number;
}

export interface WaveDef {
  id: string;
  entries: SpawnEntry[];
  clearGold: number;
  /** Multiplier on every spawned enemy's max HP (later waves are tougher). Default 1. */
  hpScale?: number;
}

/** Decorative-only data for the renderer (never used by navigation/LOS). */
export interface LevelDecor {
  trees: GridPos[];
  rocks: GridPos[];
  flowers: GridPos[];
}

/** Lighting / sky mood used by the renderer (presentation only). */
export type LevelTheme = 'day' | 'dusk' | 'snow' | 'ember';
/** Presentation-only weather (GDD §16 T3「微雨、飄雪、霧天，純表現不影響規則」). */
export type WeatherKind = 'clear' | 'rain' | 'snow' | 'fog';

export interface LevelDef {
  schemaVersion: 2;
  id: string;
  name: string;
  /** Short flavour line for the level-select card. */
  subtitle?: string;
  theme?: LevelTheme;
  width: number;
  depth: number;
  heightStepWorld: 0.5;
  cells: SurfaceCell[];
  platforms: PlatformDef[];
  connectors: ConnectorDef[];
  portals: PortalDef[];
  core: CoreDef;
  initialGold: number;
  maxShortestPathCost: number;
  waves: WaveDef[];
  decor?: LevelDecor;
  /** Set on the generated endless variant of a campaign level (GDD §16 T3). */
  endless?: { baseId: string };
  /** Default weather of the island (presentation only). */
  weather?: WeatherKind;
  /** Set on a daily seeded challenge: its date (YYYY-MM-DD) and the modifier labels shown to the player. */
  daily?: { date: string; modifiers: string[] };
}

export interface TowerDef {
  kind: TowerKind;
  name: string;
  buildCost: number;
  baseDamage: number;
  baseRangeWorld: number;
  cooldownTicks: number;
  damageType: 'physical' | 'magic';
  muzzleOffsetWorld: number;
  /** Visual projectile flight duration (presentation only). */
  projectileTicks: number;
  blastRadiusWorld?: number;
  slow?: { ratio: number; durationTicks: number };
  /** Lightning: after the first hit, jumps to the nearest un-hit enemy within `radiusWorld`
   *  (`jumps` + tower level − 1 times), each jump dealing `falloff` × the previous damage. */
  chain?: { jumps: number; radiusWorld: number; falloff: number };
  /** Wind: every enemy in range with line of sight (up to `maxTargets` + level − 1) is pushed back
   *  `cells` (+ `perLevel` per level above 1) along its route; then immune for `immuneTicks`. */
  knockback?: { cells: number; perLevel: number; immuneTicks: number; maxTargets: number };
  /** Per-level overrides (index 0 = Lv1); resolved by `towerStats`. */
  perLevel?: { slowRatio?: readonly number[]; blastRadiusWorld?: readonly number[] };
}

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  hp: number;
  speedCellsPerSecond: number;
  coreDamage: number;
  goldReward: number;
  physicalResistance: number;
  /** 0..1 — fraction of magic (frost) damage ignored. Default 0. */
  magicResistance?: number;
  targetOffsetWorld: number;
  /** 0..1 — fraction of frost slow ignored (bosses shrug off most of it). */
  slowResistance?: number;
  /** On death, spawns `count` enemies of `kind` at the same spot on the route. */
  splitInto?: { kind: EnemyKind; count: number };
  /** Every `everyTicks`, restores `amount` HP (× the wave's hpScale) to other enemies within `radiusWorld`. */
  healAura?: { radiusWorld: number; amount: number; everyTicks: number };
  /** Below `belowRatio` of max HP the enemy speeds up by `speedMult` (enrage). */
  enrage?: { belowRatio: number; speedMult: number };
  /** Spends the last `underTicks` of every `cycleTicks` (counted from spawn) underground: untargetable. */
  burrow?: { cycleTicks: number; underTicks: number };
  /** Other enemies within `radiusWorld` take `reduction` less damage from every source. */
  shieldAura?: { radiusWorld: number; reduction: number };
  /** The first death revives it on the spot with `hpRatio` of its max HP (gold is paid on the final death). */
  rebirth?: { hpRatio: number };
  /** 0..1 — fraction of wind knockback ignored (heavy bosses barely budge). Default 0. */
  knockbackResistance?: number;
  /** Presentation hint: model scale + HP bar width. */
  scale?: number;
  /** Flies straight from its portal to the nearest core approach, `altitudeWorld` above the
   *  interpolated ground height: ignores terrain, walls, bridges and traps (GDD §16 T2). */
  flying?: { altitudeWorld: number };
  /** Plans its route as if wooden walls were not there and smashes each wall in its way
   *  after standing at it for `ticks` (GDD §16 T2 「拆路障怪」). */
  breaksWalls?: { ticks: number };
}

/** 1×1 spike trap (GDD §16 T2): sits on a walkable cell without blocking it. */
export interface TrapInstance { id: string; cellId: CellId; cooldownTicks: number }

export type GamePhase = 'MENU' | 'PREPARE' | 'COMBAT' | 'WAVE_RESULT' | 'VICTORY' | 'DEFEAT';

export type TowerLevel = 1 | 2 | 3 | 4;
/** Lv4 specialisation, chosen when upgrading from Lv3 (v2.9). */
export type TowerBranch = 'A' | 'B';
export const TOWER_BRANCHES: readonly TowerBranch[] = ['A', 'B'];

export interface TowerInstance {
  id: string;
  kind: TowerKind;
  anchorCellId: CellId;
  footprintCellIds: CellId[];
  level: TowerLevel;
  /** Lv4 only: which specialisation was chosen. */
  branch?: TowerBranch;
  cooldownTicks: number;
  investedGold: number;
  targeting: TargetingMode;
  /** Wave index during which the tower was built (stats only). */
  builtWave: number;
}

export interface WallInstance { id: string; cellId: CellId; cost: 15 }

export interface EnemyInstance {
  id: string;
  kind: EnemyKind;
  portalId: string;
  hp: number;
  /** Max HP at spawn (base HP × the wave's hpScale). */
  maxHp: number;
  state: 'moving' | 'dead' | 'reachedCore';
  pathNodeIds: CellId[];
  edgeIndex: number;
  segmentProgress: number;
  slowUntilTick: number;
  /** Strength of the current slow (from the frost tower's level). Defaults to the Lv1 ratio. */
  slowRatio?: number;
  /** Frozen / stunned (Lv4 permafrost, heavy cannon): does not move before this tick. */
  stunUntilTick?: number;
  /** Lv4 permafrost: frost hits taken (every Nth hit freezes). */
  frostHits?: number;
  /** Lv4 shredder shells: resistances reduced by `shredAmount` before this tick. */
  shredUntilTick?: number;
  shredAmount?: number;
  /** Lv4 overload lightning: healing / shield auras switched off before this tick. */
  disruptedUntilTick?: number;
  spawnTick: number;
  /** Set once a rebirth enemy has used its revive. */
  reborn?: boolean;
  /** Wind knockback cannot hit again before this tick. */
  pushImmuneUntilTick?: number;
  /** Flyers: straight-line length of their two-node flight path (segment speed is divided by it). */
  flightDist?: number;
  /** Wall breakers: ticks spent hammering the wall in front of them. */
  breakingTicks?: number;
}

/** Per-portal spawn queue entry, materialised at START_WAVE (D21-07). */
export interface SpawnQueueItem {
  enemyKind: EnemyKind;
  portalId: string;
  tick: number; // waveTick at which to spawn
}

export interface GameState {
  schemaVersion: 2;
  levelId: string;
  phase: GamePhase;
  tick: number;
  rngSeed: number;
  gold: number;
  coreHp: number;
  currentWaveIndex: number;
  spawnCursor: number;
  waveTick: number;
  awardedWaveIds: string[];
  editedElevations: Record<CellId, Elevation>;
  walls: WallInstance[];
  towers: TowerInstance[];
  enemies: EnemyInstance[];
  nextEntityId: number;
  /** Spawn schedule for the active wave (empty outside COMBAT). */
  spawnQueue: SpawnQueueItem[];
  /** Frozen route snapshot per portal for the active wave (Tech §4.2). */
  frozenRoutes: Record<string, CellId[]>;
  /** Read-only run log for optional challenges (never read by the simulation). */
  run?: RunLog;
  /** 1×1 spike traps (GDD §16 T2). */
  traps?: TrapInstance[];
  /** Connectors the player has collapsed this run; their decks are not walkable (GDD §16 T2). */
  brokenConnectors?: string[];
}

export type GameCommand =
  | { type: 'SET_ELEVATION'; cellId: CellId; next: Elevation }
  | { type: 'PLACE_WALL'; cellId: CellId }
  | { type: 'REMOVE_WALL'; wallId: string }
  | { type: 'BUILD_TOWER'; kind: TowerKind; anchorCellId: CellId }
  | { type: 'UPGRADE_TOWER'; towerId: string; /** required when upgrading Lv3 → Lv4 */ branch?: TowerBranch }
  | { type: 'SELL_TOWER'; towerId: string }
  | { type: 'SET_TARGETING'; towerId: string; targeting: TargetingMode }
  | { type: 'PLACE_TRAP'; cellId: CellId }
  | { type: 'REMOVE_TRAP'; trapId: string }
  | { type: 'TOGGLE_BRIDGE'; connectorId: string }
  | { type: 'UNDO_PREPARE' }
  | { type: 'START_WAVE' }
  | { type: 'CONTINUE' };

export type RejectionCode =
  | 'INVALID_PHASE' | 'OUT_OF_BOUNDS' | 'NOT_EDITABLE'
  | 'OCCUPIED' | 'INVALID_FOOTPRINT' | 'INVALID_ELEVATION'
  | 'PROTECTED_CONNECTOR' | 'INSUFFICIENT_GOLD'
  | 'NO_ROUTE_FROM_PORTAL' | 'ROUTE_TOO_LONG'
  | 'NOT_FOUND' | 'INVALID_LEVEL_DATA'
  | 'NOTHING_TO_UNDO' | 'MAX_LEVEL' | 'BRANCH_REQUIRED' | 'ON_ACTIVE_ROUTE' | 'NOT_A_TRAP_CELL';

export type CommandResult =
  | { ok: true; state: GameState; events: GameEvent[]; cost: number }
  | { ok: false; state: GameState; code: RejectionCode; message: string; portalId?: string };

/** Runtime-only flags; NOT part of GameState or saves. */
export interface RuntimeFlags {
  paused: boolean;
  speed: 1 | 2 | 3;
}

export type Vec3 = { x: number; y: number; z: number };

export type GameEvent =
  | { type: 'PHASE_CHANGED'; tick: number; from: GamePhase; to: GamePhase }
  | { type: 'WAVE_STARTED'; tick: number; waveIndex: number }
  | { type: 'WAVE_CLEARED'; tick: number; waveIndex: number; clearGold: number }
  | { type: 'ENEMY_SPAWNED'; tick: number; enemyId: string; kind: EnemyKind; portalId: string }
  | { type: 'TOWER_FIRED'; tick: number; towerId: string; targetId: string; travelTicks: number }
  | { type: 'TOWER_BLOCKED'; tick: number; towerId: string }
  | { type: 'ENEMY_DAMAGED'; tick: number; enemyId: string; sourceTowerId: string;
      amount: number; damageType: 'physical' | 'magic'; resisted: boolean; hpAfter: number }
  | { type: 'ENEMY_SLOWED'; tick: number; enemyId: string; untilTick: number }
  | { type: 'ENEMY_HEALED'; tick: number; enemyId: string; sourceEnemyId: string; amount: number; hpAfter: number }
  | { type: 'ENEMY_REBORN'; tick: number; enemyId: string; kind: EnemyKind; hpAfter: number }
  | { type: 'CANNON_EXPLODED'; tick: number; towerId: string; at: Vec3; hitIds: string[] }
  | { type: 'LIGHTNING_CHAINED'; tick: number; towerId: string; hitIds: string[]; points: Vec3[] }
  | { type: 'WIND_GUST'; tick: number; towerId: string; hitIds: string[] }
  | { type: 'ENEMY_KNOCKED_BACK'; tick: number; enemyId: string; towerId: string; cells: number }
  | { type: 'TOWER_TARGETING_CHANGED'; tick: number; towerId: string; targeting: TargetingMode }
  | { type: 'ENEMY_KILLED'; tick: number; enemyId: string; kind: EnemyKind; killerTowerId: string; gold: number }
  | { type: 'ENEMY_REACHED_CORE'; tick: number; enemyId: string; kind: EnemyKind;
      portalId: string; approachNodeId: CellId; lastNodeIds: CellId[] }
  | { type: 'CORE_DAMAGED'; tick: number; amount: number; hpAfter: number }
  | { type: 'GOLD_CHANGED'; tick: number; delta: number; balance: number; reason: string }
  | { type: 'TERRAIN_CHANGED'; tick: number; cellId: CellId; from: Elevation; to: Elevation }
  | { type: 'WALL_PLACED' | 'WALL_REMOVED'; tick: number; wallId: string; cellId: CellId }
  | { type: 'TOWER_BUILT' | 'TOWER_UPGRADED' | 'TOWER_SOLD'; tick: number; towerId: string;
      kind: TowerKind; level: TowerLevel; anchorCellId: CellId; branch?: TowerBranch }
  | { type: 'ROUTES_CHANGED'; tick: number; portalIds: string[] }
  | { type: 'TRAP_PLACED' | 'TRAP_REMOVED'; tick: number; trapId: string; cellId: CellId }
  | { type: 'TRAP_TRIGGERED'; tick: number; trapId: string; cellId: CellId; hitIds: string[] }
  | { type: 'WALL_DESTROYED'; tick: number; wallId: string; cellId: CellId; enemyId: string }
  | { type: 'BRIDGE_COLLAPSED' | 'BRIDGE_REPAIRED'; tick: number; connectorId: string }
  | { type: 'UNDO_APPLIED'; tick: number }
  | { type: 'VICTORY'; tick: number; stars: 1 | 2 | 3 }
  | { type: 'DEFEAT'; tick: number };

export type GameEventType = GameEvent['type'];

export const ALL_EVENT_TYPES: readonly GameEventType[] = [
  'PHASE_CHANGED', 'WAVE_STARTED', 'WAVE_CLEARED', 'ENEMY_SPAWNED', 'TOWER_FIRED',
  'TOWER_BLOCKED', 'ENEMY_DAMAGED', 'ENEMY_SLOWED', 'ENEMY_HEALED', 'ENEMY_REBORN', 'CANNON_EXPLODED',
  'LIGHTNING_CHAINED', 'WIND_GUST', 'ENEMY_KNOCKED_BACK', 'TOWER_TARGETING_CHANGED', 'ENEMY_KILLED',
  'ENEMY_REACHED_CORE', 'CORE_DAMAGED', 'GOLD_CHANGED', 'TERRAIN_CHANGED', 'WALL_PLACED',
  'WALL_REMOVED', 'TOWER_BUILT', 'TOWER_UPGRADED', 'TOWER_SOLD', 'ROUTES_CHANGED',
  'UNDO_APPLIED', 'VICTORY', 'DEFEAT',
  'TRAP_PLACED', 'TRAP_REMOVED', 'TRAP_TRIGGERED', 'WALL_DESTROYED', 'BRIDGE_COLLAPSED', 'BRIDGE_REPAIRED',
] as const;
