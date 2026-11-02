import { MathUtils, OrthographicCamera, Vector3 } from 'three';

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Orthographic tactical camera (GDD §11.1, Tech §9.3): 35–45° pitch, Q/E 90° eased turns
 * (0.35 s), 3 snapped zoom levels with smoothing, clamped panning, trauma-based shake.
 */
export class CameraRig {
  readonly camera: OrthographicCamera;
  readonly target = new Vector3();
  yaw: number;
  private yawFrom = 0;
  private yawTo = 0;
  private yawT = 1;
  pitch = MathUtils.degToRad(38);
  /** Snapped zoom levels, widest first. Index 0 is a strategic overview that fits the whole island. */
  private readonly zoomLevels = [0.55, 0.8, 1.15, 1.65];
  static readonly INTRO_ZOOM_INDEX = 1;
  static readonly DEFAULT_ZOOM_INDEX = 2;
  /** Widest free (wheel / pinch) zoom. */
  static readonly MIN_ZOOM = 0.5;
  zoomIndex = CameraRig.DEFAULT_ZOOM_INDEX;
  private zoom = 1.15;
  private zoomTarget = 1.15;
  private trauma = 0;
  shakeScale = 1;
  private aspect = 1.6;
  private readonly baseHalfHeight = 12.5;
  private bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private orbit: { active: boolean; speed: number } = { active: false, speed: 0 };

  constructor(center: Vector3, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, initialYawDeg = 28) {
    this.camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
    this.target.copy(center);
    this.bounds = bounds;
    this.yaw = MathUtils.degToRad(initialYawDeg);
    this.yawTo = this.yaw;
    this.apply(0);
  }

  get isTurning(): boolean { return this.yawT < 1; }

  rotate(dir: 1 | -1) {
    const base = this.yawT < 1 ? this.yawTo : this.yaw;
    this.yawFrom = this.yaw;
    this.yawTo = base + dir * Math.PI / 2;
    this.yawT = 0;
  }

  zoomStep(dir: 1 | -1) {
    this.zoomIndex = MathUtils.clamp(this.zoomIndex + dir, 0, this.zoomLevels.length - 1);
    this.zoomTarget = this.zoomLevels[this.zoomIndex]!;
  }
  /** Smooth wheel zoom between snapped levels. */
  zoomBy(delta: number) {
    this.zoomTarget = MathUtils.clamp(this.zoomTarget * Math.exp(-delta * 0.0015), CameraRig.MIN_ZOOM, this.maxZoom);
    // snap index to nearest
    let best = 0;
    this.zoomLevels.forEach((z, i) => { if (Math.abs(z - this.zoomTarget) < Math.abs(this.zoomLevels[best]! - this.zoomTarget)) best = i; });
    this.zoomIndex = best;
  }
  snapZoom() { this.zoomTarget = this.zoomLevels[this.zoomIndex]!; }

  /** Pan in screen space (pixels → world). */
  pan(dxPx: number, dyPx: number, viewportHeightPx: number) {
    const worldPerPx = (this.halfHeightBase * 2) / this.zoom / viewportHeightPx;
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.target.addScaledVector(right, -dxPx * worldPerPx);
    this.target.addScaledVector(fwd, dyPx * worldPerPx / Math.sin(this.pitch));
    this.clampTarget();
  }
  panWorld(dx: number, dz: number) {
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.target.addScaledVector(right, dx).addScaledVector(fwd, dz);
    this.clampTarget();
  }
  /**
   * RTS-style edge scroll. `sx`/`sy` are in [-1, 1]: +x scrolls toward screen right, +y toward
   * screen top. Speed scales with the visible area so it feels the same at every zoom level.
   */
  edgeScroll(sx: number, sy: number, dt: number) {
    if (!sx && !sy) return;
    const halfH = this.halfHeightBase / this.zoom;
    const speed = halfH * 1.5; // world units / s at full strength
    this.panWorld(sx * speed * dt, (sy * speed * dt) / Math.sin(this.pitch));
  }
  private clampTarget() {
    this.target.x = MathUtils.clamp(this.target.x, this.bounds.minX, this.bounds.maxX);
    this.target.z = MathUtils.clamp(this.target.z, this.bounds.minZ, this.bounds.maxZ);
  }

  addTrauma(t: number) { this.trauma = Math.min(1, this.trauma + t * this.shakeScale); }
  setOrbit(active: boolean, speed = 0.12) { this.orbit = { active, speed }; }

  setAspect(aspect: number) { this.aspect = aspect; }

  /**
   * Visible half-height before zoom. On tall (portrait phone) viewports the frustum is widened
   * so roughly the same island width stays on screen instead of a narrow vertical slice.
   */
  get portraitFit(): number { return this.aspect < 1.2 ? Math.min(2, 1.2 / this.aspect) : 1; }
  get halfHeightBase(): number { return this.baseHalfHeight * this.portraitFit; }
  /** Closest free zoom; portrait screens may zoom further so a single cell is finger-sized. */
  get maxZoom(): number { return 1.9 * this.portraitFit; }

  update(dt: number) {
    if (this.yawT < 1) {
      this.yawT = Math.min(1, this.yawT + dt / 0.35);
      this.yaw = MathUtils.lerp(this.yawFrom, this.yawTo, easeInOutCubic(this.yawT));
    } else if (this.orbit.active) {
      this.yaw += dt * this.orbit.speed;
      this.yawTo = this.yaw;
    }
    this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-dt * 10));
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.apply(dt);
  }

  private shakeTime = 0;
  private apply(dt: number) {
    this.shakeTime += dt;
    const halfH = this.halfHeightBase / this.zoom;
    const halfW = halfH * this.aspect;
    const cam = this.camera;
    cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH;
    const dist = 70;
    const off = new Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(dist);
    cam.position.copy(this.target).add(off);
    const shake = this.trauma * this.trauma;
    if (shake > 0) {
      const t = this.shakeTime * 28;
      const sx = (Math.sin(t * 1.31) + Math.sin(t * 2.17 + 1.3) * 0.5) * 0.18 * shake;
      const sy = (Math.sin(t * 1.73 + 2.1) + Math.sin(t * 2.91) * 0.5) * 0.18 * shake;
      const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      cam.position.addScaledVector(right, sx);
      cam.position.y += sy;
    }
    cam.lookAt(cam.position.clone().sub(off));
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }
}
