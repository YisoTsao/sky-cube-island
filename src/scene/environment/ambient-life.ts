import {
  AdditiveBlending, CanvasTexture, Color, DoubleSide, DynamicDrawUsage, Group, InstancedMesh, Mesh, MeshLambertMaterial,
  NormalBlending, Object3D, PlaneGeometry, ShaderMaterial, Sprite, SpriteMaterial, Vector3,
} from 'three';
import type { LevelDef, LevelTheme, SurfaceCell } from '../../domain/types';
import { HEIGHT_STEP_WORLD } from '../../domain/types';
import { VoxelModel } from '../voxel/model';
import { createVoxelMaterial, sharedUniforms } from '../materials/voxel-material';
import type { PaletteKey } from '../palette';

/**
 * Environmental life (GDD §11.4 / §16 T1): bird flocks circling the islands, waterfalls (lava
 * falls on the volcanic level) pouring off platform edges into the cloud sea, and drifting leaves /
 * petals / snowflakes / embers. Purely presentational: reads only the static level layout, never
 * the simulation, never casts shadows, never occludes the tactical overlay or picking.
 */

export interface AmbientOptions {
  level: LevelDef;
  center: Vector3;
  /** Ground height at a world x/z (−60 over the void). */
  groundAt(x: number, z: number): number;
}

export interface AmbientSettings { birds: number; particles: number; reducedMotion: boolean }

