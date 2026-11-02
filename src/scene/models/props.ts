import type { BufferGeometry } from 'three';
import type { EnemyKind } from '../../domain/types';
import { VoxelModel } from '../voxel/model';
import { FLAG_EMISSIVE } from '../materials/voxel-material';

const V = 1 / 16;

/** Enemies (GDD §8.1): distinct silhouette, hue and gait. Forward = +z. */
export function enemyGeometry(kind: EnemyKind): { body: BufferGeometry; extra?: BufferGeometry; height: number } {
  if (kind === 'slime') {
    const m = new VoxelModel(14, 11, 14);
    for (let y = 0; y < 10; y++) {
      const t = y / 9;
      const r = 6.6 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, t - 0.25) / 0.75, 2))) + (y < 2 ? 0.2 : 0);
      m.cylinder(7, 7, r, y, y, y < 2 ? 'slimeDark' : y > 7 ? 'slimeLight' : 'slime');
    }
    // eyes + mouth on +z face
    m.box(4, 5, 12, 5, 7, 13, 'eye'); m.box(9, 5, 12, 10, 7, 13, 'eye');
    m.set(4, 7, 12, 'white'); m.set(9, 7, 12, 'white');
    m.box(6, 3, 13, 8, 3, 13, 'slimeDark');
    // highlight
    m.box(3, 8, 5, 4, 8, 6, 'white');
    return { body: m.build(V), height: 0.62 };
  }
  if (kind === 'runner') {
    const m = new VoxelModel(12, 13, 20);
    // legs
    for (const [x, z] of [[3, 13], [8, 13], [3, 5], [8, 5]] as const) m.box(x, 0, z, x + 1, 4, z + 1, 'runnerDark');
    // body (leaning forward)
    m.box(2, 4, 4, 9, 8, 15, 'runner');
    m.box(3, 8, 6, 8, 9, 14, 'runnerLight');
    m.box(3, 4, 5, 8, 4, 14, 'runnerLight');
    // head
    m.box(3, 7, 14, 8, 11, 19, 'runner');
    m.box(4, 7, 18, 7, 8, 19, 'runnerLight'); // snout
    m.box(3, 11, 15, 3, 12, 16, 'runnerDark'); m.box(8, 11, 15, 8, 12, 16, 'runnerDark'); // ears
    m.box(3, 9, 18, 3, 10, 18, 'eye'); m.box(8, 9, 18, 8, 10, 18, 'eye');
    m.set(5, 8, 19, 'eye');
    const tail = new VoxelModel(6, 6, 10);
    tail.box(2, 2, 0, 3, 3, 8, 'runnerDark');
    tail.box(1, 2, 6, 4, 4, 9, 'runnerLight');
    return { body: m.build(V), extra: tail.build(V, { originY: -2 * V }), height: 0.75 };
  }
  const m = new VoxelModel(18, 16, 16);
  // legs
  m.box(3, 0, 5, 6, 4, 10, 'golemDark'); m.box(11, 0, 5, 14, 4, 10, 'golemDark');
  // torso
  m.box(1, 4, 3, 16, 12, 13, 'golem', true);
  m.box(2, 12, 4, 15, 13, 12, 'golem', true);
  // moss back + shoulders
  m.box(1, 9, 3, 16, 14, 6, 'golemMoss', true);
  m.box(0, 9, 4, 1, 12, 11, 'golemMoss'); m.box(16, 9, 4, 17, 12, 11, 'golemMoss');
  // arms
  m.box(0, 3, 6, 1, 9, 10, 'golemDark'); m.box(16, 3, 6, 17, 9, 10, 'golemDark');
  // face
  m.box(4, 8, 13, 13, 11, 14, 'golemDark');
  const eyes = new VoxelModel(18, 16, 16);
  eyes.box(5, 9, 14, 6, 10, 14, 'golemEye'); eyes.box(11, 9, 14, 12, 10, 14, 'golemEye');
  return { body: m.build(V), extra: eyes.build(V, { flags: FLAG_EMISSIVE }), height: 0.9 };
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

export function treeGeometry(variant: number): { trunk: BufferGeometry; leaves: BufferGeometry } {
  const t = new VoxelModel(16, 20, 16);
  const h = 9 + (variant % 3) * 2;
  t.box(7, 0, 7, 8, h, 8, 'trunk');
  t.box(6, 0, 6, 9, 1, 9, 'trunkDark');
  t.box(8, h - 4, 8, 10, h - 4, 8, 'trunk');
  const l = new VoxelModel(24, 18, 24);
  const blobs = variant % 2 === 0
    ? [[12, 5, 12, 6.2], [9, 8, 13, 4.2], [15, 9, 11, 4], [12, 11, 12, 3.4]]
    : [[12, 4, 12, 5.4], [12, 8, 12, 4.6], [12, 11.5, 12, 3.2], [9, 5, 9, 3.2], [15, 5, 15, 3.2]];
  for (const [x, y, z, r] of blobs) l.sphere(x!, y!, z!, r!, 'leaf');
  l.paint((x, y, z) => y > 9 || (x + z + y) % 7 === 0, 'leafLight');
  l.paint((_x, y) => y < 3, 'leafDark');
  return { trunk: t.build(V), leaves: l.build(V, { originY: (h - 2) * V }) };
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

export function grassTuftGeometry(): BufferGeometry {
  const m = new VoxelModel(6, 5, 6);
  m.box(1, 0, 2, 1, 3, 2, 'grassLight'); m.box(3, 0, 1, 3, 4, 1, 'grass'); m.box(4, 0, 4, 4, 2, 4, 'grassDark');
  m.box(2, 0, 4, 2, 2, 4, 'grassLight');
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
