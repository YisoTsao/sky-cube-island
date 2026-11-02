import {
  AmbientLight, BackSide, Color, DirectionalLight, Group, HemisphereLight, Mesh, PMREMGenerator, PlaneGeometry,
  Scene, ShaderMaterial, SphereGeometry, Vector3, type WebGLRenderer, type Texture, DoubleSide, AdditiveBlending,
  BufferGeometry, Float32BufferAttribute,
} from 'three';
import { PALETTE } from '../palette';
import type { LevelTheme } from '../../domain/types';
import { VoxelModel } from '../voxel/model';
import { createVoxelMaterial, sharedUniforms } from '../materials/voxel-material';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p;
}`;
const SKY_FRAG = /* glsl */`
uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 c = mix(uHorizon, uMid, smoothstep(-0.05, 0.25, h));
  c = mix(c, uTop, smoothstep(0.25, 0.85, h));
  c = mix(c, uHorizon * 0.96, smoothstep(0.0, -0.4, h));
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  c += uSunColor * (pow(s, 600.0) * 6.0 + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.08);
  gl_FragColor = vec4(c, 1.0);
}`;

/** Full-screen background gradient for the orthographic view (fixed to the screen, follows camera yaw). */
const BG_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.99999, 1.0); }`;
const BG_FRAG = /* glsl */`
uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uDeep; uniform vec3 uSunColor; uniform vec2 uSun; uniform float uAspect;
varying vec2 vUv;
void main() {
  // Looking down at the islands: the bottom of the screen looks into the deep sky below,
  // the top of the screen fades toward the bright horizon.
  float h = vUv.y;
  vec3 c = mix(uDeep, uMid, smoothstep(0.0, 0.75, h));
  c = mix(c, uHorizon, smoothstep(0.7, 1.05, h));
  vec2 p = vec2((vUv.x - uSun.x) * uAspect, vUv.y - uSun.y);
  float d = length(p);
  c += uSunColor * (exp(-d * 6.0) * 0.35 + exp(-d * 1.8) * 0.10);
  // subtle vignette toward the corners keeps focus on the islands
  vec2 q = vUv - 0.5;
  c *= 1.0 - dot(q, q) * 0.22;
  gl_FragColor = vec4(c, 1.0);
}`;

