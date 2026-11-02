import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, DynamicDrawUsage, GreaterDepth, Group,
  InstancedBufferAttribute, InstancedMesh, LessEqualDepth, Matrix4, Mesh, NearestFilter, Object3D, PlaneGeometry,
  Scene, ShaderMaterial, Vector3, LinearFilter,
} from 'three';
import type { CellId, LevelDef } from '../../domain/types';
import type { RangeCell } from '../../presentation/feed';
import { TACTICAL } from '../palette';

/**
 * Tactical overlay (Tech §9.7, D21-03): rendered after post-processing, never tone-mapped,
 * graded, bloomed or fogged. Occluded parts are drawn as see-through dashes.
 */

const ROUTE_VERT = /* glsl */`
attribute float aDist;
varying float vDist; varying vec2 vUv;
void main() { vDist = aDist; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ROUTE_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uTime; uniform float uPattern; uniform float uHidden; uniform float uAlpha; uniform float uSweep;
varying float vDist; varying vec2 vUv;
void main() {
  float across = abs(vUv.y - 0.5) * 2.0;
  float s = fract(vDist * 1.1 - uTime * 0.9);
  float mark; float core;
  if (uPattern < 0.5) {
    // A: solid band + flowing chevron dots
    float line = smoothstep(0.5, 0.38, across) * 0.7;
    float dot = smoothstep(0.62, 0.42, length(vec2((s - 0.5) * 2.4, across)));
    mark = max(line, dot);
    core = smoothstep(0.22, 0.1, across) * 0.5 + dot * 0.6;
  } else {
    // B: double rails + flowing diamonds
    float rails = smoothstep(0.2, 0.08, abs(across - 0.7)) * 0.9;
    float dia = smoothstep(0.62, 0.48, abs(s - 0.5) * 2.0 + across * 0.85);
    mark = max(rails, dia);
    core = dia * 0.6;
  }
  // dark soft outline so the route reads on bright grass
  float outline = smoothstep(1.0, 0.7, across) * 0.35;
  float edge = smoothstep(1.0, 0.9, across);
  float a = max(mark, outline) * edge * uAlpha;
  float sweep = uSweep > 0.0 ? smoothstep(0.6, 0.0, abs(vDist - uSweep)) : 0.0;
  vec3 c = mix(uColor * 0.25, uColor * 1.25, smoothstep(0.0, 0.5, mark)) + core * 0.35 + sweep * 0.9;
  if (uHidden > 0.5) {
    float dash = step(0.5, fract(vDist * 2.4));
    a *= 0.42 * dash;
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(c, a);
}`;

const CELL_VERT = /* glsl */`
attribute vec4 aColor; attribute float aKind;
varying vec4 vColor; varying float vKind; varying vec2 vUv; varying vec3 vW;
void main() {
  vColor = aColor; vKind = aKind; vUv = uv;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const CELL_FRAG = /* glsl */`
