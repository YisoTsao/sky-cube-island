import { Group, Mesh, Vector3, type BufferGeometry } from 'three';
import type { EnemyKind, TowerBranch, TowerKind, TowerLevel } from '../domain/types';
import { towerParts } from './models/towers';
import { enemyGeometry, trapGeometry, wallGeometry } from './models/props';
import { createVoxelMaterial, type VoxelMaterial } from './materials/voxel-material';

const DEPTH_LAYER = 1;
let sharedTowerMat: VoxelMaterial | null = null;
let sharedGlowMat: VoxelMaterial | null = null;
let sharedClothMat: VoxelMaterial | null = null;
function towerMats() {
  sharedTowerMat ??= createVoxelMaterial({ bevel: 0.014 });
  sharedGlowMat ??= createVoxelMaterial({ bevel: 0.01, emissiveStrength: 2.2 });
  sharedClothMat ??= createVoxelMaterial({ bevel: 0.01, wind: { base: 0.9, strength: 0.03 } });
  return { body: sharedTowerMat, glow: sharedGlowMat, cloth: sharedClothMat };
}

const easeOutBack = (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

/** Tower view: body + aimable head; build-assembly, idle, aim and recoil animations (GDD §7.1). */
export class TowerView {
  readonly group = new Group();
  private inner = new Group();
  private head = new Group();
  private headMesh!: Mesh;
  private bodyMeshes: Mesh[] = [];
  level: TowerLevel = 1;
  branch?: TowerBranch;
  private buildT = 1;
  private recoil = 0;
  private aimYaw = 0;
  private targetYaw = 0;
  private idleT = Math.random() * 10;
  private charge = 0;
  private spin = Math.random() * 6;
  blockedT = 0;
  headY = 1.6;

  constructor(readonly id: string, readonly kind: TowerKind, center: Vector3, level: TowerLevel, animate: boolean, branch?: TowerBranch) {
    this.group.position.copy(center);
    this.group.add(this.inner);
    this.inner.add(this.head);
    this.setLevel(level, false, branch);
    if (animate) this.buildT = 0;
  }

  setLevel(level: TowerLevel, pop: boolean, branch?: TowerBranch) {
    this.level = level;
    this.branch = branch;
    for (const m of this.bodyMeshes) this.inner.remove(m);
    this.bodyMeshes = [];
    if (this.headMesh) this.head.remove(this.headMesh);
    const parts = towerParts(this.kind, level, branch);
    const mats = towerMats();
    const add = (geo: BufferGeometry | undefined, mat: VoxelMaterial, shadow = true) => {
      if (!geo) return;
      const m = new Mesh(geo, mat);
      m.castShadow = shadow; m.receiveShadow = true;
      m.layers.enable(DEPTH_LAYER);
      this.inner.add(m);
      this.bodyMeshes.push(m);
    };
    add(parts.body, mats.body);
    add(parts.glow, mats.glow);
    add(parts.cloth, mats.cloth);
    this.headMesh = new Mesh(parts.head, this.kind === 'frost' || this.kind === 'lightning' ? mats.glow : mats.body);
    this.headMesh.castShadow = true;
    this.head.add(this.headMesh);
    this.head.position.y = parts.headY;
    this.headY = parts.headY;
    if (pop) this.buildT = 0.55;
  }

  aimAt(world: Vector3) {
    const dx = world.x - this.group.position.x, dz = world.z - this.group.position.z;
    this.targetYaw = Math.atan2(dx, dz);
  }
  fire() { this.recoil = 1; this.charge = 1; }

  muzzleWorld(out: Vector3): Vector3 {
    out.set(Math.sin(this.aimYaw) * 0.35, this.headY, Math.cos(this.aimYaw) * 0.35).add(this.group.position);
    return out;
  }

  update(dt: number) {
    if (this.buildT < 1) {
      this.buildT = Math.min(1, this.buildT + dt / 0.6);
      const t = this.buildT;
      // layer-by-layer assembly feel: vertical scale with back-ease + slight squash
      const sy = easeOutBack(t);
      this.inner.scale.set(1 + (1 - t) * 0.15, Math.max(0.02, sy), 1 + (1 - t) * 0.15);
    } else this.inner.scale.set(1, 1, 1);
    this.idleT += dt;
    if (this.kind === 'arrow') {
      if (Math.abs(this.targetYaw - this.aimYaw) < 0.01 && this.recoil <= 0) this.targetYaw += Math.sin(this.idleT * 0.6) * dt * 0.6;
    }
    let d = this.targetYaw - this.aimYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.aimYaw += d * Math.min(1, dt * 14);
    this.head.rotation.y = this.aimYaw;
    this.recoil = Math.max(0, this.recoil - dt * 5);
    const r = Math.sin(Math.min(1, this.recoil) * Math.PI) * (this.kind === 'cannon' ? 0.12 : 0.05);
    this.headMesh.position.set(-Math.sin(0) * r, 0, -r);
    if (this.kind === 'frost') {
      this.charge = Math.max(0, this.charge - dt * 3);
      this.headMesh.position.y = Math.sin(this.idleT * 2) * 0.05;
      this.headMesh.rotation.y = this.idleT * (this.level >= 3 ? 1.6 : 0.6);
      this.headMesh.scale.setScalar(1 + this.charge * 0.25);
    }
    if (this.kind === 'cannon') this.headMesh.rotation.x = -0.12;
    if (this.kind === 'lightning') {
      this.charge = Math.max(0, this.charge - dt * 4);
      this.headMesh.position.y = Math.sin(this.idleT * 3) * 0.04;
      this.headMesh.rotation.y = this.idleT * 2.4;
      this.headMesh.scale.setScalar(1 + this.charge * 0.4 + Math.sin(this.idleT * 17) * 0.03);
    }
    if (this.kind === 'wind') {
      // sails always turn; a gust spins them up briefly
      this.charge = Math.max(0, this.charge - dt * 1.2);
      this.spin += dt * (1.2 + this.charge * 9);
      this.headMesh.rotation.z = this.spin;
    }
    this.blockedT = Math.max(0, this.blockedT - dt);
  }
}

/** Enemy view: per-instance material for hit flash / frost tint, procedural gait (GDD §8.1). */
export class EnemyView {
  readonly group = new Group();
  private body: Mesh;
  private extra?: Mesh;
  readonly mat: VoxelMaterial;
  private flash = 0;
  private squash = 0;
  private t = Math.random() * 10;
  readonly height: number;
  hpRatio = 1;
  slowed = false;
  /** Mole underground (untargetable) — body sinks, dirt mound shows. */
  burrowed = false;
  /** Boar below its enrage threshold — red tint, faster gait. */
  enraged = false;
  breaking = false;
  private burrowK = 0;
  lastPos = new Vector3();
  facing = 0;
  constructor(readonly id: string, readonly kind: EnemyKind, readonly laneOffset: number) {
    const g = enemyGeometry(kind);
    this.height = g.height;
    const jelly = kind === 'slime' || kind === 'mini' || kind === 'splitter' || kind === 'queen';
    const ghost = kind === 'ghost';
    this.mat = createVoxelMaterial({
      bevel: 0.012, transparent: jelly || ghost, opacity: ghost ? 0.72 : jelly ? 0.9 : 1,
      roughness: jelly ? 0.35 : kind === 'knight' || kind === 'crab' ? 0.45 : 0.85,
    });
    this.body = new Mesh(g.body, this.mat);
    this.body.castShadow = true;
    this.group.add(this.body);
    if (g.extra) {
      const glowing = kind !== 'runner' && kind !== 'mole' && kind !== 'bat' && kind !== 'wyvern';
      const extraMat = kind === 'mole' ? createVoxelMaterial({ bevel: 0.012 })
        : kind === 'bat' || kind === 'wyvern' ? createVoxelMaterial({ bevel: 0.01 })
          : glowing ? createVoxelMaterial({ emissiveStrength: kind === 'splitter' || kind === 'queen' ? 1.4 : kind === 'crab' || kind === 'frostGiant' ? 2 : 3 }) : this.mat;
      this.extra = new Mesh(g.extra, extraMat);
      this.extra.castShadow = true;
      if (kind === 'runner') this.extra.position.set(0, 0.36, -0.42);
      this.group.add(this.extra);
    }
  }
  hit() { this.flash = 1; this.squash = 1; }
  update(dt: number, moving: boolean, speedMul: number) {
    this.t += dt * speedMul;
    this.flash = Math.max(0, this.flash - dt / 0.09);
    this.squash = Math.max(0, this.squash - dt * 6);
    this.mat.userData.uniforms.uFlash.value = this.flash * 1.4;
    const tint = this.mat.userData.uniforms.uTint.value;
    if (this.slowed) tint.set(0.62, 0.86, 1.0, 0.42);
    else if (this.enraged) tint.set(1.0, 0.35, 0.25, 0.32 + Math.sin(this.t * 18) * 0.08);
    else tint.set(1, 1, 1, 0);
    const s = this.squash;
    if (this.kind === 'bat') {
      const bob = Math.sin(this.t * 5) * 0.08;
      this.body.position.y = 0.35 + bob;
      this.body.scale.setScalar(1 + s * 0.12);
      if (this.extra) { this.extra.position.y = this.body.position.y; this.extra.scale.set(1, 1 + Math.sin(this.t * 26) * 0.9, 1); }
    } else if (this.kind === 'wyvern') {
      const bob = Math.sin(this.t * 2.6) * 0.1;
      this.body.position.y = bob;
      this.body.rotation.x = Math.sin(this.t * 2.6 + 1) * 0.08;
      this.body.scale.setScalar(1 + s * 0.08);
      if (this.extra) { this.extra.position.y = bob; this.extra.rotation.x = this.body.rotation.x; this.extra.scale.set(1, 1 + Math.sin(this.t * 9) * 0.7, 1); }
    } else if (this.kind === 'ram') {
      const f = this.breaking ? 18 : 8;
      this.body.position.y = Math.abs(Math.sin(this.t * f)) * (this.breaking ? 0.02 : 0.05);
      this.body.rotation.x = this.breaking ? 0.18 + Math.sin(this.t * f) * 0.12 : Math.sin(this.t * f) * 0.04 - s * 0.2;
    } else if (this.kind === 'phoenix') {
      const bob = Math.sin(this.t * 2.2) * 0.1;
      this.body.position.y = 0.25 + bob;
      this.body.scale.set(1 + s * 0.05, 1 - s * 0.05, 1 + s * 0.05);
      if (this.extra) { this.extra.position.y = this.body.position.y; this.extra.scale.set(1, 1 + Math.sin(this.t * 7) * 0.35, 1); }
    } else if (this.kind === 'shaman') {
      this.body.position.y = Math.abs(Math.sin(this.t * 5)) * 0.03;
      this.body.rotation.z = Math.sin(this.t * 5) * 0.04;
      if (this.extra) { this.extra.position.y = this.body.position.y + Math.sin(this.t * 3) * 0.04; this.extra.rotation.z = this.body.rotation.z; this.extra.scale.setScalar(1 + Math.sin(this.t * 6) * 0.08); }
    } else if (this.kind === 'imp') {
      this.body.position.y = Math.abs(Math.sin(this.t * 13)) * 0.07;
      this.body.rotation.z = Math.sin(this.t * 13) * 0.08;
      if (this.extra) { this.extra.position.y = this.body.position.y; this.extra.rotation.z = this.body.rotation.z; }
    } else if (this.kind === 'mole') {
      this.burrowK += ((this.burrowed ? 1 : 0) - this.burrowK) * Math.min(1, dt * 9);
      const k = this.burrowK;
      this.body.position.y = -k * 0.55 + (moving ? Math.abs(Math.sin(this.t * 9)) * 0.03 : 0);
      this.body.scale.set(1 + s * 0.05, (1 - s * 0.05) * (1 - k * 0.4), 1 + s * 0.05);
      this.body.visible = k < 0.95;
      if (this.extra) { this.extra.scale.setScalar(0.02 + k * (0.9 + Math.sin(this.t * 10) * 0.05)); this.extra.visible = k > 0.02; }
    } else if (this.kind === 'ghost') {
      const bob = Math.sin(this.t * 2.4) * 0.07;
      this.body.position.y = 0.12 + bob;
      this.body.rotation.z = Math.sin(this.t * 1.7) * 0.07;
      this.body.scale.setScalar(1 + s * 0.08);
      if (this.extra) { this.extra.position.y = this.body.position.y; this.extra.rotation.z = this.body.rotation.z; this.extra.scale.setScalar(1 + Math.sin(this.t * 4) * 0.05); }
    } else if (this.kind === 'salamander') {
      this.body.rotation.y = Math.sin(this.t * 14) * 0.14;
      this.body.position.y = Math.abs(Math.sin(this.t * 14)) * 0.02;
      if (this.extra) { this.extra.rotation.y = this.body.rotation.y; this.extra.scale.set(1, 1 + Math.sin(this.t * 22) * 0.2, 1); }
    } else if (this.kind === 'crab') {
      this.body.rotation.z = Math.sin(this.t * 7) * 0.06;
      this.body.position.y = Math.abs(Math.sin(this.t * 7)) * 0.025;
      this.body.scale.set(1 + s * 0.05, 1 - s * 0.05, 1 + s * 0.05);
      if (this.extra) { this.extra.rotation.z = this.body.rotation.z; this.extra.position.y = this.body.position.y; }
    } else if (this.kind === 'boar') {
      const f = this.enraged ? 15 : 10;
      this.body.position.y = Math.abs(Math.sin(this.t * f)) * 0.06;
      this.body.rotation.x = Math.sin(this.t * f) * 0.05 + (this.enraged ? 0.1 : 0) - s * 0.2;
      if (this.extra) { this.extra.position.y = this.body.position.y; this.extra.rotation.x = this.body.rotation.x; }
    } else if (this.kind === 'slime' || this.kind === 'mini' || this.kind === 'splitter' || this.kind === 'queen') {
      const hop = moving ? Math.abs(Math.sin(this.t * 6.5)) : 0;
      const sq = 1 + Math.sin(this.t * 13) * 0.12 * (moving ? 1 : 0.3) + s * 0.2;
      this.body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      this.body.position.y = hop * 0.12;
      if (this.extra) { this.extra.scale.copy(this.body.scale); this.extra.position.y = this.body.position.y; }
    } else if (this.kind === 'wisp') {
      const bob = Math.sin(this.t * 3) * 0.08;
      this.body.position.y = 0.18 + bob;
      this.body.rotation.z = Math.sin(this.t * 14) * 0.08;
      if (this.extra) { this.extra.position.y = 0.18 + bob; const p = 1 + Math.sin(this.t * 5) * 0.06 + s * 0.15; this.extra.scale.setScalar(p); }
    } else if (this.kind === 'knight') {
      this.body.position.y = Math.abs(Math.sin(this.t * 9)) * 0.02;
      this.body.rotation.z = Math.sin(this.t * 9) * 0.03;
      this.body.scale.set(1 + s * 0.04, 1 - s * 0.04, 1 + s * 0.04);
    } else if (this.kind === 'runner') {
      this.body.position.y = Math.abs(Math.sin(this.t * 12)) * 0.05;
      this.body.rotation.x = 0.12 + Math.sin(this.t * 12) * 0.04 - s * 0.3;
      if (this.extra) this.extra.rotation.y = Math.sin(this.t * 8) * 0.4;
    } else {
      const step = Math.sin(this.t * 4.2);
      this.body.position.y = Math.abs(step) * 0.04;
      this.body.rotation.z = step * 0.06;
      this.body.scale.set(1 + s * 0.05, 1 - s * 0.05, 1 + s * 0.05);
      if (this.extra) { this.extra.position.y = this.body.position.y; this.extra.rotation.z = this.body.rotation.z; }
    }
  }
}

const wallGeo = { g: null as BufferGeometry | null };
export class WallView {
  readonly group = new Group();
  private t = 0;
  constructor(readonly id: string, readonly cellId: string, pos: Vector3, animate: boolean) {
    wallGeo.g ??= wallGeometry();
    const m = new Mesh(wallGeo.g, towerMats().body);
    m.castShadow = true; m.receiveShadow = true;
    m.layers.enable(DEPTH_LAYER);
    this.group.add(m);
    this.group.position.copy(pos);
    this.t = animate ? 0 : 1;
  }
  setY(y: number) { this.baseY = y; }
  private baseY: number | null = null;
  update(dt: number): boolean {
    const by = this.baseY ?? this.group.position.y;
    this.baseY = by;
    if (this.t < 1) {
      const prev = this.t;
      this.t = Math.min(1, this.t + dt / 0.28);
      const k = this.t * this.t;
      this.group.position.y = by + (1 - k) * 1.6;
      return prev < 1 && this.t >= 1; // landed this frame
    }
    this.group.position.y = by;
    return false;
  }
}

const trapGeo = { g: null as ReturnType<typeof trapGeometry> | null };
/** Spike plate flush with the path; the spikes pop up for a moment when it fires. */
export class TrapView {
  readonly group = new Group();
  private spikes: Mesh;
  private pop = 0;
  constructor(readonly id: string, readonly cellId: string, pos: Vector3) {
    trapGeo.g ??= trapGeometry();
    const plate = new Mesh(trapGeo.g.plate, towerMats().body);
    plate.receiveShadow = true;
    this.spikes = new Mesh(trapGeo.g.spikes, towerMats().body);
    this.spikes.castShadow = true;
    this.group.add(plate, this.spikes);
    this.group.position.copy(pos).add(new Vector3(0, 0.005, 0));
    this.setPop();
  }
  trigger() { this.pop = 1; }
  setY(y: number) { this.group.position.y = y + 0.005; }
  private setPop() {
    const k = this.pop > 0.7 ? 1 : this.pop / 0.7;
    this.spikes.position.y = -0.3 + k * 0.32;
    this.spikes.visible = k > 0.02;
  }
  update(dt: number) {
    if (this.pop <= 0) return;
    this.pop = Math.max(0, this.pop - dt / 0.45);
    this.setPop();
  }
}
