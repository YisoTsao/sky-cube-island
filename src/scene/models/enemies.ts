import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { EnemyKind } from '../../domain/types';
import { ENEMY_DEFS } from '../../domain/definitions';
import type { PaletteKey } from '../palette';
import { Sculpt } from '../voxel/sculpt';
import { FLAG_EMISSIVE } from '../materials/voxel-material';

/**
 * Enemy models (GDD §8.1): distinct silhouette, hue and gait. Forward = +z.
 *
 * Sculpted in art units (1 unit = 1/16 cell) and rasterised at `k` voxels per unit:
 * `detail: 'high'` uses k = 2 (1/32-cell voxels: faces, glints, fur, scales), `'low'` uses
 * k = 1 for low-end devices. Geometry is built once per kind/detail and shared by every
 * enemy of that kind (see `enemyGeometry`).
 */
export type EnemyDetail = 'high' | 'low';
export interface EnemyGeometry { body: BufferGeometry; extra?: BufferGeometry; height: number }

const V = 1 / 16;
type Shade = [PaletteKey, PaletteKey, PaletteKey];
const hash = (x: number, y: number, z: number) => { const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return h - Math.floor(h); };
const merge = (a: BufferGeometry, b: BufferGeometry): BufferGeometry => mergeGeometries([a, b]) ?? a;
const glow = (s: Sculpt, scale: number, originY = 0) => s.build(V * scale, { originY, flags: FLAG_EMISSIVE });

// ───────────────────────────── slimes ─────────────────────────────
function slimeModel(k: number, [body, light, dark]: Shade, scale: number, opts: { cores?: boolean; seam?: boolean } = {}): EnemyGeometry {
  const s = new Sculpt(14, 11, 14, k);
  // soft dome with a slightly spread, darker base
  s.ell(7, 4.2, 7, 6.6, 5.2, 6.6, body);
  s.cyl(7, 7, 6.9, 0, 1, dark);
  s.box(0, -1, 0, 14, 0, 14, null);
  s.paint((_x, y) => y < 1.4, dark);
  s.paint((x, y, z) => y > 7.4 || (y > 6.4 && (x - 7) * (x - 7) + (z - 7) * (z - 7) < 12), light);
  // drips around the base
  for (const [x, z] of [[1.2, 5.5], [12.8, 8.5], [4.5, 12.6], [10, 1.4], [2.8, 2.6]] as const) s.ball(x, 0.6, z, 0.9, dark);
  // glossy highlight
  s.decal('+y', 3.4, 4.2, 5.6, 5.4, 'white'); s.decal('+y', 3.0, 5.4, 4.0, 6.6, 'white'); s.decal('+y', 6.2, 3.6, 7, 4.4, 'white');
  if (opts.seam) s.paint((x, y) => Math.abs(x - 7) < 0.45 && y > 1.2 && y < 9, dark);
  // face
  s.eye(3.5, 4.4, 5.5, 7.2, { outer: 'left' });
  s.eye(8.5, 4.4, 10.5, 7.2, { outer: 'right' });
  s.decal('+z', 6, 3.4, 8, 4, 'mouth');
  s.decal('+z', 6.5, 2.9, 7.5, 3.4, 'tongue');
  s.decal('+z', 2.2, 3.4, 3.6, 4.2, 'blush'); s.decal('+z', 10.4, 3.4, 11.8, 4.2, 'blush');
  let extra: BufferGeometry | undefined;
  if (opts.cores) {
    // little jellies visible inside the translucent body
    const c = new Sculpt(14, 11, 14, k);
    c.ball(5, 3.6, 6, 1.7, 'jelly'); c.ball(9, 3.6, 6, 1.7, 'jelly'); c.ball(7, 6.2, 5.4, 1.7, 'jellyLight');
    c.decal('+z', 4.5, 3.6, 5.5, 4.4, 'jellyDark'); c.decal('+z', 8.5, 3.6, 9.5, 4.4, 'jellyDark'); c.decal('+z', 6.5, 6.2, 7.5, 7, 'jellyDark');
    extra = glow(c, scale);
  }
  return { body: s.build(V * scale), extra, height: 0.62 * scale };
}

function queenModel(k: number, scale: number): EnemyGeometry {
  const r = slimeModel(k, ['queen', 'queenLight', 'queenDark'], scale, { cores: true });
  const c = new Sculpt(14, 15, 14, k);
  // golden crown: band with studs, five points tipped with pearls, a ruby at the front
  c.cyl(7, 7, 3.6, 9.6, 11, 'goldDark');
  c.cyl(7, 7, 2.8, 9.6, 11, null);
  c.cyl(7, 7, 3.6, 10.5, 11, 'gold');
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = 7 + Math.sin(a) * 3.2, z = 7 + Math.cos(a) * 3.2;
    c.seg([x, 11, z], [x, 12.6 + (i % 2 ? 0 : 0.8), z], 0.75, 'gold', 0.45);
    if (i % 2 === 0) c.ball(x, 13.4, z, 0.55, 'white');
  }
  c.decal('+z', 6.2, 9.8, 7.8, 11, 'ruby', { raise: 0.5 });
  // royal cape over the back
  const cape = new Sculpt(14, 11, 14, k);
  cape.ell(7, 4.4, 6.4, 6.9, 5.4, 6.9, 'clothDark');
  cape.box(0, 0, 3.2, 14, 11, 14, null);
  cape.box(0, 0, 0, 14, 0.6, 14, null);
  cape.paint((_x, y) => y > 7.6, 'shamanTrim');
  cape.paint((x, y, z) => y < 7.6 && (Math.floor(x * 0.9) + Math.floor(y * 0.6)) % 3 === 0 && z < 1.4, 'cloth');
  return { body: merge(merge(r.body, c.build(V * scale)), cape.build(V * scale)), extra: r.extra, height: r.height + 0.25 * scale };
}

