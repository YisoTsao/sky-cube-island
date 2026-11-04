/** Deterministic balance bots for any level (tests only; defaults to L1-01). */
import { level as L1 } from '../unit/helpers';
import { createInitialState } from '../../src/simulation/engine';
import { executeCommand, resolveTowerFootprint } from '../../src/commands/execute';
import { advanceOneTick, flightLaneCells } from '../../src/simulation/engine';
import { computeRoutes } from '../../src/navigation/connectivity';
import { deriveMap } from '../../src/navigation/derived-map';
import { sampleTowerRange } from '../../src/navigation/line-of-sight';
import { ENEMY_DEFS, MAX_TOWER_LEVEL, TOWER_DEFS, upgradeCost } from '../../src/domain/definitions';
import type { GameState, LevelDef, TowerBranch, TowerKind, TowerLevel } from '../../src/domain/types';

/** Best anchor by visible route-cell coverage (both portals' routes). */
export function bestAnchor(s: GameState, kind: TowerKind, level: LevelDef = L1, spread = false): { id: string; score: number } | null {
  const map = deriveMap(level, s);
  const routesNow = s.phase === 'COMBAT' ? s.frozenRoutes : (() => { const r = computeRoutes(level, s); return r.ok ? r.routes : {}; })();
  const onRoute = new Set(Object.values(routesNow).flat());
  // a good player also covers the straight lanes flyers take (shown in the overlay)
  const flyers = level.waves.some((w) => w.entries.some((e) => ENEMY_DEFS[e.enemyKind].flying));
  const lanes = flyers ? level.portals.map((p) => flightLaneCells(level, map, p.cellId)) : [];
  // spread: a route that is already well covered is worth less (good players guard every lane)
  const covered: Record<string, number> = {};
  if (spread) {
    for (const t of s.towers) {
      for (const sm of sampleTowerRange(map, t)) {
        if (sm.state !== 'visible') continue;
        for (const [k, route] of Object.entries(routesNow)) if (route.includes(sm.cellId)) covered[k] = (covered[k] ?? 0) + 1;
      }
    }
  }
  const w = (k: string) => (spread ? 1 / (1 + (covered[k] ?? 0) / 10) : 1);
  let best: { id: string; score: number } | null = null;
  for (const c of level.cells) {
    const fp = resolveTowerFootprint(map, c.id);
    if (!fp.ok) continue;
    if (s.phase === 'COMBAT' && fp.cellIds.some((id) => onRoute.has(id))) continue;
    const draft = { ...s, towers: [...s.towers, { id: 'x', kind, anchorCellId: c.id, footprintCellIds: fp.cellIds, level: 1 as const, cooldownTicks: 0, investedGold: 0, targeting: 'FIRST' as const, builtWave: 0 }] };
    const r = computeRoutes(level, draft);
    if (!r.ok) continue;
    const routes = s.phase === 'COMBAT' ? s.frozenRoutes : r.routes;
    const samples = sampleTowerRange(deriveMap(level, draft), { kind, level: 1, anchorCellId: c.id, footprintCellIds: fp.cellIds });
    let score = 0;
    for (const sm of samples) {
      if (sm.state !== 'visible') continue;
      for (const [k, route] of Object.entries(routes)) if (route.includes(sm.cellId)) score += w(k);
      for (const lane of lanes) if (lane.includes(sm.cellId)) score += 0.8;
    }
    if (!best || score > best.score) best = { id: c.id, score };
  }
  return best;
}

export interface BotOptions {
  /** Tower kinds cycled for new builds. */
  mix: TowerKind[];
  /** Stop building new towers past this count (upgrade instead). */
  maxTowers: number;
  /** Also spend gold during combat every N ticks (0 = only in PREPARE). */
  combatSpendEvery: number;
  /** Minimum coverage score for a new tower to be worth it. */
  minScore: number;
  /** Prefer upgrades over new towers once this many towers exist. */
  upgradeAfter: number;
  /** Value coverage of poorly guarded routes higher (bots for maps with many separate lanes). */
  spread?: boolean;
  /** Fraction of gold the bot is willing to spend (sloppy players leave gold idle). */
  spendRatio?: number;
}

