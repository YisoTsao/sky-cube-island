import type {
  CellId, EnemyInstance, GameEvent, GameState, LevelDef, TargetingMode, TowerInstance, Vec3,
} from '../domain/types';
import { HEIGHT_STEP_WORLD } from '../domain/types';
import { ENEMY_DEFS, TOWER_DEFS, TPS, TRAP_DEF, isBurrowed, isEnraged, starsForHp, towerStats, waveHpMultiplier } from '../domain/definitions';
import { buildNavigationGraph } from '../navigation/build-graph';
import { findPathToCore } from '../navigation/astar';

export { isBurrowed, isEnraged };
import { deriveMap, type DerivedMap } from '../navigation/derived-map';
import { distance3D, effectiveRange, hasLineOfSight, towerGeometry } from '../navigation/line-of-sight';

export function createInitialState(level: LevelDef, rngSeed = 1): GameState {
  return {
    schemaVersion: 2,
    levelId: level.id,
    phase: 'PREPARE',
    tick: 0,
    rngSeed,
    gold: level.initialGold,
    coreHp: level.core.maxHp,
    currentWaveIndex: 0,
    spawnCursor: 0,
    waveTick: 0,
    awardedWaveIds: [],
    editedElevations: {},
    walls: [],
    towers: [],
    enemies: [],
    nextEntityId: 1,
    spawnQueue: [],
    frozenRoutes: {},
  };
}

export interface TickResult { state: GameState; events: GameEvent[] }

export interface EnemyPose { x: number; z: number; elevationF: number; nearestCell: CellId; fromCell: CellId; toCell: CellId }

/** Interpolated logical position along the frozen path. */
export function enemyPose(map: DerivedMap, e: Pick<EnemyInstance, 'pathNodeIds' | 'edgeIndex' | 'segmentProgress'>): EnemyPose {
  const last = e.pathNodeIds.length - 1;
  const i = Math.min(e.edgeIndex, last);
  const j = Math.min(i + 1, last);
  const a = map.index.cells.get(e.pathNodeIds[i]!)!;
  const b = map.index.cells.get(e.pathNodeIds[j]!)!;
  const t = i === j ? 0 : e.segmentProgress;
  const ea = map.elevationOf(a.id);
  const eb = map.elevationOf(b.id);
  return {
    x: a.pos.x + 0.5 + (b.pos.x - a.pos.x) * t,
    z: a.pos.z + 0.5 + (b.pos.z - a.pos.z) * t,
    elevationF: ea + (eb - ea) * t,
    nearestCell: t < 0.5 ? a.id : b.id,
    fromCell: a.id,
    toCell: b.id,
  };
}

export function remainingDistance(e: Pick<EnemyInstance, 'pathNodeIds' | 'edgeIndex' | 'segmentProgress' | 'flightDist'>): number {
  if (e.flightDist) return (1 - Math.min(1, e.edgeIndex + e.segmentProgress)) * e.flightDist;
  return (e.pathNodeIds.length - 1) - e.edgeIndex - e.segmentProgress;
}

/** Flyers (GDD §16 T2): a two-node path from the portal straight to the nearest core approach. */
export function flightPath(level: LevelDef, map: Pick<DerivedMap, 'index'>, portalCellId: CellId): { path: CellId[]; dist: number } {
  const from = map.index.cells.get(portalCellId)!;
  let best: { id: CellId; d: number } | null = null;
  for (const id of level.core.approachNodeIds) {
    const c = map.index.cells.get(id);
    if (!c) continue;
    const d = Math.hypot(c.pos.x - from.pos.x, c.pos.z - from.pos.z);
    if (!best || d < best.d || (d === best.d && id < best.id)) best = { id, d };
  }
  return best ? { path: [portalCellId, best.id], dist: Math.max(1, best.d) } : { path: [portalCellId], dist: 1 };
}

