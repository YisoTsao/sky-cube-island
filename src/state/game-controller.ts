import type {
  CellId, CommandResult, GameCommand, GameEvent, GameState, LevelDef, RuntimeFlags, TowerInstance,
} from '../domain/types';
import { STEP_SECONDS, ECONOMY, TOWER_DEFS, TRAP_DEF } from '../domain/definitions';
import { createInitialState, advanceOneTick, flightLaneCells } from '../simulation/engine';
import { wavePreview } from '../simulation/waves';
import { createSession, dispatch, type PrepareSession } from '../session/undo-history';
import { executeCommand, resolveTowerFootprint } from '../commands/execute';
import { computeRoutes } from '../navigation/connectivity';
import { deriveMap, indexLevel } from '../navigation/derived-map';
import { sampleTowerRange } from '../navigation/line-of-sight';
import type { PreviewInfo, RangeCell, SceneFeed, Tool } from '../presentation/feed';
import { analyseFailure, emptyWaveStats, foldWaveStats, type WaveStats } from '../presentation/stats';
import { readCheckpoint, readSave, writeCheckpoint, writeSave, clearSave } from '../persistence/save';

export type EventListener = (events: GameEvent[], ctx: { state: GameState; prev: GameState; fromUndo: boolean; fromLoad: boolean }) => void;

const MAX_CATCHUP_TICKS = 6;

/**
 * Command controller + fixed-step loop + session (Tech §1 dependency diagram). The only object
 * that talks to the simulation; presentation reads it through `SceneFeed` and `GameEvent`s.
 */
export class GameController implements SceneFeed {
  readonly level: LevelDef;
  state: GameState;
  prevState: GameState;
  alpha = 0;
  readonly flags: RuntimeFlags = { paused: false, speed: 1 };
  private session: PrepareSession = createSession();
  private acc = 0;
  private listeners = new Set<EventListener>();
  private routeCache: Record<string, CellId[]> = {};
  private rangeCache = new Map<string, RangeCell[]>();
  private previewCache = new Map<string, PreviewInfo>();
  private version = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  waveStats: WaveStats = emptyWaveStats(0);
  persist = true;

  constructor(level: LevelDef, seed = 1) {
    this.level = level;
    this.state = createInitialState(level, seed);
    this.prevState = this.state;
    this.recomputeRoutes();
  }

  on(fn: EventListener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  private emit(events: GameEvent[], prev: GameState, fromUndo = false, fromLoad = false) {
    for (const e of events) this.waveStats = foldWaveStats(this.waveStats, e);
    for (const l of this.listeners) l(events, { state: this.state, prev, fromUndo, fromLoad });
  }

  // ---- SceneFeed ------------------------------------------------------------------------
  private lanes: CellId[][] | null = null;
  flightLanes(): CellId[][] {
    if (!this.lanes) { const index = indexLevel(this.level); this.lanes = this.level.portals.map((p) => flightLaneCells(this.level, { index }, p.cellId)); }
    return this.lanes;
  }
  elevationOf(cellId: CellId): number {
    return this.state.editedElevations[cellId] ?? indexLevel(this.level).cells.get(cellId)?.elevation ?? 0;
  }
  routes(): Record<string, CellId[]> {
    if (this.state.phase === 'COMBAT' || (this.state.phase === 'VICTORY' && Object.keys(this.state.frozenRoutes).length)) return this.state.frozenRoutes;
    return this.routeCache;
  }
  rangeForTower(towerId: string): RangeCell[] {
    const key = `${towerId}@${this.version}`;
    const hit = this.rangeCache.get(key);
    if (hit) return hit;
    const t = this.state.towers.find((x) => x.id === towerId);
    if (!t) return [];
    const r = sampleTowerRange(deriveMap(this.level, this.state), t);
    this.rangeCache.set(key, r);
    return r;
  }

  get canUndo(): boolean { return this.state.phase === 'PREPARE' && this.session.history.length > 0; }

  private recomputeRoutes() {
    const r = computeRoutes(this.level, this.state);
    this.routeCache = r.routes;
  }

  private changed() {
    this.version++;
    this.rangeCache.clear();
    this.previewCache.clear();
    if (this.state.phase !== 'COMBAT') this.recomputeRoutes();
  }

  // ---- Commands ---------------------------------------------------------------------------
  dispatch(cmd: GameCommand): CommandResult {
    const prev = this.state;
    const result = dispatch(this.level, this.session, this.state, cmd);
    if (!result.ok) return result;
    this.state = result.state;
    this.prevState = result.state;
    this.acc = 0;
    this.changed();
    if (cmd.type === 'START_WAVE') this.waveStats = emptyWaveStats(this.state.currentWaveIndex);
    this.emit(result.events, prev, cmd.type === 'UNDO_PREPARE');
    this.afterStateChange(prev);
    return result;
  }

  private afterStateChange(prev: GameState) {
    if (!this.persist) return;
    const s = this.state;
    if (s.phase === 'PREPARE' && prev.phase !== 'PREPARE') {
      void writeSave(s);
      void writeCheckpoint(s);
    } else if (s.phase === 'PREPARE') {
      // throttled 500 ms autosave after successful PREPARE commands (D21-15)
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => { void writeSave(this.state); }, 500);
    } else if (s.phase === 'WAVE_RESULT' && prev.phase !== 'WAVE_RESULT') {
      void writeSave(s);
    } else if (s.phase === 'VICTORY') {
      void clearSave(0, this.level.id);
    }
    // DEFEAT keeps the last safe save + checkpoint so the player can retry this wave's PREPARE.
  }

