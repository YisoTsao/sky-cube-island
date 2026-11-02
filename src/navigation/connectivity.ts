import type { CellId, GameState, LevelDef, RejectionCode } from '../domain/types';
import { buildNavigationGraph } from './build-graph';
import { findPathToCore } from './astar';
import { deriveMap } from './derived-map';

export type RouteMap = Record<string, CellId[]>;

export type RouteValidation =
  | { ok: true; routes: RouteMap; costs: Record<string, number> }
  | { ok: false; code: Extract<RejectionCode, 'NO_ROUTE_FROM_PORTAL' | 'ROUTE_TOO_LONG'>; portalId: string; routes: RouteMap };

/** Check EACH portal reaches ANY core approach within maxShortestPathCost (Tech §6.3). */
export function computeRoutes(level: LevelDef, state: Pick<GameState, 'editedElevations' | 'towers' | 'walls'>): RouteValidation {
  const map = deriveMap(level, state);
  const graph = buildNavigationGraph(map);
  const routes: RouteMap = {};
  const costs: Record<string, number> = {};
  for (const portal of level.portals) {
    const route = findPathToCore(graph, map.index, portal.cellId, level.core.approachNodeIds);
    if (!route) return { ok: false, code: 'NO_ROUTE_FROM_PORTAL', portalId: portal.id, routes };
    routes[portal.id] = route.nodeIds;
    costs[portal.id] = route.cost;
    if (route.cost > level.maxShortestPathCost) {
      return { ok: false, code: 'ROUTE_TOO_LONG', portalId: portal.id, routes };
    }
  }
  return { ok: true, routes, costs };
}