/** Cells a flyer passes over between its portal and the core (for coverage hints and bots). */
export function flightLaneCells(level: LevelDef, map: Pick<DerivedMap, 'index'>, portalCellId: CellId): CellId[] {
  const { path } = flightPath(level, map, portalCellId);
  const a = map.index.cells.get(path[0]!)!, b = map.index.cells.get(path[path.length - 1]!)!;
  const steps = Math.max(1, Math.ceil(Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z) * 3));
  const out: CellId[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const id = map.index.byPos.get(`${Math.round(a.pos.x + (b.pos.x - a.pos.x) * t)},${Math.round(a.pos.z + (b.pos.z - a.pos.z) * t)}`);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Wall breakers plan around towers and terrain but straight through wooden walls. */
export function breakerPath(level: LevelDef, state: Pick<GameState, 'editedElevations' | 'towers' | 'brokenConnectors'>, portalCellId: CellId): CellId[] | null {
  const map = deriveMap(level, { ...state, walls: [] });
  return findPathToCore(buildNavigationGraph(map), map.index, portalCellId, level.core.approachNodeIds)?.nodeIds ?? null;
}

interface Candidate { e: EnemyInstance; p: Vec3; d: number }

const byId = (a: Candidate, b: Candidate) => a.e.spawnTick - b.e.spawnTick || (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0);
const byFirst = (a: Candidate, b: Candidate) => remainingDistance(a.e) - remainingDistance(b.e) || byId(a, b);
/** Deterministic target ordering per targeting mode (ties fall back to FIRST, then spawn order). */
export const TARGET_ORDER: Record<TargetingMode, (a: Candidate, b: Candidate) => number> = {
  FIRST: byFirst,
  LAST: (a, b) => remainingDistance(b.e) - remainingDistance(a.e) || byId(a, b),
  STRONGEST: (a, b) => b.e.hp - a.e.hp || byFirst(a, b),
  CLOSEST: (a, b) => a.d - b.d || byFirst(a, b),
};

function aimPoint(map: DerivedMap, e: EnemyInstance): { p: Vec3; pose: EnemyPose } {
  const pose = enemyPose(map, e);
  const def = ENEMY_DEFS[e.kind];
  return { p: { x: pose.x, y: pose.elevationF * HEIGHT_STEP_WORLD + def.targetOffsetWorld + (def.flying?.altitudeWorld ?? 0), z: pose.z }, pose };
}

/**
 * Advance the deterministic simulation by one 20 TPS tick (Tech §8.1). Pure function.
 * Only COMBAT advances; other phases return the state untouched.
 */
export function advanceOneTick(state: GameState, level: LevelDef): TickResult {
  if (state.phase !== 'COMBAT') return { state, events: [] };
  const events: GameEvent[] = [];
  const tick = state.tick;
  const map = deriveMap(level, state);
  let gold = state.gold;
  let coreHp = state.coreHp;
  let nextEntityId = state.nextEntityId;
  let spawnCursor = state.spawnCursor;
  const enemies: EnemyInstance[] = state.enemies.map((e) => ({ ...e }));
  let walls = state.walls;
  const breakerRoutes = new Map<string, CellId[]>();

  const hpScale = level.waves[state.currentWaveIndex]?.hpScale ?? 1;
  const hpBonus = waveHpMultiplier(state.currentWaveIndex, level.waves.length);
  // traps keep some bite in later, tougher waves
  const hpScaleDamage = Math.max(1, Math.sqrt(hpScale));
  const spawnHp = (kind: EnemyInstance['kind']) => Math.max(1, Math.round(ENEMY_DEFS[kind].hp * hpScale * hpBonus));

  // 1. Spawn
  while (spawnCursor < state.spawnQueue.length && state.spawnQueue[spawnCursor]!.tick <= state.waveTick) {
    const item = state.spawnQueue[spawnCursor++]!;
    let path = state.frozenRoutes[item.portalId];
    if (!path || path.length === 0) continue;
    const sdef = ENEMY_DEFS[item.enemyKind];
    let flightDist: number | undefined;
    if (sdef.flying) {
      const f = flightPath(level, map, path[0]!);
      path = f.path; flightDist = f.dist;
    } else if (sdef.breaksWalls && walls.length) {
      path = breakerRoutes.get(item.portalId) ?? (() => {
        const r = breakerPath(level, state, path![0]!) ?? path!;
        breakerRoutes.set(item.portalId, r);
        return r;
      })();
    }
    const enemy: EnemyInstance = {
      id: `e${nextEntityId++}`, kind: item.enemyKind, portalId: item.portalId,
      hp: spawnHp(item.enemyKind), maxHp: spawnHp(item.enemyKind), state: 'moving', pathNodeIds: path,
      edgeIndex: 0, segmentProgress: 0, slowUntilTick: -1, spawnTick: tick,
      ...(flightDist ? { flightDist } : {}),
    };
    enemies.push(enemy);
    events.push({ type: 'ENEMY_SPAWNED', tick, enemyId: enemy.id, kind: enemy.kind, portalId: enemy.portalId });
  }

  // 2–3. Movement along frozen routes; reaching an approach node damages the core.
  for (const e of enemies) {
    if (e.state !== 'moving') continue;
    const def = ENEMY_DEFS[e.kind];
    const slowRatio = e.slowUntilTick > tick ? (e.slowRatio ?? TOWER_DEFS.frost.slow?.ratio ?? 0) * (1 - (def.slowResistance ?? 0)) : 0;
    const rage = isEnraged(e) ? def.enrage!.speedMult : 1;
    if (def.breaksWalls) {
      // stop halfway into the cell before a wall and hammer it down
      const nextId = e.pathNodeIds[e.edgeIndex + 1];
      const wall = nextId ? walls.find((w) => w.cellId === nextId) : undefined;
      if (wall && e.segmentProgress >= 0.4) {
        e.segmentProgress = 0.4;
        e.breakingTicks = (e.breakingTicks ?? 0) + 1;
        if (e.breakingTicks >= def.breaksWalls.ticks) {
          e.breakingTicks = 0;
          walls = walls.filter((w) => w.id !== wall.id);
          events.push({ type: 'WALL_DESTROYED', tick, wallId: wall.id, cellId: wall.cellId, enemyId: e.id });
        }
        continue;
      }
    }
    e.segmentProgress += (def.speedCellsPerSecond * rage * (1 - slowRatio)) / TPS / (e.flightDist ?? 1);
    while (e.segmentProgress >= 1 && e.edgeIndex < e.pathNodeIds.length - 1) {
      e.segmentProgress -= 1;
      e.edgeIndex += 1;
    }
    if (e.edgeIndex >= e.pathNodeIds.length - 1) {
      e.edgeIndex = e.pathNodeIds.length - 1;
      e.segmentProgress = 0;
      e.state = 'reachedCore';
      const before = coreHp;
      coreHp = Math.max(0, coreHp - def.coreDamage);
      events.push({
        type: 'ENEMY_REACHED_CORE', tick, enemyId: e.id, kind: e.kind, portalId: e.portalId,
        approachNodeId: e.pathNodeIds[e.pathNodeIds.length - 1]!, lastNodeIds: e.pathNodeIds.slice(-6),
      });
      events.push({ type: 'CORE_DAMAGED', tick, amount: before - coreHp, hpAfter: coreHp });
    }
  }

  // 3a. Spike traps: hit every ground enemy standing on the trap cell, then recharge.
  const trapsNext = (state.traps ?? []).map((t) => ({ ...t, cooldownTicks: Math.max(0, t.cooldownTicks - 1) }));
  const trapHits: { trap: (typeof trapsNext)[number]; victims: EnemyInstance[] }[] = [];
  for (const trap of trapsNext) {
    if (trap.cooldownTicks > 0) continue;
    const victims = enemies.filter((e) => e.state === 'moving' && !ENEMY_DEFS[e.kind].flying && !isBurrowed(e, tick)
      && enemyPose(map, e).nearestCell === trap.cellId);
    if (!victims.length) continue;
    trap.cooldownTicks = TRAP_DEF.cooldownTicks;
    trapHits.push({ trap, victims });
  }

  // 3b. Healer auras: every `everyTicks` since spawn, restore a flat amount of HP to nearby allies.
  for (const h of enemies) {
    const aura = ENEMY_DEFS[h.kind].healAura;
    if (!aura || h.state !== 'moving') continue;
    const age = tick - h.spawnTick;
    if (age <= 0 || age % aura.everyTicks !== 0) continue;
    const hp = aimPoint(map, h).p;
    for (const o of enemies) {
      if (o === h || o.state !== 'moving' || isBurrowed(o, tick)) continue;
      const max = o.maxHp;
      if (o.hp >= max) continue;
      if (distance3D(aimPoint(map, o).p, hp) > aura.radiusWorld) continue;
      const amount = Math.min(max - o.hp, Math.max(1, Math.round(aura.amount * hpScale)));
      o.hp += amount;
      events.push({ type: 'ENEMY_HEALED', tick, enemyId: o.id, sourceEnemyId: h.id, amount, hpAfter: o.hp });
    }
  }

  // Shield auras: damage reduction for allies standing near a living shaman (not the shaman itself).
  const shamans = enemies.filter((e) => ENEMY_DEFS[e.kind].shieldAura && e.state === 'moving' && !isBurrowed(e, tick));
  const shielding = (v: EnemyInstance): number => {
    let best = 0;
    if (!shamans.length) return 0;
    const vp = aimPoint(map, v).p;
    for (const sh of shamans) {
      if (sh === v || sh.state !== 'moving') continue;
      const aura = ENEMY_DEFS[sh.kind].shieldAura!;
      if (aura.reduction > best && distance3D(aimPoint(map, sh).p, vp) <= aura.radiusWorld) best = aura.reduction;
    }
    return best;
  };

  // Applies one hit from a tower or trap (resistances, shields, slow, rebirth, death gold, splitting).
  type HitSource = { id: string; damageType: 'physical' | 'magic'; slow?: { ratio: number; durationTicks: number } };
  type HitDef = Omit<HitSource, 'id'>;
  const applyHit = (t: TowerInstance | HitSource, v: EnemyInstance, raw: number): void => {
    const def: HitDef = 'kind' in t ? { damageType: TOWER_DEFS[t.kind].damageType, slow: towerStats(t.kind, t.level).slow } : t;
    const edef = ENEMY_DEFS[v.kind];
    const resist = def.damageType === 'physical' ? edef.physicalResistance : (edef.magicResistance ?? 0);
    const shield = shielding(v);
    const resisted = resist > 0 || shield > 0;
    const amount = Math.max(0, Math.round(raw * (1 - resist) * (1 - shield)));
    v.hp = Math.max(0, v.hp - amount);
    events.push({ type: 'ENEMY_DAMAGED', tick, enemyId: v.id, sourceTowerId: t.id, amount, damageType: def.damageType, resisted, hpAfter: v.hp });
    if (def.slow && v.hp > 0) {
      // a weaker slow never overrides a stronger one that is still running
      const active = v.slowUntilTick > tick ? (v.slowRatio ?? 0) : 0;
      v.slowRatio = Math.max(active, def.slow.ratio);
      v.slowUntilTick = tick + def.slow.durationTicks;
      events.push({ type: 'ENEMY_SLOWED', tick, enemyId: v.id, untilTick: v.slowUntilTick });
    }
    if (v.hp <= 0 && edef.rebirth && !v.reborn) {
      // First death: rise again on the spot (no gold yet).
      v.reborn = true;
      v.hp = Math.max(1, Math.round(v.maxHp * edef.rebirth.hpRatio));
      v.slowUntilTick = -1;
      events.push({ type: 'ENEMY_REBORN', tick, enemyId: v.id, kind: v.kind, hpAfter: v.hp });
      return;
    }
    if (v.hp > 0) return;
    v.state = 'dead';
    gold += edef.goldReward;
    events.push({ type: 'ENEMY_KILLED', tick, enemyId: v.id, kind: v.kind, killerTowerId: t.id, gold: edef.goldReward });
    events.push({ type: 'GOLD_CHANGED', tick, delta: edef.goldReward, balance: gold, reason: 'kill' });
    if (edef.splitInto) {
      // Children appear on the parent's spot, staggered slightly backwards along the route.
      for (let k = 0; k < edef.splitInto.count; k++) {
        let edgeIndex = v.edgeIndex;
        let segmentProgress = v.segmentProgress - k * 0.3;
        while (segmentProgress < 0 && edgeIndex > 0) { segmentProgress += 1; edgeIndex -= 1; }
        const child: EnemyInstance = {
          id: `e${nextEntityId++}`, kind: edef.splitInto.kind, portalId: v.portalId,
          hp: spawnHp(edef.splitInto.kind), maxHp: spawnHp(edef.splitInto.kind), state: 'moving', pathNodeIds: v.pathNodeIds,
          edgeIndex, segmentProgress: Math.max(0, segmentProgress), slowUntilTick: -1, spawnTick: tick,
          ...(v.flightDist ? { flightDist: v.flightDist } : {}),
        };
        enemies.push(child);
        events.push({ type: 'ENEMY_SPAWNED', tick, enemyId: child.id, kind: child.kind, portalId: child.portalId });
      }
    }
  };

  for (const { trap, victims } of trapHits) {
    events.push({ type: 'TRAP_TRIGGERED', tick, trapId: trap.id, cellId: trap.cellId, hitIds: victims.map((v) => v.id) });
    const src: HitSource = { id: trap.id, damageType: TRAP_DEF.damageType };
    for (const v of victims) if (v.state === 'moving') applyHit(src, v, TRAP_DEF.damage * hpScaleDamage);
  }

  // 4–5. Towers: cooldown, mode-based targeting with 3D range + LOS, damage resolved this tick.
  const towers: TowerInstance[] = state.towers.map((t) => ({ ...t }));
  const towersOrdered = [...towers].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let ti = 0; ti < towersOrdered.length; ti++) {
    const t = towersOrdered[ti]!;
    if (t.cooldownTicks > 0) { t.cooldownTicks -= 1; if (t.cooldownTicks > 0) continue; }
    if (coreHp <= 0) continue;
    const def = TOWER_DEFS[t.kind];
    const geo = towerGeometry(map, t);
    const candidates: Candidate[] = [];
    let inRangeCount = 0;
    for (const e of enemies) {
      if (e.state !== 'moving' || isBurrowed(e, tick)) continue;
      const { p, pose } = aimPoint(map, e);
      const enemyElev = map.elevationOf(pose.nearestCell);
      const d = distance3D(geo.origin, p);
      if (d > effectiveRange(t.kind, t.level, geo.elevation, enemyElev)) continue;
      inRangeCount++;
      const exclude = new Set(geo.exclude);
      exclude.add(pose.fromCell);
      exclude.add(pose.toCell);
      if (!hasLineOfSight(map, geo.origin, p, exclude)) continue;
      candidates.push({ e, p, d });
    }
    if (!candidates.length) {
      if (inRangeCount > 0 && (tick + ti) % 10 === 0) events.push({ type: 'TOWER_BLOCKED', tick, towerId: t.id });
      continue;
    }
    candidates.sort(TARGET_ORDER[t.targeting ?? 'FIRST']);
    const target = candidates[0]!;
    t.cooldownTicks = def.cooldownTicks;
    events.push({ type: 'TOWER_FIRED', tick, towerId: t.id, targetId: target.e.id, travelTicks: def.projectileTicks });
    const lv = towerStats(t.kind, t.level);
    const raw = lv.damage;

    if (lv.blastRadiusWorld) {
      const victims: EnemyInstance[] = [];
      for (const e of enemies) {
        if (e.state !== 'moving' || isBurrowed(e, tick)) continue;
        if (distance3D(aimPoint(map, e).p, target.p) <= lv.blastRadiusWorld) victims.push(e);
      }
      events.push({ type: 'CANNON_EXPLODED', tick, towerId: t.id, at: target.p, hitIds: victims.map((v) => v.id) });
      for (const v of victims) applyHit(t, v, raw);
    } else if (def.chain) {
      // Chain lightning: hop to the nearest un-hit enemy around the previous victim.
      const hit: Candidate[] = [target];
      const hitSet = new Set<string>([target.e.id]);
      let from = target.p;
      for (let j = 0; j < lv.chainJumps!; j++) {
        let best: Candidate | null = null;
        for (const e of enemies) {
          if (e.state !== 'moving' || hitSet.has(e.id) || isBurrowed(e, tick)) continue;
          const p = aimPoint(map, e).p;
          const d = distance3D(from, p);
          if (d > def.chain.radiusWorld) continue;
          if (!best || d < best.d || (d === best.d && e.id < best.e.id)) best = { e, p, d };
        }
        if (!best) break;
        hit.push(best);
        hitSet.add(best.e.id);
        from = best.p;
      }
      events.push({ type: 'LIGHTNING_CHAINED', tick, towerId: t.id, hitIds: hit.map((h) => h.e.id), points: [geo.origin, ...hit.map((h) => h.p)] });
      hit.forEach((h, k) => applyHit(t, h.e, raw * Math.pow(def.chain!.falloff, k)));
    } else if (def.knockback) {
      // Wind gust: hit several enemies in range, then push the survivors back along their route.
      const kb = def.knockback;
      const victims = candidates.slice(0, lv.knockbackTargets!).map((c) => c.e);
      events.push({ type: 'WIND_GUST', tick, towerId: t.id, hitIds: victims.map((v) => v.id) });
      const push = lv.knockbackCells!;
      for (const v of victims) {
        applyHit(t, v, raw);
        if (v.state !== 'moving' || (v.pushImmuneUntilTick ?? -1) > tick) continue;
        const cells = push * (1 - (ENEMY_DEFS[v.kind].knockbackResistance ?? 0)) / (v.flightDist ?? 1);
        if (cells <= 0) continue;
        const along = Math.max(0, v.edgeIndex + v.segmentProgress - cells);
        v.edgeIndex = Math.floor(along);
        v.segmentProgress = along - v.edgeIndex;
        v.pushImmuneUntilTick = tick + kb.immuneTicks;
        events.push({ type: 'ENEMY_KNOCKED_BACK', tick, enemyId: v.id, towerId: t.id, cells: Math.round(cells * 100) / 100 });
      }
    } else {
      applyHit(t, target.e, raw);
    }
  }

  const alive = enemies.filter((e) => e.state === 'moving');
  let next: GameState = {
    ...state,
    gold, coreHp, nextEntityId, spawnCursor, towers, enemies: alive, walls,
    ...(state.traps ? { traps: trapsNext } : {}),
    tick: tick + 1, waveTick: state.waveTick + 1,
  };

  // 7. Defeat / wave clear / victory.
  if (coreHp <= 0) {
    next = { ...next, phase: 'DEFEAT', enemies: [], spawnQueue: [], spawnCursor: 0 };
    events.push({ type: 'PHASE_CHANGED', tick, from: 'COMBAT', to: 'DEFEAT' });
    events.push({ type: 'DEFEAT', tick });
  } else if (spawnCursor >= state.spawnQueue.length && alive.length === 0) {
    const wave = level.waves[state.currentWaveIndex]!;
    if (!next.awardedWaveIds.includes(wave.id)) {
      next = { ...next, gold: next.gold + wave.clearGold, awardedWaveIds: [...next.awardedWaveIds, wave.id] };
      events.push({ type: 'WAVE_CLEARED', tick, waveIndex: state.currentWaveIndex, clearGold: wave.clearGold });
      events.push({ type: 'GOLD_CHANGED', tick, delta: wave.clearGold, balance: next.gold, reason: 'waveClear' });
    }
    const isLast = state.currentWaveIndex >= level.waves.length - 1;
    const to = isLast ? 'VICTORY' : 'WAVE_RESULT';
    next = { ...next, phase: to, spawnQueue: [], spawnCursor: 0, frozenRoutes: isLast ? next.frozenRoutes : {} };
    events.push({ type: 'PHASE_CHANGED', tick, from: 'COMBAT', to });
    if (isLast) events.push({ type: 'VICTORY', tick, stars: starsForHp(coreHp) as 1 | 2 | 3 });
  }
  return { state: next, events };
}
