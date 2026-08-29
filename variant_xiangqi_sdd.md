# 系統設計規格書 (SDD)：自訂變體象棋對弈系統 (MVP)

本文件定義自訂變體象棋遊戲之技術架構、資料結構、通訊協定與實作規格，供開發團隊與 AI 程式碼生成模型依循實作。

---

## 1. 系統架構與技術棧 (Full-Stack TypeScript)

全系統採用 **全端 TypeScript 架構**，前端 (Vue 3) 與後端 (Node.js) 透過 `shared/` 套件達成 100% 型別與資料結構共用。

```
┌────────────────────────────────────────────────────────────────────────┐
│                        前端 (Frontend: Vue 3)                          │
│   - StageSelector (三大關卡選擇)    - LoadoutView (10 點預算構築)     │
│   - ChessBoard (9x10 盤面/視角翻轉) - EnemyIntel (敵方情報卡)          │
│   - Pinia (狀態管理)                - WebSocket Client (原生 ws 協議) │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ WebSocket (純 JSON，共用 shared/types)
┌───────────────────────────────────▼────────────────────────────────────┐
│                  後端 (Backend: Node.js + TypeScript)                  │
│   - server.ts (原生 'ws' WebSocket 伺服器與路由分發)                   │
│   - session.ts (GameSession: 局況管理、Stage 配置與 FEN 維護)          │
│   - FairyEngine.ts (child_process.spawn 封裝、UCI 協定與非阻塞管道)     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ child_process (stdin / stdout)
┌───────────────────────────────────▼────────────────────────────────────┐
│         底層引擎 (Engine: Fairy-Stockfish Largeboard Binary)           │
│   - variants.ini (自訂棋子走法 Betza 記譜法與估值定義)                 │
└────────────────────────────────────────────────────────────────────────┘
```

* **前端**：Vue 3 (Composition API `<script setup>`) + TypeScript + Vite + Pinia + TailwindCSS。
* **後端**：Node.js (LTS) + TypeScript + `ws` (超輕量 WebSocket 函式庫) + `tsx` (開發即時熱重載)。
* **共用層 (`shared/`)**：前後端 100% 共用 WebSocket DTO 型別、座標換算與關卡常數。
* **引擎**：**Fairy-Stockfish Largeboard** 獨立二進位檔（透過後端 `child_process.spawn` 以標準 UCI 協定驅動）。
  > [!IMPORTANT]
  > 中國象棋棋盤為 9x10（90 格），**必須**使用 Fairy-Stockfish 的 `largeboard` 編譯版本（如 `fairy-stockfish-largeboard_x86-64.exe`）。標準版僅支援最大 8x8 棋盤，載入象棋會發生記憶體溢位或例外崩潰。

---

## 2. 棋子定義與 Betza 規格 (`variants.ini`)

引擎統一使用 Fairy-Stockfish 的 Betza 記譜法實作變體。MVP 階段設定檔定義如下：

```ini
[customxiangqi:xiangqi]
# 棋子代號映射：
# u/U: 天馬 (Knight, 無蹩馬腳限制)
# f/F: 飛象 (Elephant, 田字走法且可自由過河)
# m/M: 迫擊砲 (Mortar Cannon, 平時走車，遠程隔子跳吃，解鎖相鄰 1 格近戰直接吃)
# s/S: 突擊兵 (Assault Soldier, 前進與左右橫移)
customPiece1 = u:N
customPiece2 = f:A
customPiece3 = m:mRcpRcW
customPiece4 = s:fsW

# 子力估值對應 (以標準車 900 為基準)
pieceValue = u:550, f:350, m:600, s:250, r:900, n:400, b:250, a:250, k:10000, c:450, p:100
```

### 棋子升級項目 (Loadout Configuration)

