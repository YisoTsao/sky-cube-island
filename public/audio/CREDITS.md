# 音樂與音效來源（Audio credits）

遊戲內所有錄製音訊皆為 **CC0 1.0（公眾領域）**，可免費商用、修改、再散布，不需標示作者；以下仍列出作者以示感謝。
原始授權全文：https://creativecommons.org/publicdomain/zero/1.0/

檔案已轉為 MP3（44.1 kHz）並做響度正規化，內容未做其他修改。

## 背景音樂 `music/`

| 檔案 | 用途 | 原曲 | 作者 | 授權 | 來源 |
| --- | --- | --- | --- | --- | --- |
| `town-theme.mp3` | 準備期／結算 | Town Theme RPG | cynicmusic（The Cynic Project / pixelsphere.org） | CC0 | https://opengameart.org/content/town-theme-rpg |
| `battle-theme-a.mp3` | 戰鬥（核心 HP ≤4 時加速 7%） | Battle Theme A | cynicmusic（The Cynic Project / pixelsphere.org） | CC0 | https://opengameart.org/content/battle-theme-a |

取得檔案的鏡像：Castle Game Engine 範例 `examples/audio/music_collection_player/data/songs/`（其 AUTHORS.md 同樣標註 CC0）。

## 樂句（stingers）`sfx/`

| 檔案 | 用途 | 原檔 | 作者 | 授權 | 來源 |
| --- | --- | --- | --- | --- | --- |
| `wave-start.mp3` | 開波 | SNES/charge | Beatscribe | CC0 | https://github.com/Beatscribe/homebrew_vgm |
| `wave-clear.mp3` | 清波 | SNES/treasure | Beatscribe | CC0 | 同上 |
| `victory.mp3` | 勝利 | SNES/victory | Beatscribe | CC0 | 同上 |
| `defeat.mp3` | 失敗 | SNES/game_over | Beatscribe | CC0 | 同上 |

## 音效 `sfx/`（Kenney，kenney.nl，CC0）

| 檔案 | 用途 | Kenney 素材包 / 原檔 |
| --- | --- | --- |
| `ui-click.mp3` | UI 點擊 | UI Audio / click1 |
| `ui-hover.mp3` | UI 懸停 | UI Audio / rollover2 |
| `sell-coins.mp3` | 出售 | RPG Audio / handleCoins |
| `build-0..2.mp3` | 建塔 | Impact Sounds / impact_wood_heavy_000–002 |
| `upgrade.mp3` | 升級 | Digital Audio / powerUp1 |
| `wall-place-0..1.mp3` | 放置路障 | Impact Sounds / impact_plate_heavy_000–001 |
| `wall-remove.mp3` | 移除路障 | Impact Sounds / impact_plank_medium_000 |
| `arrow-hit-0..2.mp3` | 箭矢命中 | Impact Sounds / impact_wood_light_000–002 |
| `frost-hit-0..2.mp3` | 冰晶命中 | Impact Sounds / impact_glass_light_000–002 |
| `cannon-fire.mp3` | 砲塔開火 | Sci-Fi Sounds / low_frequency_explosion_001 |
| `explosion-0..2.mp3` | 砲彈爆炸 | Sci-Fi Sounds / explosion_crunch_000–002 |
| `resist-0..1.mp3` | 傷害被抵抗 | Impact Sounds / impact_metal_light_000–001 |
| `death-slime-0..1.mp3` | 史萊姆類死亡 | Sci-Fi Sounds / slime_000–001 |
| `death-runner-0..2.mp3` | 快速怪死亡 | Impact Sounds / impact_punch_medium_000–002 |
| `death-golem-0..1.mp3` | 重型怪死亡 | Impact Sounds / impact_mining_000–001 |
| `core-hit.mp3` | 核心受擊 | Impact Sounds / impact_bell_heavy_000 |

Kenney 素材包頁面：https://kenney.nl/assets/ui-audio 、 https://kenney.nl/assets/rpg-audio 、 https://kenney.nl/assets/impact-sounds 、 https://kenney.nl/assets/sci-fi-sounds 、 https://kenney.nl/assets/digital-audio （皆附 CC0 License.txt）。

## 仍為程式合成的聲音

以下沒有對應的錄音檔，維持 `src/audio/audio.ts` 內的 Web Audio 合成（無授權問題）：
金幣入袋、非法操作、升地／降地、復原、箭塔與冰晶塔開火、出怪、環境風聲與鳥鳴。
錄音檔下載失敗或尚未載入時，所有聲音也會自動退回合成版本。
