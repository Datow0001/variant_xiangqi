# AI 開發指導手冊與防呆守則 (AI Developer Guidelines)

本手冊專為後續負責接續編寫程式碼的 AI 模型（或開發者）制定。本專案採用 **全端 TypeScript (Vue 3 + Node.js)** 架構，包含 C++ 外部引擎串接、WebSocket 即時通訊與自訂變體規則，**請嚴格遵循以下守則，避免陷入常見的實作陷阱**。

---

## 1. 核心嚴格禁令 (Inviolable Don'ts) ⚠️

1. ❌ **嚴禁在前端自算合法步與將軍狀態**：
   * 中國象棋具有複雜的規則（拐馬腳、塞象眼、九宮格限制、帥將對臉、自將禁手、被將軍應將）。加上 4 種變體棋子後，若在前端自寫規則庫將極端脆弱且耗時。
   * **唯一原則**：前端的所有選點高亮（`MoveIndicator`）**必須 100% 依賴後端 `GAME_STATE` 中下發的 `legalMoves` 陣列**！前端僅做單純的目標過濾與 UI 渲染。
2. ❌ **嚴禁使用標準 Fairy-Stockfish 二進位檔**：
   * 象棋為 9x10 棋盤，標準 8x8 版啟動即會崩潰。**必須使用 `fairy-stockfish-largeboard`**。
3. ❌ **嚴禁使用 Java / Spring Boot**：
   * 全系統統一採用 **TypeScript (Node.js + Vue 3)**，型別與資料模型由 `shared/types.ts` 統一管理，嚴禁建立 Java 相關結構或 `pom.xml` / `build.gradle`。
4. ❌ **嚴禁阻塞外部進程 Standard Error 串流**：
   * 外部 Process 的 `stderr` 必須監聽清空（`process.stderr.on('data', () => {})`），否則作業系統管道緩衝區填滿後會導致進程永久掛死。
5. ❌ **嚴禁在前端自行翻轉棋盤陣列索引**：
   * 盤面資料層永遠保持原生的 10x9 結構，視角翻轉僅在畫布/SVG 渲染層計算像素位置時（依據 `isFlipped`）轉換，不可改動資料層的 FEN 或坐標。
6. ❌ **嚴禁未經平衡性測試引入新棋子走法**：
   * 任何新設計的 Betza 走法必須遵循 [PIECE_BALANCE_TESTING.md](./PIECE_BALANCE_TESTING.md) 規範，嚴格遵守「開局首步零盲狙鐵律」，嚴禁出現開局第一步即能直接穿透吃掉對手邊車或主力大子的幾何漏洞。

---

## 2. 核心架構規範 (Engineering Standards)

### 2.1 後端規範 (Node.js + TypeScript + `ws`)
* **型別共享**：後端嚴禁自創與前端重複的 DTO 定義，一律自 `shared/types.ts` 匯入 `StartGamePayload`, `MovePayload`, `GameStatePayload`。
* **引擎通訊封裝**：統一在 `backend/src/FairyEngine.ts` 透過 `child_process.spawn` 與 `readline` 管理 Standard I/O。
* **超時保護**：呼叫 `go movetime` 必須設置 `setTimeout` 超時保護（如 `movetime + 2000ms`），超時則 reject `ENGINE_TIMEOUT`。
* **會話管理**：每個活躍中的 `GameSession` 保有其獨立的 `FairyEngine` 實例，對局結束或連線中斷逾時自動呼叫 `engine.destroy()` 釋放記憶體。

### 2.2 前端規範 (Vue 3 + TypeScript + Pinia + TailwindCSS)
* **組件模式**：全面使用 `<script setup lang="ts">` 與 Composition API。
* **Store 職責單一**：
  * `gameStore.ts`：專注管理對局狀態、當前 FEN、輪到誰、`legalMoves`、將軍與勝負。
  * `loadoutStore.ts`：專注管理 10 點預算配點、已選擇的升級清單、關卡選擇。
* **型別安全**：直接自 `shared/types.ts` 匯入所有 WebSocket 封包型別。

---

## 3. 分階段開發驗收條件 (Definition of Done - DoD)

