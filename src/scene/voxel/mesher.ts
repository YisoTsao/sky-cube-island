import { BufferAttribute, BufferGeometry } from 'three';

/**
 * Generic greedy voxel mesher (Tech §9.4 / §10.2).
 * Emits only exposed faces with baked per-vertex voxel AO, local face UV + size (for the
 * shader bevel/edge highlight), 4-bit exposed-edge flags and arbitrary per-face flags.
 * Faces are merged only when every baked attribute is identical, so visuals are exact.
 */
export interface VoxelSource {
  nx: number; ny: number; nz: number;
  /** World size of one voxel along each axis. */
  sx: number; sy: number; sz: number;
  /** World position of voxel (0,0,0)'s min corner. */
  ox: number; oy: number; oz: number;
  /** 0 = empty, otherwise any material id. */
  get(x: number, y: number, z: number): number;
  /** Linear RGB for the face of voxel (x,y,z) facing `dir` (0:+x 1:-x 2:+y 3:-y 4:+z 5:-z). */
  color(x: number, y: number, z: number, dir: number, mat: number, out: [number, number, number]): void;
  /** Optional per-face flags (bitfield, shader-defined). */
  flags?(x: number, y: number, z: number, dir: number, mat: number): number;
  /** Optional per-vertex animation id for terrain elevation tweening (0 = none). */
  anim?(x: number, y: number, z: number, dir: number, mat: number): number;
  /** Treat out-of-range voxels as solid (e.g. for chunk borders). */
  getOutside?(x: number, y: number, z: number): number;
}

export const AO_CURVE = [0.48, 0.64, 0.82, 1.0];

interface Face { key: string; r: number; g: number; b: number; ao0: number; ao1: number; ao2: number; ao3: number; edge: number; flags: number; anim: number }

// dir → [axis, sign]
const DIRS: ReadonlyArray<readonly [number, number]> = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];

export interface MeshOptions {
  /** Restrict meshing to [x0,x1) × [z0,z1) (chunking). */
  x0?: number; x1?: number; z0?: number; z1?: number;
  /** Disable greedy merging (cheaper keying when colours are unique). */
  greedy?: boolean;
}

