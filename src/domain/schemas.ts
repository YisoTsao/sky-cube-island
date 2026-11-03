import { z } from 'zod';

const elevation = z.number().int().min(0).max(6);
const gridPos = z.object({ x: z.number().int(), z: z.number().int() });
const towerKind = z.enum(['arrow', 'frost', 'cannon', 'lightning', 'wind']);
const enemyKind = z.enum(['slime', 'runner', 'golem', 'mini', 'splitter', 'knight', 'wisp', 'boss', 'boar', 'ghost', 'crab', 'mole', 'salamander', 'queen', 'bat', 'yeti', 'shaman', 'frostGiant', 'imp', 'phoenix']);

export const SurfaceCellSchema = z.object({
  id: z.string().min(1),
  platformId: z.string().min(1),
  pos: gridPos,
  elevation,
  kind: z.enum(['ground', 'bridgeDeck', 'stairDeck', 'rampDeck']),
  terrain: z.enum(['grass', 'stone', 'wood', 'water']),
  editable: z.boolean(),
  buildable: z.boolean(),
  immutable: z.boolean(),
  tags: z.array(z.string()).optional(),
});

export const SpawnEntrySchema = z.object({
  enemyKind,
  count: z.number().int().min(1),
  portalIds: z.array(z.string()).min(1),
  intervalTicks: z.number().int().min(1),
  delayTicks: z.number().int().min(0).optional(),
});

export const WaveDefSchema = z.object({
  id: z.string(),
  entries: z.array(SpawnEntrySchema).min(1),
  clearGold: z.number().int().min(0),
  hpScale: z.number().min(0.1).max(1000).optional(),
});

export const LevelDefSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string(),
  name: z.string(),
  subtitle: z.string().optional(),
  theme: z.enum(['day', 'dusk', 'snow', 'ember']).optional(),
  width: z.number().int().min(4).max(64),
  depth: z.number().int().min(4).max(64),
  heightStepWorld: z.literal(0.5),
  cells: z.array(SurfaceCellSchema).min(1),
  platforms: z.array(z.object({ id: z.string(), name: z.string(), cellIds: z.array(z.string()) })),
  connectors: z.array(z.object({
    id: z.string(), name: z.string(), kind: z.enum(['BRIDGE', 'STAIR', 'RAMP']),
    chain: z.array(z.string()), bidirectional: z.literal(true), immutable: z.literal(true),
  })),
  portals: z.array(z.object({ id: z.string(), name: z.string(), cellId: z.string() })),
  core: z.object({
    footprintCellIds: z.array(z.string()),
    approachNodeIds: z.array(z.string()),
    maxHp: z.number().int().min(1),
  }),
  initialGold: z.number().int().min(0),
  maxShortestPathCost: z.number().int().min(1),
  waves: z.array(WaveDefSchema).min(1),
  decor: z.object({ trees: z.array(gridPos), rocks: z.array(gridPos), flowers: z.array(gridPos) }).optional(),
  endless: z.object({ baseId: z.string() }).optional(),
});

export const GameStateSchema = z.object({
  schemaVersion: z.literal(2),
  levelId: z.string(),
  phase: z.enum(['MENU', 'PREPARE', 'COMBAT', 'WAVE_RESULT', 'VICTORY', 'DEFEAT']),
  tick: z.number().int().min(0),
  rngSeed: z.number().int(),
  gold: z.number().int().min(0),
  coreHp: z.number().int().min(0),
  currentWaveIndex: z.number().int().min(0),
  spawnCursor: z.number().int().min(0),
  waveTick: z.number().int().min(0),
  awardedWaveIds: z.array(z.string()),
  editedElevations: z.record(z.string(), elevation),
  walls: z.array(z.object({ id: z.string(), cellId: z.string(), cost: z.literal(15) })),
  towers: z.array(z.object({
    id: z.string(), kind: towerKind, anchorCellId: z.string(),
    footprintCellIds: z.array(z.string()).length(4),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    cooldownTicks: z.number().int().min(0), investedGold: z.number().int().min(0),
    targeting: z.enum(['FIRST', 'LAST', 'STRONGEST', 'CLOSEST']), builtWave: z.number().int().min(0),
  })),
  enemies: z.array(z.any()).max(0, 'Saves never contain live enemies (COMBAT is not a save point).'),
  nextEntityId: z.number().int().min(0),
  spawnQueue: z.array(z.any()).max(0),
  frozenRoutes: z.record(z.string(), z.array(z.string())),
  run: z.object({
    wallsPlaced: z.number().int().min(0), terrainEdits: z.number().int().min(0), towersSold: z.number().int().min(0),
    upgrades: z.number().int().min(0), maxTowers: z.number().int().min(0), kindsBuilt: z.array(towerKind),
  }).optional(),
});

export const SaveFileSchema = z.object({
  saveVersion: z.literal(1),
  gameVersion: z.string(),
  savedAt: z.number(),
  state: GameStateSchema,
});

export const SettingsSchema = z.object({
  schemaVersion: z.literal(1),
  quality: z.enum(['auto', 'low', 'medium', 'high', 'ultra']),
  dynamicResolution: z.boolean(),
  colorblindSafe: z.boolean(),
  reducedMotion: z.boolean(),
  screenShake: z.number().min(0).max(1),
  damageNumbers: z.boolean(),
  /** Mouse at the screen edge scrolls the map (desktop). Optional so older saved settings still load. */
  edgeScroll: z.boolean().default(true),
  uiScale: z.number().min(0.8).max(1.5),
  volume: z.object({
    master: z.number().min(0).max(1), music: z.number().min(0).max(1), sfx: z.number().min(0).max(1),
    ui: z.number().min(0).max(1), ambience: z.number().min(0).max(1),
  }),
  language: z.enum(['zh-TW', 'en']),
});

export type SettingsV1 = z.infer<typeof SettingsSchema>;
export type SaveFile = z.infer<typeof SaveFileSchema>;
