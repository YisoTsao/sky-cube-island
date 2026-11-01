import type { BufferGeometry } from 'three';
import type { TowerKind, TowerLevel } from '../../domain/types';
import { VoxelModel } from '../voxel/model';
import { FLAG_EMISSIVE } from '../materials/voxel-material';

/**
 * Procedural 1/16 micro-voxel towers (GDD §7.1, §11.7). Footprint 2×2 cells = 32×32 voxels.
 * Each tower is split into a static `body` and an aimable `head` whose pivot sits at the
 * logical muzzle height (arrow 1.6 / frost 1.4 / cannon 1.1 world units — D21-08).
 */
export interface TowerParts {
  body: BufferGeometry;
  head: BufferGeometry;
  /** Emissive-only parts (crystals) rendered with the emissive flag. */
  glow?: BufferGeometry;
  /** Cloth/flag parts that sway in the wind. */
  cloth?: BufferGeometry;
  /** Head pivot height (world units, from tower base). */
  headY: number;
}

const V = 1 / 16;

function stoneBase(m: VoxelModel, h: number, inset = 3) {
  m.box(inset, 0, inset, 31 - inset, h, 31 - inset, 'rock', true);
  m.box(inset, h, inset, 31 - inset, h, 31 - inset, 'rockLight', true);
  // corner blocks
  for (const [x, z] of [[inset, inset], [31 - inset, inset], [inset, 31 - inset], [31 - inset, 31 - inset]] as const) {
    m.box(x - 1, 0, z - 1, x + 1, h + 1, z + 1, 'rockDark', true);
  }
}

function arrowTower(level: TowerLevel): TowerParts {
  const body = new VoxelModel(32, 36, 32);
  if (level >= 2) stoneBase(body, 5, 2);
  const y0 = level >= 2 ? 6 : 0;
  // four slanted posts
  for (const [x, z] of [[6, 6], [24, 6], [6, 24], [24, 24]] as const) {
    for (let y = y0; y < 22; y++) {
      const k = Math.round((y - y0) / 7);
      const px = x < 16 ? x + k : x - k;
      const pz = z < 16 ? z + k : z - k;
      body.box(px, y, pz, px + 1, y, pz + 1, y % 6 === 0 ? 'woodDark' : 'wood');
    }
  }
  // cross bracing
  for (let i = 0; i < 12; i++) {
    body.set(8 + i, y0 + 4 + i * 0.6, 7, 'woodDark');
    body.set(8 + i, y0 + 4 + i * 0.6, 24, 'woodDark');
    body.set(7, y0 + 4 + i * 0.6, 8 + i, 'woodDark');
    body.set(24, y0 + 4 + i * 0.6, 8 + i, 'woodDark');
  }
  // platform
  body.box(7, 21, 7, 24, 22, 24, 'plank');
  for (let x = 7; x <= 24; x += 2) body.box(x, 22, 7, x, 22, 24, 'woodLight');
  // railing
  for (const [x0, z0, x1, z1] of [[6, 6, 25, 6], [6, 25, 25, 25], [6, 6, 6, 25], [25, 6, 25, 25]] as const) {
    body.box(x0, 23, z0, x1, 23, z1, 'woodDark');
    body.box(x0, 26, z0, x1, 26, z1, 'wood');
  }
  for (const [x, z] of [[6, 6], [25, 6], [6, 25], [25, 25], [15, 6], [16, 25], [6, 15], [25, 16]] as const) body.box(x, 23, z, x, 27, z, 'woodDark');
  let cloth: VoxelModel | undefined;
  if (level >= 2) {
    // canopy roof on 4 poles
    for (const [x, z] of [[7, 7], [24, 7], [7, 24], [24, 24]] as const) body.box(x, 27, z, x, 32, z, 'woodDark');
    cloth = new VoxelModel(32, 36, 32);
    for (let y = 32; y <= 35; y++) {
      const r = 35 - y;
      cloth.box(6 + r * 2, y, 6 + r * 2, 25 - r * 2, y, 25 - r * 2, (y + 0) % 2 ? 'cloth' : 'clothDark');
    }
  }
  if (level >= 3) {
    cloth ??= new VoxelModel(32, 36, 32);
    // golden banners hanging from the railing
    for (const [x, z] of [[11, 5], [20, 5], [11, 26], [20, 26]] as const) {
      body.box(x, 22, z, x + 1, 23, z, 'gold');
      cloth.box(x, 15, z, x + 1, 22, z, 'gold');
      cloth.box(x, 15, z, x + 1, 16, z, 'goldDark');
    }
  }
  // head: crossbow(s) — pivot at 1.6 world (25.6 voxels) → head geometry is local
  const head = new VoxelModel(20, 8, 20);
  const bows = level >= 3 ? [-3, 3] : [0];
  for (const off of bows) {
    const cx = 10 + off;
    head.box(cx - 1, 2, 3, cx, 3, 16, 'woodDark'); // stock
    head.box(cx - 6, 3, 13, cx + 5, 3, 14, level >= 3 ? 'gold' : 'wood'); // limbs
    head.box(cx - 7, 3, 12, cx - 6, 3, 12, 'iron');
    head.box(cx + 5, 3, 12, cx + 6, 3, 12, 'iron');
    head.box(cx - 1, 4, 6, cx, 4, 17, 'banner'); // bolt
    head.box(cx - 1, 4, 17, cx, 4, 18, 'ironLight');
  }
  head.box(8, 0, 8, 11, 1, 11, 'iron');
  return {
    body: body.build(V),
    head: head.build(V, { originY: -2.5 * V }),
    cloth: cloth?.build(V),
    headY: 1.6,
  };
}

