import {
  AdditiveBlending, BoxGeometry, Color, DynamicDrawUsage, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, Object3D, Quaternion, RingGeometry, Vector3, CircleGeometry, type Scene,
} from 'three';
import { pal, type PaletteKey } from '../palette';

interface Particle {
  alive: boolean; p: Vector3; v: Vector3; life: number; max: number; size: number;
  color: Color; floor: number; bounced: boolean; spin: Vector3; rot: Vector3; gravity: number; drag: number; shrink: boolean;
}

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpO = new Object3D();

/** Fixed-size cube particle pool, single draw call (Tech §9.8: zero per-frame allocation). */
class CubePool {
  readonly mesh: InstancedMesh;
  private ps: Particle[];
  private cursor = 0;
  limit: number;
  constructor(capacity: number, additive: boolean) {
    const geo = new BoxGeometry(1, 1, 1);
    const mat = additive
      ? new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: true })
      : new MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
    this.mesh = new InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = !additive;
    this.limit = capacity;
    this.ps = Array.from({ length: capacity }, () => ({
      alive: false, p: new Vector3(), v: new Vector3(), life: 0, max: 1, size: 0.1, color: new Color(), floor: -99,
      bounced: false, spin: new Vector3(), rot: new Vector3(), gravity: 9.8, drag: 0, shrink: true,
    }));
    for (let i = 0; i < capacity; i++) { this.mesh.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); this.mesh.setColorAt(i, new Color(1, 1, 1)); }
    this.mesh.count = capacity;
  }
  spawn(o: { p: Vector3; v: Vector3; life: number; size: number; color: Color; floor?: number; gravity?: number; drag?: number; shrink?: boolean }) {
    // recycle oldest when full (Tech §11.5)
    const limit = Math.min(this.limit, this.ps.length);
    const i = this.cursor % limit;
    this.cursor = (this.cursor + 1) % limit;
    const q = this.ps[i]!;
    q.alive = true; q.p.copy(o.p); q.v.copy(o.v); q.life = 0; q.max = o.life; q.size = o.size;
    q.color.copy(o.color); q.floor = o.floor ?? -99; q.bounced = false;
    q.gravity = o.gravity ?? 9.8; q.drag = o.drag ?? 0; q.shrink = o.shrink ?? true;
    q.spin.set(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4);
    q.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this.mesh.setColorAt(i, q.color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt: number) {
    let any = false;
    for (let i = 0; i < this.ps.length; i++) {
      const q = this.ps[i]!;
      if (!q.alive) continue;
      any = true;
      q.life += dt;
      if (q.life >= q.max) { q.alive = false; this.mesh.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); continue; }
      q.v.y -= q.gravity * dt;
      if (q.drag) q.v.multiplyScalar(Math.max(0, 1 - q.drag * dt));
      q.p.addScaledVector(q.v, dt);
      if (q.p.y < q.floor + q.size * 0.5 && q.v.y < 0) {
        if (!q.bounced) { q.v.y *= -0.35; q.v.x *= 0.6; q.v.z *= 0.6; q.bounced = true; q.p.y = q.floor + q.size * 0.5; }
        else { q.v.set(0, 0, 0); q.p.y = q.floor + q.size * 0.5; q.spin.multiplyScalar(0.9); }
      }
      q.rot.addScaledVector(q.spin, dt);
      const k = q.shrink ? Math.min(1, (1 - q.life / q.max) * 2.2) : 1;
      tmpO.position.copy(q.p);
      tmpO.rotation.set(q.rot.x, q.rot.y, q.rot.z);
      tmpO.scale.setScalar(q.size * k);
      tmpO.updateMatrix();
      this.mesh.setMatrixAt(i, tmpO.matrix);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

interface Projectile {
  mesh: Mesh; from: Vector3; to: Vector3; t: number; dur: number; arc: number; active: boolean; kind: string;
  onArrive?: () => void; trailT: number;
}

interface Ring { mesh: Mesh; t: number; dur: number; maxR: number; active: boolean; color: Color }
interface Decal { mesh: Mesh; t: number; dur: number; active: boolean }

/**
 * Presentation-only VFX (GDD §11.5): voxel shards, glow sparks, projectiles with trails,
 * shockwave rings and scorch decals. Uses non-deterministic Math.random (never sim RNG).
 */
export class Vfx {
  readonly group = new Group();
  private cubes: CubePool;
  private glows: CubePool;
  private projectiles: Projectile[] = [];
  private rings: Ring[] = [];
  private decals: Decal[] = [];
  groundAt: (x: number, z: number) => number = () => -99;
  reducedMotion = false;

  constructor(capacity = 1500) {
    this.cubes = new CubePool(Math.min(2500, capacity), false);
    this.glows = new CubePool(Math.min(1200, Math.round(capacity * 0.6)), true);
    this.group.add(this.cubes.mesh, this.glows.mesh);
    const arrowGeo = new BoxGeometry(0.035, 0.035, 0.42);
    const ballGeo = new BoxGeometry(0.16, 0.16, 0.16);
    const shardGeo = new BoxGeometry(0.07, 0.07, 0.3);
    for (let i = 0; i < 48; i++) {
      const kind = i < 24 ? 'arrow' : i < 36 ? 'frost' : 'cannon';
      const mat = kind === 'frost'
        ? new MeshBasicMaterial({ color: new Color(pal('crystalLight')).multiplyScalar(2.2) })
        : new MeshStandardMaterial({ color: kind === 'arrow' ? pal('banner') : pal('iron'), roughness: 0.6 });
      const m = new Mesh(kind === 'arrow' ? arrowGeo : kind === 'frost' ? shardGeo : ballGeo, mat);
      m.visible = false;
      m.castShadow = kind === 'cannon';
      this.group.add(m);
      this.projectiles.push({ mesh: m, from: new Vector3(), to: new Vector3(), t: 0, dur: 0.2, arc: 0, active: false, kind, trailT: 0 });
    }
    const ringGeo = new RingGeometry(0.86, 1, 48);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 16; i++) {
      const m = new Mesh(ringGeo, new MeshBasicMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending }));
      m.visible = false;
      this.group.add(m);
      this.rings.push({ mesh: m, t: 0, dur: 0.5, maxR: 1, active: false, color: new Color() });
    }
    const decalGeo = new CircleGeometry(0.5, 20);
    decalGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const m = new Mesh(decalGeo, new MeshBasicMaterial({ color: 0x2a2018, transparent: true, depthWrite: false, opacity: 0.5 }));
      m.visible = false;
      m.renderOrder = 2;
      this.group.add(m);
      this.decals.push({ mesh: m, t: 0, dur: 3, active: false });
    }
  }

  setCapacity(n: number) { this.cubes.limit = Math.min(2500, n); this.glows.limit = Math.min(1200, Math.round(n * 0.6)); }
  attach(scene: Scene) { scene.add(this.group); }

  /** Voxel shatter burst (death, building, sell). */
  shatter(at: Vector3, colors: PaletteKey[], count: number, opts: { speed?: number; size?: number; up?: number; life?: number } = {}) {
    const speed = opts.speed ?? 2.4;
    const floor = this.groundAt(at.x, at.z);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.cubes.spawn({
        p: new Vector3(at.x + (Math.random() - 0.5) * 0.3, at.y + Math.random() * 0.3, at.z + (Math.random() - 0.5) * 0.3),
        v: new Vector3(Math.cos(a) * s, (opts.up ?? 2.6) * (0.5 + Math.random()), Math.sin(a) * s),
        life: (opts.life ?? 1.4) * (0.7 + Math.random() * 0.6), size: (opts.size ?? 0.09) * (0.6 + Math.random() * 0.8),
        color: pal(colors[i % colors.length]!), floor,
      });
    }
  }

  /** Additive glowing cubes (sparks, frost, magic). */
  sparks(at: Vector3, color: Color | PaletteKey, count: number, opts: { speed?: number; size?: number; life?: number; gravity?: number; up?: number } = {}) {
    const c = typeof color === 'string' ? pal(color).clone().multiplyScalar(2.5) : color;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (opts.speed ?? 2) * (0.3 + Math.random());
      this.glows.spawn({
        p: at.clone(), v: new Vector3(Math.cos(a) * s, (opts.up ?? 1.5) * Math.random(), Math.sin(a) * s),
        life: (opts.life ?? 0.5) * (0.6 + Math.random() * 0.8), size: (opts.size ?? 0.06) * (0.6 + Math.random() * 0.8),
        color: c, gravity: opts.gravity ?? 3, drag: 1.5,
      });
    }
  }

  /** Dust ring of cubes along the ground (build, terrain edit, wall slam). */
  dust(at: Vector3, radius: number, count = 18, color: PaletteKey = 'path') {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      this.cubes.spawn({
        p: new Vector3(at.x + Math.cos(a) * radius * 0.6, at.y + 0.05, at.z + Math.sin(a) * radius * 0.6),
        v: new Vector3(Math.cos(a) * 1.6, 0.6 + Math.random() * 0.6, Math.sin(a) * 1.6),
        life: 0.55 + Math.random() * 0.3, size: 0.07 + Math.random() * 0.05, color: pal(color), gravity: 2.5, drag: 3, floor: at.y,
      });
    }
  }

  /** Soft-ish smoke made of growing grey cubes. */
  smoke(at: Vector3, count = 6) {
    for (let i = 0; i < count; i++) {
      this.cubes.spawn({
        p: at.clone().add(new Vector3((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2)),
        v: new Vector3((Math.random() - 0.5) * 0.5, 0.6 + Math.random() * 0.5, (Math.random() - 0.5) * 0.5),
        life: 0.8 + Math.random() * 0.4, size: 0.12 + Math.random() * 0.1, color: pal(i % 2 ? 'cloudShade' : 'stoneLight'), gravity: -0.3, drag: 1.2,
      });
    }
  }

  ring(at: Vector3, maxR: number, color: Color | PaletteKey, dur = 0.5) {
    const r = this.rings.find((x) => !x.active) ?? this.rings[0]!;
    r.active = true; r.t = 0; r.dur = dur; r.maxR = maxR;
    r.color.copy(typeof color === 'string' ? pal(color) : color).multiplyScalar(1.6);
    r.mesh.position.copy(at); r.mesh.position.y += 0.04;
    r.mesh.visible = true;
  }

  scorch(at: Vector3) {
    const d = this.decals.find((x) => !x.active) ?? this.decals.reduce((a, b) => (a.t > b.t ? a : b));
    d.active = true; d.t = 0;
    d.mesh.position.set(at.x, at.y + 0.015, at.z);
    d.mesh.scale.setScalar(1.6 + Math.random() * 0.4);
    d.mesh.rotation.y = Math.random() * 6;
    d.mesh.visible = true;
  }

  projectile(kind: 'arrow' | 'frost' | 'cannon', from: Vector3, to: Vector3, dur: number, onArrive?: () => void) {
    const p = this.projectiles.find((x) => !x.active && x.kind === kind) ?? this.projectiles.find((x) => x.kind === kind)!;
    if (p.active && p.onArrive) p.onArrive();
    p.active = true; p.from.copy(from); p.to.copy(to); p.t = 0; p.dur = Math.max(0.08, dur);
    p.arc = kind === 'cannon' ? 1.1 : kind === 'arrow' ? 0.18 : 0.05;
    p.onArrive = onArrive; p.trailT = 0;
    p.mesh.visible = true;
    p.mesh.position.copy(from);
  }

  update(dt: number) {
    this.cubes.update(dt);
    this.glows.update(dt);
    const prev = new Vector3();
    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.t += dt / p.dur;
      prev.copy(p.mesh.position);
      const t = Math.min(1, p.t);
      p.mesh.position.lerpVectors(p.from, p.to, t);
      p.mesh.position.y += Math.sin(t * Math.PI) * p.arc;
      if (prev.distanceToSquared(p.mesh.position) > 1e-6) p.mesh.lookAt(p.mesh.position.clone().add(p.mesh.position.clone().sub(prev)));
      p.trailT += dt;
      if (p.trailT > 0.025) {
        p.trailT = 0;
        if (p.kind === 'arrow') this.glows.spawn({ p: p.mesh.position.clone(), v: new Vector3(), life: 0.18, size: 0.03, color: new Color(1.4, 1.4, 1.3), gravity: 0 });
        else if (p.kind === 'frost') this.glows.spawn({ p: p.mesh.position.clone(), v: new Vector3(), life: 0.25, size: 0.05, color: pal('crystalLight').clone().multiplyScalar(2), gravity: 0 });
        else this.cubes.spawn({ p: p.mesh.position.clone(), v: new Vector3(0, 0.3, 0), life: 0.4, size: 0.07, color: pal('cloudShade'), gravity: -0.2, drag: 2 });
      }
      if (p.t >= 1) {
        p.active = false; p.mesh.visible = false;
        const cb = p.onArrive; p.onArrive = undefined;
        cb?.();
      }
    }
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) { r.active = false; r.mesh.visible = false; continue; }
      const e = 1 - Math.pow(1 - k, 3);
      r.mesh.scale.setScalar(0.05 + e * r.maxR);
      (r.mesh.material as MeshBasicMaterial).color.copy(r.color).multiplyScalar(1 - k);
    }
    for (const d of this.decals) {
      if (!d.active) continue;
      d.t += dt;
      if (d.t >= d.dur) { d.active = false; d.mesh.visible = false; continue; }
      (d.mesh.material as MeshBasicMaterial).opacity = 0.5 * (1 - d.t / d.dur);
    }
    void tmpQ; void tmpS;
  }

  /** Flush every in-flight projectile immediately (e.g. on phase change). */
  flush() {
    for (const p of this.projectiles) if (p.active) { p.active = false; p.mesh.visible = false; const cb = p.onArrive; p.onArrive = undefined; cb?.(); }
  }
}
