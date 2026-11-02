# 天空方塊島：守護之心

多層體素地形塔防：在漂浮群島上改路、爭高地、守護天空之心。

![準備階段](docs/screenshots/prepare.png)

## 開始

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 產出 dist/
npm test         # 單元與整合測試
npm run e2e      # 需先 build：瀏覽器冒煙測試（建塔、復原、開波、結算）
npm run typecheck && npm run lint
```

網址參數（測試／截圖用）：`?nointro` 跳過開場、`?visualTest` 凍結動畫、`?cam=0..3` 旋轉視角、`?quality=low|medium|high|ultra`、`?perf` 顯示效能。

## 操作

| 按鍵 | 功能 |
|---|---|
| 1 / 2 / 3 | 箭塔／冰晶塔／岩石砲塔 |
| R / F | 抬升／降低地形 |
| B | 木牆 |
| Ctrl+Z | 復原（準備期最多 20 步） |
| U / X | 升級／出售選取的塔 |
| Tab（按住） | 顯示所有射程 |
| Q / E、滾輪、WASD | 旋轉、縮放、平移 |
| Enter / Space / Esc | 開始波次／暫停／取消 |

## 架構

- `src/domain`、`src/levels`、`src/navigation`、`src/commands`、`src/simulation`、`src/session`：純 TypeScript 模擬核心（20 TPS、確定性），不依賴 three 或 React，ESLint 強制。
- `src/scene`：Three.js 呈現層（貪婪體素網格＋烘焙 AO、shader 倒角、雲海、後處理、戰術疊層、VFX），只透過 `GameEvent` 與 `SceneFeed` 讀資料。
- `src/audio`：程序合成音效與音樂。
- `src/ui`：React HUD（zustand 低頻狀態）。

設計規格見 `docs/01_GAME_DESIGN_DOCUMENT.md`、`docs/02_TECHNICAL_ARCHITECTURE.md`；實作決策見 `docs/DECISIONS.md`。