  /** Preview an action at a cell without committing (preview → validate, Tech §6). */
  preview(tool: Tool, cellId: CellId | null): PreviewInfo | null {
    if (!cellId || tool.type === 'none') return null;
    const key = `${tool.type}:${'kind' in tool ? tool.kind : ''}:${cellId}@${this.version}`;
    const hit = this.previewCache.get(key);
    if (hit) return hit;
    let info: PreviewInfo;
    const s = this.state;
    if (tool.type === 'build') {
      const map = deriveMap(this.level, s);
      const fp = resolveTowerFootprint(map, cellId);
      const cells = fp.ok ? fp.cellIds : this.squareCells(cellId);
      const r = executeCommand(this.level, s, { type: 'BUILD_TOWER', kind: tool.kind, anchorCellId: cellId });
      const virtual: Pick<TowerInstance, 'kind' | 'anchorCellId' | 'footprintCellIds' | 'level'> = { kind: tool.kind, anchorCellId: cellId, footprintCellIds: cells, level: 1 };
      const rangeState = r.ok ? r.state : s;
      const anchorOk = map.index.cells.has(cellId) && cells.length === 4;
      info = {
        tool, cellIds: cells, ok: r.ok, message: r.ok ? `${TOWER_DEFS[tool.kind].name}：${TOWER_DEFS[tool.kind].buildCost} 金幣` : r.message,
        cost: TOWER_DEFS[tool.kind].buildCost,
        routes: r.ok ? computeRoutes(this.level, r.state).routes : undefined,
        range: anchorOk ? sampleTowerRange(deriveMap(this.level, rangeState), virtual) : undefined,
        towerPreview: { kind: tool.kind, level: 1, anchorCellId: cellId },
      };
    } else if (tool.type === 'trap') {
      const r = executeCommand(this.level, s, { type: 'PLACE_TRAP', cellId });
      info = { tool, cellIds: [cellId], ok: r.ok, cost: TRAP_DEF.cost, message: r.ok ? `放置尖刺陷阱：${TRAP_DEF.cost} 金幣` : r.message };
    } else if (tool.type === 'bridge') {
      const con = this.level.connectors.find((c) => c.chain.includes(cellId));
      if (!con) {
        info = { tool, cellIds: [cellId], ok: false, cost: 0, message: '請點選一座橋' };
      } else {
        const broken = (s.brokenConnectors ?? []).includes(con.id);
        const cost = broken ? ECONOMY.bridgeRepairCost : ECONOMY.bridgeCollapseCost;
        const r = executeCommand(this.level, s, { type: 'TOGGLE_BRIDGE', connectorId: con.id });
        info = {
          tool, cellIds: [...con.chain], ok: r.ok, cost,
          message: r.ok ? `${broken ? '修復' : '拆毀'}${con.name}：${cost} 金幣` : r.message,
          routes: r.ok ? computeRoutes(this.level, r.state).routes : undefined,
        };
      }
    } else {
      const cur = this.elevationOf(cellId);
      const cmd: GameCommand = tool.type === 'wall'
        ? { type: 'PLACE_WALL', cellId }
        : { type: 'SET_ELEVATION', cellId, next: (tool.type === 'raise' ? cur + 1 : cur - 1) as never };
      const cost = tool.type === 'wall' ? ECONOMY.wallCost : tool.type === 'raise' ? ECONOMY.raiseCost : ECONOMY.lowerCost;
      const r = executeCommand(this.level, s, cmd);
      const label = tool.type === 'wall' ? '放置路障' : tool.type === 'raise' ? '升高地形' : '降低地形';
      info = {
        tool, cellIds: [cellId], ok: r.ok, cost,
        message: r.ok ? `${label}：${cost} 金幣` : r.message,
        routes: r.ok ? computeRoutes(this.level, r.state).routes : undefined,
        wallCellId: tool.type === 'wall' ? cellId : undefined,
        elevationPreview: tool.type !== 'wall' ? { cellId, to: tool.type === 'raise' ? cur + 1 : cur - 1 } : undefined,
      };
    }
    this.previewCache.set(key, info);
    return info;
  }