// ───────────────────────────── golems ─────────────────────────────
function golemModel(k: number, scale: number, variant: 'golem' | 'boss' | 'frost'): EnemyGeometry {
  const boss = variant !== 'golem', frost = variant === 'frost';
  const [stone, dark, top]: Shade = frost ? ['frostGiant', 'frostGiantDark', 'snow'] : boss ? ['boss', 'bossDark', 'bossDark'] : ['golem', 'golemDark', 'moss'];
  const s = new Sculpt(18, 20, 16, k);
  const g = new Sculpt(18, 20, 16, k);
  const glowC: PaletteKey = frost ? 'crystalLight' : boss ? 'bossLava' : 'golemRune';
  // stubby legs with toe stones
  for (const x of [5, 13]) { s.box(x - 2, 0, 5, x + 2, 4.6, 11, dark, 0.12); s.box(x - 2.2, 0, 10, x + 2.2, 1.4, 12, stone, 0.12); }
  // chunky torso, slightly rounded by bevelled corners
  s.box(1.5, 4, 3, 16.5, 13, 13.5, stone, 0.14);
  s.box(2.5, 13, 4, 15.5, 14.4, 12.5, stone, 0.14);
  for (const [x, z] of [[1.5, 3], [16.5, 3], [1.5, 13.5], [16.5, 13.5]] as const) s.cyl(x, z, 1.1, 4, 14.4, null);
  // head block sunk into the shoulders with a heavy brow
  s.box(5, 10, 9, 13, 15.6, 14.5, stone, 0.14);
  s.box(4.6, 13.4, 13.6, 13.4, 14.6, 15.2, dark);
  s.box(5.5, 11, 14.4, 12.5, 13.4, 14.8, 'eye');
  // boulder shoulders and long arms ending in fists
  for (const sx of [-1, 1]) {
    const cx = 9 + sx * 8;
    s.ell(cx, 12.6, 8, 2.6, 2.2, 3, stone, 0.14);
    s.box(cx - 1.4, 5, 6.2, cx + 1.4, 11.5, 9.8, dark, 0.12);
    s.box(cx - 1.9, 1.8, 5.6, cx + 1.9, 5.4, 10.6, stone, 0.12);
    s.decal('+z', cx - 1.5, 2.6, cx - 0.9, 5, dark); s.decal('+z', cx + 0.1, 2.6, cx + 0.7, 5, dark);
  }
  // chisel cracks / mortar lines
  s.paint((x, y, z) => (Math.abs(y - 8.5) < 0.3 || Math.abs(x - 6 - (y > 8.5 ? 3 : 0)) < 0.3) && y > 4.4 && y < 12.8 && (z > 13.2 || z < 3.3), frost ? 'frostGiantDark' : 'golemCrack');
  s.paint((x, y, z) => y > 4 && y < 13 && hash(Math.floor(x), Math.floor(y), Math.floor(z)) > 0.93, dark);
  // eyes deep under the brow + chest rune / cracks
  g.box(6.4, 11.6, 14.6, 8.2, 12.8, 15, glowC); g.box(9.8, 11.6, 14.6, 11.6, 12.8, 15, glowC);
  if (frost) {
    // snow cap, icicle beard, ice crystals on shoulders and back
    s.paint((_x, y) => y > 14, 'snow');
    s.paint((x, y, z) => y > 12.4 && (x < 3.5 || x > 14.5) && hash(Math.floor(x), 0, Math.floor(z)) > 0.35, 'snow');
    for (let x = 5.6; x < 12.6; x += 1.15) s.seg([x, 10.2, 14.6], [x + 0.2, 7.6 - (Math.floor(x * 3) % 3) * 0.9, 14.9], 0.55, 'frostBeard', 0.2);
    for (const [x, z, h, lean] of [[1, 6, 5, -1], [17, 7, 6, 1], [5, 4, 4.5, -0.5], [13, 3.6, 5.5, 0.6], [9, 4.6, 6.5, 0], [11, 6.6, 3.6, 0.4]] as const) {
      g.seg([x, 13.2, z], [x + lean, 13.2 + h, z - 0.6], 1.0, x % 2 ? 'ice' : 'crystal', 0.35);
      g.seg([x + lean * 0.9, 12.8 + h * 0.9, z - 0.5], [x + lean, 13.2 + h, z - 0.6], 0.5, 'crystalLight', 0.25);
    }
    g.box(7.6, 6.2, 13.4, 10.4, 9, 13.8, 'crystalLight');
    g.box(8.4, 5.4, 13.4, 9.6, 9.8, 13.8, 'crystalLight');
  } else if (boss) {
    // crown of gold spikes with rubies, molten cracks, shoulder horns
    s.box(4.4, 15.6, 8.6, 13.6, 16.6, 14, 'goldDark');
    for (const x of [5, 7, 9, 11, 13]) s.seg([x, 16.4, 11.2], [x, 18.6 + (x === 9 ? 1.2 : 0), 11.2], 0.75, 'gold', 0.35);
    s.decal('+z', 8.4, 15.8, 9.6, 16.6, 'ruby', { raise: 0.5 });
    for (const sx of [-1, 1]) s.seg([9 + sx * 8, 14.2, 8], [9 + sx * 9.6, 17.4, 7], 1, 'bossDark', 0.3);
    const crack = (x0: number, y0: number, x1: number, y1: number) => g.seg([x0, y0, 13.65], [x1, y1, 13.65], 0.32, 'bossLava');
    crack(5, 6, 8.6, 8.2); crack(8.6, 8.2, 12.4, 6.4); crack(8.6, 8.2, 8.8, 5); crack(12.4, 6.4, 14.2, 9.4); crack(3.6, 10.4, 5, 6);
    g.box(7.8, 6.8, 13.4, 9.6, 8.8, 13.8, 'bossCrack');
    g.seg([2.2, 6.6, 3.2], [5.2, 9.6, 3.2], 0.32, 'bossLava'); g.seg([12, 5, 2.85], [15, 10, 2.85], 0.32, 'bossLava');
  } else {
    // mossy back + shoulders with sprouts and a flower, glowing chest rune
    s.paint((_x, y, z) => y > 13 || (z < 6.5 && y > 8.5), top);
    s.paint((x, y, z) => (y > 13 || (z < 6.5 && y > 8.5)) && hash(Math.floor(x * 2), Math.floor(y * 2), Math.floor(z * 2)) > 0.72, 'mossDark');
    for (const [x, z] of [[4, 6], [7.5, 5], [13, 7], [11, 5.5]] as const) s.seg([x, 14.2, z], [x + 0.3, 15.8, z], 0.4, 'leafLight', 0.3);
    s.ball(5.6, 15.4, 9.2, 0.7, 'flowerY'); s.ball(5.6, 15.4, 9.2, 0.35, 'goldDark');
    s.seg([2, 13, 6], [1.6, 9.6, 6.2], 0.5, 'mossDark', 0.3);
    g.box(7.6, 6, 13.4, 10.4, 6.6, 13.8, glowC); g.box(8.7, 5, 13.4, 9.3, 9.4, 13.8, glowC);
    g.box(7.6, 8.4, 13.4, 8.2, 9.4, 13.8, glowC); g.box(9.8, 8.4, 13.4, 10.4, 9.4, 13.8, glowC);
  }
  return { body: s.build(V * scale), extra: glow(g, scale), height: 0.9 * scale };
}

// ───────────────────────────── creatures ─────────────────────────────
function runnerModel(k: number): EnemyGeometry {
  const s = new Sculpt(12, 14, 21, k);
  // four slim legs with dark paws
  for (const [x, z, f] of [[3.4, 13.6, 1], [8.6, 13.6, 1], [3.4, 5.6, -1], [8.6, 5.6, -1]] as const) {
    s.path([[x, 5.6, z], [x, 2.6, z - f * 0.8], [x, 0.6, z + f * 0.3]], 0.85, 'runner', 0.7);
    s.box(x - 0.9, 0, z - 0.6 + f * 0.3, x + 0.9, 1, z + 1.2 + f * 0.3, 'runnerDark');
  }
  // lean body, cream belly and chest ruff
  s.ell(6, 6.6, 9.6, 3.5, 2.5, 6.2, 'runner', 0.08);
  s.paint((_x, y, z) => y < 5.4 && z > 4, 'runnerLight');
  s.ell(6, 6.6, 14.6, 2.6, 2.6, 1.8, 'runnerLight');
  // wind stripes along the back
  s.paint((_x, y, z) => y > 7.8 && z > 4 && z < 14 && (z % 3) < 1, 'runnerDark');
  // head with long snout, cheek fluff, pointy ears
  s.ell(6, 9.6, 16.6, 2.9, 2.5, 2.6, 'runner', 0.08);
  s.box(4.6, 7.8, 17.6, 7.4, 9.6, 20.4, 'runnerLight');
  s.box(4.8, 9.2, 17.6, 7.2, 9.8, 20, 'runner');
  s.box(5.4, 9, 20, 6.6, 9.8, 20.8, 'eye');
  s.box(4.8, 7.6, 19.4, 7.2, 8.1, 20.4, 'mouth');
  s.ell(3.4, 8.8, 16.4, 1.1, 1.2, 1.4, 'runnerLight'); s.ell(8.6, 8.8, 16.4, 1.1, 1.2, 1.4, 'runnerLight');
  for (const sx of [-1, 1]) {
    const x = 6 + sx * 1.9;
    s.seg([x, 11, 16], [x + sx * 0.5, 14, 15.6], 1.15, 'runner', 0.3);
    s.seg([x, 11.3, 16.6], [x + sx * 0.45, 13.4, 16.4], 0.55, 'runnerDark', 0.2);
  }
  s.eye(4.2, 10.2, 5.2, 11.2, { outer: 'left', raise: 0 }); s.eye(6.8, 10.2, 7.8, 11.2, { outer: 'right', raise: 0 });
  // bushy tail (extra, wagged by the view) with a white tip
  const t = new Sculpt(6, 7, 10, k);
  t.path([[3, 3, 9.6], [3, 3.6, 6], [3, 4.6, 2.4]], 1.0, 'runnerDark', 1.7);
  t.ball(3, 4.9, 1.6, 1.6, 'runnerLight');
  t.paint((_x, _y, z) => z < 1.6, 'white');
  return { body: s.build(V), extra: t.build(V, { originY: -2 * V }), height: 0.75 };
}