| 棋子 ID (`upgradeId`) | 原始棋子 | 升級型態 | Cost | FEN 代號（紅/黑） | 特殊能力說明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `TIAN_MA` | 馬 (N) | 天馬 | 3 | `U` / `u` | 具備西洋棋騎士走法，移動不被拐馬腳（蹩腳）。 |
| `FEI_XIANG` | 相/象 (B) | 飛象 | 2 | `F` / `f` | 走田字格，打破楚河漢界限制，可直接渡河進攻。 |
| `PO_JI_PAO` | 砲 (C) | 迫擊砲 | 3 | `M` / `m` | 平時走車，吃子時中間可隔 1 隻或 2 隻棋子作為砲架。 |
| `TU_JI_BING` | 兵/卒 (P) | 突擊兵 | 1 | `S` / `s` | 過河前即解鎖左右平移能力，大幅提升開局推進彈性。 |

---

## 3. AI 關卡設計 (Stage System)

MVP 階段規劃 3 個由淺入深的漸進式挑戰關卡，供玩家制定對策：

| 關卡 ID (`stageId`) | 關卡名稱 | AI 預算 | AI 陣容配置 | 思考時限 (`movetime`) | 難度定位與體驗 |
| :---: | :--- | :---: | :--- | :---: | :--- |
| **1** | **初出茅廬** | **0 點** | **標準傳統象棋**<br>（無任何升級棋子） | 300 ms | **入門級**：玩家使用 10 點變體陣容對抗傳統陣容，體驗降維打擊。 |
| **2** | **初試鋒芒** | **5 點** | **1 天馬 (3) + 1 飛象 (2)**<br>預設升級：左馬 (`b9`)、右象 (`g9`) | 800 ms | **進階級**：AI 首度擁有變體棋子，考驗玩家對跨河象與天馬突襲的防守。 |
| **3** | **巔峰對決** | **10 點** | **雙迫擊砲 (6) + 1 飛象 (2) + 2 突擊兵 (2)**<br>預設升級：雙砲 (`b7`, `h7`)、左象 (`c9`)、中兵與右兵 (`e6`, `g6`) | 1500 ms | **極限級**：完全體變體對決，雙方火力最大化。 |

> [!NOTE]
> AI 棋子預設位置為黑方標準坐標，若玩家選擇執黑，AI 改為執紅，位置自動鏡射至對應紅方底線行（第 0~4 行）。

---

## 4. 資料結構與通訊協定 (`shared/types.ts`)

全系統採用原生 WebSocket 雙向傳遞純 JSON 封包，型別由 `shared/types.ts` 集中定義並由前後端共同引用。

### 4.1 Client -> Server 動作請求

```typescript
// shared/types.ts
export type ClientAction =
  | { action: 'START_GAME'; payload: StartGamePayload }
  | { action: 'MAKE_MOVE'; payload: MovePayload }
  | { action: 'RESIGN'; payload: { gameId: string } }
  | { action: 'RECONNECT'; payload: { gameId: string } };

export interface StartGamePayload {
  stageId: 1 | 2 | 3;
  playerColor: 'red' | 'black';
  budget: number; // 預設 10
  loadouts: Array<{ position: string; upgradeId: string }>;
}

export interface MovePayload {
  gameId: string;
  from: string; // 例如 'b0'
  to: string;   // 例如 'c2'
}
```

### 4.2 Server -> Client 事件廣播

```typescript
// shared/types.ts
export type ServerEvent =
  | { event: 'GAME_STATE'; payload: GameStatePayload }
  | { event: 'ERROR'; payload: { code: string; message: string } };

export interface GameStatePayload {
  gameId: string;
  stageId: number;
  fen: string;
  currentTurn: 'red' | 'black';
  lastMove: { from: string; to: string } | null;
  legalMoves: Array<{ from: string; to: string }>;
  aiLoadouts: Array<{ position: string; upgradeId: string }>;
  isCheck: boolean;
  isGameOver: boolean;
  winner: 'red' | 'black' | 'draw' | null;
  gameOverReason: 'CHECKMATE' | 'STALEMATE' | 'RESIGN' | 'REPETITION' | null;
}
```

* `legalMoves`: 由後端即時向引擎查詢並帶下，前端只需根據當前選中棋子位置直接過濾顯示可走路徑圓點，無需在前端編寫複雜的走步與應將規則。

---

## 5. 後端核心設計 (Node.js + TypeScript)