當 AI 執行特定任務時，必須滿足該任務的 DoD 方可視為完成：

### Task 0: 引擎前置驗證 (Spike Test)
* [ ] 具備 `fairy-stockfish-largeboard` 二進位檔於 `./engine/`。
* [ ] 透過 CLI 輸入 `variants.ini` 中的變體設定，確認輸入 `position fen ...` 與 `go perft 1` 不會回報任何語法錯誤。

### Task 1: 共用型別與後端 UCI 行程服務
* [ ] 建立 `shared/types.ts` 定義完整 WebSocket 請求與回應型別。
* [ ] 建立 `backend/` 專案結構（`package.json`, `tsconfig.json`）。
* [ ] 實作 `FairyEngine.ts`，能透過 `child_process.spawn` 非阻塞讀寫，成功取得 `getBestMove` 與 `getLegalMoves`。

### Task 2: 關卡配置、FEN 產生器與 WebSocket 協定
* [ ] 實作 `backend/src/stages.ts`，定義 1~3 關的 AI 預算與棋子升級。
* [ ] 實作 `backend/src/fen.ts`，能將雙方 loadout 正確覆寫至標準 FEN。
* [ ] 實作 `backend/src/server.ts`，啟動 `ws` 伺服器，支援 `START_GAME`、`MAKE_MOVE` 與推送帶有 `legalMoves` 的 `GAME_STATE`。

### Task 3: 前端專案骨架與棋盤渲染
* [ ] Vite + Vue 3 + TailwindCSS 啟動正常。
* [ ] `ChessBoard.vue` 能根據 FEN 字串完整繪製 9x10 棋盤、楚河漢界、九宮格斜線與各位置棋子。
* [ ] 支援 `isFlipped` 參數，執黑時正確將黑方翻轉至下方。

### Task 4: 關卡選擇、Loadout 構築與敵方情報
* [ ] `StageSelector.vue` 能夠切換 1~3 關卡，並展示 AI 敵方配置。
* [ ] `LoadoutPanel.vue` 能限制玩家最多配置 10 點預算，超過點數時禁止選取。
* [ ] 盤面側邊或上方能即時展示 `EnemyIntel.vue` 顯示當前對手的特殊棋子。

### Task 5: 聯調、走步高亮與勝負判定
* [ ] 玩家點選棋子時，棋盤正確根據 `legalMoves` 顯示合法走步綠點。
* [ ] 玩家走步後送至後端，AI 自動回應並更新盤面。
* [ ] 被將軍時觸發視覺警示；將死或困斃時顯示勝負結果彈窗。

---

## 4. 接續開發之標準提示詞範本 (Prompts for Next AI)

後續對話可直接複製以下 Prompt 讓接手的 AI 執行對應任務：

#### 執行 Task 1 提示詞：
> 「請參考 [variant_xiangqi_sdd.md](file:///d:/WorkSpace/variant_xiangqi/variant_xiangqi_sdd.md) 與 [AI_DEV_GUIDELINES.md](file:///d:/WorkSpace/variant_xiangqi/AI_DEV_GUIDELINES.md)，開始執行 **Task 1: 後端基礎架構與 UCI 行程服務**。請建立 `shared/types.ts` 定義資料模型，並以 Node.js + TypeScript 建立 `backend/` 專案與 `FairyEngine.ts`，確保能透過 `child_process.spawn` 與 Fairy-Stockfish 進行非阻塞 UCI 通訊。」

#### 執行 Task 2 提示詞：
> 「請參考 [variant_xiangqi_sdd.md](file:///d:/WorkSpace/variant_xiangqi/variant_xiangqi_sdd.md) 與 [COORDINATES_AND_FEN.md](file:///d:/WorkSpace/variant_xiangqi/COORDINATES_AND_FEN.md)，開始執行 **Task 2: 關卡配置、FEN 產生器與 WebSocket 協定**。請實作 `stages.ts`（Stage 1~3 預設配置）、`fen.ts` 以及使用 `ws` 套件實作 `server.ts`，支援 `START_GAME` 與 `MAKE_MOVE` 通訊。」