function knightModel(k: number): EnemyGeometry {
  // armoured beetle: domed shell with a centre seam, rim and rivets; six jointed legs; horn
  const s = new Sculpt(16, 13, 21, k);
  for (const [z, lean] of [[6, -0.6], [9.6, 0], [13.2, 0.6]] as const) for (const sx of [-1, 1]) {
    const x = 8 + sx * 5;
    s.path([[x, 3.4, z], [8 + sx * 7.4, 3.8, z + lean], [8 + sx * 7.6, 0.4, z + lean * 1.6]], 0.6, 'knightDark', 0.45);
  }
  s.ell(8, 2.6, 10, 6.4, 7.4, 7.6, 'knight');
  s.box(0, -8, 0, 16, 2.4, 21, null);
  s.ell(8, 2.4, 10, 5.4, 1.4, 6.6, 'knightDark');
  s.paint((_x, y) => y > 7.4, 'knightLight');
  s.paint((x, y) => Math.abs(x - 8) < 0.5 && y > 3.6, 'knightDark');
  s.paint((x, y) => y < 3.9 && y > 2.6 && Math.abs(x - 8) > 4.8, 'ironLight');
  for (const [x, z] of [[5, 7], [11, 7], [4.4, 11], [11.6, 11], [5.4, 14.6], [10.6, 14.6]] as const) s.decal('+y', x - 0.5, z - 0.5, x + 0.5, z + 0.5, 'ironLight', { raise: 0.5 });
  s.paint((x, y, z) => y > 8.6 && x > 9.6 && x < 11.2 && z > 6 && z < 12, 'white');
  // head, mandibles, horn
  s.ell(8, 3.8, 17.4, 2.8, 2, 2, 'knightDark');
  s.seg([6.4, 3, 18.6], [7.2, 2.6, 20.4], 0.55, 'ironLight', 0.35); s.seg([9.6, 3, 18.6], [8.8, 2.6, 20.4], 0.55, 'ironLight', 0.35);
  s.path([[8, 5, 18], [8, 7.6, 19.4], [8, 9.8, 18.6]], 0.9, 'iron', 0.4);
  s.seg([8, 8.4, 19.2], [8, 9.8, 18.6], 0.55, 'ironLight', 0.3);
  s.eye(6, 4, 7, 5, { iris: 'golemEye', glint: 'phoenixTip', outer: 'left', raise: 0 }); s.eye(9, 4, 10, 5, { iris: 'golemEye', glint: 'phoenixTip', outer: 'right', raise: 0 });
  return { body: s.build(V), height: 0.68 };
}

function wispModel(k: number): EnemyGeometry {
  // floating healing orb with leaf wings, a sprout and trailing motes (orb glows)
  const orb = new Sculpt(14, 14, 14, k);
  orb.ball(7, 7, 7, 4.2, 'wisp');
  orb.ball(7, 7, 7, 2.9, 'white');
  orb.paint((_x, y) => y < 4.6, 'wispDeep');
  // halo ring
  orb.fill(1, 6.6, 1, 13, 7.2, 13, (x, _y, z) => { const d = Math.hypot(x - 7, z - 7); return d > 4.9 && d < 5.4 && Math.floor(Math.atan2(z - 7, x - 7) * 3) % 2 === 0; }, 'wispLeaf');
  const m = new Sculpt(22, 15, 14, k);
  for (const sx of [-1, 1]) {
    const cx = 11 + sx * 7.4;
    m.ell(cx, 8.4, 7, 3.6, 0.7, 1.9, 'wispLeaf');
    m.seg([11 + sx * 4, 8.4, 7], [11 + sx * 10.6, 8.6, 7], 0.35, 'wispDeep');
    for (const d of [5.6, 7.6, 9.4]) m.seg([11 + sx * d, 8.6, 7], [11 + sx * (d + 1.1), 8.6, 7 + 1.4], 0.25, 'wispDeep');
  }
  m.path([[11, 11, 7], [11, 12.6, 7.2], [12.2, 13.6, 7.4]], 0.4, 'wispDeep', 0.3);
  m.ell(12.8, 13.6, 7.4, 1.2, 0.4, 0.8, 'wispLeaf');
  for (const [x, y, z] of [[10, 1.6, 7], [12.4, 0.8, 6.4], [11, 0.2, 8]] as const) m.box(x - 0.5, y - 0.5, z - 0.5, x + 0.5, y + 0.5, z + 0.5, 'wispDeep');
  m.box(9.4, 7.6, 11.2, 10.4, 9, 11.6, 'eye'); m.box(11.6, 7.6, 11.2, 12.6, 9, 11.6, 'eye');
  m.box(9.4, 8.5, 11.6, 9.9, 9, 11.8, 'white'); m.box(11.6, 8.5, 11.6, 12.1, 9, 11.8, 'white');
  m.box(10.4, 6.6, 11.2, 11.6, 7, 11.6, 'wispDeep');
  return { body: m.build(V, { originY: 2 * V }), extra: orb.build(V, { originY: 2 * V, flags: FLAG_EMISSIVE }), height: 0.95 };
}

function boarModel(k: number): EnemyGeometry {
  const s = new Sculpt(14, 15, 21, k);
  // legs with cloven hooves
  for (const [x, z] of [[3.6, 5], [10.4, 5], [3.6, 14], [10.4, 14]] as const) {
    s.box(x - 1.1, 0.8, z - 1.1, x + 1.1, 5, z + 1.1, 'boarDark', 0.1);
    s.box(x - 1.2, 0, z - 1.2, x + 1.2, 0.9, z + 1.2, 'impHorn');
    s.box(x - 0.15, 0, z + 0.4, x + 0.15, 0.9, z + 1.3, null);
  }
  // humped, bristly body
  s.ell(7, 6.6, 9.4, 5, 3.8, 7.6, 'boar', 0.14);
  s.ell(7, 8, 11.6, 4.6, 3.6, 4.6, 'boar', 0.14);
  s.paint((_x, y, z) => y < 4.4 && z > 3, 'boarLight');
  s.paint((x, y, z) => hash(Math.floor(x * 2), Math.floor(y * 2), Math.floor(z * 2)) > 0.86, 'boarDark');
  for (let z = 3; z <= 14.5; z += 1.1) { const top = 9.6 + (z > 8 && z < 14 ? 1.5 : 0.3); s.seg([7, top - 0.6, z], [7, top + 0.9 + ((z * 10) % 3 === 0 ? 0.5 : 0), z - 0.9], 0.6, 'boarDark', 0.25); }
  s.path([[7, 7.4, 1.8], [7.8, 7, 0.8], [7.2, 6.2, 0.4]], 0.35, 'boarDark');
  // head: snout disc with nostrils, tusks, ears, fierce brow
  s.ell(7, 6.4, 16.8, 3.8, 3.2, 3, 'boar', 0.14);
  s.box(4.8, 3.8, 18.6, 9.2, 6.4, 20.6, 'boarLight');
  s.box(5.6, 4.4, 20.4, 6.4, 5.4, 20.8, 'boarDark'); s.box(7.6, 4.4, 20.4, 8.4, 5.4, 20.8, 'boarDark');
  for (const sx of [-1, 1]) {
    s.path([[7 + sx * 2.4, 4.2, 19.4], [7 + sx * 2.9, 5.4, 20.6], [7 + sx * 2.6, 7.4, 20.4]], 0.55, 'tusk', 0.3);
    s.seg([7 + sx * 2.6, 9.4, 16], [7 + sx * 3.8, 11, 15.4], 1, 'boarDark', 0.4);
    s.seg([7 + sx * 1, 8.6, 19], [7 + sx * 2.8, 9.2, 18.4], 0.45, 'boarDark');
  }
  const eyes = new Sculpt(14, 15, 21, k);
  eyes.box(4.6, 7.4, 18.8, 5.8, 8.4, 19.2, 'bossLava'); eyes.box(8.2, 7.4, 18.8, 9.4, 8.4, 19.2, 'bossLava');
  eyes.box(5.2, 7.9, 19.2, 5.8, 8.4, 19.4, 'phoenixTip'); eyes.box(8.2, 7.9, 19.2, 8.8, 8.4, 19.4, 'phoenixTip');
  return { body: s.build(V), extra: glow(eyes, 1), height: 0.7 };
}

