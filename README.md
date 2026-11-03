# 天空方塊島：守護之心

多層體素地形塔防：在漂浮群島上改路、爭高地、守護天空之心。

![準備階段](docs/screenshots/prepare.png)

四個關卡的地圖總覽與戰鬥截圖見 [docs/levels](docs/levels/README.md)。

## 開始

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 產出 dist/
npm test         # 單元與整合測試
npm run e2e      # 需先 build：瀏覽器冒煙測試（建塔、復原、開波、結算）
npm run e2e:mobile # 需先 build：手機尺寸＋觸控模擬（直式、橫式、Android）
npm run typecheck && npm run lint
```

## 線上遊玩（GitHub Pages）

https://yisotsao.github.io/sky-cube-island/ （手機瀏覽器可直接開啟）

推送到預設分支時，`.github/workflows/deploy-pages.yml` 會自動建置並部署。首次使用需在 GitHub 儲存庫 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**。也可在 Actions 頁面手動執行「Deploy to GitHub Pages」。

網址參數（測試／截圖用）：`?nointro` 跳過開場、`?visualTest` 凍結動畫、`?cam=0..3` 旋轉視角、`?quality=low|medium|high|ultra`、`?perf` 顯示效能。

## 操作

| 按鍵 | 功能 |
|---|---|
| 1 / 2 / 3 / 4 / 5 | 箭塔／冰晶塔／岩石砲塔／雷光塔／風車塔 |
| R / F | 抬升／降低地形 |
| B | 木牆 |
| J | 尖刺陷阱（不擋路，地面敵人踩到受傷） |
| G | 拆橋／修橋（有其他通路的橋才能拆） |
| Ctrl+Z | 復原（準備期最多 20 步） |
| U / X | 升級／出售選取的塔 |
| T | 切換選取的塔的索敵模式（最前／最後／最強／最近） |
| Tab（按住） | 顯示所有射程 |
| Q / E、滾輪、WASD | 旋轉、縮放、平移 |
| Enter / Space / Esc | 開始波次／暫停／取消 |
| P | 拍照模式（見下方） |

### 手機／平板（觸控）

| 手勢 | 功能 |
|---|---|
| 點工具按鈕 | 選擇塔／地形工具（再點一次取消） |
| 點地塊 → 再點同一格 | 第一下預覽位置、花費與新路線；第二下確認 |
| 點塔／牆 | 選取，可升級／出售／拆除 |
| 單指拖曳 | 平移 |
| 雙指捏合／旋轉 | 縮放／旋轉視角 90° |
| ⚙ | 選單（設定、操作說明、拍照模式、回到標題） |
| 📷 | 拍照模式 |

手機預設畫質為「中」（低記憶體或 ≤4 核時為「低」），可在設定中調整。直式與橫式皆可遊玩，橫式視野較大。

## 新敵人與陷阱、拆橋

- **風翼飛龍**：直線飛越地形、木牆與虛空，陷阱打不到，只能靠塔擊落。
- **破牆角獸**：撞上木牆會停下約 3 秒把它撞碎再前進。
- **尖刺陷阱**（J，40 金）：鋪在路上不擋路，每秒刺傷站在上面的地面敵人；點選有陷阱的地塊可拆除（退 20 金）。
- **拆橋**（G，20 金／修回 30 金）：準備期拆掉一座橋逼敵人繞路，但不能切斷所有通路；也可點選橋面操作，撤銷可還原。

## 挑戰與紀錄

每關有 3 個可選挑戰（例如「不放任何木牆通關」「同時最多只有 8 座塔」）。選單（⚙／Esc）顯示這局是否仍在達成中，通關時結算；標題畫面的關卡卡片顯示已完成的挑戰數與最佳剩餘生命（存在本機）。

## 無盡模式

通關一關後，標題畫面選這一關再切到「無盡模式」：同一張地圖、同樣的規則，但波次不會停。敵人從這關出現過的怪物裡由弱到強輪流登場，生命一波比一波高，每 5 波會有這關的頭目。每撐過一波就記錄最高波數（關卡卡片上的「無盡 N 波」），存檔與戰役分開。

## 拍照模式

按 P（或右上角 📷、選單裡的「拍照模式」）：介面隱藏、戰鬥暫停，可以自由旋轉與傾斜鏡頭、拉得更近更遠，套用 6 種濾鏡（原色、暖陽、晨霧、復古、黑白、鮮豔）與移軸（微縮模型）效果，戰術線可開可關。按「拍照」或 Enter 存成 PNG（手機上會開分享選單）。P／Esc 離開，鏡頭與戰局回到原本狀態。

| 拍照模式操作 | 功能 |
|---|---|
| 左鍵拖曳 | 左右旋轉、上下傾斜 |
| 中鍵拖曳 / 單指拖曳 | 平移 |
| 滾輪 / 雙指捏合 | 縮放 |
| Q / E | 旋轉 15° |
| R / F | 視角抬高／放低 |
| 1～6 | 切換濾鏡 |
| H | 顯示／隱藏戰術線 |
| Enter | 拍照 |

## 架構

- `src/domain`、`src/levels`、`src/navigation`、`src/commands`、`src/simulation`、`src/session`：純 TypeScript 模擬核心（20 TPS、確定性），不依賴 three 或 React，ESLint 強制。
- `src/scene`：Three.js 呈現層（貪婪體素網格＋烘焙 AO、shader 倒角、雲海、後處理、戰術疊層、VFX），只透過 `GameEvent` 與 `SceneFeed` 讀資料。
- `src/audio`：音效與自適應音樂。錄音素材為 CC0（來源見 `public/audio/CREDITS.md`），未載入時退回程序合成。
- `src/ui`：React HUD（zustand 低頻狀態）。

設計規格見 `docs/01_GAME_DESIGN_DOCUMENT.md`、`docs/02_TECHNICAL_ARCHITECTURE.md`；現行塔與怪物數值、等級外觀見 `docs/03_TOWERS_AND_ENEMIES.md`；實作決策見 `docs/DECISIONS.md`。
