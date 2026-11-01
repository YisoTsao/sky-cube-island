# 天空方塊島：守護之心｜技術架構與開發實作規格

> **Technical Architecture / Data Contract / Claude Code Implementation Plan**  
> 版本：**v2.1**｜日期：2026-11-01｜與 [`01_GAME_DESIGN_DOCUMENT.md`](01_GAME_DESIGN_DOCUMENT.md) v2.1 配套  
> 優先權：GDD 的**遊戲行為規則**為唯一真相；此文件定義資料、渲染與實作契約  
> 前提：一人開發、Web Demo 優先、無後端、可延伸 PC / Steam  
> 變更紀錄見 [附錄 A](#附錄-av21-變更紀錄changelog)；決策編號 `D21-xx` 與 GDD 共用

## 0. 與舊版架構的非相容性變更

### 0.1 v2.1 新增（與 v2.0 相容）

v2.1 **不改變** v2.0 的地圖、導航、LOS 與模擬契約，只補齊以下內容：

- 正式定義 `GameEvent`（§8.3），作為渲染、動畫、VFX、音訊、統計的唯一輸入。
- 新增 `UNDO_PREPARE` 命令與 Session 層撤銷歷史（§6.4），不進 `GameState`、不進存檔。
- 明確化多入口出怪的輪流分配（§8.1）與塔／怪的炮口、瞄準高度初值（§3.1）。
- 新增完整的**高精緻渲染管線**規格：色彩管理、光照、體素網格化、材質、後處理、畫質分級、戰術層分離、Juice 系統、音訊（§9.4～§9.10）。
- 新增資產管線（MagicaVoxel／Blockbench → GLB → glTF Transform）、主調色盤與資產預算（§10、§13）。
- 新增設定存檔、視覺回歸與效能測試（§11、§12.5～§12.6）。

### 0.2 v2.0 相對舊版的非相容性變更

原先 `Cell[x,z] + elevation` 的單層 16×16 地圖不足以描述多個懸浮平台和橋梁。**不得直接把舊版 16×16 改為 32×32 就當成升級完成。**

- 地圖改為 `width=32, depth=32`，支援不規則、非填滿的地表集合；未佈置的格子是 Void。
- 使用 `SurfaceCell.id` 作為導航節點唯一識別，支援 `platformId`、`elevation 0..6`；未來可處理同 X/Z 不同高度的多層表面。
- 連接不同平台使用明確的 `Connector.chain`（橋／階梯／坡道），不能直接以距離近判斷可走。
- 3×3 Core **不可直接踩入**，改為通往 `core.approachNodeIds` 的多目標路徑搜尋。
- 一座塔占 2×2，同平台同高度；放置、升級、移除由資料層更新 4 格 footprint。
- 塔射擊必須通過**3D 距離 + 地圖邏輯 LOS**，不得仰賴 UI 的 Three.js Raycaster 決定傷害。
- 地形與路障只在 PREPARE 修改；關鍵橋／橋端保護區不在 MVP 編輯範圍。

## 1. 推薦技術棧與架構原則

| 層 | 技術 | 約束 |
|---|---|---|
| 建置 | Vite + React + TypeScript strict | Web 可靜態部署；避免不必要 SSR |
| 場景 | Three.js + React Three Fiber + Drei | 視覺渲染、相機、輸入拾取；WebGL2 為必要條件 |
| 後處理 | `postprocessing`（pmndrs）＋ `@react-three/postprocessing`、N8AO | 合併 Effect Pass；戰術層不進後處理（§9.7） |
| 動畫 | 自製 Spring／Tween（或 `maath`）＋ Shader 動畫 | 只在表現層；不得進 Simulation |
| 粒子 | 自製 InstancedMesh 方塊粒子池（`three.quarks` 為備選） | 固定上限、物件池、零每幀配置 |
| 文字 | `troika-three-text` 或 SDF 點陣字型 | 傷害數字與世界標籤；不用 DOM 每數字一節點 |
| 音訊 | Web Audio API（`howler.js` 包裝） | Bus／Ducking／同時發聲上限（§9.9） |
| UI | React + Tailwind + Zustand + `motion` | 低頻 HUD；不要每個敵人每 tick 觸發 React render |
| 模擬核心 | 純 TypeScript + 固定 tick | 不依賴 React / Three.js / DOM，接受 Commands，輸出 State + Events |
| 規則／Schema | Zod + 明確 TypeScript 型別 | 關卡、存檔、資產 manifest 驗證 |
| 尋路 | 自行實作的 A* over NavigationGraph | 連接節點、路障、雙入口、多目標到核心 |
| 存檔 | IndexedDB + schemaVersion | 只在安全時機存完整戰局 |
| 測試 | Vitest + Playwright | 邏輯回歸 + 完整遊戲流程 |
| 建模 | 程式幾何 / MagicaVoxel / Blockbench / Blender | GLB 模型與遊戲占位資料分離；微體素 1/16 格 |
| 資產最佳化 | glTF Transform（meshopt、weld、quantize、KTX2） | 建置期執行；預算檢查失敗則 CI 失敗 |
| AI 資產 | Meshy（選用） | 僅開發時批次產生；玩家 Runtime 不呼叫 Meshy API |
| PC 發行 | Electron 或其他包裝路線（後評估） | 渲染、資源、Steam 相容性需獨立測試 |

### 依賴方向（不可逆）

```text
User Input / React HUD
        │  GameCommand
        ▼
Command Controller (preview / validate / commit)
        │
        ├── Level Domain Data / Rules (Pure TS)
        │           │
        │           └── NavigationGraph + A* + LOS
        ▼
Game Simulation (20 TPS, deterministic)
        │
        ├── GameSnapshot ─────► R3F Renderer / Interpolation
        │                            ├── World Pass（地形、塔、怪、環境）
        │                            ├── Post-processing（AO / Bloom / LUT）
        │                            └── Tactical Overlay Pass（路線、射程、選格）
        │
        ├── GameEvent ────────► Presentation Director
        │                            ├── Juice / Animation / VFX
        │                            ├── Audio Director
        │                            └── Wave Stats / HUD Feedback
        │
        └── Save Serializer ──► IndexedDB
```

**不得**在 Simulation 中 import Three.js、React、Zustand 或存取 Canvas；場景 Mesh 並不是唯一狀態來源。**表現層不得回寫 Simulation**：所有動畫、特效、音效、鏡頭震動只讀取 Snapshot 與 Event（D21-04）；表現層可使用非決定性亂數（例如粒子方向），但絕不可呼叫 Simulation 的 RNG。

## 2. 專案目錄

```text
skybound-defenders/
├── docs/
│   ├── 01_GAME_DESIGN_DOCUMENT.md
│   ├── 02_TECHNICAL_ARCHITECTURE.md
│   ├── ART_BIBLE.md            # 主調色盤、形狀語言、Golden Shot 參考圖
│   └── DECISIONS.md
├── art-src/                    # 原始美術檔（.vox / .bbmodel / .blend），不進 public
├── public/assets/
│   ├── models/                 # 最佳化後 GLB（meshopt）
│   ├── audio/                  # music stems / sfx（ogg + m4a）
│   ├── textures/               # palette.png、LUT、noise（KTX2）
│   └── fonts/                  # 子集化字型
├── src/
│   ├── app/                    # bootstrap / lifecycle
│   ├── domain/
│   │   ├── types.ts            # strict domain contracts
│   │   ├── schemas.ts          # Zod runtime validation
│   │   └── definitions.ts      # tower/enemy/terrain balance
│   ├── levels/
│   │   ├── l1-01.definition.ts
│   │   ├── l1-01.generator.ts
│   │   └── level-validator.ts
│   ├── navigation/
│   │   ├── build-graph.ts
│   │   ├── astar.ts
│   │   ├── connectivity.ts
│   │   └── line-of-sight.ts
│   ├── commands/
│   │   ├── preview.ts
│   │   ├── validate.ts
│   │   └── execute.ts
│   ├── simulation/
│   │   ├── engine.ts
│   │   ├── fixed-loop.ts
│   │   ├── enemy.ts
│   │   ├── towers.ts
│   │   ├── combat.ts
│   │   ├── waves.ts
│   │   └── economy.ts
│   ├── session/
│   │   └── undo-history.ts      # PREPARE 撤銷堆疊（不進 GameState）
│   ├── scene/
│   │   ├── render/              # renderer 設定、色彩管理、畫質分級、動態解析度
│   │   ├── lighting/            # 太陽、IBL、陰影相機貼合
│   │   ├── terrain/             # 體素 mesher（AO、假倒角、色彩擾動）
│   │   ├── environment/         # 天空、雲海、高度霧、遠景島、植被風動
│   │   ├── materials/           # 共用調色盤材質、核心/傳送門/冰晶 shader
│   │   ├── connectors/
│   │   ├── towers/
│   │   ├── enemies/
│   │   ├── camera/
│   │   ├── postfx/              # EffectComposer 堆疊
│   │   ├── overlay/             # 戰術層：路線、射程投影、選格、血條
│   │   └── vfx/                 # 方塊粒子池、拖尾、貼花
│   ├── presentation/
│   │   ├── director.ts          # GameEvent → 動畫 / VFX / 音效 / 鏡頭
│   │   ├── juice/               # spring、tween、shake
│   │   └── stats.ts             # 波次回顧與失敗分析
│   ├── audio/                   # buses、music layers、sfx registry
│   ├── settings/                # 畫質、音量、無障礙（獨立存檔）
│   ├── ui/
│   ├── persistence/
│   ├── state/                   # UI store + sim subscription adapter
│   └── assets/
├── scripts/
│   ├── build-level.ts
│   ├── vox-to-glb.ts            # .vox → 貪婪網格 + 體素 AO + 調色盤 UV
│   ├── optimize-assets.ts       # glTF Transform 管線
│   ├── inspect-glb.ts           # 尺寸 / 面數 / 材質 / 調色盤 / 預算檢查
│   └── subset-fonts.ts
└── tests/
    ├── unit/
    ├── integration/
    ├── visual/                  # Golden Shot 截圖回歸
    └── e2e/
```

先建立單一 App，不需要預先抽出多遊戲 monorepo；等可玩的 Demo 穩定後才考慮將 Voxel Core 抽包。

## 3. 地圖與資料契約

### 3.1 核心型別（建議 TypeScript）

```ts
export type CellId = string;
export type PlatformId = string;
export type Elevation = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type GridPos = { x: number; z: number };

export type SurfaceKind = 'ground' | 'bridgeDeck' | 'stairDeck' | 'rampDeck';
export type TerrainKind = 'grass' | 'stone' | 'wood' | 'water';
export type ConnectorKind = 'BRIDGE' | 'STAIR' | 'RAMP';

export interface SurfaceCell {
  id: CellId;                  // stable, unique across all surfaces
  platformId: PlatformId;     // ground platform or connector platform ID
  pos: GridPos;               // x/z, within width/depth
  elevation: Elevation;       // top surface height index
  kind: SurfaceKind;
  terrain: TerrainKind;
  editable: boolean;          // only ordinary ground cells
  buildable: boolean;         // tower footprint candidate
  immutable: boolean;         // portals/core/protected zones
  tags?: string[];
}

export interface PlatformDef {
  id: PlatformId;
  name: string;
  cellIds: CellId[];
}

export interface ConnectorDef {
  id: string;
  kind: ConnectorKind;
  /** Includes ground endpoint A, intermediate deck nodes, endpoint B. */
  chain: CellId[];
  bidirectional: true;        // MVP all connectors allow two-way traversal
  immutable: true;            // bridge collapse/destruction is post-MVP
}

export interface PortalDef { id: string; cellId: CellId }

export interface CoreDef {
  footprintCellIds: CellId[]; // exactly 9 cells = 3x3
  approachNodeIds: CellId[];  // valid ground endpoints adjacent to core
  maxHp: number;              // MVP 20
}

export interface LevelDef {
  schemaVersion: 2;
  id: string;
  name: string;
  width: number;              // MVP 32
  depth: number;              // MVP 32
  heightStepWorld: 0.5;
  cells: SurfaceCell[];       // sparse set, no implicit floor in void
  platforms: PlatformDef[];
  connectors: ConnectorDef[];
  portals: PortalDef[];      // MVP 2, extensible 3+
  core: CoreDef;
  initialGold: number;       // 220
  maxShortestPathCost: number;// MVP 160
  waves: WaveDef[];
}

export type TowerKind = 'arrow' | 'frost' | 'cannon';
export type EnemyKind = 'slime' | 'runner' | 'golem';

export interface TowerDef {
  kind: TowerKind;
  buildCost: number;
  baseDamage: number;
  baseRangeWorld: number;
  cooldownSeconds: number;
  damageType: 'physical' | 'magic';
  muzzleOffsetWorld: number;  // arrow 1.6 / frost 1.4 / cannon 1.1 (GDD §7, D21-08)
  blastRadiusWorld?: number;
  slow?: { ratio: number; durationSeconds: number };
}

export interface EnemyDef {
  kind: EnemyKind;
  hp: number;
  speedCellsPerSecond: number;
  coreDamage: number;
  goldReward: number;
  physicalResistance: number; // 0.2 for golem
  targetOffsetWorld: number;  // slime 0.30 / runner 0.35 / golem 0.55 (GDD §8, D21-08)
}

export interface SpawnEntry {
  enemyKind: EnemyKind;
  count: number;
  /** Round-robin in list order: i-th enemy → portalIds[i % length] (D21-07). */
  portalIds: string[];
  intervalTicks: number;     // default 23 ticks = 1.15s @ 20 TPS; per-portal schedule
}
export interface WaveDef {
  id: string;
  entries: SpawnEntry[];
  clearGold: number;
}
```

`SurfaceCell` 不使用 `[x + z * width]` 當唯一 ID，避免未來同一 X/Z 上方與下方各有通道時資料衝突。**MVP 限制單一 X/Z 至多一個可遊玩表面（橋與普通地面皆算）**，讓 3D 選取與地形渲染先穩定；使用 `cellId` 是提前為真正多層重疊預留結構，**不是已實作重疊表面支援**。

**秒數 → tick 換算（20 TPS，全部整除，避免浮點誤差）**：箭塔 0.80s＝16、冰晶 1.35s＝27、砲塔 2.60s＝52、減速 1.8s＝36、出怪間隔 1.15s＝23。`definitions.ts` 以 tick 為儲存單位，秒數只作為文件與 UI 顯示。若日後新數值無法整除，以 `Math.round` 換算並在 `DECISIONS.md` 記錄。

### 3.2 局內狀態與建築占地

```ts
export type GamePhase =
  | 'MENU' | 'PREPARE' | 'COMBAT' | 'WAVE_RESULT' | 'VICTORY' | 'DEFEAT';

export interface TowerInstance {
  id: string;
  kind: TowerKind;
  anchorCellId: CellId;         // top-left (min x/z)
  footprintCellIds: CellId[];  // exactly 4, same elevation/platform
  level: 1 | 2 | 3;
  cooldownTicks: number;
  investedGold: number;
  targeting: 'FIRST';
}

export interface WallInstance { id: string; cellId: CellId; cost: 15 }

export interface EnemyInstance {
  id: string;
  kind: EnemyKind;
  portalId: string;
  hp: number;
  state: 'moving' | 'dead' | 'reachedCore';
  pathNodeIds: CellId[];
  edgeIndex: number;            // segment currently moving across
  segmentProgress: number;     // [0,1], render interpolation source
  slowUntilTick: number;
  spawnTick: number;
}

export interface GameState {
  schemaVersion: 2;
  levelId: string;
  phase: GamePhase;
  tick: number;
  rngSeed: number;
  gold: number;
  coreHp: number;
  currentWaveIndex: number;     // 0-based
  spawnCursor: number;
  waveTick: number;
  awardedWaveIds: string[];
  editedElevations: Record<CellId, Elevation>;
  walls: WallInstance[];
  towers: TowerInstance[];
  enemies: EnemyInstance[];
  nextEntityId: number;
}

export type GameCommand =
  | { type: 'SET_ELEVATION'; cellId: CellId; next: Elevation }
  | { type: 'PLACE_WALL'; cellId: CellId }
  | { type: 'REMOVE_WALL'; wallId: string }
  | { type: 'BUILD_TOWER'; kind: TowerKind; anchorCellId: CellId }
  | { type: 'UPGRADE_TOWER'; towerId: string }
  | { type: 'SELL_TOWER'; towerId: string }
  | { type: 'UNDO_PREPARE' }   // D21-06：由 Session 層處理，見 §6.4
  | { type: 'START_WAVE' };

export type CommandResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; state: GameState; code: RejectionCode; message: string };

export type RejectionCode =
  | 'INVALID_PHASE' | 'OUT_OF_BOUNDS' | 'NOT_EDITABLE'
  | 'OCCUPIED' | 'INVALID_FOOTPRINT' | 'INVALID_ELEVATION'
  | 'PROTECTED_CONNECTOR' | 'INSUFFICIENT_GOLD'
  | 'NO_ROUTE_FROM_PORTAL' | 'ROUTE_TOO_LONG'
  | 'NOT_FOUND' | 'INVALID_LEVEL_DATA'
  | 'NOTHING_TO_UNDO';

/** Runtime-only flags; NOT part of GameState or saves. */
export interface RuntimeFlags {
  paused: boolean;            // GDD §3：不覆寫 GamePhase
  speed: 1 | 2;
}
```

**資料來源規範**：`LevelDef` 是不可變基底；GameState 只儲存修改差異及實體，從 `LevelDef + GameState` 派生 `DerivedMap`。不允許場景 Renderer 修改 `LevelDef` 或直接修改狀態物件。

### 3.3 Level Schema 驗證（啟動前必跑）

1. `width, depth` 是合法整數，所有 x/z 在盤面內。
2. `cellId` 全部唯一，引用存在；MVP 不允許同一 x/z 出現兩個表面節點。
3. 各平台 cellIds 不重複，地格的 platformId 與索引一致。
4. Connector 的 `chain` 長度 ≥2；首尾是地面端點，中間是 deck；每步 x/z 四方向相鄰、高度差 ≤1，無失效節點；兩個端點屬於不同平台。
5. 普通地形與 Connector 的隱含邊不得互相穿越；所有 Connector 橋面不建塔、不編輯。
6. Portals 為 2 個以上且互不重複，位於合法可行走地格；不可建塔、不可編輯。
7. Core footprint 恰好 9 個節點，排列成**同平台、同高度**的 3×3 正方形；Approach 至少 2 格，位於核心周邊正交相鄰的普通地格，且不與 footprint 重疊。
8. 初始每個 Portal 到任一 Approach 的最短合法路線存在，成本 ≤ `maxShortestPathCost`。
9. `editable`、`buildable`、`immutable` 組合合理；Connector 端點與保護區禁止修改。
10. 所有 `WaveDef` 敵人、數量、Portal ID、clearGold 都符合 Schema。

## 4. NavigationGraph：真正的多平台尋路

### 4.1 圖形資料

```ts
interface NavEdge { to: CellId; cost: 1; via?: string }
interface NavigationGraph {
  neighbors: Map<CellId, NavEdge[]>;
  nodes: Map<CellId, SurfaceCell>;
}
```

`buildNavigationGraph(level, state)` 由**已驗證的 Domain Data**產生可走圖：

1. 讀入有效 `SurfaceCell`；Void、水、Core footprint、Tower/WALL footprint 不可進入。
2. **普通同平台邊**：只在兩個 `kind='ground'` 節點相鄰（Manhattan=1）、高度差 ≤1 時建立雙向邊。
3. **跨平台邊**：僅透過 `Connector.chain` 提供的連續節點建立雙向邊，必要時保留 `via=connectorId`，以便動畫判定。
4. `bridgeDeck/stairDeck/rampDeck` **不能自行與旁邊其他地格建立普通邊**，避免從橋上橫移到懸崖。
5. 初版 `cost=1` 表示走一步；所有 Connector 都有實際中間節點，無瞬間傳送。
6. 使用穩定排序的 `cellId`／鄰邊順序，確保多條等長路徑時產生相同結果。

### 4.2 A* 的輸入與輸出

```ts
function findPathToCore(
  graph: NavigationGraph,
  startNodeId: CellId,
  goalNodeIds: readonly CellId[],
  maxCost: number,
): { nodeIds: CellId[]; cost: number } | null;
```

- 以 `abs(dx - goal.x) + abs(dz - goal.z)` 對多個 Approach 的最小值作 heuristic。因 Connector 也是實體相鄰單步，其成本下界成立；若日後加入電梯／傳送邊，應改為安全的 `h=0`（Dijkstra）或重設 admissible heuristic。
- 遇到 Core Approach 之一即完成，採 deterministic tie-breaking（例如 f、g、cellId）。
- 不以 Three.js `Raycaster` 或 Mesh 距離做通行判斷。
- 放置／拆除物件、升降地形時重新建立／更新圖與所有入口路徑。
- COMBAT 開始前為當前 wave 所有入口生成路線快照；戰鬥中不修改地形，敵人依其入口快照走完整路線。
- 若 Spawn 分布跨入口，仍要使用與預覽相同的導航算法，不得讓怪物走另一條藏在 Mesh 裡的近路。

### 4.3 兩段橋的 L1-01 拓樸範例

```text
P_LOW elevation 0             P_MID elevation 2            P_HIGH elevation 4
Portal A                       Portal B                         Core 3x3
  (3,14)                          (14,20)                          approach
     └── (9,14,0) ─ (10,14,1) ─ (11,14,2) ─ (12,14,2)
                                      C_AB: RAMP / BRIDGE

                              (20,13,2) ─ (21,13,3) ─ (22,13,4) ─ (23,13,4)
                                                     C_BC: RAMP / BRIDGE
```

> 上述是**拓樸連接示意**，不是照比例完整地圖；遊戲內兩橋透過其端點接入各自平台的普通行走邊。

**重要細節**：A* 的節點類型 `bridgeDeck` 仍需有碰撞與動畫用的世界座標，但只有 Connector chain 才能通行；橋梁側邊的護欄、橋柱與純視覺懸空岩石不參與圖構建。

## 5. 2×2 塔、3×3 核心與保護區

### 5.1 Footprint 生成

`resolveTowerFootprint(anchorId)` 必須：

- 找到 Anchor 的 `(x,z,platformId,elevation)`；尋找 `(x,z)、(x+1,z)、(x,z+1)、(x+1,z+1)` 的四個**普通地格**。
- 四格全部存在、同一 `platformId/elevation`、`buildable=true`、不占用、非 Portal/Core/Connector/Protected。
- 若有任一失敗，回傳 `INVALID_FOOTPRINT`；不能自動將塔擺放到距離最近的可用位置。
- 塔射擊中心 = footprint 四格平面平均中心；實際 `muzzleOffsetWorld` 由 tower definition 提供。

### 5.2 核心與 Approach

- Core 3×3 九格占用並永久保留；即使位於平台高地也不可建塔或升降。
- 至少 2 個指定 Approach；以 4 鄰接規則驗證它們與 Core footprint 邊界的關係。
- Route 的目標是 `approachNodeIds`；敵人走到 Approach → `reachedCore`，核心扣血，怪物離場。
- Approach 是**保護格**且不可放塔、牆或升降，防止 Core 3×3 與路線驗證間出現死角。

## 6. 地形編輯：預覽／驗證／提交（原子性）

```text
Input (hover / click)
  └─► create GameCommand
       ├─► phase == PREPARE ?
       ├─► target id / footprint valid ?
       ├─► not immutable, not protected, enough gold ?
       ├─► copy-on-write tentative GameState
       ├─► apply command to tentative state
       ├─► derive terrain + occupancy
       ├─► validate connector invariants / footprint
       ├─► build NavigationGraph
       ├─► check EACH portal to ANY core approach
       ├─► check route cost <= 160
       └─► success -> commit & charge; failure -> return unchanged original state
```

### 6.1 成本／限制

| 指令 | 金額 | 額外檢查 |
|---|---:|---|
| `SET_ELEVATION` +1 | −12 | 只改 editable ordinary ground；<=6 |
| `SET_ELEVATION` −1 | −8 | 只改 editable ordinary ground；>=0 |
| `PLACE_WALL` | −15 | 只占 1×1 ordinary ground；不可堵死任何 Portal |
| `REMOVE_WALL` | +7 | 存在該路障並有拆除權限 |
| `BUILD_TOWER` | −70/85/105 | 同高同平台 2×2 footprint；所有 Portal 可達 |
| `UPGRADE_TOWER` | Lv1→Lv2：−ceil(base×0.7)；Lv2→Lv3：−ceil(base×1.1) | 等級不能 >3；不改 footprint |
| `SELL_TOWER` | +floor(invested×0.65) | 釋放四格；重算通行圖 |

`SET_ELEVATION` 只接受 next 與現況高度差恰好為 1；不能一次跳高多層繞過經濟成本。**所有命令失敗時金額、格子、塔、路徑、事件序列保持原樣**。

### 6.2 必須維持的不變量

- `gold >= 0`，Core HP 範圍 `[0,maxHp]`。
- 任一 Portal 在目前配置下都能抵達至少一個 Core Approach。
- Connector 的節點與高度固定、合法，不受編輯影響。
- 多塔與路障不能重疊；一座塔必為四格合法 footprint。
- 只有 PREPARE 可以改戰場；COMBAT 中禁止任何建造／路線修改。
- 路線預覽與 Wave 開始使用**同一套圖與搜尋規則**。
- 所有修改只能以 `executeCommand` 推動，不允許 Scene UI 直接扣金或改地圖。

### 6.3 針對多入口的完整檢查偽碼

```ts
function validateRoutes(level: LevelDef, draft: GameState): ValidationResult {
  const graph = buildNavigationGraph(level, draft);
  for (const portal of level.portals) {
    const route = findPathToCore(
      graph, portal.cellId, level.core.approachNodeIds,
      level.maxShortestPathCost,
    );
    if (!route) {
      return { ok: false, code: 'NO_ROUTE_FROM_PORTAL', portalId: portal.id };
    }
    if (route.cost > level.maxShortestPathCost) {
      return { ok: false, code: 'ROUTE_TOO_LONG', portalId: portal.id };
    }
  }
  return { ok: true };
}
```

**實作注意**：若 `findPathToCore` 在超過上限時直接回 `null`，應區分「無路」與「有路但超上限」，例如先求最短路再比對成本，或回傳明確的狀態值；不可讓使用者看到錯誤原因不準確。

### 6.4 🆕 準備期撤銷（UNDO_PREPARE，D21-06）

撤銷不是「反向命令」，而是**還原快照**：因 `GameState` 為不可變資料，回到前一個狀態即可同時還原金幣、地形、塔、牆與路線，不必為每種命令寫反向邏輯。

```ts
// src/session/undo-history.ts — Session layer, NOT inside GameState
const MAX_UNDO = 20;

interface PrepareSession {
  history: GameState[];        // states BEFORE each successful PREPARE command
}

function dispatch(session: PrepareSession, state: GameState, cmd: GameCommand): CommandResult {
  if (cmd.type === 'UNDO_PREPARE') {
    if (state.phase !== 'PREPARE') return reject(state, 'INVALID_PHASE');
    const prev = session.history.pop();
    if (!prev) return reject(state, 'NOTHING_TO_UNDO');
    return { ok: true, state: prev, events: [{ type: 'UNDO_APPLIED', tick: prev.tick }] };
  }
  const result = executeCommand(state, cmd);
  if (result.ok && state.phase === 'PREPARE' && cmd.type !== 'START_WAVE') {
    session.history.push(state);
    if (session.history.length > MAX_UNDO) session.history.shift();
  }
  if (cmd.type === 'START_WAVE' && result.ok) session.history = [];
  return result;
}
```

- 歷史只存在記憶體；讀檔、重新開始、`START_WAVE` 時清空；**不序列化**。
- 還原後必須重新派生 `DerivedMap`、NavigationGraph、LOS 遮擋與路線 Overlay（與一般命令提交走同一個「狀態已變更」流程）。
- 撤銷後觸發一次節流自動存檔（§11），使存檔與畫面一致。
- 表現層收到 `UNDO_APPLIED` 時，以「倒帶」短動畫（0.2s）過渡被改動的格子與塔，而非瞬間跳變。

## 7. 攻擊範圍與視線 LOS

### 7.1 規則計算

```ts
const heightStepWorld = 0.5;
const towerElevationWorld = towerElevation * heightStepWorld;
const enemyElevationWorld = enemyElevation * heightStepWorld;

const towerOrigin = {
  x: footprintCenter.x,
  y: towerElevationWorld + towerDef.muzzleOffsetWorld,
  z: footprintCenter.z,
};
const enemyTarget = {
  x: enemyInterpolatedPos.x,
  y: enemyElevationWorld + enemyDef.targetOffsetWorld,
  z: enemyInterpolatedPos.z,
};
const highGroundBonus = 0.3 * Math.min(
  3, Math.max(0, towerElevation - enemyElevation),
);
const effectiveRange = towerDef.baseRangeWorld + levelBonus + highGroundBonus;
const inRange = distance3D(towerOrigin, enemyTarget) <= effectiveRange;
const canShoot = inRange && hasLogicalLineOfSight(towerOrigin, enemyTarget, derivedMap);
```

- `hasLogicalLineOfSight` 以**資料層**產生的遮擋 AABB／體素範圍作線段相交檢查；不得使用每一幀 UI Raycast 作傷害依據。
- 遮擋類型：實心岩壁、超過射線高度的實心地形、標記 `opaque` 的路障；**不含**草、雲、橋欄杆、單純裝飾物。
- 起點所在的塔基及目標所在格子的遮擋要明確排除，以免自我遮擋；其他塔是否遮擋暫定**否**，避免規則過於複雜。
- LOS 結果可於建造預覽與選塔後可視化。計算次數只需在攻擊索敵時做，視線預覽可用節流更新。
- 修改高度後遮擋資料須更新；**不應只更新導航圖而忘記 LOS 遮擋**。

### 7.2 投射物與傷害

- 射擊命中與傷害在該模擬 tick 內結算；視覺箭／砲彈可用 0.1～0.3 秒動畫追上，不用碰撞 Mesh 決定傷害。
- 炮塔對半徑 1.05 world units 內目標一次爆炸，對同一目標只傷害一次。
- `damage = round(baseDamage × levelMultiplier × (1 - physicalResistance))`，物理抗性只影響物理傷害。
- 冰晶塔減速 30% 持續 1.8 秒，不疊加，只更新 `slowUntilTick`。
- `FIRST` 以敵人沿路徑剩餘行走距離（格長與 segmentProgress）排序，而非到核心直線距離。

### 7.3 🆕 射程與 LOS 的視覺化（D21-12）

- **貼地射程投影**：預先把「塔可攻擊範圍」對每個 SurfaceCell 取樣（以該格中心＋敵人典型瞄準高度 0.35 計算 `inRange && hasLOS`），得到 `visible | occluded | outOfRange` 三態；以 Overlay 網格貼合各層頂面繪製，`occluded` 用斜線圖樣。這是**純讀取**同一套 LOS 函式的結果，保證視覺與判定一致。
- 高地加成部分（`highGroundBonus > 0` 才在範圍內的格子）以較淡外環材質區分。
- 取樣只在選塔、建塔預覽、地形變更時計算並快取；按住 Tab 顯示全部塔時合併各塔結果，節流到每 100ms 最多一次。
- **LOS 被擋圖示**：不新增 GameState 欄位。Simulation 在索敵時本來就會算出「冷卻已完成、射程內有存活敵人、但全部被 LOS 擋住」，此時發出 `TOWER_BLOCKED` 事件（同一座塔每 10 tick 至多一次，避免洗版）；表現層收到後顯示圖示 1 秒，持續收到則持續顯示。

## 8. 固定時間模擬與戰鬥狀態

### 8.1 20 TPS Game Loop

```ts
const STEP_SECONDS = 0.05; // 20 TPS

function advanceOneTick(state: GameState, level: LevelDef): TickResult {
  // 1. Spawn queued enemies based on fixed waveTick.
  // 2. Advance enemy movement along the frozen route nodes.
  // 3. Resolve enemy reaching protected Core Approach.
  // 4. Update tower cooldown and targeting (3D range + LOS).
  // 5. Resolve damage/slow/death/gold rewards exactly once.
  // 6. Emit immutable GameEvents for renderer / audio.
  // 7. Determine wave clear, victory, defeat.
  // 8. Increment simulation tick and return next state.
  throw new Error('Implement in simulation module');
}
```

- `requestAnimationFrame` 只推進 accumulator 和渲染內插，不能直接決定傷害。
- 幀率下降需限制 catch-up ticks，避免一次凍結長時間；要有降速策略而非亂跳模擬狀態。
- `PAUSED` 不增加 tick；2× 速度需讓模擬推進兩倍 ticks，不能雙倍傷害。
- 不使用 `Math.random` 控制關鍵戰鬥；同關卡 seed＋命令序列＋tick 數，結果應可重現。
- 所有 spawn／die／reach-core 是互斥且只能結算一次。Core HP≤0 必須進入 DEFEAT，不應再領取勝利獎勵。
- 不同敵人走同橋時可暫時允許重疊（MVP 不需避碰），但視覺以小量位置偏移改善辨識；路徑本體仍固定。
- **多入口分配（D21-07）**：每個 `SpawnEntry` 的第 i 隻敵人分配到 `portalIds[i % portalIds.length]`；每個入口各自維護下一次出怪 tick，間隔為 `intervalTicks`。同一 tick 多入口同時出怪時，依 `portalIds` 順序、再依 entry 順序產生 enemyId，保證可重現。

### 8.2 Snapshot 與表現

- Sim 每 tick 提供資料快照／事件；Renderer 透過前後快照內插位置，避免 20FPS 動畫感。
- React/Zustand 訂閱低頻狀態，例如 Gold、波次、Core HP；不為 100 隻怪各建一套每幀 React state。
- 視覺特效、鏡頭震動、音效不回饋 Simulation，且不進存檔。

### 8.3 🆕 GameEvent 正式定義（D21-05）

```ts
export type GameEvent =
  | { type: 'PHASE_CHANGED'; tick: number; from: GamePhase; to: GamePhase }
  | { type: 'WAVE_STARTED'; tick: number; waveIndex: number }
  | { type: 'WAVE_CLEARED'; tick: number; waveIndex: number; clearGold: number }
  | { type: 'ENEMY_SPAWNED'; tick: number; enemyId: string; kind: EnemyKind; portalId: string }
  | { type: 'TOWER_FIRED'; tick: number; towerId: string; targetId: string; travelTicks: number }
  | { type: 'TOWER_BLOCKED'; tick: number; towerId: string }          // 射程內有敵但 LOS 全被擋
  | { type: 'ENEMY_DAMAGED'; tick: number; enemyId: string; sourceTowerId: string;
      amount: number; damageType: 'physical' | 'magic'; resisted: boolean; hpAfter: number }
  | { type: 'ENEMY_SLOWED'; tick: number; enemyId: string; untilTick: number }
  | { type: 'CANNON_EXPLODED'; tick: number; towerId: string; at: { x: number; y: number; z: number }; hitIds: string[] }
  | { type: 'ENEMY_KILLED'; tick: number; enemyId: string; kind: EnemyKind; killerTowerId: string; gold: number }
  | { type: 'ENEMY_REACHED_CORE'; tick: number; enemyId: string; kind: EnemyKind;
      portalId: string; approachNodeId: CellId; lastNodeIds: CellId[] } // 漏怪地圖用
  | { type: 'CORE_DAMAGED'; tick: number; amount: number; hpAfter: number }
  | { type: 'GOLD_CHANGED'; tick: number; delta: number; balance: number; reason: string }
  | { type: 'TERRAIN_CHANGED'; tick: number; cellId: CellId; from: Elevation; to: Elevation }
  | { type: 'WALL_PLACED' | 'WALL_REMOVED'; tick: number; wallId: string; cellId: CellId }
  | { type: 'TOWER_BUILT' | 'TOWER_UPGRADED' | 'TOWER_SOLD'; tick: number; towerId: string;
      kind: TowerKind; level: 1 | 2 | 3 }
  | { type: 'ROUTES_CHANGED'; tick: number; portalIds: string[] }
  | { type: 'UNDO_APPLIED'; tick: number }
  | { type: 'VICTORY'; tick: number; stars: 1 | 2 | 3 }
  | { type: 'DEFEAT'; tick: number };
```

- 事件為**不可變值物件**，由 Simulation／Command Controller 產生，順序固定，是決定性輸出的一部分（同 Seed＋命令序列 → 相同事件序列）。
- `TOWER_FIRED.travelTicks` 只供表現層決定投射物飛行動畫長度；傷害已在同 tick 以 `ENEMY_DAMAGED` 結算。表現層需讓投射物「抵達時」才播放命中特效（以延遲佇列對齊），讓視覺上先看到箭飛過去再看到受擊。
- 新增 GameEvent 類型時，必須在 Presentation Director 映射表（§9.8）與音訊映射表（§9.9）登記處理方式或明確標記「無」；有單元測試檢查覆蓋率。

### 8.4 🆕 波次回顧與失敗分析（D21-09）

- `presentation/stats.ts` 訂閱事件，彙整每波：每座塔總傷害／擊殺、每入口漏怪數、漏怪最後 6 格路線（`lastNodeIds`）、核心受損時間軸。
- 失敗分析以**規則式**產生一句話：取漏怪最多的入口，檢查其路線上「沒有任何塔射程覆蓋（以 §7.3 取樣）」的最長連續段，輸出平台名與 Connector 名，例如「Portal B 漏了 7 隻：中平台橋口沒有火力覆蓋」。
- 統計是**事件的純函式**，不進 Simulation 狀態；WAVE_RESULT 存檔時可附帶上一波統計摘要（選用，不影響規則）。
- 「從本波準備期重來」＝載入該波 PREPARE 進入時的自動存檔。

## 9. Scene、渲染管線、表現層與效能

### 9.1 島嶼建模策略

- **資料**：每個 SurfaceCell 是頂面節點，整個盤面是 sparse set，不把虛空當草地。
- **外觀**：對每個平台補出地基、側面、懸崖、岩層與島底岩根（品質規格見 §9.4）。側面可用重複方塊，但**不是**每個地下體素都要有獨立 React Mesh。
- **渲染**：相同材質使用 `InstancedMesh`，或按 Platform/Chunk 合併外露面；只繪製可見表面，隱藏內部面。
- **Connector**：木橋／斜橋／階梯作獨立 prefab，對應 chain 節點與固定碰撞盒。橋梁視覺不能飄離實際可走節點。
- **更新**：地形編輯只更新影響的實例矩陣／Chunk、路徑 Overlay、LOS Collider，不要整張島全量重建。

### 9.2 Raycast 與格子拾取

- 介面使用 Three.js `Raycaster` 選取地格或塔；InstancedMesh 命中須能映射 `instanceId → cellId`。
- 優先只選可操作的**頂面**；點到懸崖側面時顯示可選格的清楚規則，不要隨機跳到另一層。
- 畫面座標轉 Domain NodeId 後才送 Command Controller，不能直接修改 GLB Mesh。
- 如果地圖後期支援同一 X/Z 上下重疊表面，選取必須使用**命中 Mesh 的 cellId**，不能只用 `x/z` 查表。

### 9.3 畫面與相機

- Orthographic Camera、俯視 35°～45°；Q/E 90° 旋轉（0.35s easeInOutCubic 過渡，過渡中仍可拾取）、縮放 3 段吸附＋平滑插值、適量平移（限制在島嶼 AABB 內）。
- 柔和陰影、環境光、AO；不以重度景深或 Bloom 遮住戰術路線（見 §9.7）。
- 相機轉向時維持核心與重要 Connector 可辨識；擋住選取格或核心的前景樹木／岩石以 dither 淡出（screen-door transparency，避免排序問題）。
- **開場巡禮**：以預錄的 Catmull-Rom 樣條相機路徑（關卡資料 `introCameraPath`，選填）播放 4～6 秒，可按任意鍵跳過；巡禮期間暫時切換成 Perspective 相機＋Tilt-shift，結束時平滑過渡回 Orthographic。
- **鏡頭震動**：以 Perlin 雜訊位移（trauma 模型：`shake = trauma²`，每秒衰減），強度乘上設定值；「減少動態」時為 0。
- 先對測試用桌面設備定目標 60 FPS；記錄 FPS、Draw Calls、Triangles、資產大小與載入時間；沒有實測不得宣稱全裝置 60FPS。

### 9.4 🆕 高精緻體素地形（D21-01、D21-16）

地形 mesher（`scene/terrain/`）把 `DerivedMap` 轉為每平台／每 8×8 Chunk 的合併 `BufferGeometry`，只產生外露面。品質來自以下四項，**全部烘焙在頂點屬性中，執行時成本接近零**：

1. **體素頂點 AO**：每個外露面頂點依其三個相鄰方塊（side1、side2、corner）計算 0～3 遮蔽等級，映射為 `[1.0, 0.8, 0.65, 0.5]` 存入 `color.a` 或獨立 attribute；四邊形依 AO 方向翻轉對角線以避免條紋（經典 voxel AO 技法）。
2. **假倒角／邊緣高光**：每個面帶 local UV（0～1），fragment shader 以 `edgeDist = min(uv, 1-uv)` 計算邊緣遮罩；頂面外露邊加亮 6～10%，側面底邊壓暗，寬度約 0.04 world unit。只有「相鄰為空」的邊才套用（mesher 以 4-bit 旗標傳入），避免平坦地面出現格線。
3. **色彩擾動與分層**：頂點色＝調色盤基底色 × `(1 + 0.04·hash(x,y,z))`；側面依世界高度選擇土層色帶（草皮 → 深土 → 岩層 → 晶礦層）；頂面草皮在外露邊向外懸垂 0.06 單位的薄唇（額外幾何）。
4. **島底岩根**：每平台以其輪廓為底，程序生成逐層內縮的倒錐體素（3～6 層，每層隨機內縮 0～2 格，種子固定），夾帶發光晶礦方塊（emissive，進 Bloom）與懸垂樹根；這部分是純裝飾，不進導航與 LOS。

- 可編輯格頂面另有符文刻紋貼花與 emissive 呼吸遮罩（Medium 以上動畫），屬戰術資訊，但貼在地形本體上（不經 Overlay），因此需確保色彩分級後仍可辨識——以 §12.5 Low／色盲截圖驗證。
- 地形編輯時只重建受影響的 Chunk（及相鄰 Chunk 的 AO 邊界），並以頂點 shader 彈簧位移做升降動畫，動畫結束才換入新幾何。

### 9.5 🆕 色彩管理、光照與材質

| 項目 | 設定 |
|---|---|
| 色彩空間 | `renderer.outputColorSpace = SRGBColorSpace`；調色盤與貼圖標記 sRGB，資料貼圖（雜訊、LUT 以外）標記 Linear |
| Tone mapping | 預設 `NeutralToneMapping`（Khronos PBR Neutral，保留風格化飽和色），`AgXToneMapping` 為比較選項；以 Golden Shot 決定後寫入 ART_BIBLE |
| 太陽 | `DirectionalLight`，暖色（約 5600K→偏暖），強度依 Golden Shot 調整 |
| 陰影 | `PCFSoftShadowMap`；陰影相機為 Orthographic，每次地形變更時**貼合島嶼 AABB**（32×32 很小，可用單張高解析陰影圖，不需 CSM）；Medium 2048²、High 4096²；調整 `normalBias`／`bias` 消除 acne；地形為靜態時可關閉 `shadowMap.autoUpdate`，僅在有動態物件的 tick 更新（Low） |
| IBL | 啟動時以天空漸層場景經 `PMREMGenerator` 產生環境圖（不下載 HDR），`scene.environment` 套用，`environmentIntensity` 約 0.4～0.7 |
| 補光 | `HemisphereLight`：天空藍／草地綠反射，讓陰影偏冷、受光偏暖 |
| 共用材質 | 所有微體素資產使用**同一張調色盤貼圖**（256×1 或 16×16 PNG，`NearestFilter`）＋ `MeshStandardMaterial`（roughness 0.85、metalness 0）；同材質可合批與 Instancing |
| 特殊材質 | 核心：自訂 shader（Fresnel 邊光＋內部旋轉晶核＋emissive 脈衝＋裂痕遮罩隨 HP 階段切換）；傳送門：極座標扭曲漩渦 shader；冰晶：Fresnel＋假折射（螢幕空間 UV 偏移，不用真 transmission）；史萊姆：半透明＋次表面假色 |
| 植被 | 草叢與樹葉 InstancedMesh，頂點 shader 以世界座標雜訊做風動（只位移高於基底的頂點）；Low 關閉風動 |
| 雲海 | 島下方大平面，fbm 雜訊 shader 雙層流動＋深度淡入（soft particle 原理）避免與島底硬交線 |
| 高度霧 | 自訂 fog chunk：以世界 Y 計算，`y < 0` 以下快速增濃為雲色，強化懸浮感；不影響戰術層 |
| 天空 | 全螢幕漸層 shader＋太陽光暈；遠景剪影島為低面數 billboard，受霧影響 |

- **Shader 預熱**：關卡載入完成後以 `renderer.compileAsync(scene, camera)` 預編譯所有材質（含尚未出現的特效材質，用隱藏實例觸發），避免第一次開火或爆炸時卡頓。

### 9.6 🆕 畫質分級與動態解析度（D21-02）

| 項目 | Low | Medium | High（美術基準） | Ultra |
|---|---|---|---|---|
| 渲染解析度（DPR 上限） | 0.75～1.0 | 1.0 | min(裝置DPR, 1.5) | min(裝置DPR, 2.0) |
| 抗鋸齒 | FXAA | SMAA | MSAA 4×（composer multisampling） | MSAA 4× + SMAA |
| 陰影 | 1024²、PCF | 2048²、PCFSoft | 4096²、PCFSoft | 4096²、PCFSoft、更小 bias |
| 體素頂點 AO／假倒角 | ✓ | ✓ | ✓ | ✓ |
| 螢幕空間 AO（N8AO） | ✗ | ✗ | 半解析度 | 全解析度 |
| Bloom（選擇性） | ✗（以 emissive 顏色補償） | ✓ 低強度 | ✓ | ✓ |
| 色彩分級 LUT | ✓ | ✓ | ✓ | ✓ |
| 植被風動／雲海雙層 | ✗／單層 | ✓／單層 | ✓／雙層 | ✓／雙層 |
| 粒子上限 | 300 | 800 | 1500 | 2500 |
| 環境裝飾密度 | 50% | 75% | 100% | 100% |

- **自動偵測**：首次啟動跑 2 秒基準場景，依平均 frame time 選初始等級，可在設定覆寫。
- **動態解析度**：以 2 秒滑動平均 GPU/frame time 調整 `renderer.setPixelRatio`（下限為該級最低值），超過 18ms 降 0.1、低於 12ms 升 0.1，每次調整間隔 ≥1 秒，避免抖動；戰術層與 UI 不受影響（DOM UI 與 overlay 以原生 DPR 繪製）。
- **銳利度**：所有 UI 圖示為 SVG；世界文字用 SDF 字型，在任何 DPR 都銳利；調色盤貼圖使用 `NearestFilter`，方塊顏色在 4K 不會被濾糊。

### 9.7 🆕 渲染順序與戰術層分離（D21-03）

```text
1. World Pass       → 天空 / 雲海 / 島嶼 / 塔 / 怪 / 植被 / 世界 VFX（寫入 depth）
2. Post-processing  → AA → N8AO → Selective Bloom → LUT → Vignette (→ Tilt-shift 僅巡禮/拍照)
3. Tactical Overlay → 路線流光 / 射程投影 / 選格框 / 合法與非法格 / 血條 / 傷害數字 / 預告卡
   - 以獨立 scene + 同一相機，`autoClear=false` 在 composer 輸出之後繪製
   - 讀取 World Pass 的 depth：可見段正常繪製；被遮擋段以虛線 + 50% 透明「透視」繪製
4. DOM HUD          → React UI
```

- 戰術層材質全部 `toneMapped: false`、不參與 Bloom、不受霧影響，顏色即 ART_BIBLE 指定值。
- **路線流光**：每條入口路線為一條沿節點中心、離地 0.05 的扁平帶狀網格，UV 沿路徑長度展開，shader 以時間捲動箭頭圖樣；入口 A／B 以不同圖樣（圓點／菱形）＋不同色，滿足色盲模式（GDD §12.2）。
- **幽靈試走**：每入口 3 隻半透明史萊姆 instanced，沿凍結前的預覽路徑以固定速度循環移動，屬 Overlay（不寫 depth）。
- **選取外框**：選取的塔用 inverted-hull 外框（Overlay 內繪製）而非後處理 Outline，避免額外全螢幕 pass。

### 9.8 🆕 Presentation Director 與 Juice 系統（D21-04）

```ts
// src/presentation/director.ts
type Reaction = (e: GameEvent, ctx: PresentationContext) => void;

const reactions: { [K in GameEvent['type']]: Reaction | 'none' } = {
  TOWER_FIRED:        (e, c) => c.vfx.projectile(e.towerId, e.targetId, e.travelTicks),
  ENEMY_DAMAGED:      (e, c) => c.queueOnImpact(e, () => { c.juice.flash(e.enemyId); c.numbers.spawn(e); }),
  ENEMY_KILLED:       (e, c) => c.queueOnImpact(e, () => { c.vfx.voxelShatter(e.enemyId); c.hud.flyCoins(e.gold); }),
  CORE_DAMAGED:       (e, c) => { c.core.hit(e.hpAfter); c.camera.addTrauma(0.35); },
  TERRAIN_CHANGED:    (e, c) => c.terrain.animateElevation(e.cellId, e.from, e.to),
  TOWER_BUILT:        (e, c) => c.towers.playAssemble(e.towerId),
  // ... every event type must be mapped or explicitly 'none'
};
```

- 動畫以 **render 時間**（`clock.getDelta()`，乘以遊戲速度 1×/2×，暫停時凍結戰鬥相關動畫但保留環境動畫）推進，不使用 sim tick。
- 所有暫時物件（粒子、投射物、傷害數字、碎塊）來自**物件池**；池滿時回收最舊者；每幀零 `new`。
- 方塊碎裂：從敵人模型的 AABB 生成 8～20 個調色盤色小方塊（InstancedMesh，單一 draw call），CPU 簡易拋物線＋地面反彈一次；落在島外的碎塊繼續下墜並在霧中淡出。
- 核心損傷階段：依 `hpAfter` 切換 shader uniform `crackStage`（0～3，對應 GDD §11.4 的 ≤15／≤9／≤4）。
- 建造組裝：塔模型依微體素層高分組，頂點 shader 以 `uBuildProgress` 由下而上逐層顯現＋落下彈跳。
- 「減少動態」時：`camera.addTrauma` 為 no-op、閃爍改為淡色疊加、Tilt-shift 停用。
- 50ms 回饋要求：輸入處理與預覽高亮在同一幀內完成（拾取 → preview → overlay 更新），不等待下一個 sim tick。

### 9.9 🆕 音訊架構（D21-10）

| 元件 | 規格 |
|---|---|
| Bus | Master → Music / SFX / UI / Ambience，各自 GainNode，對應設定滑桿 |
| 音樂 | 每首曲子 3 條同長度 stem（base / combat / tension），同時開始、以 gain 交叉淡入（1.5s）；PREPARE=base、COMBAT=base+combat、核心 HP≤4 加 tension；清波／勝利／失敗為短 stinger，播放時音樂 duck −6dB |
| SFX 映射 | `audio/sfx-registry.ts`：GameEvent type → 音效 ID（含 'none'），單元測試檢查覆蓋 |
| 同時發聲上限 | 每個音效 ID 有 `maxVoices`（例：箭塔開火 6、命中 8、死亡 6），超過時忽略新觸發或搶佔最舊 |
| 變化 | 每次播放 pitch 隨機 ±5%、音量 ±2dB；每種敵人死亡至少 3 個變體 |
| 空間化 | 以世界座標投影到螢幕 X，`StereoPannerNode` −0.6～0.6；縮放越遠音量略降 |
| Ducking | `CORE_DAMAGED` 時 SFX/Music 短暫 −4dB 0.4s，突顯核心受擊 |
| 格式與載入 | ogg（Opus）＋ m4a 後備；首屏只載 UI 與 L1-01 所需音效，音樂串流播放；瀏覽器需使用者互動後才 `resume()` AudioContext |

### 9.10 🆕 UI 技術與輸入

- HUD 為 React DOM，面板動畫用 `motion`；數值滾動以 rAF 插值，**只**在值變化時觸發。
- 世界空間 UI（血條、傷害數字、波次預告卡、LOS 被擋圖示）全部在 Tactical Overlay 中以 instanced billboard／SDF 文字繪製，不使用 Drei `<Html>` 大量 DOM 節點（Drei `<Html>` 僅限少量選取資訊面板）。
- 血條：單一 InstancedMesh，per-instance attribute 傳入 `hpRatio`、`slowed`；滿血實例縮放為 0 隱藏。
- 傷害數字：池上限 40，上浮＋淡出 0.6s；設定可關閉。
- 輸入對應（GDD §12）：`Esc` 先查是否有預覽狀態，有則取消，否則開暫停選單；`Ctrl+Z` 送 `UNDO_PREPARE`；按住 `Tab` 顯示全部射程；`P` 拍照模式（T1）。
- CJK 字型以 `scripts/subset-fonts.ts` 依實際 UI 字串子集化（woff2），未涵蓋字元退回系統字型。

## 10. GLB / Meshy 低成本資產流程

### 10.1 Asset Registry

```ts
interface AssetRecord {
  id: string;
  path: string;                // /assets/models/xxx.glb
  category: 'terrain' | 'bridge' | 'tower' | 'enemy' | 'decoration';
  source: 'procedural' | 'magicavoxel' | 'blender' | 'blockbench' | 'meshy' | 'other';
  license: string;
  sourceUrl?: string;
  reviewed: boolean;
  sizeWorld: { x: number; y: number; z: number };
  origin: 'bottom-center';
  voxelScale?: 16 | 32;        // micro-voxels per cell (D21-01)
  usesMasterPalette: boolean;  // must be true for voxel assets
  muzzleOffsetWorld?: number;  // towers: must match TowerDef (±0.05)
  triangles?: number;
  materials?: number;
  textures?: number;
}
```

### 10.2 🆕 微體素資產管線（D21-01）

```text
art-src/*.vox (MagicaVoxel, 主調色盤)   art-src/*.bbmodel (Blockbench)
        │                                       │
        ▼                                       ▼
scripts/vox-to-glb.ts                    Blockbench glTF export
  - 貪婪網格化（同色同法線面合併）            │
  - 體素頂點 AO 烘焙進 vertex color           │
  - 調色盤索引 → palette.png UV               │
  - 1/16 格縮放、bottom-center 原點           │
        └──────────────┬────────────────────────┘
                       ▼
scripts/optimize-assets.ts（glTF Transform）
  - dedup / weld / prune / quantize / meshopt 壓縮
  - 強制單一共用材質（調色盤）
                       ▼
scripts/inspect-glb.ts（預算與規則檢查，失敗即 CI 失敗）
  - 尺寸、原點、面數、材質數 = 1、使用主調色盤、炮口高度標記點
                       ▼
public/assets/models/*.glb + asset-manifest.json
```

- **主調色盤**：`public/assets/textures/palette.png` 是唯一真相；ART_BIBLE 列出每格色票用途。`inspect-glb` 拒絕使用調色盤以外顏色的 voxel 資產。
- **炮口標記**：塔模型內放一個名為 `muzzle` 的空節點，`inspect-glb` 驗證其高度與 `TowerDef.muzzleOffsetWorld` 差距 ≤0.05；遊戲邏輯仍只讀 TowerDef，標記點只用於驗證與 VFX 發射位置。
- **升級加件**：Lv2/Lv3 以額外子網格（`lv2_*`、`lv3_*` 命名）加在同一 GLB，執行時切換可見性，不重複載入整座塔。
- **Meshy 產出**：必須先轉為體素（以 1/16 格重新取樣）並套主調色盤，才能進入上述管線。

### 10.3 🆕 單一資產預算

| 類別 | 三角形上限 | 材質 | 貼圖 | 備註 |
|---|---:|---:|---|---|
| 塔（含 Lv2/Lv3 加件） | 6,000 | 1 | 共用調色盤 | 貪婪網格後 |
| 敵人 | 3,000 | 1 | 共用調色盤 | 程式動畫用分件（身體／四肢／尾巴） |
| 核心＋基座 | 8,000 | 2（調色盤＋核心 shader） | — | |
| 傳送門 | 4,000 | 2 | 雜訊貼圖 128² | |
| 橋梁 prefab（每段） | 2,500 | 1 | 共用調色盤 | |
| 裝飾（樹／石／花） | 800 | 1 | 共用調色盤 | 一律 Instancing |

- 固定 Y-up，+Y 高度、每格 1 世界單位、單位格高度 0.5；模型底部原點與邏輯 `Footprint` 對齊。
- 重要資產：三塔、三怪、橋梁、核心；地形與樹石用程序幾何最划算。
- Meshy 批次任務要控制 Prompt、風格、色票、比例、輸出、授權與來源；每個新模型都經 `inspect-glb` 檢查尺寸、面數、貼圖、GLB 是否可載入。
- 不把 Meshy API Key 交給遊戲前端，也不在玩家遊玩時生成模型。
- 同一種塔用不同顏色、旗幟與附加方塊表現 Lv2/Lv3，避免重複建模。

## 11. 存檔與相容性

- IndexedDB 主鍵：`skybound.v2.save.<slot>`；`schemaVersion=2` 與 `levelId` 必填。
- 存檔包含 GameState（地形修改、塔、牆、Gold、Core HP、已完成波次、獎勵紀錄），不包含 Three.js Mesh 或 Texture。
- **安全存檔點**：PREPARE / WAVE_RESULT；COMBAT 中顯示「本階段結束後自動儲存」即可。
- 讀檔時依 Zod 驗證，重新載入 LevelDef 再 deriveMap，不接受任意外部 JSON 直接覆蓋內部資料。
- 舊 v1 存檔（單層 16×16）**不保證升級相容**；開發版可提示重開新關或寫一次性 migration；不得靜默轉換造成錯誤。
- 已領取清波獎勵需用 `awardedWaveIds` 防重；讀檔後不可重複發金幣。
- 🆕 **存檔時機（D21-15）**：進入 PREPARE、PREPARE 中每次成功命令（含撤銷）後節流 500ms、進入 WAVE_RESULT。撤銷歷史與 `RuntimeFlags` 不序列化。
- 🆕 **波次檢查點**：每次進入 PREPARE 時另存 `skybound.v2.checkpoint.<slot>`（同 schema），供 DEFEAT 畫面「從本波準備期重來」使用；每局僅保留最新一份。
- 🆕 **設定獨立存檔（D21-11）**：`skybound.settings.v1`（localStorage 即可，讀寫包 try/catch，失敗時使用預設值），Zod 驗證：

```ts
interface SettingsV1 {
  schemaVersion: 1;
  quality: 'auto' | 'low' | 'medium' | 'high' | 'ultra';
  dynamicResolution: boolean;
  colorblindSafe: boolean;
  reducedMotion: boolean;
  screenShake: number;       // 0..1
  damageNumbers: boolean;
  uiScale: number;           // 0.8..1.5
  volume: { master: number; music: number; sfx: number; ui: number; ambience: number };
  language: 'zh-TW' | 'en';
}
```

## 12. 測試矩陣（必須寫在實作前或同步完成）

### 12.1 Schema / Level Validator

| 測試 | 預期 |
|---|---|
| 32×32 有 Void 與不規則平台 | 合法，Void 不產生導航節點 |
| Connector 中段缺失 | 不合法 |
| Connector 兩端高度差過大，鏈節點無逐級過渡 | 不合法 |
| 橋面意外與鄰接平台自動相連 | 必須不發生 |
| 任一 Portal 初始無法到 Core Approach | 不合法 |
| Core 不是 3×3／有重複格 | 不合法 |
| Approach 距 Core 遠、不是邊界鄰格 | 不合法 |
| 同 X/Z 重疊 SurfaceCell（MVP） | 拒絕，提示不支援重疊表面 |
| 連接端點在可編輯區 | 不合法 |

### 12.2 Pathfinding / Edit Command

| 測試 | 預期 |
|---|---|
| 低→中→高跨兩橋 | 只能循 Connector chain，不穿越斷崖 |
| 任意地格相差 2 級 | 無普通地面邊 |
| 高台塔 2×2 其中一格在不同高度 | `INVALID_FOOTPRINT` |
| 2×2 塔跨平台、跨橋或接觸虛空 | `INVALID_FOOTPRINT` |
| 堵住 Portal A、B 任一入口 | 拒絕，Gold 不變、狀態不變 |
| 在可編輯區升降導致無路 | 拒絕，地形與 LOS 資料不更新 |
| Connector 桥口／橋面修改 | `PROTECTED_CONNECTOR` |
| 改路後新路超過 160 cost | `ROUTE_TOO_LONG` |
| 放路障合法且繞路 | 路線 Overlay 與 Simulation 路徑一致 |
| 升降兩次試圖從 0 直接到 2 | 必須分兩指令與兩次付費 |
| 🆕 建塔 → 升地 → 撤銷兩次 | 狀態與 Gold 完全等於建塔前（深度相等比較） |
| 🆕 撤銷超過 20 步／歷史為空 | 只保留最近 20 步；空時 `NOTHING_TO_UNDO`，狀態不變 |
| 🆕 COMBAT 中撤銷 | `INVALID_PHASE` |
| 🆕 START_WAVE 或讀檔後撤銷 | `NOTHING_TO_UNDO` |
| 🆕 撤銷後路線 Overlay、LOS 快取 | 與撤銷前一致（重新派生） |

### 12.3 LOS / Combat

| 測試 | 預期 |
|---|---|
| 3D 直線距離超出射程 | 不可射擊 |
| 高台塔有射程加成，但岩壁遮擋 | 仍不可射擊 |
| 草、橋欄杆遮擋模型 | 不影響邏輯射擊 |
| 升地改變 LOS | 下次預覽／攻擊判定會更新 |
| 炮擊多隻怪、傷害結算 | 每個敵人每發至多受一次傷 |
| 冰晶塔重複減速 | 不疊加，只刷新時間 |
| 怪物到 Approach | 扣 Core HP、不得給 Gold |
| 怪物在到達前被殺 | 給 Gold、不得扣 Core HP |
| 同 Seed/Commands/Ticks | 結果完全一致，**事件序列也完全一致** |
| 🆕 Wave 2 史萊姆 8 隻、portalIds [A,B] | A、B 各 4 隻，順序 A,B,A,B…；各入口獨立 23 tick 間隔 |
| 🆕 每種 GameEvent 類型 | 在 Director 與音訊映射表中都有處理或明確 'none' |
| 🆕 射程投影取樣 vs 實際開火 | 投影標為 `visible` 的格子上放敵人，塔必定可攻擊；`occluded` 必定不可 |

### 12.4 E2E

1. 開始 L1-01：畫面出現三塊高低平台、兩條橋、兩入口與 3×3 核心。
2. 放置 2×2 箭塔；看到四格占位、Gold 扣除與實際射程預覽。
3. 嘗試把橋口封死；顯示明確錯誤且金額不變。
4. 改變可編輯格高度；怪物路線與塔 LOS 即時更新。
5. 開始 Wave 1，史萊姆沿兩段橋／階梯抵達高台，攻擊與核心受損正常。
6. 完成 Wave 5 → Victory；重新開始一局結果重置。
7. 在 PREPARE 存檔後重新整理，塔、牆、高度、金幣與已完成波次均一致。
8. 🆕 建塔後按 Ctrl+Z：塔消失、Gold 回復、路線恢復。
9. 🆕 故意輸掉一局：DEFEAT 顯示失敗分析文字；「從本波準備期重來」回到該波 PREPARE 且狀態正確。
10. 🆕 設定切換色盲模式與 Low 畫質後重新整理：設定保留，戰局存檔不受影響。

### 12.5 🆕 視覺回歸（Golden Shot，D21-02）

- Playwright 以固定 seed、固定相機（四個方向）、固定時間（暫停環境動畫，`?visualTest=1` 讓 shader 時間凍結）截圖，與 `tests/visual/__golden__/` 比對，像素差容忍度 1～2%（GPU 差異）。
- 必測組合：High 1080p × 4 方向、Low 1080p × 1、High DPR2（2160p）× 1、色盲模式 × 1、路線＋射程 Overlay 開啟 × 1。
- Golden 圖更新需人工審核，並對照 GDD §11.6 檢查清單。

### 12.6 🆕 效能與表現層測試

- 開發版內建 Perf HUD（`?perf=1`）：FPS、frame time p95、draw calls、triangles、geometries、textures、粒子數、動態解析度目前值。
- 壓力場景：Wave 5 全部敵人同時在場＋所有塔 Lv3 開火＋最大粒子，記錄 60 秒 p95 frame time，存入 `perf-log.md`（標註測試機型、瀏覽器、畫質）。
- 單元測試：物件池不會無限成長；「減少動態」時鏡頭 trauma 永遠為 0；`presentation/`、`scene/`、`audio/` 只能 import `domain/types` 與事件型別，不得 import `simulation/` 或 `commands/` 的實作（以 ESLint `no-restricted-imports` 強制）。

## 13. 效能目標與風險控制

- MVP 只有 32×32 的水平**容量上限**，實際 SurfaceCell 因 Void 可能少於 1,024；多層外觀地基不等於邏輯節點數量。
- 路徑在 PREPARE 編輯時重算；COMBAT 路線凍結，避免每隻怪物每幀做 A*。
- 當大量怪物行走同一路線時，重用入口路徑；仍保留怪物自己的 `pathProgress`。
- 若 Tile 提示、LOS 預覽昂貴，進行節流，且 UI 運算不影響固定 tick 模擬。
- 建立 debug overlay：可行走節點、Connector edges、各入口路線、障礙 footprint、LOS、FPS、Draw Calls。
- 不依賴動態完整 3D NavMesh；若日後新增飛行與真正垂直多層表面，再評估架構升級。

### 13.1 🆕 整體效能預算（High 畫質、1080p、壓力場景）

| 指標 | 預算 | 說明 |
|---|---:|---|
| Frame time p95 | ≤ 16.7ms | 指定測試機（假設：GTX 1660／RX 5600／Apple M1 級），實測後修訂 |
| Draw calls | ≤ 150 | 地形按 Chunk 合併、資產共用材質、粒子／血條／裝飾 Instancing |
| Triangles（畫面內） | ≤ 600k | 地形 ≤150k、裝飾 ≤150k、塔怪 ≤200k |
| 全螢幕 pass | ≤ 5 | EffectComposer 合併 Effect 於同一 pass |
| GPU 記憶體（貼圖） | ≤ 96MB | 陰影圖 4096² 佔大宗；其餘貼圖 KTX2 |
| JS heap 成長 | 一局內 ≈ 0 | 物件池；不在 rAF 內配置物件 |
| Web Demo 首次下載 | ≤ 25MB（gzip/br 後） | 模型 meshopt、音訊 Opus、字型子集 |
| 首屏到可操作 | ≤ 6s（50Mbps） | 先載 L1-01 必要資產，其餘背景載入 |
| Low 畫質 | 入門內顯（Intel Iris Xe 級）≥ 45 FPS | 戰術資訊完整 |

- 預算超標時依序處理：降低裝飾密度 → 縮減粒子 → 合併更多幾何 → 降低陰影解析度；**不得**以移除戰術資訊或核心 Juice 換取效能。

## 14. Claude Code 執行方式與分階段 Prompt

### 14.1 Master Prompt（第一次請先使用）

```text
你是本專案的 Lead Game Developer、Technical Artist 與 QA Engineer。

請先完整閱讀 docs/01_GAME_DESIGN_DOCUMENT.md 與
 docs/02_TECHNICAL_ARCHITECTURE.md。

本版核心已定案：
- 32x32 sparse multi-platform voxel map，elevation 0~6
- 3 個主要高度平台、2 條明確的 Connector chain
- 2 個 Portal、3x3 Core + approach nodes
- 2x2 Tower Footprint
- 準備期才可升降地形、放路障與建塔
- 多入口 A* 路徑驗證與原子性提交
- 射擊必須 3D 距離 + 邏輯 Line-of-Sight
- Pure TypeScript 20TPS simulation 與 React/R3F 分離
- 準備期撤銷（Session 層快照，不進存檔）
- 高精緻 Diorama Voxel 渲染：體素 AO、假倒角、IBL、選擇性 Bloom、LUT、
  畫質分級；戰術層在後處理之後獨立繪製
- 所有表現（動畫/VFX/音效/鏡頭）只由 GameEvent 驅動，不回寫模擬

請先讀取 Repo、提出與現有架構的差異與變更清單，
建立 docs/DECISIONS.md 記錄任何設計問題。
不能默默套用舊的 16x16 單層規則，也不能一次實作全部功能。
每個 Phase 完成後都執行 Typecheck、Lint、Unit Tests，
並回報檔案變更、驗收結果、未完成項目。
現在只執行 Phase 0。
```

### 14.2 Phase 0 — Domain / Schema / Level Validator

```text
請只實作 Phase 0：
1. 建立 Vite + React + TS strict、Vitest、Playwright、Zod。
2. 實作 LevelDef/SurfaceCell/Connector/Core/TowerInstance/Command/GameEvent 型別。
3. 實作 Zod schema 與 Level Validator；definitions 以 tick 儲存時間。
4. 建立 32x32 L1-01 三平台、兩連接件的資料產生器。
5. 測試所有 Connector chain、3x3 Core、Approach、2x2 Footprint。
6. 設定 ESLint no-restricted-imports：simulation 不可 import three/react；
   scene/presentation/audio 不可 import simulation 實作。
先不做戰鬥、UI、美術。驗收：所有關卡不變量測試通過。
```

### 14.3 Phase 1 — 多層 Voxel 場景、渲染管線與 Golden Shot

```text
請只實作 Phase 1：
1. 用 R3F 顯示三塊不同高度的漂浮平台，實際有崖壁、島底岩根與虛空。
2. 實作 Chunk 體素 mesher：外露面、體素頂點 AO、假倒角邊緣遮罩、
   色彩擾動與土層色帶（§9.4）。
3. 增加兩條與 Connector chain 對齊的木橋／斜坡／階梯（可先灰盒）。
4. 顯示 3x3 Core、兩個 Portal、2x2 塔位預覽。
5. Orthographic Camera、Q/E 90度緩動旋轉、縮放吸附、格子拾取。
6. 渲染管線：sRGB + Neutral tone mapping、太陽陰影貼合島嶼 AABB、
   PMREM 天空 IBL、半球光、高度霧、雲海、漸層天空（§9.5）。
7. EffectComposer 堆疊 + 畫質分級骨架 + 戰術 Overlay 獨立 pass（§9.6～9.7）。
8. Golden Shot 樣板（限時 ≤3 天）：選一個 8×8 角落做到最終品質，
   產出 4 張參考截圖存入 docs/ART_BIBLE.md，決定 tone mapping 與 LUT。
9. Debug Overlay：cellId、elevation、platformId；Perf HUD（?perf=1）。
不得把視覺 Mesh 當成導航資料。
驗收：點擊任一橋面都能取得正確 cellId；Golden Shot 樣板通過
GDD §11.6 第 3～7 項；Overlay 不受 Bloom/LUT 影響。
```

### 14.4 Phase 2 — 多平台 A*、編輯與射程視線

```text
請只實作 Phase 2：
1. buildNavigationGraph：普通同平台邊 + Connector chain 邊。
2. 多入口到 Core Approach 的 deterministic A*。
3. 計算 2x2 塔 footprint、牆與可編輯地形。
4. preview/execute command 原子性檢查、Gold 扣費。
5. 兩個入口的路線流光 Overlay（含色盲圖樣）與幽靈試走；
   封路顯示錯誤且不扣錢，非法格紅閃搖晃。
6. 建立 3D 攻擊距離與邏輯 LOS、貼地射程投影（§7.3）。
7. UNDO_PREPARE 與 Session 撤銷歷史（§6.4）、Ctrl+Z。
8. 地形升降彈簧動畫與塵土粒子、Chunk 局部重建。
9. 寫 Pathfinding/LOS/EditCommand/Undo 完整單元測試。
不要加入怪物戰鬥。
驗收：地形真能改路、橋不能亂跨、LOS 會受崖壁影響、撤銷完全還原。
```

### 14.5 Phase 3 — 第一個完整波次

```text
請只實作 Phase 3：
1. 建立 Pure TS 20TPS Simulation。
2. 史萊姆沿入口路線與 Connector chain 移動。
3. 箭塔依 3D Range + LOS 自動索敵與射擊。
4. 完成 Core Approach 抵達結算、擊殺 Gold、Wave 1。
5. 渲染層內插位置與播放視覺投射物動畫。
6. GameEvent 輸出 + Presentation Director + 物件池（§8.3、§9.8）：
   建造組裝、開火後座、命中閃白、方塊碎裂、金幣飛 HUD、
   核心受擊與裂痕階段、鏡頭 trauma 震動（可關閉）。
7. 音訊骨架：Bus、兩層音樂交叉淡入、開火/命中/死亡/核心音效。
8. 測試死亡/抵達核心互斥、固定 Seed 可重現（含事件序列）、事件映射覆蓋。
驗收：PREPARE → COMBAT → WAVE_RESULT 完整可玩，且操作回饋 ≤50ms。
```

### 14.6 Phase 4 — 內容完整化

```text
請只實作 Phase 4：
1. 增加冰晶塔、砲塔、疾風獸、石殼巨人。
2. 加入塔升到 Lv3、出售、五波敵人與清波獎勵。
3. 核心血量、勝敗、星級、可重玩。
4. IndexedDB 安全存檔／載入（schemaVersion=2）、波次檢查點、設定獨立存檔。
5. 多入口輪流分配（§8.1）、波次預告卡、波次回顧與失敗分析（§8.4）。
6. 各塔 Lv2/Lv3 加件切換、冰霜/爆炸/減傷火花特效。
7. 補足所有整合測試與 E2E。
不得加入多人、Roguelite 選卡或任何 T2 功能。
驗收：完整五波可玩、經濟和 LOS 判定一致、獎勵不重複、回顧數據正確。
```

### 14.7 Phase 5 — 美術打磨與對外 Demo

```text
請只實作 Phase 5：
1. 依 ART_BIBLE 以微體素管線（§10.2）替換全部占位模型，通過 inspect-glb 預算。
2. 補齊塔待機動畫、敵人程式動畫、環境風動、前景 dither 淡出、開場巡禮。
3. HUD 木框晶石主題、金幣預覽、教程、錯誤提示、設定頁與無障礙選項。
4. 完整音效清單、tension 音樂層、ducking、聲像。
5. 畫質自動偵測 + 動態解析度；Profile 對照 §13.1 預算。
6. Golden Shot 視覺回歸（§12.5）、手動試玩、Playwright E2E、回歸測試。
7. 產出 Demo 發行檢查表與資產（模型、音效、字型）授權清單。
驗收：陌生玩家能完成第一局，沒有穿崖／封路／死檔問題；
GDD §11.6 Golden Shot 清單四方向全部通過；§13.1 預算達標或有書面例外。
```

### 14.8 🆕 Phase T1 — Demo 打磨（僅在 MVP DoD 全部完成後）

```text
只做不改遊戲規則的項目：拍照模式、鳥群/瀑布/落葉、核心光柱、
每關 3 個可選挑戰（只讀事件判定）、本機最佳成績。
任何會改變 GameState、命令或數值的功能都屬 T2，必須先更新兩份文件。
```

## 15. 技術驗收總表

- [ ] 使用 32×32 **稀疏多平台**資料，不默認每個格都有土地。
- [ ] 三平台與 2 條 Connector 有**實際節點鏈**、不可瞬移跨空隙。
- [ ] 高度 0–6 可配置，世界 Y 高度映射一致。
- [ ] 核心 3×3、Approach 目標、2×2 塔的占地與驗證一致。
- [ ] 任一入口在所有合法編輯後仍可到核心、長度上限規則有效。
- [ ] 只在 PREPARE 編輯；非法指令不改 GameState，不扣 Gold。
- [ ] 3D 射程和 Logic LOS 正確；高地與岩壁會真實影響塔。
- [ ] 戰鬥固定 20TPS、可測試、與 R3F 分離。
- [ ] 五波完整、獎勵防重、存檔可復原。
- [ ] 模型來源清楚，玩家遊戲時不呼叫 Meshy。
- [ ] 🆕 撤銷完全還原狀態、不存檔、僅 PREPARE 可用。
- [ ] 🆕 GameEvent 完整定義且每種事件都有表現／音訊映射（或明確 'none'）。
- [ ] 🆕 多入口輪流分配與事件序列可重現。
- [ ] 🆕 體素 AO、假倒角、IBL、陰影、選擇性 Bloom、LUT 就緒；戰術層不受後處理影響。
- [ ] 🆕 畫質四級＋動態解析度；Low 保留全部戰術資訊。
- [ ] 🆕 Golden Shot 視覺回歸通過；§13.1 效能預算達標或有書面例外。
- [ ] 🆕 所有資產通過 inspect-glb（主調色盤、單一材質、預算、炮口高度）。
- [ ] 🆕 設定獨立存檔；無障礙選項全部生效。
- [ ] 🆕 程式中沒有任何 T2／T3 功能。
- [ ] Typecheck、Lint、Vitest 與 Playwright 通過。

## 16. 開發前可查閱的官方文件

技術選型將隨套件版本變動，以下僅為後續查證入口：

- Three.js InstancedMesh：https://threejs.org/docs/#api/en/objects/InstancedMesh
- Three.js Raycaster：https://threejs.org/docs/#api/en/core/Raycaster
- React Three Fiber：https://r3f.docs.pmnd.rs/
- Zod：https://zod.dev/
- Vitest：https://vitest.dev/
- Playwright：https://playwright.dev/
- glTF Transform：https://gltf-transform.dev/
- Meshy API：https://docs.meshy.ai/
- Three.js Tone Mapping／Color Management：https://threejs.org/docs/#manual/en/introduction/Color-management
- pmndrs postprocessing：https://github.com/pmndrs/postprocessing
- React Postprocessing：https://react-postprocessing.docs.pmnd.rs/
- N8AO：https://github.com/N8python/n8ao
- troika-three-text：https://protectwise.github.io/troika/troika-three-text/
- MagicaVoxel：https://ephtracy.github.io/
- Web Audio API（MDN）：https://developer.mozilla.org/docs/Web/API/Web_Audio_API

## 17. 🆕 功能分層對應（與 GDD §16 同步）

| 分層 | 技術上的界線 |
|---|---|
| **T0 MVP** | 本文件 §1～§15 所有內容 |
| **T1 Demo 打磨** | 只新增表現層模組或只讀事件的統計；**不得**修改 `GameState`、`GameCommand`、`definitions.ts` 數值、Schema |
| **T2 正式版** | 需要新命令、新狀態、新導航規則（例如飛行怪、可破壞橋梁的 Connector 狀態機、索敵模式欄位）；先更新兩份文件與 `schemaVersion` 遷移計畫 |
| **T3 遠期** | 可能需要後端或平台 SDK（雲端存檔、成就、關卡分享）；另開架構決策 |

---

## 附錄 A：v2.1 變更紀錄（Changelog）

決策編號與 GDD 附錄 A 共用。

| 編號 | 決策 | 本文件章節 | GDD 對應 |
|---|---|---|---|
| D21-01 | 高精緻 Diorama Voxel：雙尺度體素、體素 AO、假倒角、色彩擾動、島底岩根、主調色盤 | §9.4、§9.5、§10.2 | §11.1 |
| D21-02 | 畫質四級＋動態解析度＋自動偵測；Golden Shot 視覺回歸 | §9.6、§12.5、§13.1 | §0、§12.2、§14 |
| D21-03 | 渲染順序：World → Post → Tactical Overlay → DOM；Overlay 不受後處理、被遮擋段虛線透視 | §1、§9.7 | §11.3 |
| D21-04 | Presentation Director：表現層只讀 Snapshot/Event，不回寫模擬；ESLint 強制依賴方向 | §1、§9.8、§12.6 | §11.4 |
| D21-05 | 正式定義 `GameEvent` 聯集型別；事件序列屬決定性輸出 | §8.3 | §11.4、§12.3 |
| D21-06 | `UNDO_PREPARE` 命令＋Session 層快照撤銷（上限 20、不存檔）；新增 `NOTHING_TO_UNDO` | §3.2、§6.4 | §6.1 |
| D21-07 | `SpawnEntry.portalIds` 輪流分配規則；同 tick 出怪排序規則 | §3.1、§8.1 | §9 |
| D21-08 | `muzzleOffsetWorld`／`targetOffsetWorld` 初值；`inspect-glb` 驗證模型炮口 | §3.1、§10.2 | §7、§8 |
| D21-09 | 波次統計與規則式失敗分析；波次檢查點存檔 | §8.4、§11 | §9.1 |
| D21-10 | 音訊架構：Bus、3 stem 自適應音樂、發聲上限、聲像、ducking | §9.9 | §12.3 |
| D21-11 | `SettingsV1` 獨立存檔 | §11 | §12.2、§13 |
| D21-12 | 貼地射程投影（同一 LOS 函式取樣）、`TOWER_BLOCKED` 事件、路線流光與幽靈試走 | §7.3、§9.7 | §5、§11.4 |
| D21-13 | Phase 1 加入渲染管線與限時 Golden Shot；Phase 3 加入 Juice 與音訊骨架；新增 Phase T1 | §14 | §14 |
| D21-14 | 功能分層 T0～T3 的技術界線 | §17 | §16 |
| D21-15 | 存檔時機：PREPARE 每次成功命令後節流 500ms | §11 | §13 |
| D21-16 | 島底岩根、雲海、高度霧等懸浮感元素的實作方式 | §9.4、§9.5 | §10.2 |
| D21-17 | 輸入：Esc 分流、Ctrl+Z、Tab、P | §9.10 | §12 |
| — | 新增 `RuntimeFlags`（paused/speed）型別，明確不進存檔 | §3.2 | §3 |
| — | 秒數 → tick 換算表，definitions 以 tick 儲存 | §3.1 | §7、§8、§9 |
| — | 技術棧新增 postprocessing、N8AO、troika-three-text、howler、motion、glTF Transform、MagicaVoxel | §1 | — |

**未變更**：LevelDef／SurfaceCell／Connector／Core 資料契約、NavigationGraph 與 A* 規則、LOS 規則、20 TPS 固定模擬、原子性命令提交、IndexedDB 主鍵與 schemaVersion=2。

---

> **最後提醒**：先驗證 NavigationGraph 與合法改路，再開始大量製作 3D 模型。這款遊戲的獨特性來自**跨平台的地形策略**；精緻感來自**光影、手感與一致的調色盤**，兩者都不是模型數量。
