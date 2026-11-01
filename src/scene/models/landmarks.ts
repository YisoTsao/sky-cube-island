import {
  AdditiveBlending, Color, CylinderGeometry, DoubleSide, Group, Mesh, OctahedronGeometry, ShaderMaterial,
  CircleGeometry, type BufferGeometry,
} from 'three';
import { VoxelModel } from '../voxel/model';
import { createVoxelMaterial, FLAG_EMISSIVE, sharedUniforms } from '../materials/voxel-material';
import { PALETTE } from '../palette';

const V = 1 / 16;

const CORE_VERT = /* glsl */`
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  if (isOrthographic) vV = normalize(vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]));
  vP = position;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const CORE_FRAG = /* glsl */`
uniform float uTime; uniform float uCrack; uniform float uHit; uniform vec3 uColor; uniform vec3 uDeep; uniform float uPulse;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  float swirl = sin(vP.y * 9.0 + uTime * 2.2 + atan(vP.z, vP.x) * 3.0) * 0.5 + 0.5;
  vec3 c = mix(uDeep, uColor, 0.45 + swirl * 0.35);
  float pulse = 0.85 + 0.15 * sin(uTime * 3.0) * uPulse;
  c *= (1.4 + fres * 2.6) * pulse;
  // cracks: thin bright-dark lines, more with lower HP stage
  float cr = 0.0;
  if (uCrack > 0.5) {
    vec3 q = vP * (6.0 + uCrack * 2.0);
    float l = abs(fract(q.x + q.y * 0.6 + sin(q.z * 2.0) * 0.3) - 0.5);
    cr = smoothstep(0.035 * uCrack, 0.0, l) * step(0.35, h(floor(q * 0.5)));
    float flicker = 0.75 + 0.25 * sin(uTime * (9.0 + uCrack * 6.0) + h(floor(q)) * 6.0);
    c *= mix(1.0, flicker, uCrack / 3.0);
    c = mix(c, vec3(0.05, 0.08, 0.16), cr * 0.85);
  }
  c = mix(c, vec3(4.0, 0.6, 0.5), uHit);
  gl_FragColor = vec4(c, 1.0);
}`;

/** 天空之心 — 3×3 rune plinth + floating octahedral crystal (GDD §10.2, Tech §9.5). */
export class CoreModel {
  readonly group = new Group();
  readonly crystal: Mesh;
  private crystalMat: ShaderMaterial;
  private shards: Mesh[] = [];
  private beam: Mesh;
  private hit = 0;
  private bounce = 0;

  constructor() {
    const base = new VoxelModel(48, 12, 48);
    base.cylinder(24, 24, 23, 0, 2, 'stoneDark', true);
    base.cylinder(24, 24, 21, 3, 3, 'stone', true);
    base.cylinder(24, 24, 15, 4, 5, 'stoneLight', true);
    base.cylinder(24, 24, 9, 6, 6, 'stone', true);
    // pillars at the corners
    for (const [x, z] of [[5, 5], [42, 5], [5, 42], [42, 42]] as const) {
      base.box(x - 1, 0, z - 1, x + 2, 9, z + 2, 'stoneDark', true);
      base.box(x - 2, 10, z - 2, x + 3, 11, z + 3, 'stoneLight', true);
    }
    const runes = new VoxelModel(48, 12, 48);
    for (let a = 0; a < 48; a++) {
      const ang = (a / 48) * Math.PI * 2;
      if (a % 3 === 0) continue;
      runes.set(24 + Math.cos(ang) * 18.5, 3.6, 24 + Math.sin(ang) * 18.5, 'core');
    }
    for (const [x, z] of [[5, 5], [42, 5], [5, 42], [42, 42]] as const) runes.box(x, 7, z, x + 1, 8, z + 1, 'core');
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      runes.set(24 + Math.cos(ang) * 12, 5.6, 24 + Math.sin(ang) * 12, 'rune');
    }
    const mat = createVoxelMaterial({ bevel: 0.025 });
    const baseMesh = new Mesh(base.build(V), mat);
    baseMesh.castShadow = true; baseMesh.receiveShadow = true;
    baseMesh.layers.enable(1);
    this.group.add(baseMesh);
    this.group.add(new Mesh(runes.build(V, { flags: FLAG_EMISSIVE }), createVoxelMaterial({ emissiveStrength: 3 })));

    this.crystalMat = new ShaderMaterial({
      vertexShader: CORE_VERT, fragmentShader: CORE_FRAG,
      uniforms: {
        uTime: sharedUniforms.uTime, uCrack: { value: 0 }, uHit: { value: 0 }, uPulse: { value: 1 },
        uColor: { value: new Color(PALETTE.core) }, uDeep: { value: new Color(PALETTE.coreDeep) },
      },
    });
    const geo = new OctahedronGeometry(0.62, 0);
    geo.scale(1, 1.45, 1);
    this.crystal = new Mesh(geo, this.crystalMat);
    this.crystal.position.y = 1.55;
    this.crystal.castShadow = true;
    this.group.add(this.crystal);
    const shardGeo = new OctahedronGeometry(0.11, 0);
    shardGeo.scale(1, 1.8, 1);
    for (let i = 0; i < 4; i++) {
      const s = new Mesh(shardGeo, this.crystalMat);
      this.group.add(s);
      this.shards.push(s);
    }
    // faint vertical light column (fake volume, additive)
    this.beam = new Mesh(new CylinderGeometry(0.34, 0.6, 9, 20, 1, true), new ShaderMaterial({
      transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
      uniforms: { uTime: sharedUniforms.uTime, uColor: { value: new Color(PALETTE.core) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
        void main(){ float a = (1.0 - vUv.y) * smoothstep(0.0, 0.08, vUv.y) * (0.55 + 0.45 * sin(vUv.y * 30.0 - uTime * 3.0));
        float edge = sin(vUv.x * 3.14159 * 2.0 * 6.0) * 0.15 + 0.85;
        gl_FragColor = vec4(uColor * a * edge * 0.55, 1.0); }`,
    }));
    this.beam.position.y = 1.6 + 4.5;
    this.group.add(this.beam);
  }

  setHp(hp: number) {
    this.crystalMat.uniforms.uCrack!.value = hp <= 4 ? 3 : hp <= 9 ? 2 : hp <= 15 ? 1 : 0;
  }
  hitFlash(reduced: boolean) { this.hit = reduced ? 0.5 : 1; this.bounce = 1; }

  update(dt: number, t: number) {
    this.crystal.rotation.y += dt * 0.8;
    this.bounce = Math.max(0, this.bounce - dt * 4);
    this.crystal.position.y = 1.55 + Math.sin(t * 1.6) * 0.08 + Math.sin(this.bounce * Math.PI) * 0.12;
    const sc = 1 + Math.sin(this.bounce * Math.PI) * 0.15;
    this.crystal.scale.setScalar(sc);
    this.hit = Math.max(0, this.hit - dt * 3);
    this.crystalMat.uniforms.uHit!.value = this.hit;
    this.shards.forEach((s, i) => {
      const a = t * 0.9 + (i / 4) * Math.PI * 2;
      s.position.set(Math.cos(a) * 1.0, 1.4 + Math.sin(t * 2 + i) * 0.2, Math.sin(a) * 1.0);
      s.rotation.y = a * 2;
    });
  }
}

