import {
  Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, Raycaster, Scene, Vector2, Vector3,
  Color, CanvasTexture, Sprite, SpriteMaterial, type BufferGeometry,
} from 'three';
import type { CellId, EnemyInstance, EnemyKind, GameEvent, GameState, LevelDef } from '../domain/types';
import { ENEMY_DEFS, LEVEL_RANGE_BONUS, TOWER_DEFS, isBurrowed, isEnraged } from '../domain/definitions';
import { HEIGHT_STEP_WORLD } from '../domain/types';
import type { PreviewInfo, RangeCell, SceneFeed } from '../presentation/feed';
import { RenderPipeline, QUALITY, type QualityLevel } from './render/pipeline';
import { CameraRig } from './camera/camera-rig';
import { Environment } from './environment/environment';
import { AmbientLife } from './environment/ambient-life';
import { Terrain } from './terrain/terrain';
import { TacticalOverlay } from './overlay/overlay';
import { Vfx } from './vfx/vfx';
import { TowerView, EnemyView, WallView, TrapView } from './entities';
import { CoreModel, PortalModel, bridgeGeometry } from './models/landmarks';
import { treeGeometry, rockGeometry, flowerGeometry, grassTuftGeometry, lanternGeometry, enemyGeometry } from './models/props';
import { createVoxelMaterial, sharedUniforms } from './materials/voxel-material';
import { TACTICAL, type PaletteKey } from './palette';

export interface SceneHooks {
  onCoins?(screen: { x: number; y: number }, amount: number): void;
  onCoreHit?(): void;
}

export interface SceneOptions {
  quality: QualityLevel;
  reducedMotion: boolean;
  screenShake: number;
  damageNumbers: boolean;
  colorblind: boolean;
  dynamicResolution: boolean;
  visualTest?: boolean;
}

const ENEMY_SHARDS: Record<string, PaletteKey[]> = {
  slime: ['slime', 'slimeLight', 'slimeDark'],
  runner: ['runner', 'runnerLight', 'runnerDark'],
  golem: ['golem', 'golemDark', 'golemMoss'],
  mini: ['jelly', 'jellyLight', 'jellyDark'],
  splitter: ['splitter', 'splitterLight', 'splitterDark'],
  knight: ['knight', 'knightDark', 'knightLight', 'ironLight'],
  wisp: ['wisp', 'wispDeep', 'wispLeaf'],
  boss: ['boss', 'bossDark', 'gold', 'bossLava'],
  boar: ['boar', 'boarDark', 'boarLight', 'tusk'],
  ghost: ['ghost', 'ghostDeep', 'ghostGlow'],
  crab: ['crab', 'crabDark', 'crabCrystal'],
  mole: ['mole', 'moleDark', 'claw'],
  salamander: ['salamander', 'salamanderDark', 'salamanderBelly', 'flame'],
  queen: ['queen', 'queenLight', 'queenDark', 'gold'],
  bat: ['bat', 'batDark', 'batWing'],
  yeti: ['yeti', 'yetiShade', 'yetiFace', 'horn'],
  shaman: ['shaman', 'shamanDark', 'shamanMask', 'shield'],
  frostGiant: ['frostGiant', 'frostGiantDark', 'ice', 'snow'],
  imp: ['imp', 'impDark', 'lava'],
  phoenix: ['phoenix', 'phoenixGold', 'phoenixDeep', 'lava'],
  wyvern: ['wyvern', 'wyvernDark', 'wyvernWing', 'wyvernBelly'],
  ram: ['ram', 'ramDark', 'ramWool', 'ramHorn'],
};
const BIG_KINDS = new Set<string>(['boss', 'queen', 'frostGiant', 'phoenix']);
const TOWER_SHARDS: Record<string, PaletteKey[]> = {
  arrow: ['wood', 'woodDark', 'plank', 'rock'],
  frost: ['crystal', 'stone', 'crystalLight', 'stoneDark'],
  cannon: ['rock', 'iron', 'rockLight', 'woodDark'],
  lightning: ['copper', 'iron', 'rock', 'volt'],
  wind: ['plank', 'sail', 'woodDark', 'rock'],
};

/**
 * Scene orchestration + Presentation Director (Tech §9.8). Reads SceneFeed snapshots and
 * reacts to GameEvents; never mutates simulation state.
 */
export class SceneApp {
  readonly scene = new Scene();
  readonly pipeline: RenderPipeline;
  readonly rig: CameraRig;
  readonly env: Environment;
  readonly ambient: AmbientLife;
  readonly terrain: Terrain;
  readonly overlay: TacticalOverlay;
  readonly vfx: Vfx;
  private core: CoreModel;
  private portals = new Map<string, PortalModel>();
  private towers = new Map<string, TowerView>();
  private walls = new Map<string, WallView>();
  private traps = new Map<string, TrapView>();
  private bridgeDecks = new Map<string, Mesh>();
  private enemies = new Map<string, EnemyView>();
  private dying = new Set<string>();
  private pickMesh: InstancedMesh;
  private pickIds: CellId[] = [];
  private raycaster = new Raycaster();
  private decor = new Group();
  private flowerMeshes: InstancedMesh[] = [];
  private flowerCells: { cellId: CellId; meshIdx: number; inst: number; dx: number; dz: number; rot: number; s: number }[] = [];
  private level: LevelDef;
  private preview: PreviewInfo | null = null;
  private selection: { type: 'tower' | 'wall' | 'cell'; id: string } | null = null;
  private hoverCell: CellId | null = null;
  private showAll = false;
  private illegalFlash = { cells: [] as CellId[], t: 0 };
  private impactQueue: { at: number; fn: () => void }[] = [];
  private renderTime = 0;
  private opts: SceneOptions;
  private blockedSprites = new Map<string, Sprite>();
  private blockedTex: CanvasTexture;
  private leakTrails: { cells: CellId[]; t: number }[] = [];
  private lastRoutesKey = '';
  private introT = -1;
  private stats = { fps: 60, ms: 16 };
  hooks: SceneHooks = {};
  private width = 1;
  private height = 1;

