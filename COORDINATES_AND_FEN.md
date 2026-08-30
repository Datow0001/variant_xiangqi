# 中國象棋 9x10 盤面座標與 FEN 換算速查字典 (Domain Ground Truth)

本文件定義變體象棋系統之棋盤座標系、UCI 走步代碼、FEN 記譜規則與程式碼換算公式。所有後續開發與 AI 程式碼生成必須嚴格以本文件為依據。

---

## 1. 棋盤坐標系統 (UCI Coordinate System)

* **欄 (Files / Columns)**：從左至右標記為 `a` 至 `i`（共 9 欄，對應索引 `0` ~ `8`）。
* **列 (Ranks / Rows)**：由南至北（紅方到底線至黑方底線）標記為 `0` 至 `9`（共 10 列，對應索引 `0` ~ `9`）。
* **黑方底線**：第 `9` 列（`a9` ~ `i9`）。
* **楚河漢界**：介於第 `4` 列（紅方邊緣）與第 `5` 列（黑方邊緣）之間。
* **紅方底線**：第 `0` 列（`a0` ~ `i0`）。

### 1.1 棋盤 ASCII 坐標與初始佈局對照圖

```
   a   b   c   d   e   f   g   h   i
 ┌───┬───┬───┬───┬───┬───┬───┬───┬───┐
9│ r │ n │ b │ a │ k │ a │ b │ n │ r │ 9 (黑方底線: 車馬象士將士象馬車)
 ├───┼───┼───┼───┼───┼───┼───┼───┼───┤
8│ · │ · │ · │ · │ · │ · │ · │ · │ · │ 8
 ├───┼───┼───┼───┼───┼───┼───┼───┼───┤
7│ · │ c │ · │ · │ · │ · │ · │ c │ · │ 7 (黑方砲位: b7, h7)
 ├───┼───┼───┼───┼───┼───┼───┼───┼───┤
6│ p │ · │ p │ · │ p │ · │ p │ · │ p │ 6 (黑方卒位: a6, c6, e6, g6, i6)
 ├───┼───┼───┼───┼───┼───┼───┼───┼───┤
5│   │   │   │   楚河│漢界 │   │   │   │ 5
 ╞═══╪═══╪═══╪═══╪═══╪═══╪═══╪═══╪═══╡
4│   │   │   │   楚河│漢界 │   │   │   │ 4
 ├───┼───┼───┼───┼───┼───┼───┼───┼───┤
3│ P │ · │ P │ · │ P │ · │ P │ · │ P │ 3 (紅方兵位: a3, c3, e3, g3, i3)
 ├───┼───┼───┼───┼───┼───┼───┼───┼───┤
2│ · │ C │ · │ · │ · │ · │ · │ C │ · │ 2 (紅方炮位: b2, h2)
 ├───┼───┼───┼───┼───┼───┼───┼───┼───┤
1│ · │ · │ · │ · │ · │ · │ · │ · │ · │ 1
 ├───┼───┼───┼───┼───┼───┼───┼───┼───┤
0│ R │ N │ B │ A │ K │ A │ B │ N │ R │ 0 (紅方底線: 俥傌相仕帥仕相傌俥)
 └───┴───┴───┴───┴───┴───┴───┴───┴───┘
   a   b   c   d   e   f   g   h   i
```

---

## 2. FEN (Forsyth-Edwards Notation) 規格

### 2.1 標準開局 FEN 字串
```text
rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1
```

### 2.2 FEN 各列拆解對照表 (由黑方底線 Rank 9 往紅方底線 Rank 0 解析)

| FEN 區段順序 | 對應盤面 Rank | 標準 FEN 字串片段 | 代表棋子分佈 |
| :---: | :---: | :--- | :--- |
| 第 1 區段 | Rank 9 (黑方底線) | `rnbakabnr` | a9=r, b9=n, c9=b, d9=a, e9=k, f9=a, g9=b, h9=n, i9=r |
| 第 2 區段 | Rank 8 | `9` | 9 格全空 |
| 第 3 區段 | Rank 7 (黑方砲位) | `1c5c1` | 1 空格, b7=c, 5 空格, h7=c, 1 空格 |
| 第 4 區段 | Rank 6 (黑方卒位) | `p1p1p1p1p` | a6=p, c6=p, e6=p, g6=p, i6=p |
| 第 5 區段 | Rank 5 (楚河邊界) | `9` | 9 格全空 |
| 第 6 區段 | Rank 4 (漢界邊界) | `9` | 9 格全空 |
| 第 7 區段 | Rank 3 (紅方兵位) | `P1P1P1P1P` | a3=P, c3=P, e3=P, g3=P, i3=P |
| 第 8 區段 | Rank 2 (紅方炮位) | `1C5C1` | 1 空格, b2=C, 5 空格, h2=C, 1 空格 |
| 第 9 區段 | Rank 1 | `9` | 9 格全空 |
| 第 10 區段 | Rank 0 (紅方底線) | `RNBAKABNR` | a0=R, b0=N, c0=B, d0=A, e0=K, f0=A, g0=B, h0=N, i0=R |

---

## 3. 棋子代號速查表 (傳統 vs 變體)

