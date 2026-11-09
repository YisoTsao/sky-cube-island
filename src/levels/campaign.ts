import type { GeneratedLevelSpec } from './procgen';

/**
 * Campaign beyond the four hand-authored islands (GDD §16 T3「擴充到 3 章 × 5 關」).
 * Chapter 1 ends with a fifth island that introduces the new enemies; chapters 2 and 3 are built by
 * the island generator from these descriptors (seed + layout + wave plan), so they are as
 * deterministic as the authored maps and validated the same way.
 */

export interface ChapterDef { id: number; name: string; subtitle: string; levelIds: string[] }

export const CHAPTERS: ChapterDef[] = [
  { id: 1, name: '第一章・浮空群島', subtitle: '學會改路、爭高地與四種地形', levelIds: ['L1-01', 'L1-02', 'L1-03', 'L1-04', 'L1-05'] },
  { id: 2, name: '第二章・風暴高原', subtitle: '飛龍與角獸來襲，拆橋與陷阱登場', levelIds: ['L2-01', 'L2-02', 'L2-03', 'L2-04', 'L2-05'] },
  { id: 3, name: '第三章・深淵天境', subtitle: '五、六個入口同時進攻的終局之戰', levelIds: ['L3-01', 'L3-02', 'L3-03', 'L3-04', 'L3-05'] },
];

