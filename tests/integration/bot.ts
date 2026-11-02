/** Deterministic balance bots for L1-01 (tests only). */
import { level, fresh } from '../unit/helpers';
import { executeCommand, resolveTowerFootprint } from '../../src/commands/execute';
import { advanceOneTick } from '../../src/simulation/engine';
import { computeRoutes } from '../../src/navigation/connectivity';
import { deriveMap } from '../../src/navigation/derived-map';
import { sampleTowerRange } from '../../src/navigation/line-of-sight';
import { TOWER_DEFS, upgradeCost } from '../../src/domain/definitions';
import type { GameState, TowerKind } from '../../src/domain/types';

/** Best anchor by visible route-cell coverage (both portals' routes). */
export function bestAnchor(s: GameState, kind: TowerKind): { id: string; score: number } | null {
  const map = deriveMap(level, s);
  const routesNow = s.phase === 'COMBAT' ? s.frozenRoutes : (() => { const r = computeRoutes(level, s); return r.ok ? r.routes : {}; })();
  const onRoute = new Set(Object.values(routesNow).flat());
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
      for (const route of Object.values(routes)) if (route.includes(sm.cellId)) score++;
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
  /** Fraction of gold the bot is willing to spend (sloppy players leave gold idle). */
  spendRatio?: number;
}

function spend(s: GameState, o: BotOptions): GameState {
  const budgetFloor = Math.floor(s.gold * (1 - (o.spendRatio ?? 1)));
  for (let guard = 0; guard < 40; guard++) {
    const kind = o.mix[s.towers.length % o.mix.length]!;
    const canBuild = s.towers.length < o.maxTowers && s.gold - TOWER_DEFS[kind].buildCost >= budgetFloor;
    const upgradable = s.towers
      .filter((t) => t.level < 3)
      .map((t) => ({ t, cost: upgradeCost(t.kind, (t.level + 1) as 2 | 3) }))
      .sort((a, b) => a.cost - b.cost || a.t.level - b.t.level);
    const up = upgradable[0];
    const preferUpgrade = s.towers.length >= o.upgradeAfter && up && s.gold - up.cost >= budgetFloor;
    if (preferUpgrade || !canBuild) {
      if (up && s.gold - up.cost >= budgetFloor) {
        const r = executeCommand(level, s, { type: 'UPGRADE_TOWER', towerId: up.t.id });
        if (r.ok) { s = r.state; continue; }
      }
      if (!canBuild) break;
    }
    const b = bestAnchor(s, kind);
    if (!b || b.score < o.minScore) {
      if (up && s.gold - up.cost >= budgetFloor) { const r = executeCommand(level, s, { type: 'UPGRADE_TOWER', towerId: up.t.id }); if (r.ok) { s = r.state; continue; } }
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

export function runBot(o: BotOptions): RunReport {
  let s = fresh();
  const waves: WaveReport[] = [];
  for (let w = 0; w < level.waves.length; w++) {
    s = spend(s, o);
    const st = executeCommand(level, s, { type: 'START_WAVE' });
    if (!st.ok) throw new Error(st.message);
    s = st.state;
    let leaks = 0; let ticks = 0; let spawned = 0; const leakKinds: Record<string, number> = {};
    while (s.phase === 'COMBAT') {
      if (o.combatSpendEvery && ticks > 0 && ticks % o.combatSpendEvery === 0) s = spend(s, o);
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