function ghostModel(k: number): EnemyGeometry {
  // drifting hooded wraith: deep hood, sleeves, ragged hem; eyes + soul core glow
  const s = new Sculpt(16, 18, 15, k);
  s.fill(0, 0.5, 0, 16, 17, 15, (x, y, z) => {
    const r = y > 12 ? 5.4 * Math.sqrt(Math.max(0, 1 - ((y - 12) / 5) ** 2)) : 4.3 + ((12 - y) / 12) * 1.6;
    return Math.hypot(x - 8, z - 7.2) <= r;
  }, 'ghost');
  // ragged hem: drop columns of varying length
  s.paint((_x, y) => y < 5, 'ghostDeep');
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const x = 8 + Math.sin(a) * 5.1, z = 7.2 + Math.cos(a) * 5.1;
    if (i % 3 === 0) s.box(x - 0.8, 0.5, z - 0.8, x + 0.8, 1 + (i % 2) * 1.2, z + 0.8, null);
    else s.seg([x, 1.4, z], [x * 1.04 - 0.3, -0.4 + (i % 2) * 0.6, z], 0.6, 'ghostDeep', 0.35);
  }
  // hood opening: dark void face
  s.ell(8, 11.6, 12.2, 3, 2.8, 2.2, null);
  s.ell(8, 11.6, 11.2, 3, 2.8, 1.4, 'ghostVoid');
  s.paint((x, y, z) => y > 13.6 && z > 11 && Math.abs(x - 8) < 3.6, 'ghostDeep');
  // sleeves reaching forward
  for (const sx of [-1, 1]) {
    s.path([[8 + sx * 4.4, 10, 7.6], [8 + sx * 5.8, 7.6, 9.8], [8 + sx * 5.2, 6.4, 11.6]], 1.4, 'ghost', 0.9);
    s.ball(8 + sx * 5.2, 6.2, 12, 0.8, 'ghostDeep');
  }
  const g = new Sculpt(16, 18, 15, k);
  g.box(6.4, 11.2, 12.1, 7.4, 12.4, 12.7, 'ghostGlow'); g.box(8.6, 11.2, 12.1, 9.6, 12.4, 12.7, 'ghostGlow');
  g.ball(8, 7, 7.2, 2.2, 'ghostGlow');
  return { body: s.build(V, { originY: 1 * V }), extra: g.build(V, { originY: 1 * V, flags: FLAG_EMISSIVE }), height: 1.05 };
}

function crabModel(k: number, scale: number): EnemyGeometry {
  const s = new Sculpt(22, 12, 19, k);
  // jointed legs, three each side
  for (const z of [4.6, 8, 11.4]) for (const sx of [-1, 1]) {
    s.path([[11 + sx * 5.6, 3.2, z], [11 + sx * 8.8, 4.4, z - 0.4], [11 + sx * 10.2, 0.4, z - 0.8]], 0.65, 'crabDark', 0.4);
  }
  // wide shell with a pale rim and spots
  s.fill(2, 1.6, 1, 20, 7.6, 17, (x, y, z) => {
    const dx = (x - 11) / 7.6, dz = (z - 9) / 6.6, dy = (y - 1.6) / 5.4;
    return dx * dx + dz * dz + dy * dy <= 1;
  }, 'crab', 0.06);
  s.paint((_x, y) => y < 2.8, 'crabDark');
  s.paint((x, y, z) => y > 2.8 && y < 3.6 && Math.hypot((x - 11) / 7.6, (z - 9) / 6.6) > 0.82, 'crabSpot');
  for (const [x, z] of [[7, 7], [15, 8], [9, 12], [13.6, 11.8], [6.6, 11.4], [15.2, 4.8]] as const) s.decal('+y', x - 0.6, z - 0.6, x + 0.6, z + 0.6, 'crabSpot');
  // big claws: arm → palm → two-pronged pincer
  for (const sx of [-1, 1]) {
    const x = 11 + sx * 6.8;
    s.path([[11 + sx * 5, 3.4, 13], [x, 4, 14.6]], 0.9, 'crabDark');
    s.ell(x, 4.4, 16, 2, 1.7, 1.9, 'crab');
    s.seg([x - sx * 0.6, 5.6, 17], [x - sx * 1.2, 5.8, 18.8], 0.7, 'crab', 0.4);
    s.seg([x + sx * 0.6, 3.6, 17.2], [x + sx * 0.2, 3.4, 18.8], 0.6, 'crabDark', 0.35);
    s.decal('+y', x - 0.8, 15, x + 0.8, 16.4, 'crabSpot');
  }
  // eye stalks
  for (const sx of [-1, 1]) {
    s.seg([11 + sx * 2, 5.6, 14.6], [11 + sx * 2.4, 8.4, 15.4], 0.45, 'crabDark');
    s.ball(11 + sx * 2.4, 8.8, 15.6, 0.9, 'eye');
    s.box(11 + sx * 2.4 - 0.5, 9, 16.2, 11 + sx * 2.4, 9.5, 16.6, 'white');
  }
  s.box(9.8, 3.4, 15, 12.2, 4, 15.6, 'mouth');
  const gems = new Sculpt(22, 13, 19, k);
  for (const [x, z, h, l] of [[10, 8, 4.4, -0.6], [12.4, 9.2, 5.2, 0.4], [11, 6.2, 3.2, 0], [14, 7.4, 3, 0.8], [8.4, 10.2, 2.6, -0.8], [12.6, 11.6, 2.4, 0.3]] as const) {
    gems.seg([x, 6.4, z], [x + l, 6.4 + h, z - 0.4], 0.95, 'crabCrystal', 0.4);
    gems.seg([x + l * 0.8, 6 + h * 0.85, z - 0.3], [x + l, 6.4 + h, z - 0.4], 0.55, 'crystalTip', 0.25);
  }
  return { body: s.build(V * scale), extra: glow(gems, scale), height: 0.62 * scale };
}

