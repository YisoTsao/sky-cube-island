import type {
  CellId, CommandResult, Elevation, GameCommand, GameEvent, GameState, LevelDef, RejectionCode, TowerInstance, TowerKind,
} from '../domain/types';
import { MAX_ELEVATION, MIN_ELEVATION } from '../domain/types';
import { ECONOMY, TOWER_DEFS, TRAP_DEF, nextTowerLevel, sellRefund, upgradeCost } from '../domain/definitions';
import { deriveMap, type DerivedMap } from '../navigation/derived-map';
import { computeRoutes } from '../navigation/connectivity';
import { buildSpawnQueue } from '../simulation/waves';
import { logCommand } from '../domain/challenges';

const MESSAGES: Record<RejectionCode, string> = {
  INVALID_PHASE: '目前階段不能進行這個操作',
  OUT_OF_BOUNDS: '超出地圖範圍',
  NOT_EDITABLE: '這塊地無法改造',
  OCCUPIED: '這裡已經有建築',
  INVALID_FOOTPRINT: '防禦塔需要同一平台、同一高度、可建造的 2×2 空地',
  INVALID_ELEVATION: '高度已達上限或下限',
  PROTECTED_CONNECTOR: '橋梁、階梯與其端點是固定通道，不可改造',
  INSUFFICIENT_GOLD: '金幣不足',
  NO_ROUTE_FROM_PORTAL: '必須保留所有入口到核心的道路',
  ROUTE_TOO_LONG: '路線過長（超過上限），請保留較短的道路',
  NOT_FOUND: '找不到目標',
  INVALID_LEVEL_DATA: '關卡資料錯誤',
  NOTHING_TO_UNDO: '沒有可以撤銷的操作',
  MAX_LEVEL: '已經是最高等級',
  ON_ACTIVE_ROUTE: '戰鬥中不能把塔蓋在敵人正在走的路線上',
  NOT_A_TRAP_CELL: '陷阱只能放在可通行的平台地面（不可放在橋、入口、核心旁或建築上）',
};

/** Tower commands stay available during COMBAT so kill gold can be reinvested mid-wave. */
const COMBAT_COMMANDS: ReadonlySet<GameCommand['type']> = new Set(['BUILD_TOWER', 'UPGRADE_TOWER', 'SELL_TOWER', 'SET_TARGETING']);

export function rejectionMessage(code: RejectionCode): string { return MESSAGES[code]; }

const reject = (state: GameState, code: RejectionCode, portalId?: string): CommandResult => {
  let message = MESSAGES[code];
  if (portalId && (code === 'NO_ROUTE_FROM_PORTAL' || code === 'ROUTE_TOO_LONG')) message += `（入口 ${portalId}）`;
  return portalId ? { ok: false, state, code, message, portalId } : { ok: false, state, code, message };
};

export interface FootprintResolution { ok: true; cellIds: CellId[] }
export type FootprintResult = FootprintResolution | { ok: false; code: RejectionCode };

/** resolveTowerFootprint (Tech §5.1): anchor = min x/z; never auto-shifts. */
export function resolveTowerFootprint(map: DerivedMap, anchorCellId: CellId): FootprintResult {
  const anchor = map.index.cells.get(anchorCellId);
  if (!anchor) return { ok: false, code: 'OUT_OF_BOUNDS' };
  const ids: CellId[] = [];
  const e = map.elevationOf(anchor.id);
  let occupied = false;
  for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
    const c = map.cellAt(anchor.pos.x + dx, anchor.pos.z + dz);
    if (!c || c.kind !== 'ground' || c.platformId !== anchor.platformId) return { ok: false, code: 'INVALID_FOOTPRINT' };
    if (map.elevationOf(c.id) !== e) return { ok: false, code: 'INVALID_FOOTPRINT' };
    if (!c.buildable || c.immutable || map.index.connectorCellIds.has(c.id)) return { ok: false, code: 'INVALID_FOOTPRINT' };
    if (map.occupantOf(c.id)) occupied = true;
    ids.push(c.id);
  }
  if (occupied) return { ok: false, code: 'OCCUPIED' };
  return { ok: true, cellIds: ids };
}

function goldEvent(tick: number, delta: number, balance: number, reason: string): GameEvent {
  return { type: 'GOLD_CHANGED', tick, delta, balance, reason };
}

/** Validate routes on the tentative state; atomic commit or untouched original (Tech §6). */
function commitWithRoutes(
  level: LevelDef, original: GameState, draft: GameState, events: GameEvent[], cost: number,
): CommandResult {
  const routes = computeRoutes(level, draft);
  if (!routes.ok) return reject(original, routes.code, routes.portalId);
  events.push({ type: 'ROUTES_CHANGED', tick: draft.tick, portalIds: level.portals.map((p) => p.id) });
  return { ok: true, state: draft, events, cost };
}

