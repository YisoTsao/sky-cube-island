import { create } from 'zustand';
import type { CellId, GamePhase } from '../domain/types';
import type { PreviewInfo, Tool } from '../presentation/feed';
import type { WaveStats } from '../presentation/stats';
import { DEFAULT_SETTINGS, type SettingsV1 } from '../settings/settings';
import { loadProgress, type ProgressV1 } from '../persistence/progress';

export type Selection =
  | { type: 'tower'; id: string }
  | { type: 'wall'; id: string; cellId: CellId }
  | { type: 'cell'; cellId: CellId }
  | null;

export interface PhotoState { filter: number; tiltShift: number; focus: number; hideTactical: boolean; orbit: boolean }

export interface Toast { id: number; text: string; kind: 'error' | 'info' | 'success' }

export interface HoverInfo { cellId: CellId; platform: string; elevation: number; kind: string; editable: boolean; buildable: boolean }

/** Low-frequency HUD state (Tech §8.2: never per-enemy per-tick React renders). */
export interface UiState {
  screen: 'title' | 'game' | 'editor';
  /** Spec the level editor opens with (a shared link or a saved level); null = default island. */
  editorSpec: import('../levels/custom').CustomSpec | null;
  /** Active level (the game view remounts when it changes). */
  levelId: string;
  levelName: string;
  progress: ProgressV1;
  phase: GamePhase;
  gold: number;
  coreHp: number;
  maxHp: number;
  waveIndex: number;
  waveCount: number;
  tool: Tool;
  selection: Selection;
  hover: HoverInfo | null;
  preview: PreviewInfo | null;
  toasts: Toast[];
  paused: boolean;
  speed: 1 | 2 | 3;
  canUndo: boolean;
  showAllRanges: boolean;
  settings: SettingsV1;
  settingsOpen: boolean;
  pauseOpen: boolean;
  helpOpen: boolean;
  lastWaveStats: WaveStats | null;
  failureText: string | null;
  stars: 0 | 1 | 2 | 3;
  hasSave: boolean;
  hasCheckpoint: boolean;
  introPlaying: boolean;
  qualityLabel: string;
  tutorialStep: number;
  wavePreview: Record<string, Record<string, number>>;
  perf: { fps: number; ms: number; calls: number; tris: number; dpr: number } | null;
  coinPulse: number;
  heartPulse: number;
  /** True while the player is using touch (last pointer was a finger/pen, or a coarse-pointer device). */
  touchUi: boolean;
  /** Photo mode (GDD §11.4 T1): HUD hidden, free camera, filters. null when off. */
  photo: PhotoState | null;
  /** Bumped on each photo capture (shutter flash). */
  photoFlash: number;
  /** Endless mode: waves cleared when this run set a new best (0 = no new best yet). */
  endlessNewBest: number;
  set(p: Partial<UiState>): void;
  toast(text: string, kind?: Toast['kind']): void;
}

let toastId = 1;
export const useUi = create<UiState>((set, get) => ({
  screen: 'title',
  editorSpec: null,
  levelId: 'L1-01',
  levelName: '',
  progress: loadProgress(),
  phase: 'MENU',
  gold: 0,
  coreHp: 20,
  maxHp: 20,
  waveIndex: 0,
  waveCount: 5,
  tool: { type: 'none' },
  selection: null,
  hover: null,
  preview: null,
  toasts: [],
  paused: false,
  speed: 1,
  canUndo: false,
  showAllRanges: false,
  settings: DEFAULT_SETTINGS,
  settingsOpen: false,
  pauseOpen: false,
  helpOpen: false,
  lastWaveStats: null,
  failureText: null,
  stars: 0,
  hasSave: false,
  touchUi: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  photo: null,
  photoFlash: 0,
  endlessNewBest: 0,
  hasCheckpoint: false,
  introPlaying: false,
  qualityLabel: 'high',
  tutorialStep: 0,
  wavePreview: {},
  perf: null,
  coinPulse: 0,
  heartPulse: 0,
  set: (p) => set(p),
  toast: (text, kind = 'info') => {
    const t = { id: toastId++, text, kind };
    set({ toasts: [...get().toasts.slice(-3), t] });
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== t.id) }), kind === 'error' ? 2600 : 2000);
  },
}));