function moleModel(k: number): EnemyGeometry {
  // digger mole in a miner's helmet: velvet body, star nose, shovel claws
  const s = new Sculpt(14, 13, 19, k);
  s.ell(7, 4.6, 8.4, 5.2, 4.6, 5.8, 'mole', 0.1);
  s.ell(7, 4, 13.2, 3.6, 3.2, 3, 'mole', 0.1);
  s.paint((_x, y, z) => y < 2.6 && z > 6, 'moleDark');
  s.seg([7, 3, 2.8], [7, 3.6, 1.4], 0.45, 'moleNose');
  // miner's helmet: a dome cap over the head/back with a brim and a lamp
  s.fill(1, 6.4, 6, 13, 11, 17, (x, y, z) => y > 6.6 && ((x - 7) / 3.9) ** 2 + ((y - 6.6) / 2.8) ** 2 + ((z - 11.8) / 3.9) ** 2 <= 1, 'helmet');
  s.fill(1, 6.4, 6, 13, 7.2, 17, (x, _y, z) => { const d = ((x - 7) / 4.5) ** 2 + ((z - 11.8) / 4.5) ** 2; return d <= 1 && d > 0.55; }, 'helmetDark');
  s.seg([7, 8.4, 15.2], [7, 8.4, 16], 0.95, 'goldDark');
  s.decal('+z', 6.3, 7.7, 7.7, 9.1, 'lantern');
  s.decal('+z', 6.4, 8.5, 6.9, 9, 'white');
  // star nose: pink tendrils around a round tip
  s.ball(7, 3.8, 16.4, 1.1, 'moleNose');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    s.ball(7 + Math.cos(a) * 1.3, 3.8 + Math.sin(a) * 1.3, 16.7, 0.45, 'moleNose');
  }
  s.box(4.8, 5, 15, 5.8, 6, 15.8, 'eye'); s.box(8.2, 5, 15, 9.2, 6, 15.8, 'eye');
  s.box(4.8, 5.5, 15.8, 5.3, 6, 16, 'white'); s.box(8.7, 5.5, 15.8, 9.2, 6, 16, 'white');
  // shovel claws with three fingers, back feet
  for (const sx of [-1, 1]) {
    const x = 7 + sx * 4.4;
    s.ell(x, 1.4, 13.4, 1.6, 1.1, 1.8, 'moleDark');
    for (const d of [-0.9, 0, 0.9]) s.seg([x + d, 0.8, 14.6], [x + d * 1.3, 0.4, 16.4], 0.45, 'claw', 0.3);
    s.box(7 + sx * 3 - 1, 0, 3, 7 + sx * 3 + 1, 1.2, 5.6, 'moleDark');
  }
  // dirt mound shown while burrowing (extra mesh, scaled in/out by the view)
  const d = new Sculpt(18, 6, 18, k);
  d.ell(9, 0, 9, 7, 3.5, 7, 'dirt', 0.12);
  d.paint((x, y, z) => hash(Math.floor(x), Math.floor(y), Math.floor(z)) > 0.7, 'dirtDark');
  for (const [x, z] of [[4, 6], [12, 12], [10, 4], [6, 13]] as const) d.ball(x, 1.6, z, 0.9, 'rock');
  for (const [x, z] of [[7, 11], [12, 7]] as const) d.seg([x, 2.6, z], [x + 0.3, 4.4, z], 0.35, 'grass');
  return { body: s.build(V), extra: d.build(V, { originY: 0 }), height: 0.6 };
}

function salamanderModel(k: number): EnemyGeometry {
  // low flame-tailed lizard with a spined back and spotted hide; the tail fire glows
  const s = new Sculpt(13, 9, 25, k);
  for (const [x, z, sx] of [[3.2, 15.2, -1], [9.8, 15.2, 1], [3.2, 8.4, -1], [9.8, 8.4, 1]] as const) {
    s.path([[x, 3.4, z], [x + sx * 1.2, 2.2, z + 0.4], [x + sx * 1.3, 0.5, z + 1]], 0.75, 'salamander', 0.6);
    for (const d of [-0.7, 0, 0.7]) s.seg([x + sx * 1.3, 0.4, z + 1], [x + sx * 1.6 + d * 0.5, 0.3, z + 2 + d * 0.3], 0.3, 'salamanderDark');
  }
  s.ell(6.5, 3.8, 11.6, 3.1, 1.9, 6.4, 'salamander', 0.08);
  s.paint((_x, y) => y < 3, 'salamanderBelly');
  s.paint((x, y, z) => y > 4.6 && hash(Math.floor(x * 0.7), 0, Math.floor(z * 0.7)) > 0.8, 'salamanderSpot');
  for (let z = 6.5; z <= 16; z += 1.6) s.seg([6.5, 5.4, z], [6.5, 6.8 - (z % 3.2 > 1.5 ? 0.6 : 0), z - 0.7], 0.45, 'salamanderDark', 0.2);
  // head with frills
  s.ell(6.5, 4, 19.4, 2.6, 1.7, 2.8, 'salamander', 0.08);
  s.box(4.4, 2.6, 19.6, 8.6, 3.4, 22.4, 'salamanderBelly');
  s.box(4.6, 3.2, 21.6, 8.4, 3.5, 22.4, 'mouth');
  s.ell(4.4, 5.4, 19.8, 0.9, 0.9, 0.9, 'salamander'); s.ell(8.6, 5.4, 19.8, 0.9, 0.9, 0.9, 'salamander');
  s.box(3.9, 5.2, 20.4, 5, 6.2, 20.9, 'eye'); s.box(8, 5.2, 20.4, 9.1, 6.2, 20.9, 'eye');
  s.box(3.9, 5.7, 20.9, 4.4, 6.2, 21.1, 'white'); s.box(8.6, 5.7, 20.9, 9.1, 6.2, 21.1, 'white');
  for (const sx of [-1, 1]) s.seg([6.5 + sx * 2.2, 4.4, 17.6], [6.5 + sx * 3.8, 5.6, 16.6], 0.5, 'salamanderBelly', 0.3);
  // tail base tapering towards the flame
  s.path([[6.5, 3.6, 6], [6.5, 3.4, 3.4], [6.5, 3.6, 2]], 1.4, 'salamander', 0.7);
  const f = new Sculpt(13, 9, 25, k);
  f.ell(6.5, 4.8, 1.6, 1.6, 2.6, 1.6, 'lava');
  f.ell(6.5, 4.4, 1.6, 1, 1.8, 1.4, 'flame');
  f.seg([6.5, 6.8, 1.2], [6.5, 8.6, 0.8], 0.7, 'lava', 0.2);
  f.seg([5.4, 5.6, 1], [4.8, 7.4, 0.6], 0.45, 'flame', 0.15); f.seg([7.6, 5.8, 1.2], [8.2, 7.6, 0.6], 0.45, 'flame', 0.15);
  f.ell(6.5, 4.1, 1.8, 0.6, 1, 0.8, 'phoenixTip');
  return { body: s.build(V), extra: f.build(V, { flags: FLAG_EMISSIVE }), height: 0.45 };
}

function batModel(k: number, scale: number): EnemyGeometry {
  // fuzzy round body with big ears and fangs; finger-boned membrane wings (extra, flapped by the view)
  const s = new Sculpt(10, 11, 10, k);
  s.ball(5, 5, 5, 3.5, 'bat', 0.1);
  s.paint((x, y, z) => hash(Math.floor(x * 2), Math.floor(y * 2), Math.floor(z * 2)) > 0.8, 'batDark');
  s.decal('+z', 3.6, 2.4, 6.4, 4.4, 'batWing');
  for (const sx of [-1, 1]) {
    s.seg([5 + sx * 1.8, 7.4, 5], [5 + sx * 2.5, 10.2, 4.6], 1.1, 'bat', 0.35);
    s.seg([5 + sx * 1.8, 7.8, 5.6], [5 + sx * 2.4, 9.6, 5.4], 0.5, 'batInner', 0.2);
  }
  s.eye(2.8, 5.4, 4.4, 7, { outer: 'left' }); s.eye(5.6, 5.4, 7.2, 7, { outer: 'right' });
  s.decal('+z', 4.2, 4.2, 5.8, 4.8, 'batInner');
  s.box(4, 3, 8, 4.5, 4.2, 8.8, 'fang'); s.box(5.5, 3, 8, 6, 4.2, 8.8, 'fang');
  s.decal('+z', 4.4, 3.6, 5.6, 4.2, 'mouth');
  s.box(3.8, 0.8, 4.4, 4.6, 1.8, 5.4, 'batDark'); s.box(5.4, 0.8, 4.4, 6.2, 1.8, 5.4, 'batDark');
  const w = new Sculpt(26, 10, 10, k);
  for (const sx of [-1, 1]) {
    const x0 = 13 + sx * 3.6;
    const tip = 13 + sx * 12.6;
    // membrane: a scalloped panel
    w.fill(Math.min(x0, tip), 3, 2, Math.max(x0, tip), 7.4, 8, (x, y, z) => {
      const t = Math.abs(x - x0) / Math.abs(tip - x0);
      const bottom = 4 + Math.abs(Math.sin(t * Math.PI * 3)) * 1.4 + t * 1.6;
      return y > bottom && y < 6 + t * 1 && z > 3 + t * 1.2 && z < 7;
    }, 'batWing');
    w.seg([x0, 6, 5.4], [tip, 7, 5.6], 0.45, 'batDark');
    for (const t of [0.35, 0.65]) w.seg([x0 + (tip - x0) * t * 0.8, 6.4, 5.4], [x0 + (tip - x0) * t, 4, 5.2], 0.3, 'batDark');
    w.seg([tip, 7, 5.6], [tip + sx * 0.6, 7.8, 5.6], 0.35, 'fang');
  }
  return { body: s.build(V * scale, { originY: 4 * V }), extra: w.build(V * scale, { originY: 4 * V }), height: 0.95 };
}

