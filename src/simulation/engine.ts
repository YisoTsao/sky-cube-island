import type {
  CellId, EnemyInstance, GameEvent, GameState, LevelDef, TowerInstance, Vec3,
} from '../domain/types';
import { HEIGHT_STEP_WORLD } from '../domain/types';
import { ENEMY_DEFS, LEVEL_DAMAGE_MULT, TOWER_DEFS, TPS, starsForHp } from '../domain/definitions';
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

export function remainingDistance(e: Pick<EnemyInstance, 'pathNodeIds' | 'edgeIndex' | 'segmentProgress'>): number {
  return (e.pathNodeIds.length - 1) - e.edgeIndex - e.segmentProgress;
}

function aimPoint(map: DerivedMap, e: EnemyInstance): { p: Vec3; pose: EnemyPose } {
  const pose = enemyPose(map, e);
  return { p: { x: pose.x, y: pose.elevationF * HEIGHT_STEP_WORLD + ENEMY_DEFS[e.kind].targetOffsetWorld, z: pose.z }, pose };
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

  const hpScale = level.waves[state.currentWaveIndex]?.hpScale ?? 1;
  const spawnHp = (kind: EnemyInstance['kind']) => Math.max(1, Math.round(ENEMY_DEFS[kind].hp * hpScale));

  // 1. Spawn
  while (spawnCursor < state.spawnQueue.length && state.spawnQueue[spawnCursor]!.tick <= state.waveTick) {
    const item = state.spawnQueue[spawnCursor++]!;
    const path = state.frozenRoutes[item.portalId];
    if (!path || path.length === 0) continue;
    const enemy: EnemyInstance = {
      id: `e${nextEntityId++}`, kind: item.enemyKind, portalId: item.portalId,
      hp: spawnHp(item.enemyKind), maxHp: spawnHp(item.enemyKind), state: 'moving', pathNodeIds: path,
      edgeIndex: 0, segmentProgress: 0, slowUntilTick: -1, spawnTick: tick,
    };
    enemies.push(enemy);
    events.push({ type: 'ENEMY_SPAWNED', tick, enemyId: enemy.id, kind: enemy.kind, portalId: enemy.portalId });
  }

  // 2–3. Movement along frozen routes; reaching an approach node damages the core.
  for (const e of enemies) {
    if (e.state !== 'moving') continue;
    const def = ENEMY_DEFS[e.kind];
    const slowRatio = e.slowUntilTick > tick ? (TOWER_DEFS.frost.slow?.ratio ?? 0) * (1 - (def.slowResistance ?? 0)) : 0;
    e.segmentProgress += (def.speedCellsPerSecond * (1 - slowRatio)) / TPS;
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

  // 3b. Healer auras: every `everyTicks` since spawn, restore a flat amount of HP to nearby allies.
  for (const h of enemies) {
    const aura = ENEMY_DEFS[h.kind].healAura;
    if (!aura || h.state !== 'moving') continue;
    const age = tick - h.spawnTick;
    if (age <= 0 || age % aura.everyTicks !== 0) continue;
    const hp = aimPoint(map, h).p;
    for (const o of enemies) {
      if (o === h || o.state !== 'moving') continue;
      const max = o.maxHp;
      if (o.hp >= max) continue;
      if (distance3D(aimPoint(map, o).p, hp) > aura.radiusWorld) continue;
      const amount = Math.min(max - o.hp, Math.max(1, Math.round(aura.amount * hpScale)));
      o.hp += amount;
      events.push({ type: 'ENEMY_HEALED', tick, enemyId: o.id, sourceEnemyId: h.id, amount, hpAfter: o.hp });
    }
  }

  // 4–5. Towers: cooldown, FIRST targeting with 3D range + LOS, damage resolved this tick.
  const towers: TowerInstance[] = state.towers.map((t) => ({ ...t }));
  const towersOrdered = [...towers].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let ti = 0; ti < towersOrdered.length; ti++) {
    const t = towersOrdered[ti]!;
    if (t.cooldownTicks > 0) { t.cooldownTicks -= 1; if (t.cooldownTicks > 0) continue; }
    if (coreHp <= 0) continue;
    const def = TOWER_DEFS[t.kind];
    const geo = towerGeometry(map, t);
    const candidates: { e: EnemyInstance; p: Vec3 }[] = [];
    let inRangeCount = 0;
    for (const e of enemies) {
      if (e.state !== 'moving') continue;
      const { p, pose } = aimPoint(map, e);
      const enemyElev = map.elevationOf(pose.nearestCell);
      if (distance3D(geo.origin, p) > effectiveRange(t.kind, t.level, geo.elevation, enemyElev)) continue;
      inRangeCount++;
      const exclude = new Set(geo.exclude);
      exclude.add(pose.fromCell);
      exclude.add(pose.toCell);
      if (!hasLineOfSight(map, geo.origin, p, exclude)) continue;
      candidates.push({ e, p });
    }
    if (!candidates.length) {
      if (inRangeCount > 0 && (tick + ti) % 10 === 0) events.push({ type: 'TOWER_BLOCKED', tick, towerId: t.id });
      continue;
    }
    candidates.sort((a, b) =>
      remainingDistance(a.e) - remainingDistance(b.e) || a.e.spawnTick - b.e.spawnTick || (a.e.id < b.e.id ? -1 : 1));
    const target = candidates[0]!;
    t.cooldownTicks = def.cooldownTicks;
    events.push({ type: 'TOWER_FIRED', tick, towerId: t.id, targetId: target.e.id, travelTicks: def.projectileTicks });

    const victims: EnemyInstance[] = [];
    if (def.blastRadiusWorld) {
      for (const e of enemies) {
        if (e.state !== 'moving') continue;
        if (distance3D(aimPoint(map, e).p, target.p) <= def.blastRadiusWorld) victims.push(e);
      }
      events.push({ type: 'CANNON_EXPLODED', tick, towerId: t.id, at: target.p, hitIds: victims.map((v) => v.id) });
    } else {
      victims.push(target.e);
    }
    for (const v of victims) {
      const edef = ENEMY_DEFS[v.kind];
      const resisted = def.damageType === 'physical' && edef.physicalResistance > 0;
      const amount = Math.max(0, Math.round(def.baseDamage * LEVEL_DAMAGE_MULT[t.level] * (resisted ? 1 - edef.physicalResistance : 1)));
      v.hp = Math.max(0, v.hp - amount);
      events.push({ type: 'ENEMY_DAMAGED', tick, enemyId: v.id, sourceTowerId: t.id, amount, damageType: def.damageType, resisted, hpAfter: v.hp });
      if (def.slow && v.hp > 0) {
        v.slowUntilTick = tick + def.slow.durationTicks;
        events.push({ type: 'ENEMY_SLOWED', tick, enemyId: v.id, untilTick: v.slowUntilTick });
      }
      if (v.hp <= 0) {
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
            };
            enemies.push(child);
            events.push({ type: 'ENEMY_SPAWNED', tick, enemyId: child.id, kind: child.kind, portalId: child.portalId });
          }
        }
      }
    }
  }

  const alive = enemies.filter((e) => e.state === 'moving');
  let next: GameState = {
    ...state,
    gold, coreHp, nextEntityId, spawnCursor, towers, enemies: alive,
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
