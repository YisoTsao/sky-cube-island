/**
 * L1-02「霧谷晶石群島」authoring data — the second level.
 *
 * Four floating islands joined by four connectors, three portals and a crystal plateau core.
 * A (west lowland) can reach the core through either the north ridge or the southern valley,
 * so walls and terrain edits decide which way it walks.
 *
 * Legend (one char per cell, x = column, z = row):
 *   .  void
 *   l  P_WEST lowland, elevation 0         L  P_WEST mound, elevation 1
 *   n  P_NORTH ridge, elevation 2          N  P_NORTH knoll, elevation 3
 *   m  P_SOUTH valley, elevation 2         M  P_SOUTH hill, elevation 3
 *   #  P_SOUTH rock pillar, elevation 5 (blocks walking & LOS)
 *   h  P_HIGH crystal plateau, elevation 4 H  P_HIGH lookout, elevation 5
 *   b  connector deck (resolved through the connector chains below)
 */
export const L1_02_MAP: readonly string[] = [
  '................................', // z0
  '..............nnnnnnn...........', // z1
  '.............nnnnnnnnnnnn.......', // z2
  '.............nnnnnNNnnnnnnnn....', // z3
  '...lllll.....nnnnnNNnnnnnnnnn...', // z4
  '..lllllll....nnnnnnnnnnnnnnnn...', // z5
  '.lllllllllbbbnnnnnnnnnnnnnnnn...', // z6
  '.lllllllll.....nnnnnnnnnnnnnn...', // z7
  '.lllllllll........nnnnnnnnnn....', // z8
  '.lllllllll................b.....', // z9
  '.lllllllll................b.....', // z10
  '.llLLllll.................b.....', // z11
  '.llLLllll..............hhhhhhh..', // z12
  '..lllllll.............hhhhhhhHH.', // z13
  '...lllll.............hhhhhhhhHH.', // z14
  '......b..............hhhhhhhhhh.', // z15
  '......b..............hhhhhhhhhh.', // z16
  '......b..............hhhhhhhhhh.', // z17
  '....mmmmmmmm.........hhhhhhhhhh.', // z18
  '...mmmmmmmmmmmm......hhhhhhhhhh.', // z19
  '...mmmmmmmmmmmmmbbbbbhhhhhhhhhh.', // z20
  '...mmmmmmmmmmmmm.....hHHhhhhhhh.', // z21
  '...mmmmmmMMmmmmm......HHhhhhhh..', // z22
  '...mmmmmmMMmmmmm........hhhhh...', // z23
  '...mmmmmmmmmmmm.................', // z24
  '...mmmmmmmmm#mm.................', // z25
  '...mmmmmmmmmmm..................', // z26
  '....mmmmmmmmm...................', // z27
  '......mmmmm.....................', // z28
  '................................', // z29
  '................................', // z30
  '................................', // z31
];

export const L1_02_EDIT_ZONES = [
  { x0: 4, x1: 8, z0: 8, z1: 12 },    // E1 西岸橋前
  { x0: 16, x1: 23, z0: 4, z1: 7 },   // E2 北嶺中段
  { x0: 8, x1: 14, z0: 19, z1: 22 },  // E3 南谷橋前
  { x0: 5, x1: 10, z0: 24, z1: 27 },  // E4 南谷入口
  { x0: 21, x1: 25, z0: 13, z1: 19 }, // E5 高原西側
  { x0: 26, x1: 30, z0: 12, z1: 16 }, // E6 高原北側
] as const;

export const L1_02_PORTALS = [
  { id: 'A', name: '西岸裂隙', x: 2, z: 8 },
  { id: 'B', name: '南谷裂隙', x: 4, z: 25 },
  { id: 'C', name: '北嶺裂隙', x: 15, z: 2 },
] as const;

export const L1_02_CONNECTORS = [
  { id: 'C_WN', name: '西風木橋', kind: 'BRIDGE' as const, cells: [[9, 6], [10, 6], [11, 6], [12, 6], [13, 6]] as const, deckElevations: [1, 2, 2] as const },
  { id: 'C_WS', name: '石階坡道', kind: 'RAMP' as const, cells: [[6, 14], [6, 15], [6, 16], [6, 17], [6, 18]] as const, deckElevations: [1, 1, 2] as const },
  { id: 'C_SH', name: '峽谷長橋', kind: 'BRIDGE' as const, cells: [[15, 20], [16, 20], [17, 20], [18, 20], [19, 20], [20, 20], [21, 20]] as const, deckElevations: [2, 3, 3, 4, 4] as const },
  { id: 'C_NH', name: '北坡吊橋', kind: 'RAMP' as const, cells: [[26, 8], [26, 9], [26, 10], [26, 11], [26, 12]] as const, deckElevations: [3, 4, 4] as const },
];

export const L1_02_CORE = { x0: 27, z0: 18, approaches: [[26, 19], [28, 17], [30, 19], [28, 21]] as const };

export const L1_02_TREES = [
  { x: 3, z: 5 }, { x: 8, z: 13 }, { x: 20, z: 1 }, { x: 27, z: 4 }, { x: 4, z: 21 },
  { x: 12, z: 27 }, { x: 14, z: 23 }, { x: 29, z: 22 }, { x: 24, z: 23 },
];
export const L1_02_ROCKS = [
  { x: 8, z: 5 }, { x: 23, z: 2 }, { x: 4, z: 27 }, { x: 30, z: 15 }, { x: 1, z: 11 },
];