export const GENERATED_SPECS: GeneratedLevelSpec[] = [
  {
    id: 'L1-05', name: '雲端前哨', subtitle: '飛龍初現・陷阱與拆橋教學', theme: 'day', weather: 'rain', seed: 1501, initialGold: 460,
    layout: { sides: ['N', 'W', 'E'], hubs: ['N'], doubleBridge: ['N'], corners: ['NW', 'NE'], coreElevation: 3, pillars: 2 },
    plan: { roster: ['slime', 'runner', 'mini', 'wyvern', 'knight', 'boar', 'wisp'], finalBoss: 'boss', waves: 6, density: 0.85, hp: [0.6, 1.15] },
  },
  {
    id: 'L2-01', name: '角獸草原', subtitle: '破牆角獸・木牆擋不住的敵人', theme: 'day', seed: 2103, initialGold: 440,
    layout: { sides: ['N', 'S', 'W'], hubs: ['S'], doubleBridge: ['S'], corners: ['NW', 'SW'], coreElevation: 2, pillars: 2 },
    plan: { roster: ['slime', 'runner', 'ram', 'bat', 'wyvern', 'splitter', 'boar'], finalBoss: 'queen', waves: 6, density: 1.8, hp: [0.7, 1.75] },
  },
  {
    id: 'L2-02', name: '雙峰吊橋', subtitle: '兩條長橋・拆一座逼敵人繞遠路', theme: 'dusk', weather: 'fog', seed: 2202, initialGold: 460,
    layout: { sides: ['N', 'E', 'S', 'W'], hubs: ['E', 'W'], doubleBridge: ['E'], corners: ['NE', 'SW'], coreElevation: 3, pillars: 3 },
    plan: { roster: ['slime', 'mini', 'ghost', 'ram', 'wyvern', 'crab', 'shaman'], finalBoss: 'boss', waves: 6, density: 0.72, hp: [0.6, 1.45] },
  },
  {
    id: 'L2-03', name: '霜風峽谷', subtitle: '雪地上的飛龍群', theme: 'snow', weather: 'snow', seed: 2305, initialGold: 480,
    layout: { sides: ['N', 'E', 'W'], portals: { N: 2 }, hubs: ['N'], doubleBridge: ['N'], corners: ['NE', 'NW'], coreElevation: 3, pillars: 2 },
    plan: { roster: ['slime', 'bat', 'yeti', 'wyvern', 'ram', 'mole', 'shaman'], finalBoss: 'frostGiant', waves: 7, density: 1, hp: [0.65, 1.5] },
  },
  {
    id: 'L2-04', name: '紫晶迴廊', subtitle: '五座橋・路線千變萬化', theme: 'dusk', weather: 'rain', seed: 2404, initialGold: 500,
    layout: { sides: ['N', 'E', 'S', 'W'], hubs: ['N', 'S'], corners: ['NE', 'SE', 'SW', 'NW'], coreElevation: 4, pillars: 3 },
    plan: { roster: ['runner', 'mini', 'splitter', 'crab', 'wyvern', 'ram', 'wisp', 'ghost'], finalBoss: 'queen', midBosses: { 3: 'boss' }, waves: 7, density: 0.85, hp: [0.65, 1.55] },
  },
  {
    id: 'L2-05', name: '風暴之眼', subtitle: '第二章最終戰・不死火鳥再臨', theme: 'ember', seed: 2505, initialGold: 520,
    layout: { sides: ['N', 'E', 'S', 'W'], portals: { S: 2 }, hubs: ['N', 'S'], doubleBridge: ['N'], corners: ['NE', 'SW'], coreElevation: 3, pillars: 3 },
    plan: { roster: ['slime', 'imp', 'salamander', 'wyvern', 'ram', 'knight', 'shaman', 'boar'], finalBoss: 'phoenix', midBosses: { 3: 'queen' }, waves: 7, density: 0.62, hp: [0.65, 1.55] },
  },
  {
    id: 'L3-01', name: '深淵入口', subtitle: '五個入口・第三章開始', theme: 'dusk', weather: 'fog', seed: 3101, initialGold: 540,
    layout: { sides: ['N', 'E', 'S', 'W'], portals: { N: 2 }, hubs: ['E', 'W'], corners: ['NE', 'NW', 'SE'], coreElevation: 3, pillars: 3 },
    plan: { roster: ['slime', 'runner', 'bat', 'wyvern', 'ram', 'ghost', 'crab', 'wisp'], finalBoss: 'boss', midBosses: { 3: 'queen' }, waves: 7, density: 0.85, hp: [0.65, 1.6] },
  },
  {
    id: 'L3-02', name: '冰晶墓園', subtitle: '幽靈與巨猿的雪夜', theme: 'snow', weather: 'snow', seed: 3202, initialGold: 560,
    layout: { sides: ['N', 'E', 'S', 'W'], portals: { E: 2 }, hubs: ['N', 'S'], doubleBridge: ['S'], corners: ['NE', 'SW', 'NW'], coreElevation: 3, pillars: 3 },
    plan: { roster: ['mini', 'ghost', 'yeti', 'bat', 'wyvern', 'shaman', 'ram', 'mole'], finalBoss: 'frostGiant', midBosses: { 3: 'boss' }, waves: 7, density: 0.68, hp: [0.65, 1.6] },
  },
  {
    id: 'L3-03', name: '熔火斷層', subtitle: '熔岩上的六座橋', theme: 'ember', seed: 3305, initialGold: 700,
    layout: { sides: ['N', 'E', 'S', 'W'], portals: { N: 2, S: 2 }, hubs: ['E', 'W'], corners: ['NE', 'SW', 'NW', 'SE'], coreElevation: 4, pillars: 4 },
    plan: { roster: ['imp', 'salamander', 'runner', 'wyvern', 'ram', 'crab', 'knight', 'shaman'], finalBoss: 'phoenix', midBosses: { 3: 'frostGiant' }, waves: 7, density: 0.75, hp: [0.65, 1.5] },
  },
  {
    id: 'L3-04', name: '天穹花園', subtitle: '一切怪物齊聚的花海', theme: 'day', weather: 'rain', seed: 3404, initialGold: 720,
    layout: { sides: ['N', 'E', 'S', 'W'], portals: { E: 2, W: 2 }, hubs: ['N', 'S'], doubleBridge: ['N', 'S'], corners: ['NE', 'SE', 'SW', 'NW'], coreElevation: 3, pillars: 4 },
    plan: { roster: ['slime', 'mini', 'splitter', 'boar', 'wyvern', 'ram', 'wisp', 'ghost', 'shaman'], finalBoss: 'queen', midBosses: { 2: 'boss', 4: 'phoenix' }, waves: 7, density: 0.45, hp: [0.65, 1.5] },
  },
  {
    id: 'L3-05', name: '守護之心', subtitle: '最終決戰・六個入口與三大頭目', theme: 'ember', weather: 'fog', seed: 3505, initialGold: 800,
    layout: { sides: ['N', 'E', 'S', 'W'], portals: { N: 2, E: 1, S: 2, W: 1 }, hubs: ['E', 'W'], doubleBridge: ['E', 'W'], corners: ['NE', 'SW', 'NW', 'SE'], coreElevation: 4, pillars: 4 },
    plan: { roster: ['imp', 'runner', 'bat', 'wyvern', 'ram', 'boar', 'ghost', 'shaman', 'yeti', 'wisp'], finalBoss: 'phoenix', midBosses: { 3: 'frostGiant' }, waves: 7, density: 0.55, hp: [0.65, 1.5] },
  },
];