uniform float uTime;
varying vec4 vColor; varying float vKind; varying vec2 vUv; varying vec3 vW;
void main() {
  vec2 c = abs(vUv - 0.5) * 2.0;
  float edge = max(c.x, c.y);
  float a = vColor.a;
  int k = int(vKind + 0.5);
  if (k == 1) { // hatched (occluded)
    float h = step(0.5, fract((vW.x + vW.z) * 4.0));
    a *= 0.35 + 0.65 * h;
  } else if (k == 2) { // outline only
    a *= smoothstep(0.78, 0.9, edge);
  } else if (k == 3) { // filled with strong border (preview)
    a *= 0.35 + 0.65 * smoothstep(0.8, 0.92, edge);
  } else if (k == 4) { // pulsing editable hint
    a *= (0.25 + 0.75 * smoothstep(0.82, 0.95, edge)) * (0.65 + 0.35 * sin(uTime * 3.0));
  } else if (k == 5) { // footprint mark
    a *= 0.25 + 0.75 * step(0.86, edge);
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`;

const BAR_VERT = /* glsl */`
attribute vec4 aBar; // hpRatio, slowed, visible, width
varying vec2 vUv; varying vec4 vBar;
void main() {
  vUv = uv; vBar = aBar;
  vec4 center = viewMatrix * modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 size = vec2(0.56 * aBar.w, 0.085) * aBar.z;
  center.xy += position.xy * size;
  gl_Position = projectionMatrix * center;
}`;
const BAR_FRAG = /* glsl */`
uniform vec3 uGood; uniform vec3 uMid; uniform vec3 uLow; uniform vec3 uBack; uniform vec3 uFrost;
varying vec2 vUv; varying vec4 vBar;
void main() {
  if (vBar.z < 0.5) discard;
  vec2 px = vUv;
  float border = step(px.x, 0.03) + step(0.97, px.x) + step(px.y, 0.16) + step(0.84, px.y);
  vec3 fill = vBar.x > 0.6 ? uGood : vBar.x > 0.3 ? uMid : uLow;
  vec3 c = px.x < vBar.x ? fill * (0.85 + 0.25 * px.y) : uBack;
  if (border > 0.0) c = vBar.y > 0.5 ? uFrost : vec3(0.06, 0.07, 0.1);
  gl_FragColor = vec4(c, 0.96);
}`;

const NUM_VERT = /* glsl */`
attribute vec4 aNum; // digitIndex(0-9, 10='-', 11='+'), slot offset x, age01, scale
attribute vec3 aCol;
varying vec2 vUv; varying float vAge; varying vec3 vCol;
void main() {
  vAge = aNum.z; vCol = aCol;
  float d = aNum.x;
  vUv = vec2((d + uv.x) / 12.0, uv.y);
  vec4 center = viewMatrix * modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = aNum.w * (1.0 + 0.35 * (1.0 - smoothstep(0.0, 0.15, aNum.z)));
  center.xy += (position.xy + vec2(aNum.y, 0.0)) * vec2(0.17, 0.24) * s;
  center.y += aNum.z * 0.55;
  gl_Position = projectionMatrix * center;
}`;
const NUM_FRAG = /* glsl */`
uniform sampler2D uAtlas;
varying vec2 vUv; varying float vAge; varying vec3 vCol;
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  float a = t.a * (1.0 - smoothstep(0.65, 1.0, vAge));
  if (a < 0.02) discard;
  vec3 c = mix(vec3(0.05, 0.05, 0.08), vCol, t.r);
  gl_FragColor = vec4(c, a);
}`;

function digitAtlas(): CanvasTexture {
  const cw = 48, ch = 64;
  const cv = document.createElement('canvas');
  cv.width = cw * 12; cv.height = ch;
  const g = cv.getContext('2d')!;
  g.font = '900 52px "Noto Sans TC", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const chars = '0123456789-+';
  for (let i = 0; i < chars.length; i++) {
    g.lineWidth = 9; g.strokeStyle = 'rgba(0,0,0,1)'; g.lineJoin = 'round';
    g.strokeText(chars[i]!, i * cw + cw / 2, ch / 2 + 3);
    g.fillStyle = '#ff0000';
    g.fillText(chars[i]!, i * cw + cw / 2, ch / 2 + 3);
  }
  const tex = new CanvasTexture(cv);
  tex.minFilter = LinearFilter; tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

interface RouteMeshes { visible: Mesh; hidden: Mesh; mat: ShaderMaterial; matHidden: ShaderMaterial; length: number }

export class TacticalOverlay {
  readonly scene = new Scene();
  private routeGroup = new Group();
  private routes = new Map<string, RouteMeshes>();
  private cells: InstancedMesh;
  private cellColor: InstancedBufferAttribute;
  private cellKind: InstancedBufferAttribute;
  private cellCount = 0;
  private readonly maxCells = 1400;
  private bars: InstancedMesh;
  private barAttr: InstancedBufferAttribute;
  private readonly maxBars = 64;
  private nums: InstancedMesh;
  private numAttr: InstancedBufferAttribute;
  private numCol: InstancedBufferAttribute;
  private numPool: { pos: Vector3; age: number; digits: number[]; color: Color; scale: number }[] = [];
  private readonly maxNumbers = 40;
  private ghosts: InstancedMesh | null = null;
  private ghostPaths: { pts: Vector3[]; len: number[]; total: number }[] = [];
  private time = 0;
  private sweep = 0;
  private uTime = { value: 0 };
  private o = new Object3D();
  private tmpM = new Matrix4();
  colorblind = false;

  constructor(private level: LevelDef, private cellPos: (id: CellId) => Vector3) {
    this.scene.add(this.routeGroup);
    // cells
    const plane = new PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    const cellMat = new ShaderMaterial({
      vertexShader: CELL_VERT, fragmentShader: CELL_FRAG, transparent: true, depthWrite: false,
      uniforms: { uTime: this.uTime }, toneMapped: false, depthFunc: LessEqualDepth, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.cells = new InstancedMesh(plane, cellMat, this.maxCells);
    this.cellColor = new InstancedBufferAttribute(new Float32Array(this.maxCells * 4), 4);
    this.cellKind = new InstancedBufferAttribute(new Float32Array(this.maxCells), 1);
    this.cellColor.setUsage(DynamicDrawUsage); this.cellKind.setUsage(DynamicDrawUsage);
    plane.setAttribute('aColor', this.cellColor);
    plane.setAttribute('aKind', this.cellKind);
    this.cells.count = 0;
    this.cells.frustumCulled = false;
    this.cells.renderOrder = 1;
    this.scene.add(this.cells);

    // health bars
    const barGeo = new PlaneGeometry(1, 1);
    this.barAttr = new InstancedBufferAttribute(new Float32Array(this.maxBars * 4), 4);
    this.barAttr.setUsage(DynamicDrawUsage);
    barGeo.setAttribute('aBar', this.barAttr);
    this.bars = new InstancedMesh(barGeo, new ShaderMaterial({
      vertexShader: BAR_VERT, fragmentShader: BAR_FRAG, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: {
        uGood: { value: new Color(TACTICAL.hpGood) }, uMid: { value: new Color(TACTICAL.hpMid) }, uLow: { value: new Color(TACTICAL.hpLow) },
        uBack: { value: new Color(TACTICAL.hpBack) }, uFrost: { value: new Color(TACTICAL.frost) },
      },
    }), this.maxBars);
    this.bars.count = 0; this.bars.frustumCulled = false; this.bars.renderOrder = 10;
    this.scene.add(this.bars);

    // damage numbers
    const numGeo = new PlaneGeometry(1, 1);
    const n = this.maxNumbers * 4;
    this.numAttr = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.numCol = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.numAttr.setUsage(DynamicDrawUsage); this.numCol.setUsage(DynamicDrawUsage);
    numGeo.setAttribute('aNum', this.numAttr);
    numGeo.setAttribute('aCol', this.numCol);
    this.nums = new InstancedMesh(numGeo, new ShaderMaterial({
      vertexShader: NUM_VERT, fragmentShader: NUM_FRAG, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: { uAtlas: { value: digitAtlas() } },
    }), n);
    this.nums.count = 0; this.nums.frustumCulled = false; this.nums.renderOrder = 11;
    this.scene.add(this.nums);
    void NearestFilter;
  }

  // ---------------- routes ----------------
  setRoutes(routes: Record<string, CellId[]>, sweep: boolean) {
    for (const r of this.routes.values()) {
      this.routeGroup.remove(r.visible, r.hidden);
      r.visible.geometry.dispose();
    }
    this.routes.clear();
    this.ghostPaths = [];
    const ids = this.level.portals.map((p) => p.id);
    ids.forEach((pid, i) => {
      const path = routes[pid];
      if (!path || path.length < 2) return;
      const pts = path.map((id) => this.cellPos(id).add(new Vector3(0, 0.1 + i * 0.012, 0)));
      // offset lanes slightly so overlapping routes stay readable
      const lane = ([-1, 1, 0, 0.5][i] ?? 0) * 0.13;
      const geo = this.ribbon(pts, 0.46, lane);
      const color = new Color([TACTICAL.routeA, TACTICAL.routeB, TACTICAL.routeC, TACTICAL.routeD][i] ?? TACTICAL.routeC);
      const mk = (hidden: boolean) => new ShaderMaterial({
        vertexShader: ROUTE_VERT, fragmentShader: ROUTE_FRAG, transparent: true, depthWrite: false, toneMapped: false, side: DoubleSide,
        depthFunc: hidden ? GreaterDepth : LessEqualDepth,
        uniforms: { uColor: { value: color }, uTime: this.uTime, uPattern: { value: i }, uHidden: { value: hidden ? 1 : 0 }, uAlpha: { value: 0.95 }, uSweep: { value: -1 } },
      });
      const mat = mk(false), matHidden = mk(true);
      const visible = new Mesh(geo, mat);
      const hidden = new Mesh(geo, matHidden);
      visible.renderOrder = 3; hidden.renderOrder = 2;
      visible.frustumCulled = false; hidden.frustumCulled = false;
      this.routeGroup.add(visible, hidden);
      const len: number[] = [0];
      for (let k = 1; k < pts.length; k++) len.push(len[k - 1]! + pts[k]!.distanceTo(pts[k - 1]!));
      this.routes.set(pid, { visible, hidden, mat, matHidden, length: len[len.length - 1]! });
      this.ghostPaths.push({ pts, len, total: len[len.length - 1]! });
    });
    this.sweep = sweep ? 0.0001 : 0;
  }

  setRoutesVisible(v: boolean, alpha = 0.95) {
    this.routeGroup.visible = v;
    for (const r of this.routes.values()) { r.mat.uniforms.uAlpha!.value = alpha; r.matHidden.uniforms.uAlpha!.value = alpha; }
  }

  private ribbon(pts: Vector3[], width: number, lane: number): BufferGeometry {
    const pos: number[] = []; const uv: number[] = []; const dist: number[] = []; const idx: number[] = [];
    let acc = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const prev = pts[Math.max(0, i - 1)]!;
      const next = pts[Math.min(pts.length - 1, i + 1)]!;
      const dir = new Vector3().subVectors(next, prev); dir.y = 0; dir.normalize();
      const side = new Vector3(-dir.z, 0, dir.x);
      if (i > 0) acc += p.distanceTo(prev);
      const c = p.clone().addScaledVector(side, lane);
      const a = c.clone().addScaledVector(side, width / 2);
      const b = c.clone().addScaledVector(side, -width / 2);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      uv.push(acc, 0, acc, 1);
      dist.push(acc, acc);
      if (i > 0) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    g.setAttribute('aDist', new BufferAttribute(new Float32Array(dist), 1));
    g.setIndex(idx);
    return g;
  }

  /** Ghost walkers (幽靈試走): translucent slimes looping each route in PREPARE. */
  setGhostGeometry(geo: BufferGeometry) {
    const mat = new ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
      vertexShader: `attribute vec3 color; varying vec3 vC; void main(){ vC = color; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vC; void main(){ gl_FragColor = vec4(mix(vC, vec3(1.0), 0.35), 0.5); }`,
    });
    this.ghosts = new InstancedMesh(geo, mat, 12);
    this.ghosts.count = 0;
    this.ghosts.frustumCulled = false;
    this.ghosts.renderOrder = 4;
    this.scene.add(this.ghosts);
  }
  showGhosts = true;

  // ---------------- cells ----------------
  beginCells() { this.cellCount = 0; }
  pushCell(id: CellId, color: number, alpha: number, kind: number, yOffset = 0.03, scale = 1) {
    if (this.cellCount >= this.maxCells) return;
    const p = this.cellPos(id);
    this.o.position.set(p.x, p.y + yOffset, p.z);
    this.o.scale.set(scale, 1, scale);
    this.o.rotation.set(0, 0, 0);
    this.o.updateMatrix();
    const i = this.cellCount++;
    this.cells.setMatrixAt(i, this.o.matrix);
    const c = new Color(color);
    this.cellColor.setXYZW(i, c.r, c.g, c.b, alpha);
    this.cellKind.setX(i, kind);
  }
  pushRange(range: RangeCell[], strong: boolean) {
    for (const r of range) {
      if (r.state === 'outOfRange') continue;
      if (r.state === 'occluded') this.pushCell(r.cellId, TACTICAL.rangeOccluded, strong ? 0.42 : 0.28, 1, 0.025);
      else this.pushCell(r.cellId, r.highGroundOnly ? TACTICAL.rangeHigh : TACTICAL.rangeVisible, strong ? (r.highGroundOnly ? 0.24 : 0.3) : 0.16, 0, 0.025);
    }
  }
  endCells() {
    this.cells.count = this.cellCount;
    this.cells.instanceMatrix.needsUpdate = true;
    this.cellColor.needsUpdate = true;
    this.cellKind.needsUpdate = true;
  }

  // ---------------- health bars ----------------
  setBars(items: { pos: Vector3; ratio: number; slowed: boolean; width: number }[]) {
    const n = Math.min(items.length, this.maxBars);
    for (let i = 0; i < n; i++) {
      const it = items[i]!;
      this.tmpM.makeTranslation(it.pos.x, it.pos.y, it.pos.z);
      this.bars.setMatrixAt(i, this.tmpM);
      this.barAttr.setXYZW(i, it.ratio, it.slowed ? 1 : 0, 1, it.width);
    }
    this.bars.count = n;
    this.bars.instanceMatrix.needsUpdate = true;
    this.barAttr.needsUpdate = true;
  }

  // ---------------- damage numbers ----------------
  spawnNumber(pos: Vector3, amount: number, color: number, scale = 1) {
    const digits = String(Math.max(0, Math.round(amount))).split('').map(Number);
    if (this.numPool.length >= this.maxNumbers) this.numPool.shift();
    this.numPool.push({ pos: pos.clone(), age: 0, digits, color: new Color(color), scale });
  }

  update(dt: number, enemyGhostScale = 1) {
    this.time += dt;
    this.uTime.value = this.time;
    if (this.sweep > 0) {
      this.sweep += dt * 18;
      let maxLen = 0;
      for (const r of this.routes.values()) { r.mat.uniforms.uSweep!.value = this.sweep; maxLen = Math.max(maxLen, r.length); }
      if (this.sweep > maxLen + 1) { this.sweep = 0; for (const r of this.routes.values()) r.mat.uniforms.uSweep!.value = -1; }
    }
    // numbers
    let k = 0;
    this.numPool = this.numPool.filter((n) => (n.age += dt / 0.7) < 1);
    for (const n of this.numPool) {
      const w = n.digits.length;
      n.digits.forEach((d, j) => {
        if (k >= this.maxNumbers * 4) return;
        this.tmpM.makeTranslation(n.pos.x, n.pos.y, n.pos.z);
        this.nums.setMatrixAt(k, this.tmpM);
        this.numAttr.setXYZW(k, d, j - (w - 1) / 2, n.age, n.scale);
        this.numCol.setXYZ(k, n.color.r, n.color.g, n.color.b);
        k++;
      });
    }
    this.nums.count = k;
    this.nums.instanceMatrix.needsUpdate = true;
    this.numAttr.needsUpdate = true;
    this.numCol.needsUpdate = true;
    // ghosts
    if (this.ghosts) {
      let g = 0;
      if (this.showGhosts && this.routeGroup.visible) {
        for (const path of this.ghostPaths) {
          for (let j = 0; j < 3; j++) {
            const d = ((this.time * 1.6 + j * 1.6) % (path.total + 2)) - 1;
            if (d < 0 || d > path.total) continue;
            let s = 1;
            while (s < path.len.length - 1 && path.len[s]! < d) s++;
            const a = path.pts[s - 1]!, b = path.pts[s]!;
            const t = (d - path.len[s - 1]!) / Math.max(1e-6, path.len[s]! - path.len[s - 1]!);
            this.o.position.lerpVectors(a, b, t);
            this.o.position.y += Math.abs(Math.sin(this.time * 7 + j)) * 0.08 - 0.05;
            this.o.rotation.set(0, Math.atan2(b.x - a.x, b.z - a.z), 0);
            const sq = 1 + Math.sin(this.time * 14 + j) * 0.06;
            this.o.scale.set(0.8 * enemyGhostScale / sq, 0.8 * enemyGhostScale * sq, 0.8 * enemyGhostScale / sq);
            this.o.updateMatrix();
            this.ghosts.setMatrixAt(g++, this.o.matrix);
          }
        }
      }
      this.ghosts.count = g;
      this.ghosts.instanceMatrix.needsUpdate = true;
    }
  }
}