export function meshVoxels(src: VoxelSource, opt: MeshOptions = {}): BufferGeometry | null {
  const X0 = opt.x0 ?? 0, X1 = opt.x1 ?? src.nx, Z0 = opt.z0 ?? 0, Z1 = opt.z1 ?? src.nz;
  const greedy = opt.greedy ?? true;
  const lo = [X0, 0, Z0];
  const hi = [X1, src.ny, Z1];
  const dims = [src.nx, src.ny, src.nz];
  const size = [src.sx, src.sy, src.sz];
  const origin = [src.ox, src.oy, src.oz];
  const solid = (x: number, y: number, z: number): boolean => {
    if (x < 0 || y < 0 || z < 0 || x >= dims[0]! || y >= dims[1]! || z >= dims[2]!) {
      return src.getOutside ? src.getOutside(x, y, z) !== 0 : false;
    }
    return src.get(x, y, z) !== 0;
  };

  const pos: number[] = []; const nor: number[] = []; const col: number[] = []; const ao: number[] = [];
  const uve: number[] = []; const edg: number[] = []; const flg: number[] = []; const anm: number[] = [];
  const idx: number[] = [];
  const rgb: [number, number, number] = [0, 0, 0];
  const p = [0, 0, 0];

  for (let dir = 0; dir < 6; dir++) {
    const [axis, sign] = DIRS[dir]!;
    // u/v axes: side faces use v = +Y so "top edge" is meaningful for the shader.
    const uAxis = axis === 1 ? 0 : axis === 0 ? 2 : 0;
    const vAxis = axis === 1 ? 2 : 1;
    const nu = hi[uAxis]! - lo[uAxis]!;
    const nv = hi[vAxis]! - lo[vAxis]!;
    const mask: (Face | null)[] = new Array(nu * nv);
    const n = [0, 0, 0]; n[axis] = sign;
    const U = [0, 0, 0]; U[uAxis] = 1;
    const V = [0, 0, 0]; V[vAxis] = 1;

    for (let s = lo[axis]!; s < hi[axis]!; s++) {
      mask.fill(null);
      let any = false;
      for (let v = 0; v < nv; v++) {
        for (let u = 0; u < nu; u++) {
          p[axis] = s; p[uAxis] = lo[uAxis]! + u; p[vAxis] = lo[vAxis]! + v;
          const [x, y, z] = p as [number, number, number];
          const mat = src.get(x, y, z);
          if (!mat) continue;
          if (solid(x + n[0]!, y + n[1]!, z + n[2]!)) continue;
          // AO for the four corners (−u−v, +u−v, +u+v, −u+v)
          const a = [0, 0, 0, 0];
          const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
          for (let c = 0; c < 4; c++) {
            const [du, dv] = corners[c]!;
            const bx = x + n[0]!, by = y + n[1]!, bz = z + n[2]!;
            const s1 = solid(bx + du * U[0]!, by + du * U[1]!, bz + du * U[2]!) ? 1 : 0;
            const s2 = solid(bx + dv * V[0]!, by + dv * V[1]!, bz + dv * V[2]!) ? 1 : 0;
            const cc = solid(bx + du * U[0]! + dv * V[0]!, by + du * U[1]! + dv * V[1]!, bz + du * U[2]! + dv * V[2]!) ? 1 : 0;
            a[c] = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
          }
          // exposed edges: 1=-u 2=+u 4=-v 8=+v (neighbour in-plane is empty)
          let edge = 0;
          if (!solid(x - U[0]!, y - U[1]!, z - U[2]!)) edge |= 1;
          if (!solid(x + U[0]!, y + U[1]!, z + U[2]!)) edge |= 2;
          if (!solid(x - V[0]!, y - V[1]!, z - V[2]!)) edge |= 4;
          if (!solid(x + V[0]!, y + V[1]!, z + V[2]!)) edge |= 8;
          src.color(x, y, z, dir, mat, rgb);
          const flags = src.flags ? src.flags(x, y, z, dir, mat) : 0;
          const anim = src.anim ? src.anim(x, y, z, dir, mat) : 0;
          const r = Math.round(rgb[0] * 1000), g = Math.round(rgb[1] * 1000), b = Math.round(rgb[2] * 1000);
          const key = greedy ? `${r},${g},${b},${a[0]}${a[1]}${a[2]}${a[3]},${edge},${flags},${anim}` : '';
          mask[u + v * nu] = { key, r: rgb[0], g: rgb[1], b: rgb[2], ao0: a[0]!, ao1: a[1]!, ao2: a[2]!, ao3: a[3]!, edge, flags, anim };
          any = true;
        }
      }
      if (!any) continue;
      for (let v = 0; v < nv; v++) {
        for (let u = 0; u < nu;) {
          const f = mask[u + v * nu];
          if (!f) { u++; continue; }
          let w = 1;
          let h = 1;
          if (greedy) {
            while (u + w < nu && mask[u + w + v * nu]?.key === f.key) w++;
            outer: while (v + h < nv) {
              for (let k = 0; k < w; k++) if (mask[u + k + (v + h) * nu]?.key !== f.key) break outer;
              h++;
            }
          }
          for (let dv = 0; dv < h; dv++) for (let du = 0; du < w; du++) mask[u + du + (v + dv) * nu] = null;

          // Emit quad
          const plane = (s + (sign > 0 ? 1 : 0)) * size[axis]! + origin[axis]!;
          const u0 = (lo[uAxis]! + u) * size[uAxis]! + origin[uAxis]!;
          const u1 = (lo[uAxis]! + u + w) * size[uAxis]! + origin[uAxis]!;
          const v0 = (lo[vAxis]! + v) * size[vAxis]! + origin[vAxis]!;
          const v1 = (lo[vAxis]! + v + h) * size[vAxis]! + origin[vAxis]!;
          const base = pos.length / 3;
          const quad = [[u0, v0, 0, 0], [u1, v0, 1, 0], [u1, v1, 1, 1], [u0, v1, 0, 1]] as const;
          const aos = [f.ao0, f.ao1, f.ao2, f.ao3];
          const qw = w * size[uAxis]!;
          const qh = h * size[vAxis]!;
          for (let c = 0; c < 4; c++) {
            const q = quad[c]!;
            const vtx = [0, 0, 0];
            vtx[axis] = plane; vtx[uAxis] = q[0]; vtx[vAxis] = q[1];
            pos.push(vtx[0]!, vtx[1]!, vtx[2]!);
            nor.push(n[0]!, n[1]!, n[2]!);
            col.push(f.r, f.g, f.b);
            ao.push(AO_CURVE[aos[c]!]!);
            uve.push(q[2], q[3], qw, qh);
            edg.push(f.edge);
            flg.push(f.flags);
            // animate only vertices on the top edge of side faces / top faces
            anm.push(f.anim && (axis === 1 ? sign > 0 : q[3] === 1) ? f.anim : 0);
          }
          // winding: CCW seen from +normal. Flip diagonal by AO (anisotropy fix).
          const flip = aos[0]! + aos[2]! < aos[1]! + aos[3]!;
          let tris = flip ? [0, 1, 3, 1, 2, 3] : [0, 1, 2, 0, 2, 3];
          // check orientation of first triangle
          const ia = base + tris[0]!, ib = base + tris[1]!, ic = base + tris[2]!;
          const ax = pos[ib * 3]! - pos[ia * 3]!, ay = pos[ib * 3 + 1]! - pos[ia * 3 + 1]!, az = pos[ib * 3 + 2]! - pos[ia * 3 + 2]!;
          const bx = pos[ic * 3]! - pos[ia * 3]!, by = pos[ic * 3 + 1]! - pos[ia * 3 + 1]!, bz = pos[ic * 3 + 2]! - pos[ia * 3 + 2]!;
          const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
          if (cx * n[0]! + cy * n[1]! + cz * n[2]! < 0) tris = [tris[0]!, tris[2]!, tris[1]!, tris[3]!, tris[5]!, tris[4]!];
          for (const t of tris) idx.push(base + t);
          u += w;
        }
      }
    }
  }
  if (!idx.length) return null;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  geo.setAttribute('aAo', new BufferAttribute(new Float32Array(ao), 1));
  geo.setAttribute('aUvE', new BufferAttribute(new Float32Array(uve), 4));
  geo.setAttribute('aEdge', new BufferAttribute(new Float32Array(edg), 1));
  geo.setAttribute('aFlags', new BufferAttribute(new Float32Array(flg), 1));
  geo.setAttribute('aAnim', new BufferAttribute(new Float32Array(anm), 1));
  const vcount = pos.length / 3;
  geo.setIndex(new BufferAttribute(vcount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