function yetiModel(k: number, scale: number): EnemyGeometry {
  // shaggy white ape: hanging fur tufts, blue face with a heavy brow, curled horns, long arms
  const s = new Sculpt(19, 21, 15, k);
  for (const x of [5.6, 13.4]) { s.box(x - 2, 0, 4.2, x + 2, 5.4, 9.6, 'yetiShade', 0.08); s.box(x - 2.1, 0, 8.4, x + 2.1, 1.2, 10.8, 'yetiFace'); }
  s.ell(9.5, 10, 7, 6.2, 5.6, 4.8, 'yeti', 0.08);
  s.ell(9.5, 8.4, 9.4, 4, 3.6, 2.6, 'white');
  for (const sx of [-1, 1]) {
    s.ell(9.5 + sx * 5.6, 13, 7, 2.6, 2.4, 2.8, 'yeti', 0.08);
    s.path([[9.5 + sx * 6.6, 12, 7], [9.5 + sx * 7.6, 7, 7.6], [9.5 + sx * 7.4, 3.6, 8.4]], 1.7, 'yeti', 1.5, 0.08);
    s.ell(9.5 + sx * 7.4, 2.6, 8.8, 1.7, 1.4, 1.8, 'yetiFace');
    for (const d of [-0.7, 0.7]) s.box(9.5 + sx * 7.4 + d - 0.3, 1.2, 10, 9.5 + sx * 7.4 + d + 0.3, 2.2, 10.7, 'yetiDeep');
  }
  // head with face, brow, open mouth and fangs
  s.ell(9.5, 16.4, 7.6, 3.8, 3.4, 3.6, 'yeti', 0.08);
  s.box(7, 13.6, 10.4, 12, 17.2, 11.6, 'yetiFace');
  s.box(7, 17, 10.4, 12, 17.8, 11.6, 'yetiShade');
  s.box(7.8, 13.8, 11.4, 11.2, 15, 11.8, 'mouth');
  s.box(8, 14.4, 11.6, 8.6, 15, 12, 'fang'); s.box(10.4, 14.4, 11.6, 11, 15, 12, 'fang');
  s.eye(7.6, 15.6, 9, 16.8, { outer: 'left' }); s.eye(10, 15.6, 11.4, 16.8, { outer: 'right' });
  for (const sx of [-1, 1]) s.path([[9.5 + sx * 2.8, 18.4, 7], [9.5 + sx * 4.4, 19.8, 6.6], [9.5 + sx * 5.4, 19, 7.6]], 0.8, 'horn', 0.4);
  // fur: shaggy vertical streaks and drooping tufts
  s.paint((x, y, z) => (Math.floor(x * 1.5 + z * 0.5) % 3 === 0) && hash(Math.floor(x), Math.floor(y / 2), Math.floor(z)) > 0.4 && y > 4, 'yetiShade');
  for (const [x, y, z] of [[4, 6.6, 8], [15, 6.6, 8], [7, 5, 10.2], [12, 5, 10.2], [9.5, 5.4, 10.6], [5.6, 11, 10.6], [13.4, 11, 10.6]] as const) s.seg([x, y + 1, z], [x, y - 0.6, z + 0.3], 0.7, 'yetiShade', 0.3);
  return { body: s.build(V * scale), height: 1.15 * scale };
}

function shamanModel(k: number): EnemyGeometry {
  // robed caster: trimmed robe, belt with charms, feathered golden mask; staff holds a shield orb (glows)
  const s = new Sculpt(16, 21, 12, k);
  s.fill(2, 0, 1, 12, 12, 11, (x, y, z) => Math.hypot(x - 7, z - 6) <= 4.5 - y * 0.18, 'shaman', 0.06);
  s.paint((_x, y) => y < 1.4, 'shamanDark');
  s.paint((_x, y) => y >= 1.4 && y < 2, 'shamanTrim');
  s.paint((_x, y, z) => y > 6.4 && y < 7.4 && z > 2, 'shamanTrim');
  s.paint((x, y, z) => z > 9 && y > 2 && y < 6.4 && Math.abs(x - 7) < 0.5, 'shamanDark');
  for (const [x, y] of [[5.4, 5], [8.6, 5.4]] as const) { s.seg([x, 6.6, 10.2], [x, y, 10.6], 0.25, 'rope'); s.ball(x, y - 0.4, 10.6, 0.55, x < 7 ? 'tusk' : 'crystal'); }
  // sleeves/arms reaching to the staff
  s.path([[10.6, 10, 6], [12, 8, 6.6], [12.8, 8.2, 6]], 1.1, 'shaman', 0.9);
  s.ball(13, 8.2, 6, 0.9, 'shamanMask');
  s.path([[3.4, 10, 6], [2.6, 7.6, 7.6]], 1.1, 'shaman', 0.9);
  // hood + mask
  s.ball(7, 14.2, 6, 3.6, 'shamanDark', 0.06);
  s.seg([7, 16.8, 5], [7, 18.6, 3.6], 1.4, 'shamanDark', 0.5);
  s.box(4.8, 12.4, 8.8, 9.2, 16.6, 9.6, 'shamanMask');
  s.box(5.2, 15.8, 9.6, 8.8, 16.4, 9.8, 'goldDark');
  s.box(5.4, 14.4, 9.6, 6.6, 15.4, 10, 'eye'); s.box(7.4, 14.4, 9.6, 8.6, 15.4, 10, 'eye');
  s.box(6.8, 12.8, 9.6, 7.2, 14.6, 9.9, 'clothDark');
  s.box(5.4, 13, 9.6, 5.8, 13.8, 9.9, 'clothDark'); s.box(8.2, 13, 9.6, 8.6, 13.8, 9.9, 'clothDark');
  for (const [x, c, lean] of [[5, 'feather', -0.6], [7, 'featherB', 0], [9, 'feather', 0.6]] as const) s.seg([x, 16.6, 8.6], [x + lean, 19.6, 8.2], 0.5, c, 0.3);
  // staff with a carved crook and tied ribbons
  s.box(12.6, 0, 5.6, 13.4, 17.4, 6.4, 'woodDark');
  s.path([[13, 17, 6], [14.6, 18.4, 6], [14.6, 20.2, 6], [13.4, 20.8, 6]], 0.45, 'wood');
  s.seg([12.6, 16.2, 6.4], [12, 14.4, 7.2], 0.3, 'cloth'); s.seg([13.4, 16.2, 6.4], [14, 14, 7], 0.3, 'clothBlue');
  const orb = new Sculpt(16, 22, 12, k);
  orb.ball(13, 19, 6, 2, 'shield');
  orb.ball(12.6, 19.4, 7.4, 0.6, 'white');
  return { body: s.build(V), extra: orb.build(V, { flags: FLAG_EMISSIVE }), height: 1.15 };
}

