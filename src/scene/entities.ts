import { Group, Mesh, Vector3, type BufferGeometry } from 'three';
import type { EnemyKind, TowerKind, TowerLevel } from '../domain/types';
import { towerParts } from './models/towers';
import { enemyGeometry, wallGeometry } from './models/props';
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
  private buildT = 1;
  private recoil = 0;
  private aimYaw = 0;
  private targetYaw = 0;
  private idleT = Math.random() * 10;
  private charge = 0;
  blockedT = 0;
  headY = 1.6;

  constructor(readonly id: string, readonly kind: TowerKind, center: Vector3, level: TowerLevel, animate: boolean) {
    this.group.position.copy(center);
    this.group.add(this.inner);
    this.inner.add(this.head);
    this.setLevel(level, false);
    if (animate) this.buildT = 0;
  }

  setLevel(level: TowerLevel, pop: boolean) {
    this.level = level;
    for (const m of this.bodyMeshes) this.inner.remove(m);
    this.bodyMeshes = [];
    if (this.headMesh) this.head.remove(this.headMesh);
    const parts = towerParts(this.kind, level);
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
    this.headMesh = new Mesh(parts.head, this.kind === 'frost' ? mats.glow : mats.body);
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
  lastPos = new Vector3();
  facing = 0;
  constructor(readonly id: string, readonly kind: EnemyKind, readonly laneOffset: number) {
    const g = enemyGeometry(kind);
    this.height = g.height;
    this.mat = createVoxelMaterial({ bevel: 0.012, transparent: kind === 'slime', opacity: kind === 'slime' ? 0.9 : 1, roughness: kind === 'slime' ? 0.35 : 0.85 });
    this.body = new Mesh(g.body, this.mat);
    this.body.castShadow = true;
    this.group.add(this.body);
    if (g.extra) {
      const extraMat = kind === 'golem' ? createVoxelMaterial({ emissiveStrength: 3 }) : this.mat;
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
    if (this.slowed) tint.set(0.62, 0.86, 1.0, 0.42); else tint.set(1, 1, 1, 0);
    const s = this.squash;
    if (this.kind === 'slime') {
      const hop = moving ? Math.abs(Math.sin(this.t * 6.5)) : 0;
      const sq = 1 + Math.sin(this.t * 13) * 0.12 * (moving ? 1 : 0.3) + s * 0.2;
      this.body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      this.body.position.y = hop * 0.12;
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