const FALL_VERT = /* glsl */`
varying vec2 vUv;
varying float vY;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vY = wp.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FALL_FRAG = /* glsl */`
uniform float uTime; uniform vec3 uColor; uniform vec3 uFoam; uniform float uTop; uniform float uSpeed; uniform float uSeed; uniform float uGlow;
varying vec2 vUv;
varying float vY;
float h1(float x) { return fract(sin(x * 91.7 + uSeed) * 43758.5453); }
float n1(float x) { float i = floor(x), f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
void main() {
  float x = vUv.x;
  // streaks: columns scrolling down at slightly different speeds
  float col = floor(x * 7.0);
  float sp = uSpeed * (0.8 + h1(col) * 0.5);
  float v = (uTop - vY) * 0.9 - uTime * sp;
  float streak = n1(v * 2.2 + col * 13.0) * 0.6 + n1(v * 5.3 - col * 7.0) * 0.4;
  float edge = smoothstep(0.0, 0.18, x) * smoothstep(1.0, 0.82, x);
  float fall = clamp((uTop - vY) / 9.0, 0.0, 1.0);
  // fan out and thin towards the cloud sea; foam right under the lip
  float alpha = edge * (0.55 + streak * 0.45) * (1.0 - smoothstep(0.55, 1.0, fall));
  vec3 c = mix(uColor, uFoam, smoothstep(0.55, 0.95, streak) * 0.7 + (1.0 - smoothstep(0.0, 0.08, fall)) * 0.6);
  gl_FragColor = vec4(c * (1.0 + uGlow), alpha * 0.95);
}`;

type Theme = LevelTheme;

/** Colours of the drifting particles per theme. */
const DRIFT: Record<Theme, { colors: number[]; rise: boolean; glow: boolean; size: number }> = {
  day: { colors: [0xffb3cf, 0xffd0e0, 0x8fd060, 0xfff2f6], rise: false, glow: false, size: 0.09 },
  dusk: { colors: [0xf29a3c, 0xd8662e, 0xffc56e, 0xe97a5a], rise: false, glow: false, size: 0.1 },
  snow: { colors: [0xffffff, 0xeef6ff, 0xdbe9fb], rise: false, glow: false, size: 0.075 },
  ember: { colors: [0xffa21f, 0xff6a2a, 0xffd36e], rise: true, glow: true, size: 0.06 },
};

const BIRD_COLORS: Record<Theme, [PaletteKey, PaletteKey, PaletteKey]> = {
  day: ['white', 'cloudShade', 'clothBlue'],
  dusk: ['woodDark', 'trunkDark', 'autumn'],
  snow: ['snowLight', 'snowShade', 'iron'],
  ember: ['ashDark', 'impHorn', 'lava'],
};

export class AmbientLife {
  readonly group = new Group();
  private flocks: { group: Group; birds: { body: Group; wingL: Object3D; wingR: Object3D; phase: number; offset: Vector3 }[]; radius: number; height: number; speed: number; angle: number; bob: number }[] = [];
  private falls: { mat: ShaderMaterial; mist: Sprite[]; base: Vector3 }[] = [];
  private drift?: InstancedMesh;
  private driftState: { p: Vector3; v: Vector3; spin: number; rot: number; phase: number }[] = [];
  private driftBox: { minX: number; maxX: number; minZ: number; maxZ: number; top: number };
  private theme: Theme;
  private settings: AmbientSettings = { birds: 2, particles: 90, reducedMotion: false };
  private tmp = new Object3D();

  constructor(private opts: AmbientOptions) {
    this.theme = opts.level.theme ?? 'day';
    const xs = opts.level.cells.map((c) => c.pos.x), zs = opts.level.cells.map((c) => c.pos.z);
    this.driftBox = { minX: Math.min(...xs) - 2, maxX: Math.max(...xs) + 3, minZ: Math.min(...zs) - 2, maxZ: Math.max(...zs) + 3, top: 9 };
    this.buildFalls();
    this.buildBirds();
    this.group.name = 'ambient-life';
  }

  /** Apply quality / comfort settings (called whenever the options change). */
  configure(s: AmbientSettings) {
    this.settings = s;
    this.flocks.forEach((f, i) => { f.group.visible = i < s.birds; });
    const n = s.reducedMotion ? Math.floor(s.particles * 0.4) : s.particles;
    this.buildDrift(n);
  }

  /** Counts for tests / debugging. */
  get info() { return { flocks: this.flocks.filter((f) => f.group.visible).length, falls: this.falls.length, drift: this.drift?.count ?? 0 }; }

  // ------------------------------------------------------------------ waterfalls
  /** Edge cells whose outward side faces the void: candidates for a fall. */
  static fallSpots(level: LevelDef, max = 3): { cell: SurfaceCell; dir: [number, number] }[] {
    const byPos = new Map(level.cells.map((c) => [`${c.pos.x},${c.pos.z}`, c]));
    const coreSet = new Set(level.core.footprintCellIds);
    const cand: { cell: SurfaceCell; dir: [number, number]; score: number }[] = [];
    for (const c of level.cells) {
      if (c.kind !== 'ground' || coreSet.has(c.id)) continue;
      if (c.tags?.some((t) => t === 'portal' || t === 'connector' || t === 'protected' || t === 'core')) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (byPos.has(`${c.pos.x + dx},${c.pos.z + dz}`)) continue;
        // the two side neighbours must exist so the lip sits on a straight stretch of cliff
        const s1 = byPos.get(`${c.pos.x + dz},${c.pos.z + dx}`), s2 = byPos.get(`${c.pos.x - dz},${c.pos.z - dx}`);
        if (!s1 || !s2 || s1.elevation !== c.elevation || s2.elevation !== c.elevation) continue;
        // prefer water cells, then low cells (less hidden by the rock roots), deterministic tie-break
        const score = (c.terrain === 'water' ? 100 : 0) - c.elevation * 2 + ((c.pos.x * 7 + c.pos.z * 13) % 5) * 0.1;
        cand.push({ cell: c, dir: [dx, dz], score });
      }
    }
    cand.sort((a, b) => b.score - a.score || a.cell.id.localeCompare(b.cell.id));
    // greedy spread: each new fall at least 7 cells away from the others
    const out: { cell: SurfaceCell; dir: [number, number] }[] = [];
    for (const c of cand) {
      if (out.length >= max) break;
      if (out.some((o) => Math.hypot(o.cell.pos.x - c.cell.pos.x, o.cell.pos.z - c.cell.pos.z) < 7)) continue;
      out.push({ cell: c.cell, dir: c.dir });
    }
    return out;
  }

  private buildFalls() {
    const lava = this.theme === 'ember';
    const frozen = this.theme === 'snow';
    const mistTex = softDot(lava ? 'rgba(255,170,90,1)' : 'rgba(255,255,255,1)');
    AmbientLife.fallSpots(this.opts.level).forEach(({ cell, dir }, i) => {
      const top = cell.elevation * HEIGHT_STEP_WORLD;
      const height = top + 8.6;
      const geo = new PlaneGeometry(0.9, height, 1, 1);
      geo.translate(0, -height / 2, 0);
      const mat = new ShaderMaterial({
        vertexShader: FALL_VERT, fragmentShader: FALL_FRAG, transparent: true, depthWrite: false, side: DoubleSide,
        blending: lava ? AdditiveBlending : NormalBlending,
        uniforms: {
          uTime: sharedUniforms.uTime, uTop: { value: top }, uSeed: { value: i * 17.3 },
          uSpeed: { value: lava ? 0.9 : 2.4 },
          uColor: { value: new Color(lava ? 0xff7a1f : frozen ? 0xbfe3ff : 0x8fd2ff) },
          uFoam: { value: new Color(lava ? 0xffe08a : 0xffffff) },
          uGlow: { value: lava ? 1.4 : 0 },
        },
      });
      const sheet = new Mesh(geo, mat);
      // sit just outside the cliff face of the edge cell, facing outward
      const base = new Vector3(cell.pos.x + 0.5 + dir[0] * 0.53, top + 0.02, cell.pos.z + 0.5 + dir[1] * 0.53);
      sheet.position.copy(base);
      sheet.rotation.y = Math.atan2(dir[0], dir[1]);
      sheet.renderOrder = -5;
      this.group.add(sheet);
      // a thin lip of water across the top of the cell
      const lip = new Mesh(new PlaneGeometry(0.9, 0.5), mat);
      lip.rotation.x = -Math.PI / 2;
      lip.rotation.z = -Math.atan2(dir[0], dir[1]);
      lip.position.set(cell.pos.x + 0.5 + dir[0] * 0.28, top + 0.03, cell.pos.z + 0.5 + dir[1] * 0.28);
      this.group.add(lip);
      // mist / spray puffs where the fall meets the clouds
      const mist: Sprite[] = [];
      for (let k = 0; k < 3; k++) {
        const sp = new Sprite(new SpriteMaterial({ map: mistTex, transparent: true, depthWrite: false, opacity: lava ? 0.35 : 0.45, blending: lava ? AdditiveBlending : NormalBlending }));
        sp.position.set(base.x + dir[0] * 0.3 + (k - 1) * 0.5, -6.2 + k * 0.3, base.z + dir[1] * 0.3);
        sp.scale.setScalar(2.2 + k * 0.6);
        sp.renderOrder = -4;
        this.group.add(sp);
        mist.push(sp);
      }
      this.falls.push({ mat, mist, base });
    });
  }

  // ------------------------------------------------------------------ birds
  private buildBirds() {
    const [bodyC, wingC, accent] = BIRD_COLORS[this.theme];
    const mat = createVoxelMaterial({ bevel: 0.02 });
    const body = new VoxelModel(3, 3, 7);
    body.box(0, 0, 1, 2, 1, 5, bodyC).box(0, 1, 5, 2, 2, 6, bodyC).box(1, 1, 6, 1, 1, 6, accent).box(1, 0, 0, 1, 0, 0, wingC);
    const wing = new VoxelModel(6, 1, 4);
    wing.box(0, 0, 0, 5, 0, 3, wingC).box(4, 0, 0, 5, 0, 1, accent);
    const bodyGeo = body.build(1 / 16);
    const wingGeo = wing.build(1 / 16);
    wingGeo.translate(0, 0, -0.06);
    const flocks = [
      { n: 7, radius: 21, height: 8.5, speed: 0.07, angle: 0.4 },
      { n: 5, radius: 26, height: 10.5, speed: -0.055, angle: 2.6 },
    ];
    for (const f of flocks) {
      const g = new Group();
      const birds: (typeof this.flocks)[number]['birds'] = [];
      for (let i = 0; i < f.n; i++) {
        const b = new Group();
        b.add(new Mesh(bodyGeo, mat));
        const wl = new Object3D(); const wr = new Object3D();
        const ml = new Mesh(wingGeo, mat); ml.position.x = 0.08;
        const mr = new Mesh(wingGeo, mat); mr.scale.x = -1; mr.position.x = 0.1;
        wl.add(ml); wr.add(mr);
        wl.position.set(0.12, 0.08, 0.2); wr.position.set(0.08, 0.08, 0.2);
        b.add(wl, wr);
        // V formation: leader in front, wings trailing back on alternating sides
        const row = Math.ceil(i / 2), side = i === 0 ? 0 : i % 2 ? 1 : -1;
        const offset = new Vector3(side * row * 0.7, (i % 3) * 0.12, -row * 0.75);
        b.scale.setScalar(1.15);
        g.add(b);
        birds.push({ body: b, wingL: wl, wingR: wr, phase: i * 0.9, offset });
      }
      this.group.add(g);
      this.flocks.push({ group: g, birds, radius: f.radius, height: f.height, speed: f.speed, angle: f.angle, bob: 0 });
    }
  }

  // ------------------------------------------------------------------ drifting leaves
  private buildDrift(count: number) {
    if (this.drift) { this.group.remove(this.drift); this.drift.geometry.dispose(); (this.drift.material as MeshLambertMaterial).dispose(); this.drift = undefined; }
    this.driftState = [];
    if (count <= 0) return;
    const d = DRIFT[this.theme];
    const geo = new PlaneGeometry(d.size, d.size * (this.theme === 'snow' || d.glow ? 1 : 0.62));
    const mat = d.glow
      ? new MeshLambertMaterial({ side: DoubleSide, emissive: 0xff8a2a, emissiveIntensity: 2.2, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false })
      : new MeshLambertMaterial({ side: DoubleSide });
    const m = new InstancedMesh(geo, mat, count);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.frustumCulled = false;
    const c = new Color();
    for (let i = 0; i < count; i++) {
      m.setColorAt(i, c.set(d.colors[i % d.colors.length]!));
      const s = { p: new Vector3(), v: new Vector3(), spin: 0, rot: 0, phase: 0 };
      this.respawn(s, true, i);
      this.driftState.push(s);
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    this.drift = m;
    this.group.add(m);
  }

  private seed = 1;
  private rnd() { this.seed = (this.seed * 16807) % 2147483647; return (this.seed - 1) / 2147483646; }

  private respawn(s: { p: Vector3; v: Vector3; spin: number; rot: number; phase: number }, anywhere: boolean, i = 0) {
    const b = this.driftBox;
    const rise = DRIFT[this.theme].rise;
    const x = b.minX + this.rnd() * (b.maxX - b.minX);
    const z = b.minZ + this.rnd() * (b.maxZ - b.minZ);
    const y = rise ? (anywhere ? -2 + this.rnd() * (b.top + 2) : Math.max(-1, this.opts.groundAt(x, z))) : anywhere ? this.rnd() * b.top : b.top + this.rnd() * 2;
    s.p.set(x, y, z);
    const fall = this.theme === 'snow' ? 0.32 : rise ? -0.45 : 0.42;
    s.v.set(0.35 + this.rnd() * 0.25, -fall * (0.7 + this.rnd() * 0.6), 0.12 + this.rnd() * 0.2);
    s.spin = (this.rnd() - 0.5) * 6;
    s.rot = this.rnd() * 6.28;
    s.phase = this.rnd() * 6.28 + i;
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    if (dt <= 0) return;
    const t = sharedUniforms.uTime.value;
    const slow = this.settings.reducedMotion ? 0.5 : 1;
    const c = this.opts.center;
    for (const f of this.flocks) {
      if (!f.group.visible) continue;
      f.angle += dt * f.speed * slow;
      const a = f.angle;
      const x = c.x + Math.cos(a) * f.radius, z = c.z + Math.sin(a) * f.radius * 0.8;
      const y = f.height + Math.sin(t * 0.4 + f.radius) * 0.6;
      // heading = derivative of the ellipse
      const dx = -Math.sin(a) * f.radius * Math.sign(f.speed), dz = Math.cos(a) * f.radius * 0.8 * Math.sign(f.speed);
      const yaw = Math.atan2(dx, dz);
      f.group.position.set(x, y, z);
      f.group.rotation.y = yaw;
      for (const b of f.birds) {
        b.body.position.copy(b.offset);
        b.body.position.y += Math.sin(t * 1.3 + b.phase) * 0.08;
        // flap in bursts, glide in between
        const burst = Math.sin(t * 0.7 + b.phase) > -0.2 ? 1 : 0.15;
        const flap = Math.sin(t * 11 * slow + b.phase) * 0.75 * burst + 0.1;
        b.wingL.rotation.z = flap;
        b.wingR.rotation.z = -flap;
      }
    }
    for (const f of this.falls) {
      f.mist.forEach((m, k) => {
        const s = 2.2 + k * 0.6 + Math.sin(t * 0.8 + k * 2 + f.base.x) * 0.35;
        m.scale.setScalar(s);
        m.material.rotation = t * 0.1 * (k % 2 ? 1 : -1);
      });
    }
    const m = this.drift;
    if (m) {
      const b = this.driftBox;
      const rise = DRIFT[this.theme].rise;
      const o = this.tmp;
      this.driftState.forEach((s, i) => {
        const sway = Math.sin(t * 1.6 + s.phase);
        s.p.x += (s.v.x + sway * 0.25) * dt * slow;
        s.p.y += s.v.y * dt * slow;
        s.p.z += (s.v.z + Math.cos(t * 1.1 + s.phase) * 0.15) * dt * slow;
        s.rot += s.spin * dt * slow;
        const ground = this.opts.groundAt(s.p.x, s.p.z);
        const gone = rise ? s.p.y > b.top + 1 : s.p.y < Math.max(ground, -6.5);
        if (gone || s.p.x > b.maxX + 2 || s.p.z > b.maxZ + 2) this.respawn(s, false);
        o.position.copy(s.p);
        o.rotation.set(s.rot, s.rot * 0.7 + sway * 0.5, sway * 0.6);
        // embers fade as they climb
        o.scale.setScalar(rise ? Math.max(0.2, 1 - (s.p.y + 1) / (b.top + 2)) : 1);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
      });
      m.instanceMatrix.needsUpdate = true;
    }
  }
}

function softDot(color: string): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, color);
  grad.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(cv);
}
