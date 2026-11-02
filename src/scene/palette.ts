import { Color } from 'three';

/**
 * Master palette (GDD §11.1 / ART_BIBLE). Every voxel asset picks colours from here only.
 * Values are sRGB hex; `pal()` returns linear-space THREE.Color.
 */
export const PALETTE = {
  // terrain
  grass: 0x84c95c, grassLight: 0x9fd96e, grassDark: 0x62ad48, grassSide: 0x6fb64f,
  dirt: 0xa0704a, dirtDark: 0x7f5638, soil: 0x634433, soilDeep: 0x4c3529,
  rock: 0x8f939c, rockDark: 0x6e7380, rockDeep: 0x565a69, rockLight: 0xadb1b8,
  stone: 0xd2cab8, stoneDark: 0xb4ab98, stoneLight: 0xe4ddcd,
  sand: 0xe6cf98, path: 0xd8bf8c,
  crystal: 0x61d6ff, crystalDeep: 0x2f9fe0, crystalLight: 0xb8f1ff,
  root: 0x6b4a32,
  // wood / build
  wood: 0xb07a4b, woodDark: 0x825a37, woodLight: 0xd39d65, plank: 0xc48a55,
  rope: 0xe0cc9e, iron: 0x5b5f6a, ironLight: 0x8a8f9b, gold: 0xf2c14e, goldDark: 0xc9932f,
  cloth: 0xe94f4f, clothDark: 0xb83a3a, clothBlue: 0x4f86e9, banner: 0xf5e6c8,
  lantern: 0xffcf6e,
  // nature
  leaf: 0x5aa846, leafLight: 0x7cc957, leafDark: 0x3f8236, trunk: 0x7c5436, trunkDark: 0x5c3d27,
  flowerY: 0xffd84f, flowerP: 0xff86b0, flowerW: 0xfdfbf2, flowerV: 0xae92ff,
  // magic
  core: 0x7fe9ff, coreDeep: 0x2fb8ff, portal: 0xa06bff, portalDeep: 0x5b2fbf, portalLight: 0xd3b0ff,
  rune: 0xffd77a,
  // enemies
  slime: 0x72dc5a, slimeDark: 0x46b13e, slimeLight: 0xb6f59a,
  runner: 0xff9a3c, runnerDark: 0xd8691f, runnerLight: 0xffd07a,
  golem: 0x8f8b94, golemDark: 0x6c6873, golemMoss: 0x5f9441, golemEye: 0xffa040,
  jelly: 0xff8fc8, jellyDark: 0xe0609e, jellyLight: 0xffc8e4,
  splitter: 0xb07aff, splitterDark: 0x7f4fd6, splitterLight: 0xdcc4ff,
  knight: 0x5a6fa0, knightDark: 0x3b4a72, knightLight: 0x9fb3dc,
  wisp: 0x9cffb0, wispDeep: 0x3fd07a, wispLeaf: 0x6fd36a,
  boss: 0x6d6670, bossDark: 0x4a444f, bossLava: 0xff6a2a,
  boar: 0x9a5b3c, boarDark: 0x6e3c27, boarLight: 0xc98a5f, tusk: 0xf4ead2,
  ghost: 0xcfd8ff, ghostDeep: 0x8c97d8, ghostGlow: 0x9fe8ff,
  crab: 0x4fc6c0, crabDark: 0x2f8f93, crabCrystal: 0xb48cff,
  mole: 0x6b5446, moleDark: 0x4a382e, moleNose: 0xff9fb0, claw: 0xe8dcc2,
  salamander: 0xff5d3a, salamanderDark: 0xc23a22, salamanderBelly: 0xffc25a, flame: 0xffb030,
  queen: 0x5fd8c0, queenDark: 0x2fa58e, queenLight: 0xb4f5e6,
  eye: 0x1d2333, white: 0xffffff,
  // sky
  skyTop: 0x5aa8ff, skyMid: 0x9fd0ff, skyHorizon: 0xe3f2ff, skyDeep: 0x3f8fe0, cloud: 0xffffff, cloudShade: 0xb2cbec,
  fog: 0xb9d8f5,
} as const;

export type PaletteKey = keyof typeof PALETTE;

const cache = new Map<number, Color>();
export function pal(key: PaletteKey | number): Color {
  const hex = typeof key === 'number' ? key : PALETTE[key];
  let c = cache.get(hex);
  if (!c) { c = new Color(hex); cache.set(hex, c); }
  return c;
}

/** Tactical-overlay colours (never tone-mapped / graded; GDD §11.3). */
export const TACTICAL = {
  routeA: 0xffd34a, routeB: 0x5fd0ff, routeC: 0xff8fd8, legal: 0x5cf08a, illegal: 0xff4d5e, select: 0xffffff,
  rangeVisible: 0x8ff0ff, rangeOccluded: 0xff7a7a, rangeHigh: 0xfff2a0,
  hpGood: 0x66e06a, hpMid: 0xffd34a, hpLow: 0xff5a4f, hpBack: 0x1b1f2a, frost: 0x9ee8ff,
} as const;
