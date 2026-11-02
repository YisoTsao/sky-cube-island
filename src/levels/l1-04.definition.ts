/**
 * L1-04「熔岩天空城」authoring data — the fourth level (volcanic theme).
 *
 * A sky fortress (the keep) ringed by four islands and seven connectors, attacked from four portals.
 * The northern rampart has two portals but no bridge of its own: those enemies must go round
 * through the western cliffs or the eastern terraces, while the southern ward links everything.
 *
 * Legend (one char per cell, x = column, z = row):
 *   .  void
 *   n  P_N rampart, elevation 2         N  P_N battlement, elevation 3
 *   l  P_W cliffs, elevation 0          L  P_W outcrop, elevation 1
 *   e  P_E terraces, elevation 1        E  P_E watchpost, elevation 2
 *   s  P_S ward, elevation 2            S  P_S bastion, elevation 3
 *   #  P_S obsidian spire, elevation 5 (blocks walking & LOS)
 *   h  P_KEEP keep, elevation 4         H  P_KEEP tower, elevation 5
 *   b  connector deck
 */
export const L1_04_MAP: readonly string[] = [
  '................................', // z0
  '......nnnnnnnnnnnnnnnnnnnn......', // z1
  '.....nnnnnnnnnNNNNnnnnnnnnn.....', // z2
  '....nnnnnnnnnnnnnnnnnnnnnnnn....', // z3
  '....nnnnnnnnnnnnnnnnnnnnnnnn....', // z4
  '....nnnnnnnnnnnnnnnnnnnnnnnn....', // z5
  '....nnnnnnnnnnnnnnnnnnnnnnnn....', // z6
  '.....b....................b.....', // z7
  '.....b....................b.....', // z8
  '..llllll................eeeeee..', // z9
  '.lllllll................eeeeeee.', // z10
  '.lllllll....hhhhhhhH....eeeeEEe.', // z11
  '.lllllllbbbhhhhhhhhhH...eeeeEEe.', // z12
  '.lllllll...hhhhhhhhhh...eeeeeee.', // z13
  '.lllllll...hhhhhhhhhh...eeeeeee.', // z14
  '.lllllll...hhhhhhhhhh...eeeeeee.', // z15
  '.lllllll...hhhhhhhhhh...eeeeeee.', // z16
  '.lllllll...hhhhhhhhhh...eeeeeee.', // z17
  '.lLLllll...hhhhhhhhhh...eeeeeee.', // z18
  '.lLLllll...Hhhhhhhhhhbbbeeeeeee.', // z19
  '.lllllll....Hhhhhhhh....eeeeeee.', // z20
  '..llllll.........b......eeeeeee.', // z21
  '...llll..........b.......eeeee..', // z22
  '....b............b.........b....', // z23
  '....b............b.........b....', // z24
  '...ssssssssssssssssssssssssss...', // z25
  '...ssssssssssssssssssssssssss...', // z26
  '...ssssssSSsssssssssssSSsssss...', // z27
  '....sssssssss#ssssssssssssss....', // z28
  '......ssssssssssssssssssss......', // z29
  '................................', // z30
  '................................', // z31
];


export const L1_04_EDIT_ZONES = [
  { x0: 7, x1: 13, z0: 2, z1: 5 },    // E1 北城牆西段
  { x0: 18, x1: 24, z0: 2, z1: 5 },   // E2 北城牆東段
  { x0: 2, x1: 6, z0: 10, z1: 20 },   // E3 西崖
  { x0: 25, x1: 29, z0: 13, z1: 20 }, // E4 東台
  { x0: 6, x1: 14, z0: 26, z1: 28 },  // E5 南區西段
  { x0: 19, x1: 26, z0: 26, z1: 28 }, // E6 南區東段
  { x0: 11, x1: 12, z0: 13, z1: 18 }, // E7 城堡西緣
] as const;

export const L1_04_PORTALS = [
  { id: 'A', name: '西北城門', x: 8, z: 3 },
  { id: 'B', name: '西崖裂隙', x: 3, z: 14 },
  { id: 'C', name: '東台裂隙', x: 28, z: 15 },
  { id: 'D', name: '東北城門', x: 23, z: 3 },
] as const;

export const L1_04_CONNECTORS = [
  { id: 'C_NW', name: '西城坡道', kind: 'RAMP' as const, cells: [[5, 6], [5, 7], [5, 8], [5, 9]] as const, deckElevations: [1, 1] as const },
  { id: 'C_NE', name: '東城坡道', kind: 'RAMP' as const, cells: [[26, 6], [26, 7], [26, 8], [26, 9]] as const, deckElevations: [2, 1] as const },
  { id: 'C_WK', name: '西門吊橋', kind: 'BRIDGE' as const, cells: [[7, 12], [8, 12], [9, 12], [10, 12], [11, 12]] as const, deckElevations: [1, 2, 3] as const },
  { id: 'C_EK', name: '東門吊橋', kind: 'BRIDGE' as const, cells: [[24, 19], [23, 19], [22, 19], [21, 19], [20, 19]] as const, deckElevations: [2, 3, 4] as const },
  { id: 'C_SK', name: '熔岩長橋', kind: 'BRIDGE' as const, cells: [[17, 25], [17, 24], [17, 23], [17, 22], [17, 21], [17, 20]] as const, deckElevations: [3, 3, 4, 4] as const },
  { id: 'C_WS', name: '西崖石階', kind: 'RAMP' as const, cells: [[4, 22], [4, 23], [4, 24], [4, 25]] as const, deckElevations: [1, 2] as const },
  { id: 'C_ES', name: '東台石階', kind: 'RAMP' as const, cells: [[27, 22], [27, 23], [27, 24], [27, 25]] as const, deckElevations: [1, 2] as const },
];

export const L1_04_CORE = { x0: 14, z0: 14, approaches: [[13, 15], [17, 15], [15, 13], [15, 17]] as const };

export const L1_04_TREES = [
  { x: 5, z: 2 }, { x: 26, z: 4 }, { x: 2, z: 10 }, { x: 6, z: 21 }, { x: 29, z: 10 }, { x: 25, z: 21 },
  { x: 5, z: 27 }, { x: 27, z: 27 }, { x: 12, z: 18 },
];
export const L1_04_ROCKS = [
  { x: 12, z: 5 }, { x: 19, z: 5 }, { x: 1, z: 16 }, { x: 30, z: 17 }, { x: 8, z: 29 }, { x: 24, z: 28 },
];