* **紅方（Red）**：全大寫字母 (Uppercase)
* **黑方（Black）**：全小寫字母 (Lowercase)

| 棋子名稱（紅 / 黑） | 傳統代號 | 升級型態 | 變體代號 | Cost | 特殊能力 |
| :--- | :---: | :--- | :---: | :---: | :--- |
| **俥 / 車** (Chariot) | `R` / `r` | *(無升級)* | - | - | 直線任意格走吃。 |
| **傌 / 馬** (Horse) | `N` / `n` | **天馬** | **`U` / `u`** | 3 | 如西洋棋 Knight，不別馬腳。 |
| **相 / 象** (Elephant) | `B` / `b` | **飛象** | **`F` / `f`** | 2 | 田字斜跳，可跨越楚河漢界。 |
| **仕 / 士** (Advisor) | `A` / `a` | *(無升級)* | - | - | 九宮格內斜走一格。 |
| **帥 / 將** (General) | `K` / `k` | *(無升級)* | - | - | 九宮格內直橫走一格，不得王見王。 |
| **炮 / 砲** (Cannon) | `C` / `c` | **霰彈砲** | **`M` / `m`** | 3 | 平時走車，遠程隔一子跳吃，敵軍貼身時解鎖近戰直接吃子。 |
| **兵 / 卒** (Soldier) | `P` / `p` | **突擊兵** | **`S` / `s`** | 1 | 未過河前即具備左右橫移能力。 |

---

## 4. 座標與索引轉換公式 (Code Snippets)

在前後端程式碼中，統一以 2D 矩陣陣列表示盤面：`board[row][col]`，其中 `row` 範圍 `0` ~ `9`，`col` 範圍 `0` ~ `8`。

### 4.1 TypeScript (前端) 座標轉換函式

```typescript
// services/coordinate.ts

export interface Position {
  col: number; // 0 = 'a', 8 = 'i'
  row: number; // 0 = Rank 0 (紅底), 9 = Rank 9 (黑底)
}

/** 將 UCI 座標 (如 "b0", "c2") 轉為數值 (col, row) */
export function uciToPos(uci: string): Position {
  const col = uci.charCodeAt(0) - 97; // 'a'.charCodeAt(0) === 97
  const row = parseInt(uci.charAt(1), 10);
  return { col, row };
}

/** 將數值 (col, row) 轉為 UCI 座標 (如 "b0") */
export function posToUci(pos: Position): string {
  const file = String.fromCharCode(97 + pos.col);
  return `${file}${pos.row}`;
}

/** 畫布渲染坐標計算 (含視角翻轉) */
export function posToPixel(
  pos: Position,
  cellSize: number,
  padding: number,
  isFlipped: boolean = false // true 代表玩家執黑，黑方在下方
): { x: number; y: number } {
  let displayCol = pos.col;
  let displayRow = pos.row;

  if (isFlipped) {
    // 翻轉視角：黑方 Rank 9 顯示在最下方 (displayRow = 0)，Rank 0 在上方
    displayCol = 8 - pos.col;
    displayRow = pos.row;
  } else {
    // 預設視角：紅方 Rank 0 顯示在最下方 (Y 軸反轉)
    displayRow = 9 - pos.row;
  }

  const x = displayCol * cellSize + padding;
  const y = displayRow * cellSize + padding;
  return { x, y };
}
```

### 4.2 TypeScript (前後端共用) 替換與生成變體 FEN

```typescript
// shared/fen.ts

// 標準開局 10 個 Rank 的純字元展開 (全為 90 格的二維矩陣，'.' 代表空格)
const DEFAULT_RANKS = [
  'rnbakabnr', // Rank 9 (黑方底線)
  '.........', // Rank 8
  '.c.....c.', // Rank 7 (黑方砲位)
  'p.p.p.p.p', // Rank 6 (黑方卒位)
  '.........', // Rank 5
  '.........', // Rank 4
  'P.P.P.P.P', // Rank 3 (紅方兵位)
  '.C.....C.', // Rank 2 (紅方炮位)
  '.........', // Rank 1
  'RNBAKABNR', // Rank 0 (紅方底線)
];

/**
 * 根據升級配置 (loadouts) 替換棋子並生成變體 FEN 字串
 */
export function generateVariantFen(
  loadouts: Array<{ position: string; upgradeChar: string }>,
  currentTurn: 'w' | 'b' = 'w'
): string {
  // 建立 10x9 字元矩陣副本
  const board: string[][] = DEFAULT_RANKS.map((row) => row.split(''));

  // 套用雙方升級棋子
  for (const { position, upgradeChar } of loadouts) {
    const col = position.charCodeAt(0) - 97; // 0 ~ 8
    const rank = parseInt(position.charAt(1), 10); // 0 ~ 9
    const rowIndex = 9 - rank; // 陣列 row 0 代表 Rank 9
    board[rowIndex][col] = upgradeChar;
  }

  // 將二維矩陣壓縮為 FEN 格式 (連綿的 '.' 壓縮為數字)
  const fenRanks = board.map((row) => {
    return row
      .join('')
      .replace(/\.+/g, (dots) => dots.length.toString());
  });

  // 拼接走棋方與回合資訊
  return `${fenRanks.join('/')} ${currentTurn} - - 0 1`;
}
```