  private squareCells(anchor: CellId): CellId[] {
    const idx = indexLevel(this.level);
    const c = idx.cells.get(anchor);
    if (!c) return [];
    const out: CellId[] = [];
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const id = idx.byPos.get(`${c.pos.x + dx},${c.pos.z + dz}`);
      if (id) out.push(id);
    }
    return out;
  }

  wavePreviewCounts(): Record<string, Record<string, number>> {
    const w = this.level.waves[this.state.currentWaveIndex];
    return w ? wavePreview(w, this.level.portals.map((p) => p.id)) : {};
  }

  // ---- Fixed-step loop ------------------------------------------------------------------
  /** Advance accumulator by real seconds; returns number of ticks run (Tech §8.1). */
  update(dtReal: number): number {
    if (this.state.phase !== 'COMBAT' || this.flags.paused) { this.alpha = 1; return 0; }
    this.acc += Math.min(dtReal, 0.25) * this.flags.speed;
    let n = 0;
    while (this.acc >= STEP_SECONDS && n < MAX_CATCHUP_TICKS * this.flags.speed) {
      const prev = this.state;
      const r = advanceOneTick(this.state, this.level);
      this.prevState = prev;
      this.state = r.state;
      this.acc -= STEP_SECONDS;
      n++;
      if (r.events.length) {
        const phaseChanged = r.state.phase !== prev.phase;
        if (phaseChanged) this.changed();
        this.emit(r.events, prev);
        if (phaseChanged) { this.afterStateChange(prev); break; }
      }
    }
    if (n === MAX_CATCHUP_TICKS * this.flags.speed) this.acc = Math.min(this.acc, STEP_SECONDS);
    this.alpha = this.state.phase === 'COMBAT' ? Math.min(1, this.acc / STEP_SECONDS) : 1;
    return n;
  }

  // ---- Persistence / restart ------------------------------------------------------------
  private replaceState(s: GameState) {
    const prev = this.state;
    this.state = s;
    this.prevState = s;
    this.session = createSession();
    this.acc = 0;
    this.changed();
    this.emit([{ type: 'ROUTES_CHANGED', tick: s.tick, portalIds: this.level.portals.map((p) => p.id) }], prev, false, true);
  }

  newGame(seed = 1) {
    this.waveStats = emptyWaveStats(0);
    this.replaceState(createInitialState(this.level, seed));
    if (this.persist) { void writeSave(this.state); void writeCheckpoint(this.state); }
  }
  async loadSave(): Promise<boolean> {
    const s = await readSave(this.level.id);
    if (!s) return false;
    this.replaceState(s);
    return true;
  }
  async restartFromCheckpoint(): Promise<boolean> {
    const s = await readCheckpoint(this.level.id);
    if (!s) return false;
    this.replaceState(s);
    if (this.persist) void writeSave(s);
    return true;
  }
  async hasSave(): Promise<boolean> { return !!(await readSave(this.level.id)); }
  async hasCheckpoint(): Promise<boolean> { return !!(await readCheckpoint(this.level.id)); }

  /** Failure analysis sentence for the DEFEAT screen (Tech §8.4). */
  failureAnalysis(): string {
    const idx = indexLevel(this.level);
    const covered = new Set<CellId>();
    const map = deriveMap(this.level, this.state);
    for (const t of this.state.towers) for (const s of sampleTowerRange(map, t)) if (s.state === 'visible') covered.add(s.cellId);
    const routes = Object.keys(this.state.frozenRoutes).length ? this.state.frozenRoutes : this.routeCache;
    return analyseFailure({
      stats: this.waveStats, routes, covered, towerCount: this.state.towers.length,
      placeOf: (id) => {
        const c = idx.cells.get(id);
        if (!c) return '';
        if (idx.connectorCellIds.has(id) && c.kind !== 'ground') return idx.platformName.get(c.platformId) ?? '橋';
        const near = idx.connectorEndpointIds.has(id) ? '橋口' : '';
        return (idx.platformName.get(c.platformId) ?? '') + near;
      },
      portalName: (pid) => this.level.portals.find((p) => p.id === pid)?.name ?? pid,
    });
  }
}
