import type { BufferGeometry } from 'three';
import { PALETTE, type PaletteKey } from '../palette';
import { VoxelModel } from './model';

export type SculptColor = PaletteKey | number;
type Vec3 = readonly [number, number, number];
type DecalDir = '+x' | '-x' | '+y' | '+z' | '-z';

const hash3 = (x: number, y: number, z: number): number => {
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return h - Math.floor(h);
};

/**
 * Resolution-independent voxel sculpting. Shapes are described in "art units" (1 unit = the
 * classic 1/16-cell voxel) with fractional coordinates, then rasterised at `k` voxels per unit.
 * The same model code therefore yields a fine version (k = 2, 1/32-cell voxels) for detailed
 * rendering and a coarse one (k = 1) for low-end devices.
 *
 * Colour jitter is hashed per art unit (not per fine voxel) so greedy meshing still merges
 * the fine voxels of one unit and the triangle count stays reasonable.
 */
export class Sculpt {
  readonly m: VoxelModel;
  constructor(readonly W: number, readonly H: number, readonly D: number, readonly k = 1) {
    this.m = new VoxelModel(Math.ceil(W * k), Math.ceil(H * k), Math.ceil(D * k));
  }

  private hex(c: SculptColor, x: number, y: number, z: number, jitter: number): number {
    const h = typeof c === 'number' ? c : PALETTE[c];
    if (!jitter) return h;
    const f = 1 + (hash3(Math.floor(x), Math.floor(y), Math.floor(z)) - 0.5) * jitter;
    const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((h >> s) & 255) * f)));
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  }

  private put(i: number, j: number, l: number, c: SculptColor | null, jitter: number) {
    if (c === null) { this.m.set(i, j, l, null); return; }
    const k = this.k;
    this.m.set(i, j, l, this.hex(c, (i + 0.5) / k, (j + 0.5) / k, (l + 0.5) / k, jitter));
  }

  /** Fill every voxel whose centre (in art units) is inside the bounds and passes `test`. */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    test: (x: number, y: number, z: number) => boolean, c: SculptColor | null, jitter = 0): this {
    const k = this.k;
    const i0 = Math.max(0, Math.floor(x0 * k)), i1 = Math.min(this.m.nx - 1, Math.ceil(x1 * k));
    const j0 = Math.max(0, Math.floor(y0 * k)), j1 = Math.min(this.m.ny - 1, Math.ceil(y1 * k));
    const l0 = Math.max(0, Math.floor(z0 * k)), l1 = Math.min(this.m.nz - 1, Math.ceil(z1 * k));
    for (let j = j0; j <= j1; j++) for (let l = l0; l <= l1; l++) for (let i = i0; i <= i1; i++) {
      if (test((i + 0.5) / k, (j + 0.5) / k, (l + 0.5) / k)) this.put(i, j, l, c, jitter);
    }
    return this;
  }

  /** Grow a [lo, hi) span thinner than one voxel to exactly one voxel, so details survive coarse k. */
  private span(lo: number, hi: number): [number, number] {
    const v = 1 / this.k;
    if (hi - lo >= v) return [lo, hi];
    const c = Math.floor(((lo + hi) / 2) * this.k) / this.k;
    return [c, c + v];
  }

  /** Axis-aligned box with continuous extents [x0,x1) etc. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: SculptColor | null, jitter = 0): this {
    [x0, x1] = this.span(x0, x1); [y0, y1] = this.span(y0, y1); [z0, z1] = this.span(z0, z1);
    return this.fill(x0, y0, z0, x1, y1, z1, (x, y, z) => x >= x0 && x < x1 && y >= y0 && y < y1 && z >= z0 && z < z1, c, jitter);
  }

  ell(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, c: SculptColor | null, jitter = 0): this {
    return this.fill(cx - rx, cy - ry, cz - rz, cx + rx, cy + ry, cz + rz, (x, y, z) => {
      const dx = (x - cx) / rx, dy = (y - cy) / ry, dz = (z - cz) / rz;
      return dx * dx + dy * dy + dz * dz <= 1;
    }, c, jitter);
  }

  ball(cx: number, cy: number, cz: number, r: number, c: SculptColor | null, jitter = 0): this {
    return this.ell(cx, cy, cz, r, r, r, c, jitter);
  }

  /** Vertical cylinder from y0 to y1 (continuous). */
  cyl(cx: number, cz: number, r: number, y0: number, y1: number, c: SculptColor | null, jitter = 0): this {
    return this.fill(cx - r, y0, cz - r, cx + r, y1, cz + r, (x, y, z) => {
      const dx = x - cx, dz = z - cz;
      return y >= y0 && y < y1 && dx * dx + dz * dz <= r * r;
    }, c, jitter);
  }

  /** Capsule from a to b, radius tapering from ra to rb. */
  seg(a: Vec3, b: Vec3, ra: number, c: SculptColor | null, rb = ra, jitter = 0): this {
    // keep thin limbs/spines at least ~one voxel thick at coarse resolutions
    const minR = 0.55 / this.k;
    ra = Math.max(ra, minR); rb = Math.max(rb, minR);
    const r = Math.max(ra, rb);
    const [ax, ay, az] = a, [bx, by, bz] = b;
    const ex = bx - ax, ey = by - ay, ez = bz - az;
    const len2 = ex * ex + ey * ey + ez * ez || 1e-6;
    return this.fill(Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.min(az, bz) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r, Math.max(az, bz) + r,
      (x, y, z) => {
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey + (z - az) * ez) / len2));
        const dx = x - (ax + ex * t), dy = y - (ay + ey * t), dz = z - (az + ez * t);
        const rr = ra + (rb - ra) * t;
        return dx * dx + dy * dy + dz * dz <= rr * rr;
      }, c, jitter);
  }

  /** Polyline of capsules (horns, tails, legs). */
  path(pts: Vec3[], ra: number, c: SculptColor | null, rb = ra, jitter = 0): this {
    const n = pts.length - 1;
    for (let i = 0; i < n; i++) this.seg(pts[i]!, pts[i + 1]!, ra + (rb - ra) * (i / n), c, ra + (rb - ra) * ((i + 1) / n), jitter);
    return this;
  }

  /** Recolour existing voxels where `pred` holds (centre in art units). */
  paint(pred: (x: number, y: number, z: number) => boolean, c: SculptColor, jitter = 0): this {
    const k = this.k;
    for (let j = 0; j < this.m.ny; j++) for (let l = 0; l < this.m.nz; l++) for (let i = 0; i < this.m.nx; i++) {
      if (!this.m.get(i, j, l)) continue;
      if (pred((i + 0.5) / k, (j + 0.5) / k, (l + 0.5) / k)) this.put(i, j, l, c, jitter);
    }
    return this;
  }

  /**
   * Paint the outermost surface seen from `dir` inside a rectangle (a, b are the two other
   * axes in x→y→z order: +z/-z use (x, y), +y uses (x, z), ±x use (z, y)). `raise` adds fine
   * voxels proud of the surface (pupils, studs); `depth` paints that many voxels inwards.
   */
  decal(dir: DecalDir, a0: number, b0: number, a1: number, b1: number, c: SculptColor, opts: { raise?: number; depth?: number; jitter?: number } = {}): this {
    const k = this.k, m = this.m;
    [a0, a1] = this.span(a0, a1); [b0, b1] = this.span(b0, b1);
    const raise = opts.raise ?? 0, depth = Math.max(1, Math.round((opts.depth ?? 1) * k));
    const axis = dir[1] as 'x' | 'y' | 'z';
    const sign = dir[0] === '+' ? 1 : -1;
    const [ua, ub] = axis === 'z' ? ['x', 'y'] : axis === 'y' ? ['x', 'z'] : ['z', 'y'];
    const n: Record<string, number> = { x: m.nx, y: m.ny, z: m.nz };
    const ia0 = Math.max(0, Math.floor(a0 * k)), ia1 = Math.min(n[ua]! - 1, Math.ceil(a1 * k) - 1);
    const ib0 = Math.max(0, Math.floor(b0 * k)), ib1 = Math.min(n[ub]! - 1, Math.ceil(b1 * k) - 1);
    const idx = (p: Record<string, number>) => [p.x!, p.y!, p.z!] as const;
    for (let ia = ia0; ia <= ia1; ia++) for (let ib = ib0; ib <= ib1; ib++) {
      const ca = (ia + 0.5) / k, cb = (ib + 0.5) / k;
      if (ca < a0 || ca >= a1 || cb < b0 || cb >= b1) continue;
      const N = n[axis]!;
      let s = sign > 0 ? N - 1 : 0;
      const p: Record<string, number> = { [ua]: ia, [ub]: ib, [axis]: s };
      while (s >= 0 && s < N) { p[axis] = s; if (m.get(...idx(p))) break; s -= sign; }
      if (s < 0 || s >= N) continue;
      for (let d = 0; d < depth; d++) {
        p[axis] = s - sign * d;
        if (p[axis]! < 0 || p[axis]! >= N || !m.get(...idx(p))) break;
        this.put(...idx(p), c, opts.jitter ?? 0);
      }
      for (let r = 1; r <= Math.round(raise * k); r++) { p[axis] = s + sign * r; this.put(...idx(p), c, 0); }
    }
    return this;
  }

  /** Eye on the +z surface: dark iris with a bright glint in its upper outer corner. */
  eye(x0: number, y0: number, x1: number, y1: number, opts: { iris?: SculptColor; glint?: SculptColor; outer?: 'left' | 'right'; raise?: number } = {}): this {
    const g = 0.5;
    this.decal('+z', x0, y0, x1, y1, opts.iris ?? 'eye', { raise: opts.raise ?? 0.5 });
    const gx = opts.outer === 'right' ? x1 - g : x0;
    return this.decal('+z', gx, y1 - g, gx + g, y1, opts.glint ?? 'white');
  }

  build(scale: number, opts: { originY?: number; flags?: number } = {}): BufferGeometry {
    return this.m.build(scale / this.k, opts);
  }
}
