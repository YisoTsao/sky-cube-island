import { Color, type BufferGeometry } from 'three';
import { meshVoxels } from './mesher';
import { PALETTE, type PaletteKey } from '../palette';

/**
 * Micro-voxel model builder (GDD §11.1: 1/16-cell art voxels). Used to build all towers,
 * enemies, core, portals, bridges and props procedurally from the master palette.
 */
export class VoxelModel {
  readonly data: Uint32Array; // 0 = empty, otherwise (hex+1) | jitterFlag<<25
  constructor(public nx: number, public ny: number, public nz: number) {
    this.data = new Uint32Array(nx * ny * nz);
  }
  private i(x: number, y: number, z: number): number { return x + this.nx * (z + this.nz * y); }
  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz;
  }
  set(x: number, y: number, z: number, c: PaletteKey | number | null, jitter = false): this {
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    if (!this.inBounds(x, y, z)) return this;
    if (c === null) { this.data[this.i(x, y, z)] = 0; return this; }
    const hex = typeof c === 'number' ? c : PALETTE[c];
    this.data[this.i(x, y, z)] = ((hex + 1) & 0x1ffffff) | (jitter ? 1 << 25 : 0);
    return this;
  }
  get(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return 0;
    return this.data[this.i(x, y, z)]!;
  }
  /** Inclusive box. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: PaletteKey | number | null, jitter = false): this {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, z, c, jitter);
    return this;
  }
  /** Vertical cylinder (inclusive heights), centre may be fractional. */
  cylinder(cx: number, cz: number, r: number, y0: number, y1: number, c: PaletteKey | number | null, jitter = false): this {
    for (let y = y0; y <= y1; y++)
      for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
          if (dx * dx + dz * dz <= r * r) this.set(x, y, z, c, jitter);
        }
    return this;
  }
  sphere(cx: number, cy: number, cz: number, r: number, c: PaletteKey | number | null, sy = 1, jitter = false): this {
    for (let y = Math.floor(cy - r * sy); y <= Math.ceil(cy + r * sy); y++)
      for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          const dx = x + 0.5 - cx, dy = (y + 0.5 - cy) / sy, dz = z + 0.5 - cz;
          if (dx * dx + dy * dy + dz * dz <= r * r) this.set(x, y, z, c, jitter);
        }
    return this;
  }
  /** Replace colour of existing voxels matching a predicate. */
  paint(pred: (x: number, y: number, z: number) => boolean, c: PaletteKey | number): this {
    for (let y = 0; y < this.ny; y++) for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) {
      if (this.get(x, y, z) && pred(x, y, z)) this.set(x, y, z, c, (this.get(x, y, z) >> 25 & 1) === 1);
    }
    return this;
  }

  /**
   * Build geometry. `scale` = world size of one micro voxel (1/16 by default); origin is
   * bottom-centre (Tech §10.1) unless `center` is false.
   */
  build(scale = 1 / 16, opts: { originY?: number; flags?: number } = {}): BufferGeometry {
    const nx = this.nx, ny = this.ny, nz = this.nz;
    const tmp = new Color();
    const geo = meshVoxels({
      nx, ny, nz, sx: scale, sy: scale, sz: scale,
      ox: -nx * scale / 2, oy: (opts.originY ?? 0), oz: -nz * scale / 2,
      get: (x, y, z) => this.get(x, y, z),
      color: (x, y, z, dir, mat, out) => {
        tmp.setHex(((mat & 0x1ffffff) - 1) & 0xffffff);
        let k = 1;
        if (mat >> 25 & 1) {
          const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
          k = 1 + ((h - Math.floor(h)) - 0.5) * 0.1;
        }
        // subtle directional tint: tops lighter, bottoms darker (diorama hand-painted feel)
        if (dir === 2) k *= 1.04; else if (dir === 3) k *= 0.82;
        out[0] = tmp.r * k; out[1] = tmp.g * k; out[2] = tmp.b * k;
      },
      flags: opts.flags ? () => opts.flags! : undefined,
    }, { greedy: true });
    if (!geo) throw new Error('empty voxel model');
    return geo;
  }
}