function impModel(k: number, scale: number): EnemyGeometry {
  // small lava devil: big-headed, curled horns, bat wings, arrow tail; belly and eyes glow
  const s = new Sculpt(14, 15, 13, k);
  for (const x of [5, 9]) { s.box(x - 0.9, 0, 5.4, x + 0.9, 3.2, 7.2, 'impDark'); s.box(x - 1, 0, 6.6, x + 1, 0.8, 8.2, 'impHorn'); }
  s.ell(7, 5.8, 6.4, 3, 3, 2.8, 'imp', 0.08);
  s.ell(7, 10.4, 6.6, 3.6, 3, 3.4, 'imp', 0.08);
  for (const sx of [-1, 1]) {
    s.path([[7 + sx * 2.4, 12.4, 6.4], [7 + sx * 3.6, 14, 6], [7 + sx * 3, 14.8, 7]], 0.65, 'impHorn', 0.3);
    s.path([[7 + sx * 2.8, 7, 6.8], [7 + sx * 4.2, 5.6, 8], [7 + sx * 4, 4.6, 9]], 0.75, 'imp', 0.6);
    // little wings
    s.fill(7 + Math.min(sx * 2, sx * 6.6), 6, 1.6, 7 + Math.max(sx * 2, sx * 6.6), 11, 4.4, (x, y) => {
      const t = Math.abs(x - 7) - 2; return y < 10.6 - t * 0.2 && y > 6.4 + t * 0.6 + (Math.floor(t * 1.4) % 2) * 0.6;
    }, 'impDark');
  }
  s.box(4.4, 11.6, 9.6, 9.6, 12.4, 10.2, 'impDark');
  s.box(5.6, 8.6, 9.6, 8.4, 9.2, 10.2, 'mouth');
  s.box(5.8, 8.9, 10, 6.4, 9.6, 10.4, 'fang'); s.box(7.6, 8.9, 10, 8.2, 9.6, 10.4, 'fang');
  s.path([[7, 3.6, 3.6], [7, 2.2, 1.4], [7, 3.6, 0.4]], 0.5, 'impDark', 0.35);
  s.fill(5.8, 3.4, 0, 8.2, 5.4, 1.2, (x, y) => Math.abs(x - 7) < (5.4 - y) * 0.7, 'impHorn');
  const g = new Sculpt(14, 15, 13, k);
  g.box(5, 10.2, 9.7, 6.2, 11.2, 10.1, 'lava'); g.box(7.8, 10.2, 9.7, 9, 11.2, 10.1, 'lava');
  g.box(5.7, 10.7, 10.1, 6.2, 11.2, 10.3, 'phoenixTip'); g.box(8.5, 10.7, 10.1, 9, 11.2, 10.3, 'phoenixTip');
  g.ell(7, 5.6, 9, 1.8, 1.8, 0.5, 'impBelly');
  return { body: s.build(V * scale), extra: g.build(V * scale, { flags: FLAG_EMISSIVE }), height: 0.8 * scale };
}

function phoenixModel(k: number, scale: number): EnemyGeometry {
  // fire bird: layered breast feathers, gold beak, crest plumes; wings + tail are glowing flame (extra)
  const s = new Sculpt(14, 17, 20, k);
  s.ell(7, 7.2, 9, 4.2, 4.4, 4.8, 'phoenix', 0.06);
  s.paint((x, y, z) => z > 10.5 && y < 8.5 && y > 3 && ((y + Math.abs(Math.sin(x * 1.3)) * 0.8) % 1.8) < 0.5, 'phoenixGold');
  s.paint((_x, y, z) => z > 11 && y < 5, 'phoenixGold');
  s.ell(7, 11.6, 12.4, 2.8, 2.6, 2.8, 'phoenixDeep', 0.06);
  s.path([[7, 11.2, 14.8], [7, 10.6, 16.6], [7, 9.6, 17]], 0.8, 'phoenixGold', 0.35);
  s.eye(5, 12, 6, 13, { outer: 'left', raise: 0 }); s.eye(8, 12, 9, 13, { outer: 'right', raise: 0 });
  for (const x of [5.4, 8.6]) { s.box(x - 0.5, 0, 8.4, x + 0.5, 3.4, 9.4, 'phoenixGold'); s.box(x - 1, 0, 9, x + 1, 0.5, 10.6, 'phoenixGold'); }
  const f = new Sculpt(34, 19, 24, k);
  // body sits at x 10..24 / z 2..22 of this frame (both meshes are centred)
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const x0 = 17 + sx * 4, x1 = 17 + sx * (5 + 11.4 * (0.5 + t * 0.5));
      const y = 9 + t * 3.4, z = 12.4 - t * 3.6;
      f.seg([x0, y - 1.6, z + 1], [x1, y + (i % 2) * 0.8, z], 0.9, i % 2 ? 'phoenix' : 'lava', 0.5);
    }
    f.seg([17 + sx * 4, 9.2, 12], [17 + sx * 15.6, 13.6, 8.6], 0.55, 'phoenixGold');
    f.paint((x, y) => Math.abs(x - 17) > 13 && y > 10, 'phoenixTip');
  }
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.35;
    f.path([[17, 7, 7], [17 + Math.sin(a) * 2.4, 6, 3.6], [17 + Math.sin(a) * 4, 7.6 - (i % 2), 0.6]], 0.8, i % 2 ? 'phoenixGold' : 'lava', 0.4);
  }
  f.paint((_x, _y, z) => z < 1.6, 'phoenixTip');
  // crest plumes
  for (const [lean, h] of [[-0.8, 3.6], [0, 4.6], [0.8, 3.6]] as const) f.path([[17, 14, 13], [17 + lean, 14 + h * 0.6, 12.2], [17 + lean * 1.6, 14 + h, 11]], 0.5, 'phoenixGold', 0.3);
  return { body: s.build(V * scale), extra: f.build(V * scale, { flags: FLAG_EMISSIVE }), height: 1.0 * scale };
}

