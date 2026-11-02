import type { EnemyKind, GameEvent, GameState, LevelDef } from '../domain/types';
import { getLevel, isLevelId, type LevelId } from '../levels/registry';
import { validateLevel } from '../levels/level-validator';
import { recordVictory } from '../persistence/progress';
import { challengeMet, challengesFor } from '../domain/challenges';
import { GameController, type EventListener } from '../state/game-controller';
import { useUi } from '../state/store';
import { audio } from '../audio/audio';
import type { SfxId } from '../audio/sfx-registry';
import type { SceneApp } from '../scene/scene-app';
import { loadSettings } from '../settings/settings';

const HEAVY_KINDS = new Set<EnemyKind>(['golem', 'knight', 'boss', 'crab', 'queen', 'boar', 'yeti', 'frostGiant', 'phoenix']);
const SWIFT_KINDS = new Set<EnemyKind>(['runner', 'wisp', 'ghost', 'salamander', 'mole', 'bat', 'imp', 'shaman']);

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const initialId = params.get('level');

/**
 * The active level + controller. `export let` keeps ES live bindings, so modules that import
 * `level` / `controller` always see the current ones after `selectLevel()` (only called while the
 * game view is unmounted, i.e. from the title screen).
 */
export let level: LevelDef = getLevel(initialId && isLevelId(initialId) ? initialId : 'L1-01');
export let controller: GameController = createController(level);
useUi.getState().set({ levelId: level.id, levelName: level.name });

function createController(l: LevelDef): GameController {
  const v = validateLevel(l);
  if (!v.ok) console.error(`${l.id} invalid`, v.errors);
  const c = new GameController(l, 1);
  c.on(onEvents);
  return c;
}

/** Switch the active level (title screen only). */
export function selectLevel(id: LevelId): void {
  if (level.id === id) return;
  level = getLevel(id);
  controller = createController(level);
  useUi.getState().set({ levelId: id, levelName: level.name });
}

export const runtime: { scene: SceneApp | null } = { scene: null };

export function syncStore(s: GameState = controller.state) {
  useUi.getState().set({
    phase: s.phase,
    gold: s.gold,
    coreHp: s.coreHp,
    maxHp: level.core.maxHp,
    waveIndex: s.currentWaveIndex,
    waveCount: level.waves.length,
    canUndo: controller.canUndo,
    wavePreview: controller.wavePreviewCounts(),
    paused: controller.flags.paused,
    speed: controller.flags.speed,
  });
}

function screenPanOf(_e: GameEvent): number { return 0; }

/** Audio director: GameEvent → sound (Tech §9.9). */
function playAudio(events: GameEvent[], state: GameState) {
  for (const e of events) {
    let id: SfxId | null = null;
    switch (e.type) {
      case 'WAVE_STARTED': id = 'waveStart'; break;
      case 'WAVE_CLEARED': id = 'waveClear'; break;
      case 'ENEMY_SPAWNED': id = 'spawn'; break;
      case 'TOWER_FIRED': {
        const t = state.towers.find((x) => x.id === e.towerId);
        id = t?.kind === 'cannon' || t?.kind === 'wind' ? 'cannonFire' : t?.kind === 'frost' || t?.kind === 'lightning' ? 'frostFire' : 'arrowFire';
        break;
      }
      case 'ENEMY_DAMAGED': {
        const t = state.towers.find((x) => x.id === e.sourceTowerId);
        id = e.resisted ? 'resist' : t?.kind === 'frost' || t?.kind === 'lightning' ? 'frostHit' : t?.kind === 'cannon' || t?.kind === 'wind' ? null : 'arrowHit';
        break;
      }
      case 'CANNON_EXPLODED': id = 'explosion'; break;
      case 'ENEMY_KILLED': id = HEAVY_KINDS.has(e.kind) ? 'deathGolem' : SWIFT_KINDS.has(e.kind) ? 'deathRunner' : 'deathSlime'; break;
      case 'CORE_DAMAGED': id = 'coreHit'; break;
      case 'TERRAIN_CHANGED': id = e.to > e.from ? 'raise' : 'lower'; break;
      case 'WALL_PLACED': id = 'wallPlace'; break;
      case 'WALL_REMOVED': id = 'wallRemove'; break;
      case 'TOWER_BUILT': id = 'build'; break;
      case 'TOWER_UPGRADED': id = 'upgrade'; break;
      case 'TOWER_SOLD': id = 'sell'; break;
      case 'UNDO_APPLIED': id = 'undo'; break;
      case 'VICTORY': id = 'victory'; break;
      case 'DEFEAT': id = 'defeat'; break;
      default: break;
    }
    if (id) audio.play(id, { pan: screenPanOf(e) });
  }
  // adaptive music
  if (state.phase === 'COMBAT') audio.setMusic(state.coreHp <= 4 ? 'tension' : 'combat');
  else if (state.phase === 'PREPARE' || state.phase === 'WAVE_RESULT') audio.setMusic('prepare');
  else audio.setMusic('silent');
}

function onEvents(events: GameEvent[], ctx: Parameters<EventListener>[1]) {
  const ui = useUi.getState();
  runtime.scene?.handleEvents(events, ctx);
  playAudio(events, ctx.state);
  let lowFreq = false;
  for (const e of events) {
    if (e.type === 'GOLD_CHANGED' || e.type === 'CORE_DAMAGED' || e.type === 'PHASE_CHANGED' || e.type === 'UNDO_APPLIED' || e.type === 'ROUTES_CHANGED') lowFreq = true;
    if (e.type === 'CORE_DAMAGED') ui.set({ heartPulse: ui.heartPulse + 1 });
    if (e.type === 'PHASE_CHANGED') {
      if (e.to === 'WAVE_RESULT') ui.set({ lastWaveStats: controller.waveStats, selection: null, tool: { type: 'none' }, preview: null });
      if (e.to === 'DEFEAT') {
        ui.set({ lastWaveStats: controller.waveStats, failureText: controller.failureAnalysis(), selection: null, tool: { type: 'none' }, preview: null });
        void controller.hasCheckpoint().then((v) => useUi.getState().set({ hasCheckpoint: v }));
      }
      if (e.to === 'COMBAT') ui.set({ tool: { type: 'none' }, preview: null });
      if (e.to === 'PREPARE') ui.set({ failureText: null });
    }
    if (e.type === 'VICTORY') {
      const met = challengesFor(level).filter((c) => challengeMet(c, ctx.state)).map((c) => c.id);
      ui.set({ stars: e.stars, lastWaveStats: controller.waveStats, progress: recordVictory(level.id, e.stars, undefined, { coreHp: ctx.state.coreHp, challenges: met }) });
    }
    if (e.type === 'WAVE_STARTED') {
      const step = useUi.getState().tutorialStep;
      if (step < 4) ui.set({ tutorialStep: 4 });
    }
  }
  if (lowFreq || ctx.fromLoad) syncStore(ctx.state);
}

export function applyInitialSettings() {
  const s = loadSettings();
  useUi.getState().set({ settings: s });
  audio.setVolumes(s.volume);
  return s;
}
