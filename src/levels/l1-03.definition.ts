/**
 * L1-03「冰封雪峰」authoring data — the third level (snowfield theme).
 *
 * Five islands around a central summit that holds the core. The core sits in the summit's south-east corner, so every route crosses the summit; the
 * north-east ridge can drop either straight onto it or detour through the eastern glacier.
 *
 * Legend (one char per cell, x = column, z = row):
 *   .  void
 *   l  P_NW snowfield, elevation 0      L  P_NW drift, elevation 1
 *   w  P_W ice shelf, elevation 2       W  P_W ledge, elevation 3
 *   n  P_NE ridge, elevation 2          N  P_NE knoll, elevation 3
 *   e  P_E glacier, elevation 3         E  P_E serac, elevation 4
 *   c  P_S valley, elevation 1          C  P_S mound, elevation 2
 *   #  P_S ice pillar, elevation 5 (blocks walking & LOS)
 *   h  P_PEAK summit, elevation 4       H  P_PEAK lookout, elevation 5
 *   b  connector deck
 */
export const L1_03_MAP: readonly string[] = [
  '................................', // z0
  '...lllll...........nnnnnnnnn....', // z1
  '..lllllll.........nnnnnnnnnnnn..', // z2
  '.lllllllll.......nnnnnNNnnnnnnn.', // z3
  '.lllllLLll.......nnnnnNNnnnnnnn.', // z4
  '.lllllLLll.......nnnnnnnnnnnnnn.', // z5
  '.lllllllll.......nnnnnnnnnnnnnn.', // z6
  '.lllllllll.......nnnnnnnnnnnnnn.', // z7
  '..lllllll........nnnnnnnnnnnnn..', // z8
  '...lllll.........nnnnnnnnnnnn...', // z9
  '.....b............b........b....', // z10
  '.....b......hhhhhhhhh......b....', // z11
  '.....b.....HHhhhhhhhhh.....b....', // z12
  '..wwwwww..hHHhhhhhhhhh..eeeeee..', // z13
  '.wwwwwwww.hhhhhhhhhhhh.eeeeeeee.', // z14
  '.wwwwwwww.hhhhhhhhhhhhbeeeeeeee.', // z15
  '.wwwwwwwwbhhhhhhhhhhhh.eeeeeeee.', // z16
  '.wwwwwwww.hhhhhhhhhhhh.eeeeeeee.', // z17
  '.wWWwwwww.hhhhhhhhhhhh.eeeeeeee.', // z18
  '.wWWwwwww.hhhhhhhhhhhh.eeeeeeEE.', // z19
  '..wwwwww..hhhhhhhhhhhh.eeeeeeEE.', // z20
  '...wwww....hhhhhhhhhh...eeeeee..', // z21
  '..............b.................', // z22
  '..............b.................', // z23
  '......ccccccccccccccccccccc.....', // z24
  '.....ccccccccccccccccccccccc....', // z25
  '....ccccccccccccccccCCcccccc....', // z26
  '....ccccccCCcccccccccccccccc....', // z27
  '....ccccccCCcccc#ccccccccccc....', // z28
  '.....cccccccccccccccccccccc.....', // z29
  '.......cccccccccccccccccc.......', // z30
  '................................', // z31
];

export const L1_03_EDIT_ZONES = [
  { x0: 3, x1: 8, z0: 5, z1: 8 },     // E1 西北雪原
  { x0: 2, x1: 7, z0: 14, z1: 19 },   // E2 西側冰棚
  { x0: 19, x1: 26, z0: 4, z1: 8 },   // E3 東北山脊
  { x0: 7, x1: 13, z0: 25, z1: 29 },  // E4 南谷西段
  { x0: 16, x1: 24, z0: 25, z1: 29 }, // E5 南谷東段
  { x0: 11, x1: 15, z0: 14, z1: 20 }, // E6 峰頂西側
  { x0: 24, x1: 29, z0: 16, z1: 20 }, // E7 東側冰川
] as const;

export const L1_03_PORTALS = [
  { id: 'A', name: '雪原裂隙', x: 3, z: 3 },
  { id: 'B', name: '南谷裂隙', x: 6, z: 27 },
  { id: 'C', name: '山脊裂隙', x: 28, z: 4 },
] as const;

export const L1_03_CONNECTORS = [
  { id: 'C_NWW', name: '冰階坡道', kind: 'RAMP' as const, cells: [[5, 9], [5, 10], [5, 11], [5, 12], [5, 13]] as const, deckElevations: [1, 2, 2] as const },
  { id: 'C_WP', name: '西側冰橋', kind: 'BRIDGE' as const, cells: [[8, 16], [9, 16], [10, 16]] as const, deckElevations: [3] as const },
  { id: 'C_NEP', name: '山脊吊橋', kind: 'BRIDGE' as const, cells: [[18, 9], [18, 10], [18, 11]] as const, deckElevations: [3] as const },
  { id: 'C_PE', name: '冰川棧道', kind: 'BRIDGE' as const, cells: [[21, 15], [22, 15], [23, 15]] as const, deckElevations: [3] as const },
  { id: 'C_NEE', name: '冰瀑階梯', kind: 'RAMP' as const, cells: [[27, 9], [27, 10], [27, 11], [27, 12], [27, 13]] as const, deckElevations: [2, 3, 3] as const },
  { id: 'C_SP', name: '南坡長階', kind: 'RAMP' as const, cells: [[14, 24], [14, 23], [14, 22], [14, 21]] as const, deckElevations: [2, 3] as const },
];

export const L1_03_CORE = { x0: 17, z0: 17, approaches: [[16, 18], [20, 18], [18, 16], [18, 20]] as const };

export const L1_03_TREES = [
  { x: 2, z: 7 }, { x: 8, z: 2 }, { x: 29, z: 7 }, { x: 19, z: 2 }, { x: 2, z: 20 }, { x: 7, z: 20 },
  { x: 8, z: 29 }, { x: 26, z: 26 }, { x: 29, z: 21 }, { x: 24, z: 14 }, { x: 21, z: 13 },
];
export const L1_03_ROCKS = [
  { x: 9, z: 4 }, { x: 17, z: 8 }, { x: 4, z: 13 }, { x: 22, z: 30 }, { x: 30, z: 15 },
];