function wyvernModel(k: number, scale: number): EnemyGeometry {
  // small teal dragon: plated belly, spined back, horned head, spade tail; bone-fingered wings (extra)
  const s = new Sculpt(12, 13, 23, k);
  s.ell(6, 5, 9.4, 3.2, 3, 4.2, 'wyvern', 0.06);
  s.paint((_x, y, z) => y < 4 && z > 6, 'wyvernBelly');
  s.paint((_x, y, z) => y < 4 && z > 6 && Math.floor(z * 1.2) % 2 === 0, 'tusk');
  s.path([[6, 6.4, 12], [6, 8.6, 14.4], [6, 10, 16.4]], 1.25, 'wyvern', 1, 0.06);
  s.ell(6, 10.4, 18, 1.9, 1.6, 2.4, 'wyvern', 0.06);
  s.box(4.8, 9, 18.6, 7.2, 10.2, 21.6, 'wyvern');
  s.box(4.8, 9, 19, 7.2, 9.4, 21.6, 'wyvernBelly');
  s.box(5.2, 9.4, 21.2, 6.8, 9.8, 21.8, 'mouth');
  s.box(5.2, 9.8, 21.2, 5.6, 10.2, 21.8, 'eye'); s.box(6.4, 9.8, 21.2, 6.8, 10.2, 21.8, 'eye');
  for (const sx of [-1, 1]) {
    s.path([[6 + sx * 1.2, 11.6, 17.6], [6 + sx * 1.8, 12.6, 16.2], [6 + sx * 2, 12.6, 15]], 0.45, 'horn', 0.25);
    s.box(6 + sx * 1.9 - 0.5, 10.6, 19, 6 + sx * 1.9 + 0.5, 11.6, 19.6, 'eye');
    s.box(6 + sx * 1.9 - 0.5, 11.1, 19.6, 6 + sx * 1.9, 11.6, 19.8, 'white');
    s.path([[6 + sx * 2, 3.6, 10.4], [6 + sx * 2.4, 1, 11], [6 + sx * 2.4, 0.4, 12]], 0.6, 'wyvernDark', 0.4);
  }
  for (let z = 4; z <= 15; z += 1.5) {
    const y = z < 12 ? 8 : 8 + (z - 12) * 0.9;
    s.seg([6, y - 0.6, z], [6, y + 0.8, z - 0.6], 0.4, 'wyvernSpine', 0.15);
  }
  s.path([[6, 5, 5.6], [6, 4.4, 2.6], [6, 5.2, 0.8]], 1.1, 'wyvern', 0.45);
  s.fill(4.4, 4.8, 0, 7.6, 6.6, 1.4, (x, y) => Math.abs(x - 6) < (6.6 - y) * 0.9, 'wyvernDark');
  const w = new Sculpt(34, 13, 23, k);
  for (const sx of [-1, 1]) {
    const sh = 17 + sx * 2.6;
    const tip = 17 + sx * 16.4;
    w.fill(Math.min(sh, tip), 4, 3, Math.max(sh, tip), 9.4, 13, (x, y, z) => {
      const t = Math.abs(x - sh) / Math.abs(tip - sh);
      const back = 11.2 - t * 4.4 + Math.abs(Math.sin(t * Math.PI * 3)) * 1.4;
      return z > back - 6.6 + t * 4 && z < back && y > 6 + t * 1.6 && y < 7 + t * 1.6;
    }, 'wyvernWing');
    w.seg([sh, 6.6, 11], [tip, 8.6, 11], 0.55, 'wyvernDark');
    for (const t of [0.4, 0.7, 1]) w.seg([sh + (tip - sh) * t * 0.85, 7 + t * 1.4, 11], [sh + (tip - sh) * t, 6.8 + t * 1.4, 5 + t * 1.4], 0.32, 'wyvernDark');
    w.seg([tip, 8.6, 11], [tip + sx * 0.6, 9.4, 11.6], 0.35, 'horn');
  }
  return { body: s.build(V * scale, { originY: 3 * V }), extra: w.build(V * scale, { originY: 3 * V }), height: 0.95 };
}

function ramModel(k: number, scale: number): EnemyGeometry {
  // woolly battering ram: curly fleece, iron forehead plate with rivets, spiral horns
  const s = new Sculpt(17, 15, 21, k);
  for (const [x, z] of [[4, 4.4], [13, 4.4], [4, 13.6], [13, 13.6]] as const) {
    s.box(x - 0.9, 1, z - 0.9, x + 0.9, 4, z + 0.9, 'ramDark');
    s.box(x - 1.1, 0, z - 1.1, x + 1.1, 1, z + 1.1, 'impHorn');
  }
  s.ell(8.5, 7.4, 8.8, 6.2, 4.2, 7, 'ramWool');
  // curls: lumpy bumps over the fleece
  for (let i = 0; i < 46; i++) {
    const a = hash(i, 1, 3) * Math.PI * 2, b = hash(i, 7, 2) * 0.9 + 0.1;
    const x = 8.5 + Math.cos(a) * 6 * Math.sin(b * Math.PI / 2 + 0.6), y = 7.4 + Math.cos(b * Math.PI / 2) * 4, z = 8.8 + Math.sin(a) * 6.8 * Math.sin(b * Math.PI / 2 + 0.6);
    s.ball(x, y, z, 1.1, i % 3 ? 'ramWool' : 'white');
  }
  s.box(0, 0, 0, 17, 3.4, 21, null);
  for (const [x, z] of [[4, 4.4], [13, 4.4], [4, 13.6], [13, 13.6]] as const) s.box(x - 0.9, 1, z - 0.9, x + 0.9, 3.4, z + 0.9, 'ramDark');
  // head with muzzle, iron battering plate, spiral horns
  s.ell(8.5, 7.6, 16.4, 3, 3.2, 3, 'ramFace');
  s.box(6.4, 4.6, 17.6, 10.6, 7, 20, 'ramMuzzle');
  s.box(7.2, 5.6, 19.8, 7.8, 6.2, 20.2, 'eye'); s.box(9.2, 5.6, 19.8, 9.8, 6.2, 20.2, 'eye');
  s.box(7.6, 4.8, 19.8, 9.4, 5.2, 20.2, 'mouth');
  s.box(5.6, 8.4, 18.4, 11.4, 11.4, 19.6, 'ramPlate');
  s.box(5.6, 10.8, 18.4, 11.4, 11.4, 19.6, 'ramPlateLight');
  for (const x of [6.4, 10.6]) s.decal('+z', x - 0.4, 9, x + 0.4, 9.8, 'ramPlateLight', { raise: 0.5 });
  s.box(5.8, 7.4, 17.8, 7.4, 8.4, 18.8, 'white'); s.box(9.6, 7.4, 17.8, 11.2, 8.4, 18.8, 'white');
  s.box(6.4, 7.6, 18.6, 7.2, 8.4, 19, 'eye'); s.box(9.8, 7.6, 18.6, 10.6, 8.4, 19, 'eye');
  for (const sx of [-1, 1]) {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI * 1.6;
      const r = 2.6 - i * 0.12;
      pts.push([8.5 + sx * (3 + 0.25 * i), 10.6 + Math.sin(a) * r, 15.4 - Math.cos(a) * r + 1.6]);
    }
    // ridged horn: alternate two tones along the spiral
    for (let i = 0; i < 10; i++) s.seg(pts[i]!, pts[i + 1]!, 1.2 - i * 0.065, i % 2 ? 'horn' : 'ramHorn', 1.2 - (i + 1) * 0.065);
  }
  s.ell(8.5, 7.6, 1.4, 1.4, 1.2, 1, 'ramWool');
  return { body: s.build(V * scale), height: 0.75 * scale };
}

const BUILDERS: Record<EnemyKind, (k: number, scale: number) => EnemyGeometry> = {
  slime: (k, sc) => slimeModel(k, ['slime', 'slimeLight', 'slimeDark'], sc),
  mini: (k, sc) => slimeModel(k, ['jelly', 'jellyLight', 'jellyDark'], sc),
  splitter: (k, sc) => slimeModel(k, ['splitter', 'splitterLight', 'splitterDark'], sc, { cores: true, seam: true }),
  queen: queenModel,
  runner: (k) => runnerModel(k),
  knight: (k) => knightModel(k),
  wisp: (k) => wispModel(k),
  boar: (k) => boarModel(k),
  ghost: (k) => ghostModel(k),
  crab: crabModel,
  mole: (k) => moleModel(k),
  salamander: (k) => salamanderModel(k),
  bat: batModel,
  yeti: yetiModel,
  shaman: (k) => shamanModel(k),
  imp: impModel,
  phoenix: phoenixModel,
  wyvern: wyvernModel,
  ram: ramModel,
  golem: (k, sc) => golemModel(k, sc, 'golem'),
  boss: (k, sc) => golemModel(k, sc, 'boss'),
  frostGiant: (k, sc) => golemModel(k, sc, 'frost'),
};

const cache = new Map<string, EnemyGeometry>();

/**
 * Shared, lazily built geometry per enemy kind and detail level. Every EnemyView of a kind
 * reuses the same buffers, so spawning is free after the first one and nothing leaks when
 * enemies die. Callers must not dispose the returned geometry.
 */
export function enemyGeometry(kind: EnemyKind, detail: EnemyDetail = 'high'): EnemyGeometry {
  const key = `${kind}:${detail}`;
  let g = cache.get(key);
  if (!g) {
    g = BUILDERS[kind](detail === 'high' ? 2 : 1, ENEMY_DEFS[kind].scale ?? 1);
    cache.set(key, g);
  }
  return g;
}
