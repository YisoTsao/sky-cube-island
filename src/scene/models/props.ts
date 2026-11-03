import type { BufferGeometry } from 'three';
import type { PaletteKey } from '../palette';
import { VoxelModel } from '../voxel/model';
import { FLAG_EMISSIVE } from '../materials/voxel-material';

const V = 1 / 16;

type Shade = [PaletteKey, PaletteKey, PaletteKey];

export { enemyGeometry } from './enemies';

/** Spike trap (陷阱): a flush iron plate (body) and the spikes that shoot up when triggered (extra). */
export function trapGeometry(): { plate: BufferGeometry; spikes: BufferGeometry } {
  const m = new VoxelModel(16, 2, 16);
  m.box(1, 0, 1, 14, 0, 14, 'trapDark');
  m.box(2, 1, 2, 13, 1, 13, 'trap');
  for (let x = 3; x <= 12; x += 3) for (let z = 3; z <= 12; z += 3) m.box(x, 1, z, x + 1, 1, z + 1, 'trapDark');
  const sp = new VoxelModel(16, 7, 16);
  for (let x = 3; x <= 12; x += 3) for (let z = 3; z <= 12; z += 3) { sp.box(x, 0, z, x + 1, 4, z + 1, 'trapSpike'); sp.set(x, 5, z, 'white'); }
  return { plate: m.build(V), spikes: sp.build(V) };
}

/** Wooden barricade with stone footing (路障, 1×1 cell). */
export function wallGeometry(): BufferGeometry {
  const m = new VoxelModel(16, 14, 16);
  m.box(1, 0, 1, 14, 2, 14, 'rock', true);
  m.box(1, 3, 1, 14, 3, 14, 'rockLight', true);
  for (let x = 2; x <= 13; x += 3) {
    m.box(x, 4, 6, x + 1, 11 + (x % 2), 9, 'wood');
    m.box(x, 12 + (x % 2), 7, x + 1, 12 + (x % 2), 8, 'woodLight');
  }
  m.box(1, 6, 5, 14, 6, 5, 'woodDark'); m.box(1, 9, 10, 14, 9, 10, 'woodDark');
  m.box(1, 6, 10, 14, 6, 10, 'woodDark'); m.box(1, 9, 5, 14, 9, 5, 'woodDark');
  return m.build(V);
}

export type Foliage = 'green' | 'snow' | 'autumn';

export function treeGeometry(variant: number, foliage: Foliage = 'green'): { trunk: BufferGeometry; leaves: BufferGeometry } {
  if (foliage === 'snow') return pineGeometry(variant);
  const t = new VoxelModel(16, 20, 16);
  const h = 9 + (variant % 3) * 2;
  t.box(7, 0, 7, 8, h, 8, 'trunk');
  t.box(6, 0, 6, 9, 1, 9, 'trunkDark');
  t.box(8, h - 4, 8, 10, h - 4, 8, 'trunk');
  const l = new VoxelModel(24, 18, 24);
  const blobs = variant % 2 === 0
    ? [[12, 5, 12, 6.2], [9, 8, 13, 4.2], [15, 9, 11, 4], [12, 11, 12, 3.4]]
    : [[12, 4, 12, 5.4], [12, 8, 12, 4.6], [12, 11.5, 12, 3.2], [9, 5, 9, 3.2], [15, 5, 15, 3.2]];
  const [leaf, light, dark]: Shade = foliage === 'autumn' ? ['autumn', 'autumnLight', 'autumnDark'] : ['leaf', 'leafLight', 'leafDark'];
  for (const [x, y, z, r] of blobs) l.sphere(x!, y!, z!, r!, leaf);
  l.paint((x, y, z) => y > 9 || (x + z + y) % 7 === 0, light);
  l.paint((_x, y) => y < 3, dark);
  return { trunk: t.build(V), leaves: l.build(V, { originY: (h - 2) * V }) };
}

/** Snow-capped pine: stacked cones with white tips. */
function pineGeometry(variant: number): { trunk: BufferGeometry; leaves: BufferGeometry } {
  const t = new VoxelModel(16, 8, 16);
  t.box(7, 0, 7, 8, 5, 8, 'trunkDark');
  const l = new VoxelModel(20, 26, 20);
  const tiers = 3 + (variant % 2);
  for (let i = 0; i < tiers; i++) {
    const y0 = i * 5;
    for (let y = 0; y < 7; y++) {
      const r = (7.5 - i * 1.4) * (1 - y / 7) + 0.6;
      l.cylinder(10, 10, r, y0 + y, y0 + y, y >= 4 ? 'snow' : i % 2 ? 'pine' : 'pineDark');
    }
  }
  l.paint((x, y, z) => (x + z + y) % 9 === 0, 'snowShade');
  return { trunk: t.build(V), leaves: l.build(V, { originY: 4 * V }) };
}

export function rockGeometry(variant: number): BufferGeometry {
  const m = new VoxelModel(14, 9, 14);
  m.sphere(7, 2, 7, 5 + (variant % 2), 'rock', 0.9, true);
  m.sphere(5, 4, 8, 3, 'rockLight', 1, true);
  m.paint((_x, y) => y === 0, 'rockDark');
  if (variant % 3 === 0) m.paint((x, y, z) => y >= 4 && (x + z) % 3 === 0, 'golemMoss');
  return m.build(V);
}

export function flowerGeometry(color: 'flowerY' | 'flowerP' | 'flowerW' | 'flowerV'): BufferGeometry {
  const m = new VoxelModel(5, 5, 5);
  m.box(2, 0, 2, 2, 2, 2, 'leafDark');
  m.box(1, 3, 2, 3, 3, 2, color); m.box(2, 3, 1, 2, 3, 3, color);
  m.set(2, 3, 2, 'flowerY');
  return m.build(V);
}

export function grassTuftGeometry([g, gl, gd]: Shade = ['grass', 'grassLight', 'grassDark']): BufferGeometry {
  const m = new VoxelModel(6, 5, 6);
  m.box(1, 0, 2, 1, 3, 2, gl); m.box(3, 0, 1, 3, 4, 1, g); m.box(4, 0, 4, 4, 2, 4, gd);
  m.box(2, 0, 4, 2, 2, 4, gl);
  return m.build(V);
}

/** Lantern on a post (bridge ends). */
export function lanternGeometry(): { post: BufferGeometry; light: BufferGeometry } {
  const p = new VoxelModel(6, 17, 6);
  p.box(2, 0, 2, 3, 12, 3, 'woodDark');
  p.box(1, 13, 1, 4, 13, 4, 'iron');
  p.box(1, 16, 1, 4, 16, 4, 'iron');
  const l = new VoxelModel(6, 18, 6);
  l.box(2, 14, 2, 3, 15, 3, 'lantern');
  return { post: p.build(V), light: l.build(V, { flags: FLAG_EMISSIVE }) };
}
