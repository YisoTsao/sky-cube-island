import type { BufferGeometry } from 'three';
import type { EnemyKind } from '../../domain/types';
import { ENEMY_DEFS } from '../../domain/definitions';
import type { PaletteKey } from '../palette';
import { VoxelModel } from '../voxel/model';
import { FLAG_EMISSIVE } from '../materials/voxel-material';

const V = 1 / 16;

type Shade = [PaletteKey, PaletteKey, PaletteKey];

function slimeModel([body, light, dark]: Shade, scale: number, cores = false): { body: BufferGeometry; extra?: BufferGeometry; height: number } {
  const m = new VoxelModel(14, 11, 14);
  for (let y = 0; y < 10; y++) {
    const t = y / 9;
    const r = 6.6 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, t - 0.25) / 0.75, 2))) + (y < 2 ? 0.2 : 0);
    m.cylinder(7, 7, r, y, y, y < 2 ? dark : y > 7 ? light : body);
  }
  // eyes + mouth on +z face
  m.box(4, 5, 12, 5, 7, 13, 'eye'); m.box(9, 5, 12, 10, 7, 13, 'eye');
  m.set(4, 7, 12, 'white'); m.set(9, 7, 12, 'white');
  m.box(6, 3, 13, 8, 3, 13, dark);
  // highlight
  m.box(3, 8, 5, 4, 8, 6, 'white');
  let extra: BufferGeometry | undefined;
  if (cores) {
    // three little jellies visible inside the splitter's body
    const c = new VoxelModel(14, 11, 14);
    c.sphere(5, 4, 6, 1.6, 'jelly'); c.sphere(9, 4, 6, 1.6, 'jelly'); c.sphere(7, 6.5, 5, 1.6, 'jellyLight');
    extra = c.build(V * scale, { flags: FLAG_EMISSIVE });
  }
  return { body: m.build(V * scale), extra, height: 0.62 * scale };
}

function golemModel(scale: number, boss: boolean): { body: BufferGeometry; extra?: BufferGeometry; height: number } {
  const [stone, dark, moss]: Shade = boss ? ['boss', 'bossDark', 'bossDark'] : ['golem', 'golemDark', 'golemMoss'];
  const m = new VoxelModel(18, 19, 16);
  // legs
  m.box(3, 0, 5, 6, 4, 10, dark); m.box(11, 0, 5, 14, 4, 10, dark);
  // torso
  m.box(1, 4, 3, 16, 12, 13, stone, true);
  m.box(2, 12, 4, 15, 13, 12, stone, true);
  // moss back + shoulders
  m.box(1, 9, 3, 16, 14, 6, moss, true);
  m.box(0, 9, 4, 1, 12, 11, moss); m.box(16, 9, 4, 17, 12, 11, moss);
  // arms
  m.box(0, 3, 6, 1, 9, 10, dark); m.box(16, 3, 6, 17, 9, 10, dark);
  // face
  m.box(4, 8, 13, 13, 11, 14, dark);
  if (boss) {
    // crown of gold spikes
    m.box(3, 14, 5, 14, 14, 11, 'goldDark');
    for (const x of [3, 6, 9, 12, 14]) m.box(x, 15, 7, x, 17 + (x === 9 ? 1 : 0), 8, 'gold');
  }
  const eyes = new VoxelModel(18, 19, 16);
  const eye: PaletteKey = boss ? 'bossLava' : 'golemEye';
  eyes.box(5, 9, 14, 6, 10, 14, eye); eyes.box(11, 9, 14, 12, 10, 14, eye);
  if (boss) {
    // molten cracks across the chest
    eyes.box(5, 6, 14, 12, 6, 14, 'bossLava'); eyes.box(8, 5, 14, 9, 7, 14, 'bossLava');
  }
  return { body: m.build(V * scale), extra: eyes.build(V * scale, { flags: FLAG_EMISSIVE }), height: 0.9 * scale };
}

/** Enemies (GDD §8.1): distinct silhouette, hue and gait. Forward = +z. */
export function enemyGeometry(kind: EnemyKind): { body: BufferGeometry; extra?: BufferGeometry; height: number } {
  const scale = ENEMY_DEFS[kind].scale ?? 1;
  if (kind === 'slime') return slimeModel(['slime', 'slimeLight', 'slimeDark'], scale);
  if (kind === 'mini') return slimeModel(['jelly', 'jellyLight', 'jellyDark'], scale);
  if (kind === 'splitter') return slimeModel(['splitter', 'splitterLight', 'splitterDark'], scale, true);
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
  if (kind === 'knight') {
    // armoured beetle: low domed shell plates, six legs, horn
    const m = new VoxelModel(16, 12, 20);
    for (const z of [5, 9, 13]) { m.box(1, 0, z, 2, 3, z, 'knightDark'); m.box(13, 0, z, 14, 3, z, 'knightDark'); }
    for (let y = 2; y < 10; y++) {
      const t = (y - 2) / 7;
      const r = 6.8 * Math.sqrt(Math.max(0, 1 - t * t));
      for (let z = 3; z <= 15; z++) {
        const zz = (z - 9) / 7;
        const rr = r * Math.sqrt(Math.max(0, 1 - zz * zz * 0.5));
        for (let x = 0; x < 16; x++) {
          const dx = x + 0.5 - 7.5;
          if (Math.abs(dx) <= rr) m.set(x, y, z, Math.abs(dx) < 0.6 ? 'knightDark' : y > 7 ? 'knightLight' : 'knight', true);
        }
      }
    }
    // head + horn
    m.box(5, 3, 16, 10, 6, 18, 'knightDark');
    m.box(7, 6, 18, 8, 9, 19, 'ironLight'); m.box(7, 9, 17, 8, 10, 18, 'ironLight');
    m.set(5, 5, 18, 'golemEye'); m.set(10, 5, 18, 'golemEye');
    return { body: m.build(V), height: 0.68 };
  }
  if (kind === 'wisp') {
    // floating healing orb with leaf wings (body hovers; orb glows)
    const orb = new VoxelModel(14, 14, 14);
    orb.sphere(7, 7, 7, 4.2, 'wisp');
    orb.sphere(7, 7, 7, 2.6, 'white');
    const m = new VoxelModel(22, 14, 14);
    m.box(1, 7, 6, 6, 8, 8, 'wispLeaf'); m.box(2, 9, 6, 5, 9, 8, 'wispDeep');
    m.box(16, 7, 6, 21, 8, 8, 'wispLeaf'); m.box(17, 9, 6, 20, 9, 8, 'wispDeep');
    m.box(10, 1, 7, 11, 3, 7, 'wispDeep');
    m.box(9, 8, 11, 9, 9, 12, 'eye'); m.box(12, 8, 11, 12, 9, 12, 'eye');
    return { body: m.build(V, { originY: 2 * V }), extra: orb.build(V, { originY: 2 * V, flags: FLAG_EMISSIVE }), height: 0.95 };
  }
  return golemModel(scale, kind === 'boss');
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
