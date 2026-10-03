# 自訂變體象棋對弈系統 (Variant Xiangqi MVP)

一個支援局前構築（Loadout）、升級自訂棋子能力（天馬、飛象、霰彈砲、突擊兵），並能與多階 AI 進行即時對弈的現代化中國象棋變體系統。

本專案採用 **全端 TypeScript (Full-Stack TypeScript)** 架構：**Vue 3 (前端) + Node.js (後端)**，透過 `shared/` 模組達成前後端 100% 型別與資料結構共用。

---

## 📑 核心技術文件導覽

本專案提供完整且標準化的規格說明書與開發指導文件，供開發者與 AI 程式碼生成模型查閱：

1. **[系統設計規格書 (variant_xiangqi_sdd.md)](./variant_xiangqi_sdd.md)**：
   * 包含全端 TypeScript 架構、4 種變體棋子規則、3 大挑戰關卡、WebSocket JSON 協定與模組劃分。
2. **[AI 開發指導手冊與防呆守則 (AI_DEV_GUIDELINES.md)](./AI_DEV_GUIDELINES.md)**：
   * 規範 AI 開發原則、核心禁令（Inviolable Don'ts）、各任務的 Definition of Done (DoD) 與接續開發 Prompt 範本。
3. **[盤面坐標與 FEN 換算速查字典 (COORDINATES_AND_FEN.md)](./COORDINATES_AND_FEN.md)**：
   * 9x10 象棋盤面 ASCII 坐標對照、標準/自訂 FEN 拆解表，以及前後端坐標換算之 TypeScript 實作代碼。
4. **[新棋子走法設計與平衡性測試規範 (PIECE_BALANCE_TESTING.md)](./PIECE_BALANCE_TESTING.md)**：
   * 變體棋子設計三大鐵律（開局首步零盲狙）、三大自對弈測試情境與 4 大過強量化警戒紅線。
5. **[變體引擎設定檔 (variants.ini)](./variants.ini)**：
   * 供 Fairy-Stockfish 讀取之 Betza 記譜法實體設定檔。
6. **[遊戲基礎實作與協定 (GAME_FOUNDATION.md)](./GAME_FOUNDATION.md)**：
   * 第一階段的執行方式、驗證規則、指定盤面、恢復憑證、生命週期、測試及部署限制；目前協定以此文件和 `shared/types.ts` 為準。
7. **[短局挑戰系統 (CHALLENGES.md)](./CHALLENGES.md)**：
   * 第二階段的三個示範關卡、限步目標、提示與星級、結果／重試、關卡資料格式與協定增量。
8. **[第一批正式關卡 (FIRST_CHALLENGES.md)](./FIRST_CHALLENGES.md)**：
   * 12 關、3 章的設計表、引擎防守分支驗證、本機最佳成績與進度保存。
9. **[手機體驗與進度保存 (MOBILE_EXPERIENCE.md)](./MOBILE_EXPERIENCE.md)**：
   * 手機排版、操作確認、schema 2 移轉、配點保存、備份合併與前景恢復，以及實機驗收清單。
10. **[GCP 部署與發布 (DEPLOYMENT.md)](./DEPLOYMENT.md)**：
    * 既有服務、Cloud Build 首次切換、無流量預覽、容器驗證、明確版本發布與回復。
11. **[玩家測試與實機驗收 (PLAYER_TESTING.md)](./PLAYER_TESTING.md)**：
    * Android／iPhone 驗收表、容量量測、兩輪試玩與問題回報格式。

---

## 🛠️ 環境需求與相依性 (Prerequisites)

* **執行環境**：建議 Node.js 24 LTS 與 npm；部署容器使用 Node.js 24。鎖定安裝請分別執行 `npm ci --prefix backend`、`npm ci --prefix frontend`。
* **對弈引擎 (Engine)**：**Fairy-Stockfish Largeboard**
  * ⚠️ *重要注意*：中國象棋必須使用 `largeboard` 編譯版本，標準版本不支援 9x10 盤面。
  * 可由 [Fairy-Stockfish 官方 GitHub Releases](https://github.com/fairy-stockfish/Fairy-Stockfish/releases) 下載對應作業系統的 largeboard 版本（如 Windows: `fairy-stockfish-largeboard_x86-64.exe`）。
  * 放置於專案根目錄下的 `./engine/` 目錄。

---

## 🚀 專案結構預覽

```
variant_xiangqi/
├── variant_xiangqi_sdd.md      # 系統設計規格書 (SDD)
├── AI_DEV_GUIDELINES.md        # AI 實作防呆與驗收標準
├── COORDINATES_AND_FEN.md      # 盤面坐標與 FEN 對照字典
├── variants.ini                # 變體棋子 Betza 設定檔
├── README.md                   # 專案說明文件
├── engine/                     # 存放 Fairy-Stockfish Largeboard 二進位檔
│   └── fairy-stockfish-largeboard_x86-64.exe
├── shared/                     # 前後端共用型別 (TypeScript)
│   ├── types.ts                # WebSocket 封包 interface
│   └── coordinates.ts          # 坐標轉換函式
├── backend/                    # Node.js + TypeScript + ws 後端
└── frontend/                   # Vue 3 + Vite + TailwindCSS 前端
```

---

## 🎮 變體規則速覽 (MVP 4 大特種棋子)

| 棋子 | 升級型態 | 耗費點數 | 特殊能力 |
| :---: | :---: | :---: | :--- |
| **馬** | **天馬** (`U`/`u`) | 3 點 | 無拐馬腳（蹩腳）限制，具備西洋棋騎士之完整跳躍機動性。 |
| **相/象** | **飛象** (`F`/`f`) | 2 點 | 打破楚河漢界限制，可直接渡河深入敵陣進攻。 |
| **砲/炮** | **霰彈砲** (`M`/`m`) | 3 點 | 平時走車，遠程隔子跳吃，且解鎖相鄰 1 格近戰直接吃子。 |
| **兵/卒** | **突擊兵** (`S`/`s`) | 1 點 | 未過河前即解鎖左右平移能力，大幅提升開局推進彈性。 |

玩家擁有 **10 點預算**，可在局前自選棋子升級，挑戰「初出茅廬（0點）」、「初試鋒芒（5點）」與「巔峰對決（10點）」三大 AI 關卡！
