import { Group, Mesh, type BufferGeometry } from 'three';
import type { LevelDef, SurfaceCell } from '../../domain/types';
import { meshVoxels } from '../voxel/mesher';
import { createVoxelMaterial, FLAG_EDITABLE, FLAG_EMISSIVE, FLAG_GRASS_SIDE, FLAG_NO_BEVEL, sharedUniforms, MAX_TERRAIN_ANIMS } from '../materials/voxel-material';
import { PALETTE, pal, type PaletteKey } from '../palette';

/** Terrain voxels are half a cell wide and one height step (0.5) tall. */
const VS = 0.5;
const SUB = 2; // voxels per cell (x/z)
const J_OFF = 34; // voxel layer j=0 corresponds to world layer -J_OFF
const NY = 44;

const M_GRASS = 1, M_DIRT = 2, M_SOIL = 3, M_ROCK = 4, M_ROOT = 5, M_CRYSTAL = 6, M_STONE = 7, M_PILLAR = 8, M_LEDGE = 9;

function hash3(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function hash2(x: number, z: number): number { return hash3(x, 17.3, z); }
function vnoise(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

export interface TerrainData {
  level: LevelDef;
  elevationOf(cellId: string): number;
}

interface Column { cell: SurfaceCell; topJ: number; bodyBottomJ: number }

/**
 * Procedural hi-fi voxel terrain (Tech §9.4): exposed faces only, baked voxel AO, bevel edge
 * masks, colour jitter & strata, grass fringe, editable rune tiles and inverted-cone island roots
 * with glowing crystal ore. Chunked 8×8 cells for local rebuilds.
 */
export class Terrain {
  readonly group = new Group();
  readonly material = createVoxelMaterial({ terrainAnim: true, bevel: 0.05 });
  private nx: number; private nz: number;
  private vol: Uint8Array;
  private rootVol: Uint8Array; // static decorative roots/ledges
  private cols = new Map<number, Column>(); // key: cellX + cellZ*width
  private chunks = new Map<string, Mesh>();
  private anims: { id: number; from: number; t: number; dur: number }[] = [];
  private readonly chunkCells = 8;

  /** Grass top palette per level theme (snowfield / volcanic ash). */
  private readonly surface: [PaletteKey, PaletteKey, PaletteKey];

  constructor(private data: TerrainData) {
    const { level } = data;
    const theme = level.theme ?? 'day';
    this.surface = theme === 'snow' ? ['snow', 'snowLight', 'snowShade'] : theme === 'ember' ? ['ash', 'ashLight', 'ashDark'] : ['grass', 'grassLight', 'grassDark'];
    sharedUniforms.uGrassSide.value.setHex(theme === 'snow' ? PALETTE.snowSide : theme === 'ember' ? PALETTE.ashSide : PALETTE.grassSide);
    this.nx = level.width * SUB;
    this.nz = level.depth * SUB;
    this.vol = new Uint8Array(this.nx * this.nz * NY);
    this.rootVol = new Uint8Array(this.nx * this.nz * NY);
    this.group.name = 'terrain';
    this.buildColumns();
    this.buildRoots();
    this.fillVolume();
    for (let cz = 0; cz < level.depth / this.chunkCells; cz++)
      for (let cx = 0; cx < level.width / this.chunkCells; cx++) this.rebuildChunk(cx, cz);
  }

  private vi(x: number, y: number, z: number) { return x + this.nx * (z + this.nz * y); }

  private buildColumns() {
    const { level } = this.data;
    const minTop = new Map<string, number>();
    for (const c of level.cells) {
      if (c.kind !== 'ground') continue;
      const t = c.elevation; // body depth from authored base, not edits
      minTop.set(c.platformId, Math.min(minTop.get(c.platformId) ?? 99, t));
    }
    for (const c of level.cells) {
      if (c.kind !== 'ground') continue;
      const base = minTop.get(c.platformId) ?? 0;
      this.cols.set(c.pos.x + c.pos.z * level.width, {
        cell: c,
        topJ: this.data.elevationOf(c.id) + J_OFF,
        bodyBottomJ: base + J_OFF - 6,
      });
    }
  }

  /** Inverted-cone roots + cliff ledges, generated once from platform outlines (fixed seed). */
  private buildRoots() {
    const { level } = this.data;
    const byPlatform = new Map<string, Column[]>();
    for (const col of this.cols.values()) {
      const list = byPlatform.get(col.cell.platformId) ?? [];
      list.push(col);
      byPlatform.set(col.cell.platformId, list);
    }
    for (const [pid, cols] of byPlatform) {
      const mask = new Uint8Array(this.nx * this.nz);
      let bottom = 0;
      for (const c of cols) {
        bottom = c.bodyBottomJ;
        for (let dz = 0; dz < SUB; dz++) for (let dx = 0; dx < SUB; dx++)
          mask[c.cell.pos.x * SUB + dx + (c.cell.pos.z * SUB + dz) * this.nx] = 1;
      }
      // distance to outside (4-neighbour BFS)
      const dist = new Int16Array(this.nx * this.nz).fill(-1);
      const q: number[] = [];
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        const x = i % this.nx, z = (i / this.nx) | 0;
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
          const xx = x + dx!, zz = z + dz!;
          return xx < 0 || zz < 0 || xx >= this.nx || zz >= this.nz || !mask[xx + zz * this.nx];
        });
        if (edge) { dist[i] = 1; q.push(i); }
      }
      for (let h = 0; h < q.length; h++) {
        const i = q[h]!; const x = i % this.nx, z = (i / this.nx) | 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const xx = x + dx, zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= this.nx || zz >= this.nz) continue;
          const k = xx + zz * this.nx;
          if (!mask[k] || dist[k] !== -1) continue;
          dist[k] = dist[i]! + 1; q.push(k);
        }
      }
      const seed = pid.length * 13.7;
      for (let k = 1; k < 26; k++) {
        const j = bottom - k;
        if (j < 1) break;
        for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) {
          const d = dist[x + z * this.nx]!;
          if (d <= 0) continue;
          const n1 = vnoise(x * 0.35 + seed, z * 0.35);
          const n2 = hash3(x, k, z);
          const thr = k * 0.62 + n1 * 2.6 + n2 * 0.9 - 0.6;
          if (d > thr) this.rootVol[this.vi(x, j, z)] = M_ROOT;
        }
      }
      // cliff ledges / protruding rocks just outside the outline (purely decorative)
      for (const c of cols) {
        for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nxC = c.cell.pos.x + ox, nzC = c.cell.pos.z + oz;
          if (this.cols.has(nxC + nzC * level.width)) continue;
          if (level.cells.some((s) => s.pos.x === nxC && s.pos.z === nzC)) continue;
          for (let s = 0; s < SUB; s++) {
            const vx = ox === 0 ? c.cell.pos.x * SUB + s : ox > 0 ? c.cell.pos.x * SUB + SUB : c.cell.pos.x * SUB - 1;
            const vz = oz === 0 ? c.cell.pos.z * SUB + s : oz > 0 ? c.cell.pos.z * SUB + SUB : c.cell.pos.z * SUB - 1;
            if (vx < 0 || vz < 0 || vx >= this.nx || vz >= this.nz) continue;
            const h = hash2(vx * 1.7, vz * 2.3);
            if (h > 0.42) continue;
            const topLimit = c.cell.elevation + J_OFF - 3 - Math.floor(h * 6);
            const len = 2 + Math.floor(hash2(vx, vz + 9) * 5);
            for (let j = topLimit; j > topLimit - len && j > 0; j--) this.rootVol[this.vi(vx, j, vz)] = M_LEDGE;
          }
        }
      }
    }
  }

  private fillVolume() {
    this.vol.set(this.rootVol);
    for (const col of this.cols.values()) this.fillColumn(col);
  }

  private fillColumn(col: Column) {
    const { cell } = col;
    const pillar = cell.tags?.includes('pillar');
    const stone = cell.terrain === 'stone';
    for (let dz = 0; dz < SUB; dz++) for (let dx = 0; dx < SUB; dx++) {
      const x = cell.pos.x * SUB + dx, z = cell.pos.z * SUB + dz;
      for (let j = col.bodyBottomJ; j < NY; j++) {
        let m = 0;
        if (j < col.topJ) {
          const d = col.topJ - 1 - j;
          if (pillar) m = M_PILLAR;
          else if (d === 0) m = stone ? M_STONE : M_GRASS;
          else if (d <= 2) m = stone ? M_ROCK : M_DIRT;
          else if (d <= 4) m = M_SOIL;
          else m = M_ROCK;
          if (m === M_ROCK && d > 3 && hash3(x, j, z) < 0.012) m = M_CRYSTAL;
        }
        this.vol[this.vi(x, j, z)] = m;
      }
    }
  }

  private colAtVoxel(x: number, z: number): Column | undefined {
    return this.cols.get(Math.floor(x / SUB) + Math.floor(z / SUB) * this.data.level.width);
  }

  private rebuildChunk(cx: number, cz: number) {
    const key = `${cx},${cz}`;
    const old = this.chunks.get(key);
    if (old) { this.group.remove(old); old.geometry.dispose(); this.chunks.delete(key); }
    const cs = this.chunkCells * SUB;
    const tmp = { r: 0, g: 0, b: 0 };
    const set = (k: PaletteKey, mul: number, out: [number, number, number]) => {
      const c = pal(k); out[0] = c.r * mul; out[1] = c.g * mul; out[2] = c.b * mul;
    };
    void tmp;
    const geo: BufferGeometry | null = meshVoxels({
      nx: this.nx, ny: NY, nz: this.nz, sx: VS, sy: VS, sz: VS,
      ox: 0, oy: -J_OFF * VS, oz: 0,
      get: (x, y, z) => this.vol[this.vi(x, y, z)]!,
      color: (x, y, z, dir, mat, out) => {
        const jit = 1 + (hash3(x, y, z) - 0.5) * 0.08;
        const top = dir === 2;
        const bottom = dir === 3;
        switch (mat) {
          case M_GRASS: {
            if (top) {
              const n = vnoise(x * 0.18, z * 0.18);
              const [g, gl, gd] = this.surface;
              const k: PaletteKey = n > 0.68 ? gl : n < 0.3 ? gd : g;
              set(k, jit * (0.96 + hash2(x * 3.1, z * 1.7) * 0.08), out);
            } else set(bottom ? 'soil' : 'dirt', jit, out);
            return;
          }
          case M_STONE: {
            if (top) {
              const tile = hash2(Math.floor(x / 1) * 5.1, Math.floor(z / 1) * 3.3);
              set(tile > 0.7 ? 'stoneLight' : tile < 0.25 ? 'stoneDark' : 'stone', 0.97 + tile * 0.06, out);
            } else set('rockLight', jit, out);
            return;
          }
          case M_DIRT: set(bottom ? 'soil' : 'dirt', jit * (y % 2 === 0 ? 1 : 0.95), out); return;
          case M_SOIL: set(bottom ? 'soilDeep' : 'dirtDark', jit, out); return;
          case M_ROCK: case M_PILLAR: case M_LEDGE: {
            const band = (y + Math.floor(vnoise(x * 0.25, z * 0.25) * 2.2)) % 3;
            const k: PaletteKey = band === 0 ? 'rockDark' : band === 1 ? 'rock' : 'rockLight';
            set(bottom ? 'rockDeep' : top && mat !== M_PILLAR ? 'rockLight' : k, jit, out);
            return;
          }
          case M_ROOT: {
            const deep = y < J_OFF - 12;
            const k: PaletteKey = bottom ? 'rockDeep' : (y % 2 === 0) ? (deep ? 'rockDeep' : 'rockDark') : (deep ? 'rockDark' : 'soil');
            set(k, jit, out);
            return;
          }
          case M_CRYSTAL: set(hash3(x, y, z) > 0.5 ? 'crystal' : 'crystalLight', 1, out); return;
        }
        set('rock', 1, out);
      },
      flags: (x, y, z, dir, mat) => {
        let f = 0;
        if (mat === M_CRYSTAL) f |= FLAG_EMISSIVE | FLAG_NO_BEVEL;
        if (mat === M_GRASS && dir !== 2 && dir !== 3) f |= FLAG_GRASS_SIDE;
        if (dir === 2 && (mat === M_GRASS || mat === M_STONE)) {
          const col = this.colAtVoxel(x, z);
          if (col && col.cell.editable && y === col.topJ - 1) f |= FLAG_EDITABLE;
        }
        return f;
      },
      anim: (x, y, z) => {
        const col = this.colAtVoxel(x, z);
        if (!col || y !== col.topJ - 1) return 0;
        return col.cell.pos.x + col.cell.pos.z * this.data.level.width + 1;
      },
    }, { x0: cx * cs, x1: (cx + 1) * cs, z0: cz * cs, z1: (cz + 1) * cs, greedy: true });
    if (!geo) return;
    const mesh = new Mesh(geo, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `terrain-chunk-${key}`;
    this.group.add(mesh);
    this.chunks.set(key, mesh);
  }

  /** Apply a new elevation for one cell: local volume + chunk rebuild + spring tween. */
  setElevation(cellId: string, from: number, to: number, animate = true) {
    const cell = this.data.level.cells.find((c) => c.id === cellId);
    if (!cell) return;
    const col = this.cols.get(cell.pos.x + cell.pos.z * this.data.level.width);
    if (!col) return;
    col.topJ = to + J_OFF;
    // restore static roots/ledges in the column region, then refill
    for (let dz = 0; dz < SUB; dz++) for (let dx = 0; dx < SUB; dx++) {
      const x = cell.pos.x * SUB + dx, z = cell.pos.z * SUB + dz;
      for (let j = 0; j < NY; j++) this.vol[this.vi(x, j, z)] = this.rootVol[this.vi(x, j, z)]!;
    }
    this.fillColumn(col);
    const cx = Math.floor(cell.pos.x / this.chunkCells), cz = Math.floor(cell.pos.z / this.chunkCells);
    const lx = cell.pos.x % this.chunkCells, lz = cell.pos.z % this.chunkCells;
    const todo = new Set([`${cx},${cz}`]);
    if (lx === 0) todo.add(`${cx - 1},${cz}`);
    if (lx === this.chunkCells - 1) todo.add(`${cx + 1},${cz}`);
    if (lz === 0) todo.add(`${cx},${cz - 1}`);
    if (lz === this.chunkCells - 1) todo.add(`${cx},${cz + 1}`);
    for (const k of todo) {
      const [a, b] = k.split(',').map(Number) as [number, number];
      if (a >= 0 && b >= 0 && a < this.data.level.width / this.chunkCells && b < this.data.level.depth / this.chunkCells) this.rebuildChunk(a, b);
    }
    if (animate) {
      const id = cell.pos.x + cell.pos.z * this.data.level.width + 1;
      this.anims = this.anims.filter((a) => a.id !== id);
      this.anims.push({ id, from: (from - to) * VS, t: 0, dur: 0.32 });
      if (this.anims.length > MAX_TERRAIN_ANIMS) this.anims.shift();
    }
  }

  /** Re-sync every column with current elevations (load / undo). */
  syncAll(animate: boolean) {
    for (const col of this.cols.values()) {
      const e = this.data.elevationOf(col.cell.id);
      if (e + J_OFF !== col.topJ) this.setElevation(col.cell.id, col.topJ - J_OFF, e, animate);
    }
  }

  update(dt: number) {
    const arr = sharedUniforms.uAnims.value;
    for (const a of this.anims) a.t += dt;
    this.anims = this.anims.filter((a) => a.t < a.dur + 0.25);
    for (let i = 0; i < MAX_TERRAIN_ANIMS; i++) {
      const a = this.anims[i];
      if (!a) { arr[i]!.set(0, 0); continue; }
      // damped spring overshoot
      const t = Math.min(1, a.t / a.dur);
      const s = 1 - Math.exp(-6 * t) * Math.cos(t * 9);
      arr[i]!.set(a.id, a.from * (1 - s));
    }
  }

  topY(cellId: string): number { return this.data.elevationOf(cellId) * VS; }
}
