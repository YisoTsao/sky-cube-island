import type { CellId, Elevation, TowerInstance, TowerLevel, Vec3 } from '../domain/types';
import { HEIGHT_STEP_WORLD } from '../domain/types';
import {
  LEVEL_RANGE_BONUS, PREVIEW_TARGET_OFFSET, TOWER_DEFS, highGroundBonus,
} from '../domain/definitions';
import type { DerivedMap } from './derived-map';

/**
 * Logical line of sight (Tech §7.1). Occluders are solid terrain columns only: a ground cell
 * whose top surface is above the segment where the segment crosses that cell. Connector decks,
 * walls, decor, bridges' rails and clouds never occlude. Excluded cells (tower base, target)
 * never self-occlude.
 *
 * Exact 2D grid traversal (Amanatides–Woo) over the XZ plane; within each crossed cell the
 * segment height is linear, so the minimum is at the entry/exit point.
 */
export function hasLineOfSight(map: DerivedMap, from: Vec3, to: Vec3, exclude: ReadonlySet<CellId>): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  let cx = Math.floor(from.x);
  let cz = Math.floor(from.z);
  const ex = Math.floor(to.x);
  const ez = Math.floor(to.z);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = stepX > 0 ? (cx + 1 - from.x) / dx : stepX < 0 ? (from.x - cx) / -dx : Infinity;
  let tMaxZ = stepZ > 0 ? (cz + 1 - from.z) / dz : stepZ < 0 ? (from.z - cz) / -dz : Infinity;
  let tEnter = 0;
  const yAt = (t: number) => from.y + (to.y - from.y) * t;
  for (let guard = 0; guard < 256; guard++) {
    const tExit = Math.min(tMaxX, tMaxZ, 1);
    const cell = map.cellAt(cx, cz);
    if (cell && cell.kind === 'ground' && !exclude.has(cell.id)) {
      const top = map.elevationOf(cell.id) * HEIGHT_STEP_WORLD;
      const minY = Math.min(yAt(tEnter), yAt(tExit));
      if (minY < top - 1e-6) return false;
    }
    if (cx === ex && cz === ez) return true;
    if (tExit >= 1) return true;
    if (tMaxX < tMaxZ) { cx += stepX; tEnter = tMaxX; tMaxX += tDeltaX; }
    else { cz += stepZ; tEnter = tMaxZ; tMaxZ += tDeltaZ; }
  }
  return true;
}

export interface TowerGeometry {
  origin: Vec3;
  elevation: Elevation;
  center: { x: number; z: number };
  exclude: Set<CellId>;
}

export function towerGeometry(map: DerivedMap, tower: Pick<TowerInstance, 'kind' | 'anchorCellId' | 'footprintCellIds'>): TowerGeometry {
  const anchor = map.index.cells.get(tower.anchorCellId)!;
  const elevation = map.elevationOf(anchor.id);
  const center = { x: anchor.pos.x + 1, z: anchor.pos.z + 1 };
  return {
    origin: { x: center.x, y: elevation * HEIGHT_STEP_WORLD + TOWER_DEFS[tower.kind].muzzleOffsetWorld, z: center.z },
    elevation,
    center,
    exclude: new Set(tower.footprintCellIds),
  };
}

export function effectiveRange(kind: TowerInstance['kind'], level: TowerLevel, towerElevation: number, enemyElevation: number): number {
  return TOWER_DEFS[kind].baseRangeWorld + LEVEL_RANGE_BONUS[level] + highGroundBonus(towerElevation - enemyElevation);
}

export const distance3D = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export type RangeSample = 'visible' | 'occluded' | 'outOfRange';
export interface RangeCellSample { cellId: CellId; state: RangeSample; highGroundOnly: boolean }

/**
 * Range projection sampling (Tech §7.3): per SurfaceCell, test cell centre at a typical aim
 * height with the SAME range + LOS functions used by combat.
 */
export function sampleTowerRange(
  map: DerivedMap,
  tower: Pick<TowerInstance, 'kind' | 'anchorCellId' | 'footprintCellIds' | 'level'>,
): RangeCellSample[] {
  const geo = towerGeometry(map, tower);
  const out: RangeCellSample[] = [];
  for (const cell of map.index.level.cells) {
    if (geo.exclude.has(cell.id)) continue;
    const e = map.elevationOf(cell.id);
    const target = { x: cell.pos.x + 0.5, y: e * HEIGHT_STEP_WORLD + PREVIEW_TARGET_OFFSET, z: cell.pos.z + 0.5 };
    const d = distance3D(geo.origin, target);
    const range = effectiveRange(tower.kind, tower.level, geo.elevation, e);
    if (d > range) { out.push({ cellId: cell.id, state: 'outOfRange', highGroundOnly: false }); continue; }
    const baseRange = effectiveRange(tower.kind, tower.level, 0, 0);
    const exclude = new Set(geo.exclude);
    exclude.add(cell.id);
    const visible = hasLineOfSight(map, geo.origin, target, exclude);
    out.push({ cellId: cell.id, state: visible ? 'visible' : 'occluded', highGroundOnly: d > baseRange });
  }
  return out;
}