function spend(s: GameState, o: BotOptions, level: LevelDef): GameState {
  const budgetFloor = Math.floor(s.gold * (1 - (o.spendRatio ?? 1)));
  for (let guard = 0; guard < 40; guard++) {
    const kind = o.mix[s.towers.length % o.mix.length]!;
    const canBuild = s.towers.length < o.maxTowers && s.gold - TOWER_DEFS[kind].buildCost >= budgetFloor;
    const upgradable = s.towers
      .filter((t) => t.level < MAX_TOWER_LEVEL)
      .map((t) => ({ t, cost: upgradeCost(t.kind, (t.level + 1) as TowerLevel) }))
      .sort((a, b) => a.cost - b.cost || a.t.level - b.t.level);
    const up = upgradable[0];
    const preferUpgrade = s.towers.length >= o.upgradeAfter && up && s.gold - up.cost >= budgetFloor;
    if (preferUpgrade || !canBuild) {
      if (up && s.gold - up.cost >= budgetFloor) {
        const r = executeCommand(level, s, { type: 'UPGRADE_TOWER', towerId: up.t.id, branch: branchFor(up.t.id) });
        if (r.ok) { s = r.state; continue; }
      }
      if (!canBuild) break;
    }
    const b = bestAnchor(s, kind, level, o.spread);
    if (!b || b.score < o.minScore) {
      if (up && s.gold - up.cost >= budgetFloor) { const r = executeCommand(level, s, { type: 'UPGRADE_TOWER', towerId: up.t.id, branch: branchFor(up.t.id) }); if (r.ok) { s = r.state; continue; } }
      break;
    }
    const r = executeCommand(level, s, { type: 'BUILD_TOWER', kind, anchorCellId: b.id });
    if (!r.ok) break;
    s = r.state;
  }
  return s;
}

export interface WaveReport { wave: number; seconds: number; leaks: number; leakKinds: Record<string, number>; hpAfter: number; goldAfter: number; enemies: number; towers: string }
export interface RunReport { result: 'VICTORY' | 'DEFEAT'; coreHp: number; waves: WaveReport[] }

/**
 * Lowest core HP left after any wave. Campaign cores refill between waves, so the final HP only
 * tells about the last wave; this is the "worst moment" of the run.
 */
export const lowestHp = (r: RunReport): number => Math.min(...r.waves.map((w) => w.hpAfter));


/** Lv4 branch the bots pick: alternate by tower id so both branches see play. */
const branchFor = (id: string): TowerBranch => (Number(id.replace(/\D/g, '')) % 2 ? 'A' : 'B');

export function runBot(o: BotOptions, level: LevelDef = L1): RunReport {
  let s = createInitialState(level, 7);
  const waves: WaveReport[] = [];
  for (let w = 0; w < level.waves.length; w++) {
    s = spend(s, o, level);
    const st = executeCommand(level, s, { type: 'START_WAVE' });
    if (!st.ok) throw new Error(st.message);
    s = st.state;
    let leaks = 0; let ticks = 0; let spawned = 0; const leakKinds: Record<string, number> = {};
    while (s.phase === 'COMBAT') {
      if (o.combatSpendEvery && ticks > 0 && ticks % o.combatSpendEvery === 0) s = spend(s, o, level);
      const t = advanceOneTick(s, level);
      s = t.state; ticks++;
      for (const e of t.events) { if (e.type === 'ENEMY_REACHED_CORE') { leaks++; leakKinds[e.kind] = (leakKinds[e.kind] ?? 0) + 1; } if (e.type === 'ENEMY_SPAWNED') spawned++; }
    }
    waves.push({ wave: w + 1, seconds: ticks / 20, leaks, leakKinds, hpAfter: s.coreHp, goldAfter: s.gold, enemies: spawned, towers: s.towers.map((t) => t.kind.charAt(0) + t.level).join(' ') });
    if (s.phase !== 'WAVE_RESULT') break;
    s = executeCommand(level, s, { type: 'CONTINUE' }).state;
  }
  return { result: s.phase === 'VICTORY' ? 'VICTORY' : 'DEFEAT', coreHp: s.coreHp, waves };
}