  constructor(private canvas: HTMLCanvasElement, private feed: SceneFeed, opts: SceneOptions) {
    this.opts = opts;
    this.level = feed.level;
    const center = new Vector3(feed.level.width / 2, 0.5, feed.level.depth / 2 - 0.5);
    this.rig = new CameraRig(center, { minX: 1, maxX: feed.level.width - 1, minZ: 2, maxZ: feed.level.depth - 2 });
    this.overlay = new TacticalOverlay(feed.level, (id) => this.cellWorld(id));
    this.pipeline = new RenderPipeline(canvas, this.scene, this.rig.camera, this.overlay.scene);
    this.env = new Environment({ center, extent: Math.max(feed.level.width, feed.level.depth), theme: feed.level.theme });
    this.scene.add(this.env.group);
    this.scene.environment = this.env.buildEnvMap(this.pipeline.renderer);
    this.scene.environmentIntensity = 0.55;
    this.ambient = new AmbientLife({ level: feed.level, center, groundAt: (x, z) => this.groundAt(x, z) });
    this.scene.add(this.ambient.group);

    this.terrain = new Terrain({ level: feed.level, elevationOf: (id) => feed.elevationOf(id) });
    for (const m of this.terrain.group.children) m.layers.enable(RenderPipeline.DEPTH_LAYER);
    this.scene.add(this.terrain.group);

    this.vfx = new Vfx(QUALITY[opts.quality].particles);
    this.vfx.groundAt = (x, z) => this.groundAt(x, z);
    this.vfx.attach(this.scene);

    this.buildBridges();
    this.core = new CoreModel();
    const coreCells = feed.level.core.footprintCellIds.map((id) => this.cellWorld(id));
    const cc = coreCells.reduce((a, b) => a.add(b), new Vector3()).multiplyScalar(1 / coreCells.length);
    this.core.group.position.copy(cc);
    this.scene.add(this.core.group);
    for (const p of feed.level.portals) {
      const pm = new PortalModel(p.id === 'B' ? 'B' : 'A');
      const pos = this.cellWorld(p.cellId);
      pm.group.position.copy(pos);
      // face along the first step of its route
      const r = feed.routes()[p.id];
      if (r && r[1]) {
        const n = this.cellWorld(r[1]);
        pm.group.rotation.y = Math.atan2(n.x - pos.x, n.z - pos.z);
      }
      this.scene.add(pm.group);
      this.portals.set(p.id, pm);
    }
    this.buildDecor();
    this.scene.add(this.decor);

    // picking quads (one per surface cell)
    const plane = new PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    this.pickMesh = new InstancedMesh(plane, new MeshBasicMaterial({ visible: false }), feed.level.cells.length);
    this.pickIds = feed.level.cells.map((c) => c.id);
    this.updatePickMesh();
    this.scene.add(this.pickMesh);

    this.overlay.setGhostGeometry(enemyGeometry('slime').body);
    this.overlay.colorblind = opts.colorblind;
    this.blockedTex = this.makeBlockedIcon();

    this.applyOptions(opts);
    this.syncEntities(false);
    this.refreshRoutes(false);
  }

  // ---------------------------------------------------------------- setup helpers
  cellWorld(id: CellId): Vector3 {
    const c = this.level.cells.find((x) => x.id === id);
    if (!c) return new Vector3();
    const y = this.feed.elevationOf(id) * HEIGHT_STEP_WORLD + (c.kind === 'ground' ? 0 : 0.06);
    return new Vector3(c.pos.x + 0.5, y, c.pos.z + 0.5);
  }
  private cellIndex = new Map<string, CellId>();
  private groundAt(x: number, z: number): number {
    if (!this.cellIndex.size) for (const c of this.level.cells) this.cellIndex.set(`${c.pos.x},${c.pos.z}`, c.id);
    const id = this.cellIndex.get(`${Math.floor(x)},${Math.floor(z)}`);
    return id ? this.feed.elevationOf(id) * HEIGHT_STEP_WORLD : -60;
  }

  private buildBridges() {
    const deckMat = createVoxelMaterial({ bevel: 0.012 });
    const lantern = lanternGeometry();
    const lanternGlow = createVoxelMaterial({ emissiveStrength: 3.2 });
    this.level.connectors.forEach((con, i) => {
      const pts = con.chain.map((id) => {
        const c = this.level.cells.find((x) => x.id === id)!;
        return { x: c.pos.x + 0.5, y: c.elevation * HEIGHT_STEP_WORLD, z: c.pos.z + 0.5 };
      });
      const b = bridgeGeometry(pts, i === 0 ? 'wood' : 'stoneWood');
      const mesh = new Mesh(b.deck, deckMat);
      const mid = { x: (pts[0]!.x + pts[pts.length - 1]!.x) / 2, z: (pts[0]!.z + pts[pts.length - 1]!.z) / 2 };
      mesh.position.set(mid.x, b.baseY + 0.0625, mid.z);
      mesh.rotation.y = Math.atan2(b.dir[0], b.dir[1]) - Math.PI / 2;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.layers.enable(RenderPipeline.DEPTH_LAYER);
      this.scene.add(mesh);
      this.bridgeDecks.set(con.id, mesh);
      // lanterns at both ends, beside the deck
      for (const end of [pts[0]!, pts[pts.length - 1]!]) {
        for (const side of [-0.62, 0.62]) {
          const g = new Group();
          g.add(new Mesh(lantern.post, deckMat), new Mesh(lantern.light, lanternGlow));
          g.position.set(end.x - b.dir[1] * side, end.y, end.z + b.dir[0] * side);
          g.children[0]!.castShadow = true;
          this.scene.add(g);
        }
      }
    });
  }