### 5.1 專案結構 (`backend/`)
```
backend/
├── package.json               # 依賴: ws, @types/ws, tsx, typescript
├── tsconfig.json
└── src/
    ├── server.ts              # 啟動 WebSocket 伺服器、監聽連線與轉發訊息
    ├── session.ts             # GameSession: 單局狀態維護、計時器、勝負狀態
    ├── fen.ts                 # 替換雙方變體棋子生成 FEN
    ├── stages.ts              # 關卡 1~3 預設陣容與 movetime 常數
    └── FairyEngine.ts         # child_process.spawn 封裝 (UCI 協定處理器)
```

### 5.2 引擎進程管理實作規格 (`backend/src/FairyEngine.ts`)
透過 Node.js 原生 `child_process.spawn`，天然具備事件驅動與串流通訊特性：

```typescript
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as readline from 'readline';

export class FairyEngine {
  private process: ChildProcessWithoutNullStreams;
  private rl: readline.Interface;

  constructor(enginePath: string, variantPath: string) {
    this.process = spawn(enginePath);
    this.rl = readline.createInterface({ input: this.process.stdout });

    // 持續清空 stderr 避免緩衝區阻塞
    this.process.stderr.on('data', () => {});

    // 初始化變體
    this.send('uci');
    this.send(`setoption name VariantPath value ${variantPath}`);
    this.send('setoption name UCI_Variant value customxiangqi');
    this.send('isready');
  }

  public send(cmd: string): void {
    this.process.stdin.write(`${cmd}\n`);
  }

  // 取得 AI 最佳走步
  public async getBestMove(fen: string, movetimeMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ENGINE_TIMEOUT')), movetimeMs + 2000);

      const onLine = (line: string) => {
        if (line.startsWith('bestmove ')) {
          clearTimeout(timer);
          this.rl.removeListener('line', onLine);
          const parts = line.split(' ');
          resolve(parts[1]); // e.g. "b9c7"
        }
      };

      this.rl.on('line', onLine);
      this.send(`position fen ${fen}`);
      this.send(`go movetime ${movetimeMs}`);
    });
  }

  // 查詢當前盤面所有合法走步 (供前端高亮)
  public async getLegalMoves(fen: string): Promise<Array<{ from: string; to: string }>> {
    return new Promise((resolve) => {
      const moves: Array<{ from: string; to: string }> = [];
      const onLine = (line: string) => {
        // 解析 perft 1 輸出的行格式: "b0c2: 1"
        const match = line.match(/^([a-i][0-9])([a-i][0-9]):/);
        if (match) {
          moves.push({ from: match[1], to: match[2] });
        }
        if (line.startsWith('Nodes searched:') || line.startsWith('Total:')) {
          this.rl.removeListener('line', onLine);
          resolve(moves);
        }
      };

      this.rl.on('line', onLine);
      this.send(`position fen ${fen}`);
      this.send('go perft 1');
    });
  }

  public destroy(): void {
    this.process.kill();
  }
}
```

---

## 6. 前端核心設計 (Vue 3)

### 6.1 專案結構 (`frontend/`)
```
frontend/
├── package.json
├── vite.config.ts
└── src/
    ├── assets/images/pieces/   # 傳統棋子與變體棋子 SVG 圖標 (天馬、飛象、迫擊砲、突擊兵)
    ├── components/
    │   ├── Stage/
    │   │   └── StageSelector.vue   # 關卡 1~3 選擇卡片 (展示敵方預算與情報)
    │   ├── Loadout/
    │   │   ├── LoadoutPanel.vue    # 10 點預算計數器與配置重置
    │   │   └── UpgradeCard.vue     # 單一棋子升級能力說明卡
    │   └── Board/
    │       ├── ChessBoard.vue      # 9x10 主棋盤 (含楚河漢界、九宮斜線、畫布翻轉)
    │       ├── ChessPiece.vue      # 棋子元件 (含被將軍閃爍特效與自訂棋子光圈)
    │       ├── MoveIndicator.vue   # 可走步綠色圓點高亮
    │       └── EnemyIntel.vue      # 盤面側邊/上方即時展示敵方變體棋子情報
    ├── stores/
    │   ├── gameStore.ts            # 當前 FEN、回合格、合法步清單、勝負狀態
    │   └── loadoutStore.ts         # 當前已消耗點數、玩家選擇的升級陣列
    └── services/
        └── websocket.ts            # WebSocket 封裝、自動重連與 JSON 訊息派送
```