function editProtectionCode(map: DerivedMap, cellId: CellId): RejectionCode {
  const c = map.index.cells.get(cellId)!;
  if (map.index.connectorCellIds.has(cellId)) return 'PROTECTED_CONNECTOR';
  for (const end of map.index.connectorEndpointIds) {
    const e = map.index.cells.get(end)!;
    if (Math.max(Math.abs(e.pos.x - c.pos.x), Math.abs(e.pos.z - c.pos.z)) <= 1) return 'PROTECTED_CONNECTOR';
  }
  return 'NOT_EDITABLE';
}

/**
 * The single entry point that mutates game state (Tech §6.2). Pure: returns a new state or the
 * untouched original on failure. UNDO_PREPARE is handled by the session layer.
 */
export function executeCommand(level: LevelDef, state: GameState, cmd: GameCommand): CommandResult {
  const r = executeRaw(level, state, cmd);
  if (!r.ok || cmd.type === 'START_WAVE' || cmd.type === 'CONTINUE' || cmd.type === 'SET_TARGETING') return r;
  return { ...r, state: { ...r.state, run: logCommand(r.state.run, cmd.type, r.state, cmd.type === 'BUILD_TOWER' ? cmd.kind : undefined) } };
}

function executeRaw(level: LevelDef, state: GameState, cmd: GameCommand): CommandResult {
  if (cmd.type === 'UNDO_PREPARE') return reject(state, state.phase === 'PREPARE' ? 'NOTHING_TO_UNDO' : 'INVALID_PHASE');
  if (cmd.type === 'CONTINUE') return continueAfterResult(level, state);
  if (state.phase !== 'PREPARE' && !(state.phase === 'COMBAT' && COMBAT_COMMANDS.has(cmd.type))) return reject(state, 'INVALID_PHASE');
  const map = deriveMap(level, state);
  const tick = state.tick;

  switch (cmd.type) {
    case 'SET_ELEVATION': {
      const cell = map.index.cells.get(cmd.cellId);
      if (!cell) return reject(state, 'OUT_OF_BOUNDS');
      if (cell.kind !== 'ground' || !cell.editable) return reject(state, editProtectionCode(map, cell.id));
      if (map.occupantOf(cell.id)) return reject(state, 'OCCUPIED');
      const cur = map.elevationOf(cell.id);
      if (Math.abs(cmd.next - cur) !== 1 || cmd.next < MIN_ELEVATION || cmd.next > MAX_ELEVATION) return reject(state, 'INVALID_ELEVATION');
      const cost = cmd.next > cur ? ECONOMY.raiseCost : ECONOMY.lowerCost;
      if (state.gold < cost) return reject(state, 'INSUFFICIENT_GOLD');
      const editedElevations = { ...state.editedElevations };
      if (cmd.next === cell.elevation) delete editedElevations[cell.id];
      else editedElevations[cell.id] = cmd.next;
      const draft: GameState = { ...state, gold: state.gold - cost, editedElevations };
      return commitWithRoutes(level, state, draft, [
        { type: 'TERRAIN_CHANGED', tick, cellId: cell.id, from: cur, to: cmd.next as Elevation },
        goldEvent(tick, -cost, draft.gold, cmd.next > cur ? 'raise' : 'lower'),
      ], cost);
    }
    case 'PLACE_WALL': {
      const cell = map.index.cells.get(cmd.cellId);
      if (!cell) return reject(state, 'OUT_OF_BOUNDS');
      if (cell.kind !== 'ground' || !cell.editable) return reject(state, editProtectionCode(map, cell.id));
      if (map.occupantOf(cell.id)) return reject(state, 'OCCUPIED');
      if (state.gold < ECONOMY.wallCost) return reject(state, 'INSUFFICIENT_GOLD');
      const wallId = `w${state.nextEntityId}`;
      const draft: GameState = {
        ...state,
        gold: state.gold - ECONOMY.wallCost,
        walls: [...state.walls, { id: wallId, cellId: cell.id, cost: ECONOMY.wallCost }],
        nextEntityId: state.nextEntityId + 1,
      };
      return commitWithRoutes(level, state, draft, [
        { type: 'WALL_PLACED', tick, wallId, cellId: cell.id },
        goldEvent(tick, -ECONOMY.wallCost, draft.gold, 'wall'),
      ], ECONOMY.wallCost);
    }
    case 'REMOVE_WALL': {
      const wall = state.walls.find((w) => w.id === cmd.wallId);
      if (!wall) return reject(state, 'NOT_FOUND');
      const draft: GameState = {
        ...state,
        gold: state.gold + ECONOMY.wallRefund,
        walls: state.walls.filter((w) => w.id !== wall.id),
      };
      return commitWithRoutes(level, state, draft, [
        { type: 'WALL_REMOVED', tick, wallId: wall.id, cellId: wall.cellId },
        goldEvent(tick, ECONOMY.wallRefund, draft.gold, 'wallRefund'),
      ], -ECONOMY.wallRefund);
    }
    case 'BUILD_TOWER': {
      const fp = resolveTowerFootprint(map, cmd.anchorCellId);
      if (!fp.ok) return reject(state, fp.code);
      if (state.phase === 'COMBAT') {
        // Frozen routes cannot change mid-wave, so never build on top of them.
        // (wall breakers plan their own route at spawn, so live enemies' paths count too)
        const onRoute = new Set([...Object.values(state.frozenRoutes).flat(), ...state.enemies.flatMap((e) => e.pathNodeIds)]);
        if (fp.cellIds.some((id) => onRoute.has(id))) return reject(state, 'ON_ACTIVE_ROUTE');
      }
      const def = TOWER_DEFS[cmd.kind];
      if (state.gold < def.buildCost) return reject(state, 'INSUFFICIENT_GOLD');
      const tower: TowerInstance = {
        id: `t${state.nextEntityId}`, kind: cmd.kind, anchorCellId: cmd.anchorCellId,
        footprintCellIds: fp.cellIds, level: 1, cooldownTicks: 0, investedGold: def.buildCost,
        targeting: 'FIRST', builtWave: state.currentWaveIndex,
      };
      const draft: GameState = {
        ...state, gold: state.gold - def.buildCost, towers: [...state.towers, tower], nextEntityId: state.nextEntityId + 1,
      };
      return commitWithRoutes(level, state, draft, [
        { type: 'TOWER_BUILT', tick, towerId: tower.id, kind: tower.kind, level: 1, anchorCellId: tower.anchorCellId },
        goldEvent(tick, -def.buildCost, draft.gold, 'build'),
      ], def.buildCost);
    }
    case 'UPGRADE_TOWER': {
      const t = state.towers.find((x) => x.id === cmd.towerId);
      if (!t) return reject(state, 'NOT_FOUND');
      const to = nextTowerLevel(t.level);
      if (!to) return reject(state, 'MAX_LEVEL');
      const cost = upgradeCost(t.kind, to);
      if (state.gold < cost) return reject(state, 'INSUFFICIENT_GOLD');
      const upgraded: TowerInstance = { ...t, level: to, investedGold: t.investedGold + cost };
      const draft: GameState = { ...state, gold: state.gold - cost, towers: state.towers.map((x) => (x.id === t.id ? upgraded : x)) };
      return {
        ok: true, state: draft, cost,
        events: [
          { type: 'TOWER_UPGRADED', tick, towerId: t.id, kind: t.kind, level: to, anchorCellId: t.anchorCellId },
          goldEvent(tick, -cost, draft.gold, 'upgrade'),
        ],
      };
    }
    case 'SELL_TOWER': {
      const t = state.towers.find((x) => x.id === cmd.towerId);
      if (!t) return reject(state, 'NOT_FOUND');
      const refund = sellRefund(t.investedGold);
      const draft: GameState = { ...state, gold: state.gold + refund, towers: state.towers.filter((x) => x.id !== t.id) };
      return commitWithRoutes(level, state, draft, [
        { type: 'TOWER_SOLD', tick, towerId: t.id, kind: t.kind, level: t.level, anchorCellId: t.anchorCellId },
        goldEvent(tick, refund, draft.gold, 'sell'),
      ], -refund);
    }
    case 'SET_TARGETING': {
      const t = state.towers.find((x) => x.id === cmd.towerId);
      if (!t) return reject(state, 'NOT_FOUND');
      const draft: GameState = { ...state, towers: state.towers.map((x) => (x.id === t.id ? { ...x, targeting: cmd.targeting } : x)) };
      return { ok: true, state: draft, cost: 0, events: [{ type: 'TOWER_TARGETING_CHANGED', tick, towerId: t.id, targeting: cmd.targeting }] };
    }
    case 'PLACE_TRAP': {
      const cell = map.index.cells.get(cmd.cellId);
      if (!cell) return reject(state, 'OUT_OF_BOUNDS');
      const traps = state.traps ?? [];
      if (traps.some((t) => t.cellId === cell.id) || map.occupantOf(cell.id)) return reject(state, 'OCCUPIED');
      const idx = map.index;
      if (cell.kind !== 'ground' || cell.terrain === 'water' || idx.connectorCellIds.has(cell.id) || idx.portalCellIds.has(cell.id)
        || idx.approachIds.has(cell.id) || idx.coreFootprint.has(cell.id)) return reject(state, 'NOT_A_TRAP_CELL');
      if (state.gold < TRAP_DEF.cost) return reject(state, 'INSUFFICIENT_GOLD');
      const trapId = `p${state.nextEntityId}`;
      const draft: GameState = {
        ...state, gold: state.gold - TRAP_DEF.cost, nextEntityId: state.nextEntityId + 1,
        traps: [...traps, { id: trapId, cellId: cell.id, cooldownTicks: 0 }],
      };
      // traps never block, so routes are unchanged
      return { ok: true, state: draft, cost: TRAP_DEF.cost, events: [
        { type: 'TRAP_PLACED', tick, trapId, cellId: cell.id },
        goldEvent(tick, -TRAP_DEF.cost, draft.gold, 'trap'),
      ] };
    }
    case 'REMOVE_TRAP': {
      const trap = (state.traps ?? []).find((t) => t.id === cmd.trapId);
      if (!trap) return reject(state, 'NOT_FOUND');
      const draft: GameState = { ...state, gold: state.gold + TRAP_DEF.refund, traps: (state.traps ?? []).filter((t) => t.id !== trap.id) };
      return { ok: true, state: draft, cost: -TRAP_DEF.refund, events: [
        { type: 'TRAP_REMOVED', tick, trapId: trap.id, cellId: trap.cellId },
        goldEvent(tick, TRAP_DEF.refund, draft.gold, 'trapRefund'),
      ] };
    }
    case 'TOGGLE_BRIDGE': {
      const con = level.connectors.find((c) => c.id === cmd.connectorId);
      if (!con) return reject(state, 'NOT_FOUND');
      const broken = state.brokenConnectors ?? [];
      const isBroken = broken.includes(con.id);
      const cost = isBroken ? ECONOMY.bridgeRepairCost : ECONOMY.bridgeCollapseCost;
      if (state.gold < cost) return reject(state, 'INSUFFICIENT_GOLD');
      // nothing may stand on a deck that is about to fall
      if (!isBroken && (state.traps ?? []).some((t) => con.chain.includes(t.cellId))) return reject(state, 'OCCUPIED');
      const draft: GameState = {
        ...state, gold: state.gold - cost,
        brokenConnectors: isBroken ? broken.filter((id) => id !== con.id) : [...broken, con.id],
      };
      return commitWithRoutes(level, state, draft, [
        { type: isBroken ? 'BRIDGE_REPAIRED' : 'BRIDGE_COLLAPSED', tick, connectorId: con.id },
        goldEvent(tick, -cost, draft.gold, isBroken ? 'bridgeRepair' : 'bridgeCollapse'),
      ], cost);
    }
    case 'START_WAVE': {
      const wave = level.waves[state.currentWaveIndex];
      if (!wave) return reject(state, 'INVALID_LEVEL_DATA');
      const routes = computeRoutes(level, state);
      if (!routes.ok) return reject(state, routes.code, routes.portalId);
      const draft: GameState = {
        ...state,
        phase: 'COMBAT',
        waveTick: 0,
        spawnCursor: 0,
        spawnQueue: buildSpawnQueue(wave, level.portals.map((p) => p.id)),
        frozenRoutes: routes.routes,
        towers: state.towers.map((t) => ({ ...t, cooldownTicks: 0 })),
        ...(state.traps ? { traps: state.traps.map((t) => ({ ...t, cooldownTicks: 0 })) } : {}),
      };
      return {
        ok: true, state: draft, cost: 0,
        events: [
          { type: 'PHASE_CHANGED', tick, from: 'PREPARE', to: 'COMBAT' },
          { type: 'WAVE_STARTED', tick, waveIndex: state.currentWaveIndex },
        ],
      };
    }
  }
}

function continueAfterResult(level: LevelDef, state: GameState): CommandResult {
  if (state.phase !== 'WAVE_RESULT') return reject(state, 'INVALID_PHASE');
  const nextIndex = state.currentWaveIndex + 1;
  if (nextIndex >= level.waves.length) return reject(state, 'INVALID_PHASE');
  const draft: GameState = { ...state, phase: 'PREPARE', currentWaveIndex: nextIndex, frozenRoutes: {}, spawnQueue: [], spawnCursor: 0, waveTick: 0 };
  return {
    ok: true, state: draft, cost: 0,
    events: [{ type: 'PHASE_CHANGED', tick: state.tick, from: 'WAVE_RESULT', to: 'PREPARE' }],
  };
}

export function towerCostFor(kind: TowerKind): number { return TOWER_DEFS[kind].buildCost; }