  private buildDecor() {
    const density = QUALITY[this.opts.quality].decorDensity;
    const trunkMat = createVoxelMaterial({ bevel: 0.01 });
    const leafMat = createVoxelMaterial({ bevel: 0.012, wind: { base: 0.2, strength: 0.025 } });
    const rockMat = createVoxelMaterial({ bevel: 0.012 });
    const decor = this.level.decor;
    const theme = this.level.theme ?? 'day';
    decor?.trees.forEach((t, i) => {
      const id = `c${t.x}_${t.z}`;
      const geo = treeGeometry(i, theme === 'snow' ? 'snow' : theme === 'ember' ? 'autumn' : 'green');
      const g = new Group();
      const trunk = new Mesh(geo.trunk, trunkMat);
      const leaves = new Mesh(geo.leaves, leafMat);
      trunk.castShadow = leaves.castShadow = true;
      trunk.receiveShadow = leaves.receiveShadow = true;
      g.add(trunk, leaves);
      const p = this.cellWorld(id);
      g.position.copy(p);
      g.rotation.y = (i * 1.7) % 6.28;
      g.scale.setScalar(1.1 + (i % 3) * 0.12);
      this.decor.add(g);
    });
    decor?.rocks.forEach((r, i) => {
      const m = new Mesh(rockGeometry(i), rockMat);
      m.position.copy(this.cellWorld(`c${r.x}_${r.z}`));
      m.rotation.y = i * 2.1;
      m.castShadow = true; m.receiveShadow = true;
      this.decor.add(m);
    });
    // flowers & grass tufts scattered on grass cells (purely decorative, tiny)
    // snowfields get frosty tufts and pale blooms; volcanic ash gets ember sprouts
    const geos: BufferGeometry[] = theme === 'snow'
      ? [grassTuftGeometry(['snowShade', 'snowLight', 'pine']), grassTuftGeometry(['ice', 'snowLight', 'snowShade']), flowerGeometry('flowerW'), flowerGeometry('flowerV'), grassTuftGeometry(['pine', 'snow', 'pineDark'])]
      : theme === 'ember'
        ? [grassTuftGeometry(['ashLight', 'ashDark', 'autumnDark']), grassTuftGeometry(['autumn', 'autumnLight', 'autumnDark']), flowerGeometry('flowerY'), grassTuftGeometry(['lava', 'autumnLight', 'ashDark']), grassTuftGeometry(['ashDark', 'ash', 'autumn'])]
        : [grassTuftGeometry(), flowerGeometry('flowerY'), flowerGeometry('flowerP'), flowerGeometry('flowerW'), flowerGeometry('flowerV')];
    const counts = geos.map(() => 0);
    const picks: typeof this.flowerCells = [];
    const hash = (a: number, b: number) => { const h = Math.sin(a * 91.7 + b * 47.3) * 43758.5453; return h - Math.floor(h); };
    for (const c of this.level.cells) {
      if (c.kind !== 'ground' || c.terrain !== 'grass') continue;
      for (let k = 0; k < 3; k++) {
        const h = hash(c.pos.x * 3 + k, c.pos.z * 7 - k);
        if (h > 0.55 * density) continue;
        const mi = h < 0.32 * density ? 0 : 1 + Math.floor(hash(c.pos.x, c.pos.z + k) * 4);
        picks.push({ cellId: c.id, meshIdx: mi, inst: counts[mi]!++, dx: hash(k, c.pos.x) * 0.8 + 0.1, dz: hash(c.pos.z, k) * 0.8 + 0.1, rot: h * 6.28, s: 0.8 + hash(k + 3, c.pos.x + c.pos.z) * 0.6 });
      }
    }
    const flowerMat = createVoxelMaterial({ bevel: 0, wind: { base: 0.02, strength: 0.06 } });
    this.flowerMeshes = geos.map((g, i) => {
      const m = new InstancedMesh(g, flowerMat, Math.max(1, counts[i]!));
      m.receiveShadow = true;
      this.decor.add(m);
      return m;
    });
    this.flowerCells = picks;
    this.updateFlowers();
  }

  private updateFlowers() {
    const o = new Object3D();
    const occupied = new Set<string>();
    for (const t of this.feed.state.towers) t.footprintCellIds.forEach((c) => occupied.add(c));
    for (const w of this.feed.state.walls) occupied.add(w.cellId);
    for (const f of this.flowerCells) {
      const c = this.level.cells.find((x) => x.id === f.cellId)!;
      const y = this.feed.elevationOf(f.cellId) * HEIGHT_STEP_WORLD;
      o.position.set(c.pos.x + f.dx, y, c.pos.z + f.dz);
      o.rotation.set(0, f.rot, 0);
      o.scale.setScalar(occupied.has(f.cellId) ? 0 : f.s);
      o.updateMatrix();
      this.flowerMeshes[f.meshIdx]!.setMatrixAt(f.inst, o.matrix);
    }
    for (const m of this.flowerMeshes) m.instanceMatrix.needsUpdate = true;
  }

  private updatePickMesh() {
    const o = new Object3D();
    this.pickIds.forEach((id, i) => {
      o.position.copy(this.cellWorld(id));
      o.updateMatrix();
      this.pickMesh.setMatrixAt(i, o.matrix);
    });
    this.pickMesh.instanceMatrix.needsUpdate = true;
    this.pickMesh.computeBoundingSphere();
  }