### 6.2 盤面座標系統與視角翻轉 (Board Flip)
* 棋盤基準座標採用標準 UCI 規範：寬 9 列 (`a` ~ `i`)，高 10 行 (`0` ~ `9`)。
* **預設視角（玩家執紅，紅方在下方）**：
  $$X = colIndex \times CellSize + Padding \quad (colIndex: a=0 \dots i=8)$$
  $$Y = (9 - rowIndex) \times CellSize + Padding \quad (rowIndex: 0 \dots 9)$$
* **翻轉視角（玩家執黑，黑方在下方）**：
  $$X = (8 - colIndex) \times CellSize + Padding$$
  $$Y = rowIndex \times CellSize + Padding$$

---

## 7. 開發執行步驟清單 (AI Codegen Checklist)

- [x] **Task 0: 引擎驗證與前置準備 (Spike Test)**
  - 下載 `fairy-stockfish-largeboard` 二進位檔至 `./engine/`。
  - 透過命令列手動測試載入 `customxiangqi` 並驗證天馬、飛象、迫擊砲、突擊兵走步。
- [x] **Task 1: 後端基礎架構與 UCI 行程服務 (Backend)**
  - 建立 `shared/types.ts` 定義資料模型。
  - 建立 `backend/` 專案結構（`package.json`, `tsconfig.json`）。
  - 實作 `FairyEngine.ts`（以 `child_process.spawn` 串接 Fairy-Stockfish，支援 `getBestMove` 與 `getLegalMoves`）。
- [x] **Task 2: 關卡系統、FEN 產生器與 WebSocket 協定 (Backend)**
  - 實作 `stages.ts`（定義關卡 1~3 的 AI 預算與棋子升級）。
  - 實作 `fen.ts`（將雙方 loadout 寫入標準棋盤 FEN）。
  - 實作 `server.ts`，支援 `START_GAME`、`MAKE_MOVE`、`RESIGN`、`RECONNECT` 與錯誤事件廣播。
- [x] **Task 3: 前端專案骨架與棋盤渲染 (Frontend)**
  - 建立 Vite + Vue 3 + TypeScript + Pinia + TailwindCSS 專案。
  - 實作 `ChessBoard.vue`（9x10 網格、楚河漢界、九宮斜線、棋子渲染、紅黑視角翻轉支援）。
- [x] **Task 4: 關卡選擇、Loadout 構築與敵方情報 (Frontend)**
  - 實作 `StageSelector.vue`（關卡 1、2、3 切換）。
  - 實作 `LoadoutPanel.vue`（10 點預算限制檢核、點選棋子升級）。
  - 實作 `EnemyIntel.vue`（顯示 AI 當前升級棋子資訊）。
- [x] **Task 5: 全流程對弈串接、合法步高亮與邊界測試**
  - 串接後端 `legalMoves`，點擊棋子時高亮可行走格子。
  - 實作將軍警示 (`isCheck`)、勝負彈窗 (`winner`, `gameOverReason`)。
  - 驗證執黑先手 AI 自動出步、非法走步防禦與斷線重連。

---

## 8. 新棋子走法設計與平衡性測試規範 (Piece Balance Protocol)

為防止未來新增或修改棋子時破壞遊戲平衡（如開局首步秒殺大子、點數嚴重超模），所有變體兵種設計必須嚴格遵循 **[PIECE_BALANCE_TESTING.md](./PIECE_BALANCE_TESTING.md)** 所定義之規範：

1. **三大設計鐵律**：開局首回合禁止攻擊底線大子（Turn-1 Non-aggression）、點數價值對稱、保留反制弱點。
2. **三大對弈情境**：對稱鏡像組（100場）、等點對照組（雙向換手100場）、純傳統基準組（100場）。
3. **四大量化警戒紅線**：
   * 先手勝率不得大於 65%。
   * 雙向綜合淨勝率偏離度不得大於 70%。
   * 15 回合內之早夭短局不得大於 5%。
   * 開局前 5 步出子壟斷率不得大於 70%。