const VORTEX_FRAG = /* glsl */`
uniform float uTime; uniform vec3 uA; uniform vec3 uB; uniform float uBoost;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float s = sin(a * 3.0 + r * 9.0 - uTime * (3.0 + uBoost * 6.0));
  float s2 = sin(a * 5.0 - r * 14.0 + uTime * 2.0);
  vec3 c = mix(uB, uA, smoothstep(-0.3, 0.9, s) * 0.8 + 0.2 * s2);
  c *= (1.6 + (1.0 - r) * 2.2) * (1.0 + uBoost * 0.8);
  float alpha = smoothstep(1.0, 0.75, r);
  gl_FragColor = vec4(c, alpha);
}`;

/** Portal: tilted ancient stone arch (A) or crystal-ringed rift (B) with a swirling vortex. */
export class PortalModel {
  readonly group = new Group();
  private vortexMat: ShaderMaterial;
  private boost = 0;
  constructor(variant: 'A' | 'B') {
    const m = new VoxelModel(32, 34, 12);
    const glow = new VoxelModel(32, 34, 12);
    if (variant === 'A') {
      // ancient arch, slightly leaning, with fallen blocks
      for (let y = 0; y < 26; y++) {
        const lean = Math.round(y / 13);
        m.box(3 + lean, y, 3, 7 + lean, y, 8, y % 5 === 0 ? 'rockDark' : 'rock', true);
        m.box(24 + lean, y, 3, 28 + lean, y, 8, y % 5 === 0 ? 'rockDark' : 'rock', true);
      }
      for (let x = 3; x <= 30; x++) {
        const t = (x - 16) / 13;
        const yy = 26 + Math.round((1 - t * t) * 5);
        m.box(x, yy - 3, 3, x, yy, 8, x % 4 === 0 ? 'rockLight' : 'rock', true);
      }
      m.box(0, 0, 9, 3, 2, 11, 'rockDark', true);
      m.box(28, 0, 0, 31, 3, 2, 'rock', true);
      m.paint((x, y, z) => y > 26 && (x + z) % 3 === 0, 'golemMoss');
      for (let y = 4; y < 24; y += 6) { glow.set(5 + Math.round(y / 13), y, 9, 'portalLight'); glow.set(26 + Math.round(y / 13), y, 9, 'portalLight'); }
    } else {
      m.box(5, 0, 2, 26, 1, 9, 'rockDark', true);
      for (const [x, z, h] of [[4, 4, 22], [27, 5, 26], [9, 8, 12], [22, 8, 15], [15, 2, 8]] as const) {
        for (let y = 0; y < h; y++) {
          const r = Math.max(0.6, 2.2 * (1 - y / h) + 0.4);
          glow.cylinder(x, z, r, y, y, y > h - 4 ? 'portalLight' : y % 3 ? 'portal' : 'portalDeep');
        }
      }
    }
    const stoneMat = createVoxelMaterial({ bevel: 0.02 });
    const stone = new Mesh(m.build(V), stoneMat);
    stone.castShadow = true; stone.receiveShadow = true;
    stone.layers.enable(1);
    this.group.add(stone);
    this.group.add(new Mesh(glow.build(V, { flags: FLAG_EMISSIVE }), createVoxelMaterial({ emissiveStrength: 2.6 })));
    this.vortexMat = new ShaderMaterial({
      transparent: true, depthWrite: false, side: DoubleSide,
      uniforms: { uTime: sharedUniforms.uTime, uA: { value: new Color(PALETTE.portalLight) }, uB: { value: new Color(PALETTE.portalDeep) }, uBoost: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: VORTEX_FRAG,
    });
    const disk = new Mesh(new CircleGeometry(0.72, 40), this.vortexMat);
    disk.position.set(0, 1.0, 0.05 - (variant === 'A' ? 0.12 : 0));
    disk.scale.set(1, 1.25, 1);
    this.group.add(disk);
    const ground = new Mesh(new CircleGeometry(0.62, 40), this.vortexMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.02;
    this.group.add(ground);
  }
  /** Pulse before / at wave start (GDD §9.1). */
  pulse() { this.boost = 1; }
  update(dt: number) {
    this.boost = Math.max(0, this.boost - dt * 0.8);
    this.vortexMat.uniforms.uBoost!.value = this.boost;
  }
}

export interface BridgePoint { x: number; y: number; z: number }

/** Plank ramp bridge following the connector chain (deck nodes ↔ visual always aligned). */
export function bridgeGeometry(points: BridgePoint[], style: 'wood' | 'stoneWood'): { deck: BufferGeometry; length: number; dir: [number, number]; baseY: number } {
  const first = points[0]!, last = points[points.length - 1]!;
  const dx = last.x - first.x, dz = last.z - first.z;
  const len = Math.hypot(dx, dz);
  const segs = points.length - 1;
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const nx = Math.round(len * 16) + 1;
  const ny = Math.round((maxY - minY) * 16) + 24;
  const m = new VoxelModel(nx, ny, 18);
  const hAt = (s: number) => {
    const f = Math.min(segs - 1e-6, Math.max(0, s));
    const i = Math.floor(f);
    const t = f - i;
    return points[i]!.y + (points[i + 1]!.y - points[i]!.y) * t;
  };
  const base = 8; // voxels of supports below lowest deck
  for (let x = 0; x < nx; x++) {
    const s = (x / 16);
    const y = Math.round((hAt(s) - minY) * 16) + base;
    const stoneHalf = style === 'stoneWood' && s < segs / 2;
    if (stoneHalf) {
      m.box(x, Math.max(0, y - 5), 1, x, y, 16, x % 8 < 1 ? 'rockDark' : 'stone', true);
      m.box(x, y + 1, 0, x, y + 2, 0, 'stoneDark'); m.box(x, y + 1, 17, x, y + 2, 17, 'stoneDark');
    } else {
      const plank = (Math.floor(x / 3) % 2) ? 'plank' : 'woodLight';
      m.box(x, y - 1, 2, x, y, 15, x % 3 === 2 ? 'woodDark' : plank);
      // side beams
      m.box(x, y - 2, 1, x, y, 1, 'woodDark'); m.box(x, y - 2, 16, x, y, 16, 'woodDark');
      // rope rails
      m.set(x, y + 6, 1, 'rope'); m.set(x, y + 6, 16, 'rope');
      if (x % 12 === 0) { m.box(x, y, 1, x, y + 7, 1, 'woodDark'); m.box(x, y, 16, x, y + 7, 16, 'woodDark'); }
      if (x % 12 === 6) { m.set(x, y + 3, 1, 'rope'); m.set(x, y + 3, 16, 'rope'); }
    }
  }
  return { deck: m.build(V, { originY: -base * V }), length: len, dir: [dx / len, dz / len], baseY: minY };
}
