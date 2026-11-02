/**
 * L1-01「天空斷崖島」authoring data (GDD §10).
 *
 * Legend (one char per cell, x = column, z = row):
 *   .  void
 *   l  P_LOW ground, elevation 0      L  P_LOW terrace, elevation 1
 *   m  P_MID ground, elevation 2      M  P_MID hill, elevation 3
 *   #  P_MID rock pillar, elevation 5 (cliff — blocks walking & LOS)
 *   h  P_HIGH ground, elevation 4     H  P_HIGH lookout, elevation 5
 *   b  connector deck (resolved through the connector chains below)
 */
export const L1_01_MAP: readonly string[] = [
  '................................', // z0
  '................................', // z1
  '................................', // z2
  '................................', // z3
  '................................', // z4
  '................................', // z5
  '................................', // z6
  '................................', // z7
  '........................hhhhhh..', // z8
  '.............mmmmmm....hhhhhhhh.', // z9
  '..llllll....mmmmmmmm...hhhhhhhh.', // z10
  '.llllllll...mmmmmmmmm..hhhhhhhh.', // z11
  '.lllllllll..mmmmMMmmm..hhhhhhhh.', // z12
  '.lllllllll..mmmmMMmmmbbhhhhhhhh.', // z13
  '.lllllllllbbmmmmmmmmm..hhhhhhhh.', // z14
  '.lllllllll..mmmmmmmmm..hhhhhhhh.', // z15
  '.lllllllll..mmmmmmmmm..hhhHHhhh.', // z16
  '.llllLLlll..mmmmm#mmm..hhhHHhhh.', // z17
  '.llllLLlll..mmmmmmmmm...hhhhhh..', // z18
  '.lllllllll..mmmmmmmmm...........', // z19
  '..llllllll..mmmmmmmmm...........', // z20
  '..lllllll....mmmmmmmm...........', // z21
  '.............mmmmmmm............', // z22
  '..............mmmmm.............', // z23
  '................................', // z24
  '................................', // z25
  '................................', // z26
  '................................', // z27
  '................................', // z28
  '................................', // z29
  '................................', // z30
  '................................', // z31
];

export type Rect = { x0: number; x1: number; z0: number; z1: number };

/** Editable terrain zones (GDD §10.1: 4～6 local re-routing areas). Protected cells are subtracted. */
export const L1_01_EDIT_ZONES: readonly Rect[] = [
  { x0: 5, x1: 8, z0: 10, z1: 16 },   // E1 低台橋前
  { x0: 2, x1: 6, z0: 18, z1: 21 },   // E2 低台南側
  { x0: 13, x1: 15, z0: 13, z1: 19 }, // E3 中台西南
  { x0: 16, x1: 19, z0: 13, z1: 20 }, // E4 中台中央
  { x0: 13, x1: 19, z0: 10, z1: 12 }, // E5 中台北側
  { x0: 23, x1: 25, z0: 15, z1: 18 }, // E6 高台南側
];

export const L1_01_PORTALS = [
  { id: 'A', name: '入口 A', x: 3, z: 14 },
  { id: 'B', name: '入口 B', x: 14, z: 20 },
] as const;

export const L1_01_CONNECTORS = [
  { id: 'C_AB', name: '木製斜橋', kind: 'RAMP' as const, cells: [[9, 14], [10, 14], [11, 14], [12, 14]] as const, deckElevations: [1, 2] as const },
  { id: 'C_BC', name: '石木坡橋', kind: 'RAMP' as const, cells: [[20, 13], [21, 13], [22, 13], [23, 13]] as const, deckElevations: [3, 4] as const },
];

export const L1_01_CORE = { x0: 26, z0: 11, approaches: [[25, 12], [29, 12], [27, 10], [27, 14]] as const };

export const L1_01_TREES = [
  { x: 1, z: 11 }, { x: 2, z: 20 }, { x: 12, z: 10 }, { x: 20, z: 20 }, { x: 13, z: 22 }, { x: 30, z: 9 },
];
export const L1_01_ROCKS = [
  { x: 9, z: 19 }, { x: 18, z: 22 }, { x: 29, z: 17 }, { x: 1, z: 18 },
];