function frostTower(level: TowerLevel): TowerParts {
  const body = new VoxelModel(32, 24, 32);
  stoneBase(body, 4, 4);
  // tiered pedestal
  body.box(8, 5, 8, 23, 8, 23, 'stone', true);
  body.box(10, 9, 10, 21, 11, 21, 'stoneLight', true);
  for (const [x, z] of [[8, 8], [23, 8], [8, 23], [23, 23]] as const) body.box(x, 5, z, x, 12, z, 'crystalDeep');
  if (level >= 2) {
    body.box(4, 5, 4, 6, 9, 6, 'rockDark');
    body.box(25, 5, 25, 27, 9, 27, 'rockDark');
    body.box(4, 5, 25, 6, 9, 27, 'rockDark');
    body.box(25, 5, 4, 27, 9, 6, 'rockDark');
  }
  const glow = new VoxelModel(32, 32, 32);
  const crystal = (cx: number, cz: number, h: number, r: number, y0: number) => {
    for (let y = 0; y < h; y++) {
      const t = y / h;
      const rr = t < 0.7 ? r : r * (1 - (t - 0.7) / 0.3);
      glow.cylinder(cx, cz, Math.max(0.6, rr), y0 + y, y0 + y, t > 0.82 ? 'crystalLight' : y % 4 === 0 ? 'crystalDeep' : 'crystal');
    }
  };
  if (level === 1) crystal(16, 16, 12, 2.6, 12);
  if (level >= 2) {
    crystal(16, 16, 12, 2.4, 12);
    crystal(12.5, 18.5, 7, 1.5, 12);
    crystal(19.5, 13.5, 8, 1.6, 12);
  }
  // head = floating focus crystal at muzzle (1.4 world = 22.4 vox); Lv3 adds orbiting ring
  const head = new VoxelModel(24, 9, 24);
  head.sphere(12, 4.5, 12, 2.6, 'crystalLight', 1.4);
  if (level >= 3) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const x = 12 + Math.cos(ang) * 9, z = 12 + Math.sin(ang) * 9;
      if (a % 2 === 0) head.box(x - 0.5, 4, z - 0.5, x + 0.5, 5, z + 0.5, a % 4 === 0 ? 'crystal' : 'crystalLight');
    }
  }
  return {
    body: body.build(V),
    glow: glow.build(V, { flags: FLAG_EMISSIVE }),
    head: head.build(V, { originY: -4.5 * V, flags: FLAG_EMISSIVE }),
    headY: 1.4,
  };
}

function cannonTower(level: TowerLevel): TowerParts {
  const body = new VoxelModel(32, 20, 32);
  stoneBase(body, 7, 2);
  // crenellations
  for (let i = 3; i <= 28; i += 4) {
    body.box(i, 8, 2, i + 1, 10, 3, 'rockLight', true);
    body.box(i, 8, 28, i + 1, 10, 29, 'rockLight', true);
    body.box(2, 8, i, 3, 10, i + 1, 'rockLight', true);
    body.box(28, 8, i, 29, 10, i + 1, 'rockLight', true);
  }
  // inner turntable
  body.cylinder(16, 16, 9, 8, 9, 'woodDark');
  body.cylinder(16, 16, 8, 10, 10, 'iron');
  if (level >= 2) {
    body.box(2, 3, 2, 29, 3, 2, 'iron'); body.box(2, 3, 29, 29, 3, 29, 'iron');
    body.box(2, 3, 2, 2, 3, 29, 'iron'); body.box(29, 3, 2, 29, 3, 29, 'iron');
  }
  let glow: VoxelModel | undefined;
  if (level >= 3) {
    glow = new VoxelModel(32, 20, 32);
    for (const [x, z] of [[8, 1], [23, 1], [8, 30], [23, 30]] as const) glow.box(x, 4, z, x + 1, 5, z, 'rune');
  }
  // head: barrel(s) pointing +z, pivot at 1.1 world (17.6 vox)
  const head = new VoxelModel(22, 10, 26);
  head.box(6, 0, 6, 15, 4, 15, 'woodDark'); // carriage
  head.box(5, 0, 8, 5, 3, 13, 'wood'); head.box(16, 0, 8, 16, 3, 13, 'wood');
  const barrels = level >= 3 ? [7, 14] : [10.5];
  for (const bx of barrels) {
    const r = level >= 3 ? 2.2 : 2.8;
    for (let z = 4; z < 25; z++) {
      for (let y = 0; y < 10; y++) for (let x = 0; x < 22; x++) {
        const dx = x + 0.5 - bx - 0.5, dy = y + 0.5 - 5;
        const rr = z > 21 ? r + 0.7 : r;
        if (dx * dx + dy * dy <= rr * rr) head.set(x, y, z, z > 21 || (level >= 2 && z % 6 === 0) ? 'ironLight' : 'iron');
      }
    }
    // muzzle hole
    head.set(bx, 5, 24, null); head.set(bx + 1, 5, 24, null);
  }
  return {
    body: body.build(V),
    head: head.build(V, { originY: -5 * V }),
    glow: glow?.build(V, { flags: FLAG_EMISSIVE }),
    headY: 1.1,
  };
}

const cache = new Map<string, TowerParts>();
export function towerParts(kind: TowerKind, level: TowerLevel): TowerParts {
  const key = `${kind}:${level}`;
  let p = cache.get(key);
  if (!p) {
    p = kind === 'arrow' ? arrowTower(level) : kind === 'frost' ? frostTower(level) : cannonTower(level);
    cache.set(key, p);
  }
  return p;
}
