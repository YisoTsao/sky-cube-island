import type { CellId, GameState, LevelDef, RuntimeFlags, TowerKind, TowerLevel } from '../domain/types';

/** Range-projection state per cell (Tech §7.3). Mirrors navigation's RangeSample (data only). */
export type RangeCellState = 'visible' | 'occluded' | 'outOfRange';
export interface RangeCell { cellId: CellId; state: RangeCellState; highGroundOnly: boolean }

export type Tool =
  | { type: 'none' }
  | { type: 'build'; kind: TowerKind }
  | { type: 'raise' } | { type: 'lower' } | { type: 'wall' }
  | { type: 'trap' } | { type: 'bridge' }
  /** Relocating an existing tower: pick a new anchor cell. */
  | { type: 'move'; towerId: string };

export interface PreviewInfo {
  tool: Tool;
  cellIds: CellId[];
  ok: boolean;
  message: string;
  cost: number;
  /** Routes if the action were committed (only when ok). */
  routes?: Record<string, CellId[]>;
  range?: RangeCell[];
  towerPreview?: { kind: TowerKind; level: TowerLevel; anchorCellId: CellId };
  wallCellId?: CellId;
  elevationPreview?: { cellId: CellId; to: number };
}

/**
 * Read-only data the presentation layers consume (D21-04). Implemented by the game controller;
 * presentation never imports simulation/command implementations.
 */
export interface SceneFeed {
  readonly level: LevelDef;
  readonly state: GameState;
  readonly prevState: GameState;
  /** Interpolation factor between prevState and state, [0,1]. */
  readonly alpha: number;
  readonly flags: RuntimeFlags;
  elevationOf(cellId: CellId): number;
  /** Current routes per portal (PREPARE preview or frozen COMBAT routes). */
  routes(): Record<string, CellId[]>;
  rangeForTower(towerId: string): RangeCell[];
  /** Cells under each portal's straight flyer lane (static per level). */
  flightLanes(): CellId[][];
}