  private makeBlockedIcon(): CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d')!;
    g.fillStyle = 'rgba(20,24,36,0.85)';
    g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = 4;
    g.beginPath(); g.ellipse(32, 32, 18, 10, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(32, 32, 5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ff5a5a'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(14, 50); g.lineTo(50, 14); g.stroke();
    return new CanvasTexture(cv);
  }

  // ---------------------------------------------------------------- options
  private ambientConfigured = false;
  applyOptions(o: Partial<SceneOptions>) {
    this.opts = { ...this.opts, ...o };
    const p = QUALITY[this.opts.quality];
    if (o.quality !== undefined || !this.pipeline.composer) {
      this.pipeline.setQuality(this.opts.quality);
      this.env.setShadowSize(p.shadowSize);
      this.env.setCloudLayers(p.cloudLayers);
      this.vfx.setCapacity(p.particles);
    }
    if (o.quality !== undefined || o.reducedMotion !== undefined || !this.ambientConfigured) {
      this.ambientConfigured = true;
      const q = this.opts.quality;
      this.ambient.configure({ birds: q === 'low' ? 1 : 2, particles: q === 'low' ? 0 : q === 'medium' ? 50 : q === 'high' ? 90 : 130, reducedMotion: this.opts.reducedMotion });
    }
    sharedUniforms.uWind.value = p.wind && !this.opts.reducedMotion ? 1 : 0;
    sharedUniforms.uRuneAnimate.value = p.runeAnimate && !this.opts.reducedMotion ? 1 : 0;
    this.rig.shakeScale = this.opts.reducedMotion ? 0 : this.opts.screenShake;
    this.pipeline.dynamicResolution = this.opts.dynamicResolution;
    this.vfx.reducedMotion = this.opts.reducedMotion;
    this.overlay.colorblind = this.opts.colorblind;
  }

  resize(w: number, h: number) {
    this.width = w; this.height = h;
    this.rig.setAspect(w / Math.max(1, h));
    this.pipeline.resize(w, h);
  }

  // ---------------------------------------------------------------- interaction
  pick(clientX: number, clientY: number): { cellId: CellId | null; towerId: string | null; wallId: string | null } {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    // towers first (their bodies are tall and should win)
    let towerId: string | null = null;
    let wallId: string | null = null;
    let best = Infinity;
    for (const t of this.towers.values()) {
      const hit = this.raycaster.intersectObject(t.group, true)[0];
      if (hit && hit.distance < best) { best = hit.distance; towerId = t.id; }
    }
    for (const w of this.walls.values()) {
      const hit = this.raycaster.intersectObject(w.group, true)[0];
      if (hit && hit.distance < best) { best = hit.distance; wallId = w.id; towerId = null; }
    }
    // terrain occlusion: a cell quad only counts if no terrain face is clearly in front of it
    const terrainHit = this.raycaster.intersectObjects(this.terrain.group.children, false)[0];
    const hits = this.raycaster.intersectObject(this.pickMesh, false);
    let cellId: CellId | null = null;
    for (const h of hits) {
      if (h.instanceId === undefined) continue;
      if (terrainHit && h.distance > terrainHit.distance + 0.08) continue;
      cellId = this.pickIds[h.instanceId] ?? null;
      if (cellId && h.distance < best) { /* cell in front of tower */ }
      break;
    }
    if (!cellId && terrainHit && terrainHit.face && terrainHit.face.normal.y < 0.5) {
      // clicked a cliff side: choose the cell whose column was hit (top of that column)
      const p = terrainHit.point.clone().addScaledVector(terrainHit.face.normal, -0.05);
      cellId = this.cellIndex.get(`${Math.floor(p.x)},${Math.floor(p.z)}`) ?? null;
    }
    return { cellId, towerId, wallId };
  }

  setPreview(p: PreviewInfo | null) {
    this.preview = p;
    const routes = p?.ok && p.routes ? p.routes : this.feed.routes();
    this.applyRoutes(routes, false);
  }
  setSelection(s: { type: 'tower' | 'wall' | 'cell'; id: string } | null) { this.selection = s; }
  setHover(cellId: CellId | null) { this.hoverCell = cellId; }
  setShowAllRanges(v: boolean) { this.showAll = v; }
  /** Editable-rune emphasis: 0 hidden (combat), ~0.3 idle, 1 while a terrain tool is held. */
  runeTarget = 0.3;
  setRuneEmphasis(v: number) { this.runeTarget = v; }
  snapRune() { sharedUniforms.uRuneVis.value = this.runeTarget; }
  flashIllegal(cells: CellId[]) { this.illegalFlash = { cells, t: 0.45 }; }

  private applyRoutes(routes: Record<string, CellId[]>, sweep: boolean) {
    const key = JSON.stringify(routes);
    if (key === this.lastRoutesKey && !sweep) return;
    const changed = key !== this.lastRoutesKey;
    this.lastRoutesKey = key;
    this.overlay.setRoutes(routes, sweep && changed);
  }
  private nextWaveHasFlyers(): boolean {
    const w = this.level.waves[this.feed.state.currentWaveIndex];
    return !!w && w.entries.some((e) => ENEMY_DEFS[e.enemyKind].flying);
  }
  refreshRoutes(sweep: boolean) { this.applyRoutes(this.preview?.ok && this.preview.routes ? this.preview.routes : this.feed.routes(), sweep); }

  worldToScreen(p: Vector3): { x: number; y: number; visible: boolean } {
    const v = p.clone().project(this.rig.camera);
    return { x: (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height, visible: v.z < 1 && v.z > -1 };
  }
  portalScreen(id: string) {
    const p = this.level.portals.find((x) => x.id === id);
    if (!p) return null;
    return this.worldToScreen(this.cellWorld(p.cellId).add(new Vector3(0, 2.6, 0)));
  }
  towerScreen(id: string) {
    const t = this.towers.get(id);
    return t ? this.worldToScreen(t.group.position.clone().add(new Vector3(0, 2.4, 0))) : null;
  }

  /** Intro camera tour (GDD §10.3): orbit + zoom, skippable (no tilt-shift blur: the board must stay sharp). */
  playIntro() { this.introT = 0; this.rig.zoomIndex = CameraRig.INTRO_ZOOM_INDEX; this.rig.snapZoom(); }
  skipIntro() { if (this.introT >= 0) { this.introT = -1; this.rig.zoomIndex = CameraRig.DEFAULT_ZOOM_INDEX; this.rig.snapZoom(); } }
  get introPlaying() { return this.introT >= 0; }

  // ---------------------------------------------------------------- entity sync
  private towerCenter(anchorCellId: CellId): Vector3 {
    return this.cellWorld(anchorCellId).add(new Vector3(0.5, 0, 0.5));
  }
  syncEntities(animate: boolean) {
    const s = this.feed.state;
    const seen = new Set<string>();
    for (const t of s.towers) {
      seen.add(t.id);
      let v = this.towers.get(t.id);
      if (!v) {
        v = new TowerView(t.id, t.kind, this.towerCenter(t.anchorCellId), t.level, animate);
        this.scene.add(v.group);
        this.towers.set(t.id, v);
        if (animate) this.vfx.dust(v.group.position, 1.4, 22);
      } else if (v.level !== t.level) v.setLevel(t.level, animate);
    }
    for (const [id, v] of this.towers) if (!seen.has(id)) { this.scene.remove(v.group); this.towers.delete(id); }
    const wseen = new Set<string>();
    for (const w of s.walls) {
      wseen.add(w.id);
      if (!this.walls.has(w.id)) {
        const v = new WallView(w.id, w.cellId, this.cellWorld(w.cellId), animate);
        this.scene.add(v.group);
        this.walls.set(w.id, v);
      }
    }
    for (const [id, v] of this.walls) if (!wseen.has(id)) { this.scene.remove(v.group); this.walls.delete(id); }
    const pseen = new Set<string>();
    for (const t of s.traps ?? []) {
      pseen.add(t.id);
      if (!this.traps.has(t.id)) {
        const v = new TrapView(t.id, t.cellId, this.cellWorld(t.cellId));
        this.scene.add(v.group);
        this.traps.set(t.id, v);
      }
    }
    for (const [id, v] of this.traps) if (!pseen.has(id)) { this.scene.remove(v.group); this.traps.delete(id); }
    const broken = new Set(s.brokenConnectors ?? []);
    for (const [id, m] of this.bridgeDecks) m.visible = !broken.has(id);
    this.updateFlowers();
  }

  /** Splinters falling off a bridge deck (collapse) or settling onto it (repair). */
  private bridgeBurst(connectorId: string, collapse: boolean) {
    const con = this.level.connectors.find((c) => c.id === connectorId);
    if (!con) return;
    for (const id of con.chain) {
      const p = this.cellWorld(id);
      if (collapse) this.vfx.shatter(p.clone().add(new Vector3(0, 0.1, 0)), ['wood', 'woodDark', 'plank'], 10, { speed: 1.2, up: 1.4 });
      else this.vfx.dust(p, 0.8, 8, 'path');
    }
    if (collapse) this.rig.addTrauma(0.12);
  }

  private resyncTerrain(animate: boolean) {
    this.terrain.syncAll(animate);
    this.updatePickMesh();
    this.updateFlowers();
    for (const w of this.walls.values()) w.setY(this.cellWorld(w.cellId).y);
    for (const t of this.traps.values()) t.setY(this.cellWorld(t.cellId).y);
  }

  // ---------------------------------------------------------------- director
  private screenOf(p: Vector3) { const s = this.worldToScreen(p); return { x: s.x, y: s.y }; }

  private enemyWorld(e: Pick<EnemyInstance, 'pathNodeIds' | 'edgeIndex' | 'segmentProgress' | 'kind'>, out: Vector3): Vector3 {
    const last = e.pathNodeIds.length - 1;
    const i = Math.min(e.edgeIndex, last);
    const j = Math.min(i + 1, last);
    const a = this.cellWorld(e.pathNodeIds[i]!);
    const b = this.cellWorld(e.pathNodeIds[j]!);
    out.lerpVectors(a, b, i === j ? 0 : e.segmentProgress);
    // flyers cruise high above the island; they dip down onto the last stretch before the core
    const alt = ENEMY_DEFS[e.kind].flying?.altitudeWorld;
    if (alt) out.y += alt * (i === j ? 0.35 : 1 - Math.max(0, e.segmentProgress - 0.85) / 0.15 * 0.65);
    return out;
  }

  private queue(delaySec: number, fn: () => void) { this.impactQueue.push({ at: this.renderTime + delaySec, fn }); }

  handleEvents(events: GameEvent[], ctx: { state: GameState; prev: GameState; fromUndo: boolean; fromLoad: boolean }) {
    const reduced = this.opts.reducedMotion;
    let needSync = false;
    let routesChanged = false;
    const speed = this.feed.flags.speed;
    for (const e of events) {
      switch (e.type) {
        case 'TERRAIN_CHANGED': {
          this.terrain.setElevation(e.cellId, e.from, e.to, !reduced);
          this.updatePickMesh();
          const p = this.cellWorld(e.cellId);
          this.vfx.dust(p, 1, 14, e.to > e.from ? 'dirt' : 'path');
          this.vfx.shatter(p.clone().add(new Vector3(0, -0.2, 0)), ['dirt', 'rock', 'grassDark'], 8, { speed: 1.2, up: 1.2, size: 0.07 });
          break;
        }
        case 'TRAP_PLACED': case 'TRAP_REMOVED':
          needSync = true;
          if (e.type === 'TRAP_PLACED') this.vfx.dust(this.cellWorld(e.cellId), 0.6, 8, 'path');
          break;
        case 'TRAP_TRIGGERED': {
          const v = this.traps.get(e.trapId);
          if (v) { v.trigger(); if (!reduced) this.vfx.sparks(v.group.position.clone().add(new Vector3(0, 0.25, 0)), 'trapSpike', 8, { speed: 1.4, up: 1.6, life: 0.3, size: 0.04 }); }
          break;
        }
        case 'WALL_DESTROYED': {
          needSync = true;
          const p = this.cellWorld(e.cellId);
          this.vfx.shatter(p.clone().add(new Vector3(0, 0.4, 0)), ['wood', 'woodDark', 'woodLight', 'rock'], 30, { speed: 2.6, up: 2.6 });
          this.vfx.dust(p, 1.1, 16, 'rock');
          this.rig.addTrauma(0.2);
          break;
        }
        case 'BRIDGE_COLLAPSED': case 'BRIDGE_REPAIRED':
          needSync = true; routesChanged = true;
          this.bridgeBurst(e.connectorId, e.type === 'BRIDGE_COLLAPSED');
          break;
        case 'WALL_PLACED': case 'WALL_REMOVED': case 'TOWER_BUILT': case 'TOWER_UPGRADED': needSync = true;
          if (e.type === 'TOWER_UPGRADED') {
            const v = this.towers.get(e.towerId);
            if (v) this.vfx.sparks(v.group.position.clone().add(new Vector3(0, 1, 0)), 'gold', 24, { speed: 1.5, up: 2.5 });
          }
          if (e.type === 'WALL_REMOVED') {
            const p = this.cellWorld(e.cellId);
            this.vfx.shatter(p.add(new Vector3(0, 0.3, 0)), ['wood', 'woodDark', 'rock'], 16, { speed: 1.6 });
          }
          break;
        case 'TOWER_SOLD': {
          const v = this.towers.get(e.towerId);
          if (v) {
            const p = v.group.position.clone().add(new Vector3(0, 0.8, 0));
            this.vfx.shatter(p, TOWER_SHARDS[e.kind]!, 40, { speed: 2, up: 3 });
            this.vfx.sparks(p, 'gold', 20, { speed: 2 });
            this.hooks.onCoins?.(this.screenOf(p), 0);
          }
          needSync = true;
          break;
        }
        case 'ROUTES_CHANGED': routesChanged = true; break;
        case 'UNDO_APPLIED': needSync = true; break;
        case 'PHASE_CHANGED':
          if (e.to === 'COMBAT') this.vfx.flush();
          if (e.to === 'VICTORY') this.rig.setOrbit(!reduced, 0.15);
          if (e.to === 'PREPARE') { this.rig.setOrbit(false); this.leakTrails = []; }
          if (e.to === 'WAVE_RESULT' || e.to === 'DEFEAT') this.vfx.flush();
          routesChanged = true;
          break;
        case 'WAVE_STARTED':
          for (const p of this.portals.values()) p.pulse();
          for (const p of this.level.portals) this.vfx.ring(this.cellWorld(p.cellId), 2.2, 'portalLight', 0.7);
          break;
        case 'WAVE_CLEARED': {
          const c = this.core.group.position.clone().add(new Vector3(0, 1.5, 0));
          this.vfx.sparks(c, 'gold', 60, { speed: 1.2, up: 5, gravity: -1.5, life: 1.6, size: 0.08 });
          break;
        }
        case 'ENEMY_SPAWNED': {
          const p = this.level.portals.find((x) => x.id === e.portalId);
          if (p) this.vfx.sparks(this.cellWorld(p.cellId).add(new Vector3(0, 0.6, 0)), 'portalLight', 10, { speed: 1.2 });
          break;
        }
        case 'TOWER_FIRED': {
          const t = this.towers.get(e.towerId);
          const enemy = ctx.state.enemies.find((x) => x.id === e.targetId) ?? ctx.prev.enemies.find((x) => x.id === e.targetId);
          if (!t || !enemy) break;
          const ev = this.enemies.get(e.targetId);
          const target = this.enemyWorld(enemy, new Vector3()).add(new Vector3(0, (ev?.height ?? 0.6) * 0.55, 0));
          t.aimAt(target);
          t.fire();
          const muzzle = t.muzzleWorld(new Vector3());
          const dur = e.travelTicks / 20 / speed;
          if (t.kind === 'lightning' || t.kind === 'wind') break; // drawn by LIGHTNING_CHAINED / WIND_GUST
          this.vfx.projectile(t.kind, muzzle, target, dur);
          if (t.kind === 'cannon') { this.vfx.smoke(muzzle, 5); this.vfx.ring(t.group.position, 1.1, 'stoneLight', 0.3); }
          if (t.kind === 'frost') this.vfx.sparks(muzzle, 'crystalLight', 6, { speed: 0.8 });
          break;
        }
        case 'TOWER_BLOCKED': {
          const t = this.towers.get(e.towerId);
          if (t) t.blockedT = 1.1;
          break;
        }
        case 'ENEMY_DAMAGED': {
          const delay = this.travelDelay(e.sourceTowerId, ctx.state);
          const enemy = ctx.state.enemies.find((x) => x.id === e.enemyId) ?? ctx.prev.enemies.find((x) => x.id === e.enemyId);
          const pos = enemy ? this.enemyWorld(enemy, new Vector3()) : null;
          const resisted = e.resisted; const amount = e.amount; const id = e.enemyId; const hpAfter = e.hpAfter;
          const kind = enemy?.kind;
          this.queue(delay, () => {
            const v = this.enemies.get(id);
            const at = v ? v.group.position.clone() : pos;
            if (v) { v.hit(); v.hpRatio = hpAfter / (enemy?.maxHp ?? this.maxHp(kind)); }
            if (!at) return;
            const top = at.clone().add(new Vector3(0, (v?.height ?? 0.6) + 0.15, 0));
            if (this.opts.damageNumbers) this.overlay.spawnNumber(top, amount, resisted ? 0xd8dde8 : 0xffe28a, resisted ? 0.85 : 1);
            if (resisted) this.vfx.sparks(at.clone().add(new Vector3(0, 0.5, 0)), 'lantern', 6, { speed: 1.6, size: 0.04 });
            else this.vfx.shatter(at.clone().add(new Vector3(0, 0.4, 0)), ['plank', 'woodLight'], 3, { speed: 1, size: 0.04, life: 0.5 });
          });
          break;
        }
        case 'ENEMY_SLOWED': {
          const id = e.enemyId;
          this.queue(this.travelDelayById(id, ctx.state), () => {
            const v = this.enemies.get(id);
            if (v) this.vfx.sparks(v.group.position.clone().add(new Vector3(0, 0.4, 0)), 'crystalLight', 10, { speed: 0.9, up: 1 });
          });
          break;
        }
        case 'ENEMY_REBORN': {
          const v = this.enemies.get(e.enemyId);
          if (v) {
            const p = v.group.position.clone().add(new Vector3(0, v.height * 0.5, 0));
            this.vfx.sparks(p, new Color(4, 1.8, 0.4), 40, { speed: 2.4, up: 2.6, life: 0.6, size: 0.1 });
            this.vfx.ring(v.group.position.clone(), 1.6, 'lantern', 0.5);
            this.rig.addTrauma(0.25);
            v.hit();
          }
          break;
        }
        case 'ENEMY_HEALED': {
          const v = this.enemies.get(e.enemyId);
          if (v && !reduced) this.vfx.sparks(v.group.position.clone().add(new Vector3(0, v.height * 0.7, 0)), 'wisp', 5, { speed: 0.6, up: 1.4 });
          break;
        }
        case 'CANNON_EXPLODED': {
          const at = new Vector3(e.at.x, e.at.y, e.at.z);
          const delay = this.travelDelay(e.towerId, ctx.state);
          this.queue(delay, () => {
            this.vfx.sparks(at, new Color(4, 1.6, 0.4), 30, { speed: 2.6, up: 2, life: 0.45, size: 0.09 });
            this.vfx.shatter(at, ['rock', 'rockDark', 'dirt'], 14, { speed: 2.2, up: 3 });
            this.vfx.smoke(at, 6);
            const g = this.groundAt(at.x, at.z);
            if (g > -50) this.vfx.scorch(new Vector3(at.x, g, at.z));
            this.vfx.ring(new Vector3(at.x, g, at.z), 1.1, 'lantern', 0.35);
            this.rig.addTrauma(0.12);
          });
          break;
        }
        case 'LIGHTNING_CHAINED': {
          const t = this.towers.get(e.towerId);
          const pts = e.points.map((p) => new Vector3(p.x, p.y, p.z));
          if (t && pts.length) pts[0] = t.group.position.clone().add(new Vector3(0, t.headY, 0));
          this.vfx.bolt(pts);
          for (let i = 1; i < pts.length; i++) this.vfx.sparks(pts[i]!, 'volt', reduced ? 3 : 8, { speed: 1.8, up: 1.2, life: 0.3, size: 0.05 });
          break;
        }
        case 'WIND_GUST': {
          const t = this.towers.get(e.towerId);
          if (!t) break;
          const tw = ctx.state.towers.find((x) => x.id === e.towerId);
          const r = TOWER_DEFS.wind.baseRangeWorld + (tw ? LEVEL_RANGE_BONUS[tw.level] : 0);
          this.vfx.gust(t.group.position, r, reduced ? 10 : 26);
          this.vfx.ring(t.group.position, r, 'cloud', 0.45);
          break;
        }
        case 'ENEMY_KNOCKED_BACK': {
          const id = e.enemyId;
          this.queue(0.1 / speed, () => {
            const v = this.enemies.get(id);
            if (v) this.vfx.dust(v.group.position.clone(), 0.5, reduced ? 4 : 10, 'cloud');
          });
          break;
        }
        case 'ENEMY_KILLED': {
          const id = e.enemyId; const kind = e.kind; const gold = e.gold;
          this.dying.add(id);
          this.queue(this.travelDelay(e.killerTowerId, ctx.state), () => {
            const v = this.enemies.get(id);
            if (v) {
              const p = v.group.position.clone().add(new Vector3(0, v.height * 0.5, 0));
              this.vfx.shatter(p, ENEMY_SHARDS[kind]!, BIG_KINDS.has(kind) ? 80 : kind === 'golem' || kind === 'crab' ? 34 : kind === 'mini' ? 10 : 22, { speed: kind === 'runner' ? 3 : 2.2, up: 2.8 });
              if (BIG_KINDS.has(kind)) this.rig.addTrauma(0.4);
              this.vfx.sparks(p, 'gold', 6, { speed: 1.2, up: 2 });
              this.hooks.onCoins?.(this.screenOf(p), gold);
              this.scene.remove(v.group);
              this.enemies.delete(id);
            }
            this.dying.delete(id);
          });
          break;
        }
        case 'ENEMY_REACHED_CORE': {
          const v = this.enemies.get(e.enemyId);
          if (v) {
            this.vfx.sparks(v.group.position.clone().add(new Vector3(0, 0.4, 0)), 'portal', 16, { speed: 1.5 });
            this.scene.remove(v.group);
            this.enemies.delete(e.enemyId);
          }
          this.leakTrails.push({ cells: e.lastNodeIds, t: 6 });
          break;
        }
        case 'CORE_DAMAGED':
          this.core.hitFlash(reduced);
          this.core.setHp(e.hpAfter);
          this.vfx.ring(this.core.group.position, 3.2, 'cloth', 0.6);
          this.vfx.sparks(this.core.group.position.clone().add(new Vector3(0, 1.5, 0)), 'core', 18, { speed: 2.4 });
          this.rig.addTrauma(0.35);
          this.hooks.onCoreHit?.();
          break;
        case 'DEFEAT':
          this.vfx.shatter(this.core.group.position.clone().add(new Vector3(0, 1.5, 0)), ['core', 'crystal', 'crystalLight', 'stone'], 60, { speed: 3.5, up: 4 });
          this.rig.addTrauma(0.6);
          break;
        case 'VICTORY':
          this.vfx.sparks(this.core.group.position.clone().add(new Vector3(0, 1.5, 0)), 'gold', 90, { speed: 2, up: 6, gravity: -0.8, life: 2 });
          break;
        default: break;
      }
    }
    if (ctx.fromUndo || ctx.fromLoad) { this.resyncTerrain(!reduced && ctx.fromUndo); needSync = true; this.core.setHp(ctx.state.coreHp); }
    if (ctx.fromLoad) { for (const v of this.enemies.values()) this.scene.remove(v.group); this.enemies.clear(); this.towers.forEach((v) => this.scene.remove(v.group)); this.towers.clear(); this.walls.forEach((v) => this.scene.remove(v.group)); this.walls.clear(); this.traps.forEach((v) => this.scene.remove(v.group)); this.traps.clear(); }
    if (needSync) this.syncEntities(!ctx.fromLoad);
    if (routesChanged) this.refreshRoutes(true);
  }

  private maxHp(kind?: EnemyKind) { return kind ? ENEMY_DEFS[kind].hp : 60; }
  private travelDelay(towerId: string, s: GameState): number {
    const t = s.towers.find((x) => x.id === towerId);
    const ticks = t ? TOWER_DEFS[t.kind].projectileTicks : 4;
    return ticks / 20 / this.feed.flags.speed;
  }
  private travelDelayById(_enemyId: string, _s: GameState) { return 5 / 20 / this.feed.flags.speed; }

  // ---------------------------------------------------------------- frame
  frame(dtReal: number, frameMs: number, now: number) {
    const paused = this.feed.flags.paused;
    const speed = this.feed.flags.speed;
    const vt = this.opts.visualTest;
    const dtEnv = vt ? 0 : dtReal;
    const dtGame = vt ? 0 : paused ? 0 : dtReal * speed;
    this.renderTime += dtGame;
    sharedUniforms.uTime.value += dtEnv;
    this.stats.ms = this.stats.ms * 0.95 + frameMs * 0.05;
    this.stats.fps = 1000 / Math.max(1, this.stats.ms);

    // intro tour
    if (this.introT >= 0) {
      this.introT += dtReal;
      this.rig.yaw += dtReal * 0.35;
      if (this.introT > 5) this.skipIntro();
    }

    // impact queue (render-time aligned)
    if (this.impactQueue.length) {
      const due = this.impactQueue.filter((q) => q.at <= this.renderTime);
      if (due.length) {
        this.impactQueue = this.impactQueue.filter((q) => q.at > this.renderTime);
        for (const q of due) q.fn();
      }
    }

    {
      const rv = sharedUniforms.uRuneVis;
      rv.value += (this.runeTarget - rv.value) * Math.min(1, dtReal * 6);
    }
    this.rig.update(dtEnv);
    this.env.update(dtEnv, this.rig.yaw, this.width / Math.max(1, this.height));
    this.terrain.update(dtEnv);
    this.ambient.update(dtEnv);
    this.core.update(dtEnv, sharedUniforms.uTime.value);
    this.core.setHp(this.feed.state.coreHp);
    for (const p of this.portals.values()) p.update(dtEnv);
    for (const t of this.towers.values()) t.update(dtGame || (paused ? 0 : dtEnv));
    for (const w of this.walls.values()) {
      if (w.update(dtEnv)) { this.vfx.dust(w.group.position, 0.9, 14, 'rock'); this.vfx.ring(w.group.position, 0.9, 'stoneLight', 0.3); this.rig.addTrauma(0.05); }
    }
    for (const t of this.traps.values()) t.update(dtGame);
    this.updateEnemies(dtGame);
    this.vfx.update(dtGame || dtEnv * (paused ? 0 : 1));
    this.updateOverlay(dtEnv);
    this.pipeline.render(dtEnv, frameMs, now);
  }

  private updateEnemies(dt: number) {
    const s = this.feed.state;
    const prev = this.feed.prevState;
    const alpha = this.feed.alpha;
    const prevMap = new Map(prev.enemies.map((e) => [e.id, e]));
    const live = new Set<string>();
    const bars: { pos: Vector3; ratio: number; slowed: boolean; width: number }[] = [];
    const a = new Vector3(), b = new Vector3();
    for (const e of s.enemies) {
      live.add(e.id);
      let v = this.enemies.get(e.id);
      if (!v) {
        const h = parseInt(e.id.slice(1), 10) || 0;
        v = new EnemyView(e.id, e.kind, ((h * 0.618) % 1 - 0.5) * 0.24);
        this.scene.add(v.group);
        this.enemies.set(e.id, v);
        this.enemyWorld(e, v.group.position);
      }
      const pe = prevMap.get(e.id);
      this.enemyWorld(e, b);
      if (pe) this.enemyWorld(pe, a); else a.copy(b);
      const pos = a.lerp(b, alpha);
      // small lateral lane offset to separate overlapping enemies (presentation only)
      const dir = new Vector3().subVectors(b, v.lastPos);
      dir.y = 0;
      if (dir.lengthSq() > 1e-6) v.facing = Math.atan2(dir.x, dir.z);
      v.lastPos.copy(b);
      pos.x += Math.cos(v.facing) * v.laneOffset;
      pos.z -= Math.sin(v.facing) * v.laneOffset;
      v.group.position.copy(pos);
      let df = v.facing - v.group.rotation.y;
      df = Math.atan2(Math.sin(df), Math.cos(df));
      v.group.rotation.y += df * Math.min(1, dt * 10 + 0.05);
      v.slowed = e.slowUntilTick > s.tick;
      v.burrowed = isBurrowed(e, s.tick);
      v.enraged = isEnraged(e);
      v.breaking = (e.breakingTicks ?? 0) > 0;
      const maxHp = e.maxHp ?? this.maxHp(e.kind);
      v.hpRatio = e.hp / maxHp;
      v.update(dt, true, v.slowed ? 0.7 : 1);
      if (e.hp < maxHp && !v.burrowed) bars.push({ pos: pos.clone().add(new Vector3(0, v.height + 0.3, 0)), ratio: v.hpRatio, slowed: v.slowed, width: BIG_KINDS.has(e.kind) ? 2 : e.kind === 'golem' || e.kind === 'crab' || e.kind === 'yeti' ? 1.25 : e.kind === 'mini' ? 0.7 : 1 });
    }
    for (const [id, v] of this.enemies) {
      if (live.has(id)) continue;
      if (this.dying.has(id)) { v.update(dt, false, 1); continue; }
      // killed or leaked enemies whose event already handled; otherwise clean up
      this.scene.remove(v.group);
      this.enemies.delete(id);
    }
    this.overlay.setBars(bars);
  }

  private updateOverlay(dt: number) {
    const s = this.feed.state;
    const phase = s.phase;
    const ov = this.overlay;
    const prepare = phase === 'PREPARE';
    ov.setRoutesVisible(phase !== 'MENU', prepare ? 0.95 : 0.6);
    ov.showGhosts = prepare;
    ov.beginCells();
    // illegal flash (red blink + shake)
    if (this.illegalFlash.t > 0) {
      this.illegalFlash.t -= dt;
      const on = Math.sin(this.illegalFlash.t * 40) > -0.2;
      const shake = Math.sin(this.illegalFlash.t * 60) * 0.06 * (this.opts.reducedMotion ? 0 : 1);
      if (on) for (const c of this.illegalFlash.cells) ov.pushCell(c, TACTICAL.illegal, 0.75, 3, 0.05, 1 + shake);
    }
    const p = this.preview;
    if (p && prepare) {
      if (p.range) ov.pushRange(p.range, true);
      const color = p.ok ? TACTICAL.legal : TACTICAL.illegal;
      for (const c of p.cellIds) ov.pushCell(c, color, 0.6, 3, 0.05);
      // editable hint for terrain tools
      if (p.tool.type === 'raise' || p.tool.type === 'lower' || p.tool.type === 'wall') {
        for (const c of this.level.cells) if (c.editable && !p.cellIds.includes(c.id)) ov.pushCell(c.id, 0xffe6a0, 0.35, 4, 0.03);
      }
      if (p.tool.type === 'bridge') {
        for (const con of this.level.connectors) for (const c of con.chain) if (!p.cellIds.includes(c)) ov.pushCell(c, 0xffb27a, 0.3, 4, 0.03);
      }
    } else if (this.hoverCell && prepare) {
      ov.pushCell(this.hoverCell, TACTICAL.select, 0.5, 2, 0.04);
    }
    // selection range
    const sel = this.selection;
    const ranges: RangeCell[][] = [];
    if (sel?.type === 'tower') ranges.push(this.feed.rangeForTower(sel.id));
    if (this.showAll) for (const t of s.towers) if (sel?.id !== t.id) ranges.push(this.feed.rangeForTower(t.id));
    ranges.forEach((r, i) => ov.pushRange(r, i === 0 && sel?.type === 'tower'));
    if (sel?.type === 'tower') {
      const t = s.towers.find((x) => x.id === sel.id);
      if (t) for (const c of t.footprintCellIds) ov.pushCell(c, TACTICAL.select, 0.9, 5, 0.06);
    } else if (sel?.type === 'wall' || sel?.type === 'cell') {
      const cid = sel.type === 'wall' ? s.walls.find((w) => w.id === sel.id)?.cellId : sel.id;
      if (cid) ov.pushCell(cid, TACTICAL.select, 0.9, 5, 0.06);
    }
    // flyer lanes: when the coming wave has flyers, mark the straight lines they will take
    if (prepare && this.nextWaveHasFlyers()) {
      for (const cells of this.feed.flightLanes()) for (const c of cells) ov.pushCell(c, 0x7ff0d8, 0.28, 1, 0.035, 0.5);
    }
    // leak trails (red footprints fading)
    this.leakTrails = this.leakTrails.filter((l) => (l.t -= dt) > 0 || phase === 'WAVE_RESULT' || phase === 'DEFEAT');
    for (const l of this.leakTrails) for (const c of l.cells) ov.pushCell(c, TACTICAL.illegal, 0.45 * Math.min(1, Math.max(0.3, l.t / 3)), 0, 0.04, 0.45);
    ov.endCells();
    ov.update(dt);
    // LOS-blocked icons
    for (const [id, t] of this.towers) {
      let sp = this.blockedSprites.get(id);
      if (t.blockedT > 0) {
        if (!sp) {
          sp = new Sprite(new SpriteMaterial({ map: this.blockedTex, depthTest: false, transparent: true, toneMapped: false }));
          sp.scale.set(0.55, 0.55, 1);
          sp.renderOrder = 12;
          ov.scene.add(sp);
          this.blockedSprites.set(id, sp);
        }
        sp.visible = true;
        sp.position.copy(t.group.position).add(new Vector3(0, t.headY + 0.75, 0));
      } else if (sp) sp.visible = false;
    }
    for (const [id, sp] of this.blockedSprites) if (!this.towers.has(id)) { ov.scene.remove(sp); this.blockedSprites.delete(id); }
  }

  // ---------------------------------------------------------------- photo mode (GDD §11.4 T1)
  /** Free camera + look controls; presentation only, the simulation is paused by the caller. */
  setPhotoMode(on: boolean) {
    this.rig.photoZoom = on;
    if (!on) {
      this.pipeline.overlayEnabled = true;
      this.pipeline.setLook({ filter: 0, tiltShift: 0, focus: 0.5 });
      this.rig.setOrbit(false);
    }
  }
  setPhotoLook(l: { filter: number; tiltShift: number; focus: number; hideTactical: boolean; orbit: boolean }) {
    this.pipeline.setLook(l);
    this.pipeline.overlayEnabled = !l.hideTactical;
    this.rig.setOrbit(l.orbit, 0.18);
  }
  /** Render a fresh frame and read it back before the browser clears the drawing buffer. */
  capture(type = 'image/png'): string {
    this.pipeline.render(0, 16, performance.now());
    return this.canvas.toDataURL(type);
  }

  perfInfo() {
    const info = this.pipeline.renderer.info;
    return { fps: Math.round(this.stats.fps), ms: Math.round(this.stats.ms * 10) / 10, calls: info.render.calls, tris: info.render.triangles, dpr: Math.round(this.pipeline.currentPixelRatio * 100) / 100 };
  }

  dispose() { this.pipeline.dispose(); }
}