const CLOUD_VERT = /* glsl */`
varying vec2 vXZ;
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vXZ = wp.xz; vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const CLOUD_FRAG = /* glsl */`
uniform float uTime; uniform vec3 uColor; uniform vec3 uShade; uniform vec3 uSunTint; uniform float uLayers; uniform vec2 uCenter;
varying vec2 vXZ;
varying vec3 vWorld;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * n2(p); p = p * 2.03 + 7.1; a *= 0.5; } return v; }
void main() {
  vec2 p = vXZ * 0.045;
  float a = fbm(p + vec2(uTime * 0.012, uTime * 0.006));
  float b = uLayers > 1.5 ? fbm(p * 1.9 - vec2(uTime * 0.02, -uTime * 0.01)) : a;
  float d = a * 0.62 + b * 0.38;
  float puff = smoothstep(0.32, 0.72, d);
  vec3 c = mix(uShade, uColor, puff);
  c += uSunTint * smoothstep(0.55, 0.9, d) * 0.12;
  float r = length(vXZ - uCenter);
  float alpha = smoothstep(0.34, 0.62, d) * (1.0 - smoothstep(60.0, 115.0, r));
  gl_FragColor = vec4(c, alpha * 0.92);
}`;

export interface EnvironmentOptions { center: Vector3; extent: number; theme?: LevelTheme }

/** Sky / light mood per level theme (presentation only). */
interface SkyTheme {
  top: number; mid: number; horizon: number; deep: number; sunColor: number; sunScreen: [number, number];
  cloud: number; cloudShade: number; cloudSunTint: number; fog: number;
  hemiSky: number; hemiGround: number; hemiIntensity: number; sunLight: number; sunIntensity: number;
  sunDir: [number, number, number]; distantTint: [number, number, number, number]; envGround: [number, number, number];
}
const SKY_THEMES: Record<LevelTheme, SkyTheme> = {
  day: {
    top: PALETTE.skyTop, mid: PALETTE.skyMid, horizon: PALETTE.skyHorizon, deep: PALETTE.skyDeep, sunColor: 0xfff0c8, sunScreen: [0.18, 0.86],
    cloud: PALETTE.cloud, cloudShade: PALETTE.cloudShade, cloudSunTint: 0xffe2b0, fog: PALETTE.fog,
    hemiSky: 0xcfe6ff, hemiGround: 0x8aa66a, hemiIntensity: 0.75, sunLight: 0xffefd2, sunIntensity: 2.65,
    sunDir: [-0.62, 1.0, 0.42], distantTint: [0.72, 0.84, 0.98, 0.5], envGround: [0.62, 0.7, 0.62],
  },
  // golden hour: low warm sun, violet zenith, peach horizon, rosy cloud sea
  dusk: {
    top: 0x4d5bb4, mid: 0xc48cc4, horizon: 0xffc58e, deep: 0x38448f, sunColor: 0xffb46e, sunScreen: [0.16, 0.66],
    cloud: 0xfff0e4, cloudShade: 0xb89cc8, cloudSunTint: 0xffae80, fog: 0xeab8b0,
    hemiSky: 0xffd6c2, hemiGround: 0x7d8a66, hemiIntensity: 0.72, sunLight: 0xffcf98, sunIntensity: 2.55,
    sunDir: [-0.7, 0.72, 0.36], distantTint: [0.96, 0.74, 0.82, 0.52], envGround: [0.7, 0.62, 0.6],
  },
  // crisp winter noon: pale blue sky, bright cold light, white cloud sea
  snow: {
    top: 0x6a9ee2, mid: 0xb6d4f2, horizon: 0xf0f7ff, deep: 0x4f7cc6, sunColor: 0xfff6e8, sunScreen: [0.22, 0.8],
    cloud: 0xffffff, cloudShade: 0xb6c6e2, cloudSunTint: 0xf2f4ff, fog: 0xdce8f6,
    hemiSky: 0xe6f0ff, hemiGround: 0xb8c6d6, hemiIntensity: 0.82, sunLight: 0xfff4e8, sunIntensity: 2.35,
    sunDir: [-0.55, 0.95, 0.5], distantTint: [0.86, 0.92, 1.0, 0.55], envGround: [0.8, 0.84, 0.9],
  },
  // volcanic sky city: maroon-violet sky, lava-orange horizon, smouldering ash sea
  ember: {
    top: 0x2e1d44, mid: 0x86344a, horizon: 0xff9450, deep: 0x22163a, sunColor: 0xff7a3a, sunScreen: [0.2, 0.58],
    cloud: 0xa0646a, cloudShade: 0x40263a, cloudSunTint: 0xff7a44, fog: 0x8a4440,
    hemiSky: 0xffbe9a, hemiGround: 0x5a3232, hemiIntensity: 0.78, sunLight: 0xffbf86, sunIntensity: 2.5,
    sunDir: [-0.65, 0.82, 0.4], distantTint: [0.58, 0.32, 0.34, 0.6], envGround: [0.45, 0.28, 0.25],
  },
};

/**
 * Sky, cloud sea, distant silhouette islands, puffy voxel clouds and the light rig
 * (Tech §9.5): warm sun with island-fitted soft shadows, hemisphere fill, PMREM sky IBL.
 */
export class Environment {
  readonly group = new Group();
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly sunDir: Vector3;
  private readonly th: SkyTheme;
  private bg: Mesh;
  private bgMat: ShaderMaterial;
  private cloudMat: ShaderMaterial;
  private puffs: { mesh: Mesh; speed: number; base: Vector3 }[] = [];
  envMap?: Texture;

  constructor(private opts: EnvironmentOptions) {
    const { center } = opts;
    const th = (this.th = SKY_THEMES[opts.theme ?? 'day']);
    this.sunDir = new Vector3(...th.sunDir).normalize();
    this.bgMat = new ShaderMaterial({
      vertexShader: BG_VERT, fragmentShader: BG_FRAG, depthWrite: false, depthTest: false,
      uniforms: {
        uTop: { value: new Color(th.top) }, uMid: { value: new Color(th.mid) },
        uHorizon: { value: new Color(th.horizon) }, uDeep: { value: new Color(th.deep) }, uSunColor: { value: new Color(th.sunColor) },
        uSun: { value: [...th.sunScreen] }, uAspect: { value: 1.6 },
      },
    });
    this.bg = new Mesh(new PlaneGeometry(2, 2), this.bgMat);
    this.bg.frustumCulled = false;
    this.bg.renderOrder = -1000;
    this.group.add(this.bg);

    // cloud sea
    this.cloudMat = new ShaderMaterial({
      vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false, side: DoubleSide,
      uniforms: {
        uTime: sharedUniforms.uTime, uColor: { value: new Color(th.cloud) }, uShade: { value: new Color(th.cloudShade) },
        uSunTint: { value: new Color(th.cloudSunTint) }, uLayers: { value: 2 }, uCenter: { value: [center.x, center.z] },
      },
    });
    for (const [y, k] of [[-7.4, 1], [-9.6, 0.85]] as const) {
      const sea = new Mesh(new PlaneGeometry(260, 260), this.cloudMat);
      sea.rotation.x = -Math.PI / 2;
      sea.position.set(center.x, y, center.z);
      sea.scale.setScalar(k);
      sea.renderOrder = -10;
      this.group.add(sea);
    }
    // soft haze under the islands
    const haze = new Mesh(new PlaneGeometry(260, 260), new ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uColor: { value: new Color(th.fog) }, uCenter: { value: [center.x, center.z] } },
      vertexShader: CLOUD_VERT,
      fragmentShader: `uniform vec3 uColor; uniform vec2 uCenter; varying vec2 vXZ; varying vec3 vWorld;
        void main(){ float r = length(vXZ-uCenter); gl_FragColor = vec4(uColor, 0.28*(1.0-smoothstep(10.0, 80.0, r))); }`,
    }));
    haze.rotation.x = -Math.PI / 2;
    haze.position.set(center.x, -5.2, center.z);
    haze.renderOrder = -9;
    this.group.add(haze);

    this.buildPuffs();
    this.buildDistantIslands();

    // lights
    this.hemi = new HemisphereLight(th.hemiSky, th.hemiGround, th.hemiIntensity);
    this.group.add(this.hemi);
    this.group.add(new AmbientLight(0xffffff, 0.08));
    this.sun = new DirectionalLight(th.sunLight, th.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 3;
    this.sun.shadow.blurSamples = 12;
    this.group.add(this.sun);
    this.group.add(this.sun.target);
    this.fitShadow(opts.extent);
  }

  setShadowSize(size: number) {
    if (this.sun.shadow.mapSize.x === size) return;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null as never;
  }

  /** Fit the orthographic shadow camera tightly around the island AABB (Tech §9.5). */
  fitShadow(extent: number) {
    const c = this.opts.center;
    this.sun.position.copy(c).addScaledVector(this.sunDir, 40);
    this.sun.target.position.copy(c);
    const cam = this.sun.shadow.camera;
    const r = extent * 0.78;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 10; cam.far = 80;
    cam.updateProjectionMatrix();
  }

  /** PMREM environment from the sky gradient (no HDR download). */
  buildEnvMap(renderer: WebGLRenderer): Texture {
    const skyScene = new Scene();
    const mat = new ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: BackSide, depthWrite: false,
      uniforms: {
        uTop: { value: new Color(this.th.top) }, uMid: { value: new Color(this.th.mid) },
        uHorizon: { value: new Color(this.th.horizon) }, uSunDir: { value: this.sunDir.clone() }, uSunColor: { value: new Color(this.th.sunColor) },
      },
    });
    const ground = new Mesh(new SphereGeometry(10, 32, 16, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), new ShaderMaterial({
      side: BackSide, vertexShader: SKY_VERT, fragmentShader: `void main(){ gl_FragColor = vec4(${this.th.envGround.map((v) => v.toFixed(3)).join(',')},1.0); }`,
    }));
    skyScene.add(new Mesh(new SphereGeometry(10, 32, 16), mat));
    skyScene.add(ground);
    const pm = new PMREMGenerator(renderer);
    const rt = pm.fromScene(skyScene, 0.02);
    pm.dispose();
    this.envMap = rt.texture;
    return rt.texture;
  }

  private buildPuffs() {
    const mat = createVoxelMaterial({ bevel: 0.0, roughness: 1 });
    const { center } = this.opts;
    const spots: [number, number, number, number][] = [
      [-30, -4.5, -18, 1.4], [34, -4.5, -18, 1.8], [40, -1.2, 22, 1.2], [-26, -5.5, 26, 2.0],
      [10, -6.0, 40, 1.6], [-14, -4.0, -40, 1.1], [52, -3.0, 2, 1.5], [-40, -2.0, 4, 1.3],
    ];
    spots.forEach(([dx, y, dz, s], i) => {
      const m = new VoxelModel(28, 10, 18);
      const seed = i * 3.7;
      for (let k = 0; k < 6; k++) {
        const cx = 5 + ((Math.sin(seed + k * 2.1) + 1) / 2) * 18;
        const cz = 5 + ((Math.cos(seed + k * 1.3) + 1) / 2) * 8;
        const r = 3 + ((Math.sin(seed * 2 + k) + 1) / 2) * 3;
        m.sphere(cx, 3.2, cz, r, 'cloud', 0.75);
      }
      m.paint((_x, y) => y <= 1, 'cloudShade');
      const mesh = new Mesh(m.build(0.5), mat);
      mesh.scale.setScalar(s);
      const base = new Vector3(center.x + dx, y, center.z + dz);
      mesh.position.copy(base);
      this.group.add(mesh);
      this.puffs.push({ mesh, speed: 0.15 + (i % 3) * 0.07, base });
    });
  }

  private buildDistantIslands() {
    const { center } = this.opts;
    const mat = createVoxelMaterial({ bevel: 0.05 });
    mat.userData.uniforms.uTint.value.set(...this.th.distantTint);
    const isl: [number, number, number, number, number][] = [
      [-46, -3, -34, 1.3, 1], [56, 0, -40, 1.8, 2], [62, -6, 30, 1.2, 3], [-58, -1, 34, 1.5, 4], [6, -8, -58, 1.1, 5],
    ];
    for (const [dx, y, dz, s, seed] of isl) {
      const m = new VoxelModel(24, 26, 24);
      for (let yy = 0; yy < 26; yy++) {
        const top = yy >= 22;
        const r = top ? 10 + Math.sin(seed + yy) * 0.6 : Math.max(0, 10 - (22 - yy) * 0.48 + Math.sin(seed * 3 + yy * 0.9) * 0.9);
        if (yy > 23) continue;
        m.cylinder(12, 12, r, yy, yy, top ? (yy === 23 ? 'grass' : 'dirt') : yy % 3 ? 'rock' : 'rockDark', true);
      }
      // a couple of trees
      for (let t = 0; t < 3; t++) {
        const tx = 6 + ((seed * 7 + t * 5) % 12), tz = 6 + ((seed * 3 + t * 7) % 12);
        m.box(tx, 24, tz, tx, 25, tz, 'trunk');
        m.sphere(tx + 0.5, 26.5, tz + 0.5, 2.2, 'leaf');
      }
      const mesh = new Mesh(m.build(0.5), mat);
      mesh.position.set(center.x + dx, y - 12 * s, center.z + dz);
      mesh.scale.setScalar(s);
      this.group.add(mesh);
    }
    // faint god-ray-ish sun shafts (additive sheets, cheap)
    const shaftGeo = new BufferGeometry();
    shaftGeo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
    shaftGeo.setIndex([0, 1, 2, 0, 2, 3]);
    void AdditiveBlending; void shaftGeo;
  }

  update(dt: number, cameraYaw: number, aspect: number) {
    for (const p of this.puffs) {
      p.mesh.position.x = p.base.x + Math.sin(sharedUniforms.uTime.value * p.speed * 0.2 + p.base.z) * 3;
      p.mesh.position.y = p.base.y + Math.sin(sharedUniforms.uTime.value * 0.3 + p.base.x) * 0.25;
    }
    // sun glow position on the background follows camera yaw
    const sunYaw = Math.atan2(this.sunDir.x, this.sunDir.z);
    const rel = Math.atan2(Math.sin(sunYaw - cameraYaw), Math.cos(sunYaw - cameraYaw));
    (this.bgMat.uniforms.uSun!.value as number[])[0] = 0.5 - rel / Math.PI * 0.9;
    this.bgMat.uniforms.uAspect!.value = aspect;
    void dt;
  }

  setCloudLayers(n: 1 | 2) { this.cloudMat.uniforms.uLayers!.value = n; }
}
