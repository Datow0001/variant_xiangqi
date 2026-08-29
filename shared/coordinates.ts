import { Move } from './types';

export interface Position {
  col: number; // 0 ('a') ~ 8 ('i')
  row: number; // 0 (紅底線) ~ 9 (黑底線)
}

/** 將 UCI 座標 (如 "b0", "c2") 轉為數值 { col, row } */
export function uciToPos(uci: string): Position {
  if (uci.length < 2) {
    throw new Error(`Invalid UCI coordinate: ${uci}`);
  }
  const col = uci.charCodeAt(0) - 97; // 'a'.charCodeAt(0) === 97
  const row = parseInt(uci.substring(1), 10);
  return { col, row };
}

/** 將數值 { col, row } 轉為 UCI 座標 (如 "b0") */
export function posToUci(col: number, row: number): string {
  const file = String.fromCharCode(97 + col);
  return `${file}${row}`;
}

/** 檢驗字串是否為合法的 9x10 象棋 UCI 坐標 */
export function isValidUci(uci: string): boolean {
  if (!uci || uci.length !== 2) return false;
  const colChar = uci.charAt(0);
  const rowChar = uci.charAt(1);
  return colChar >= 'a' && colChar <= 'i' && rowChar >= '0' && rowChar <= '9';
}

/**
 * 系統坐標 (Rank 0~9, 如 "b0") 轉換為 Fairy-Stockfish UCI 引擎坐標 (Rank 1~10, 如 "b1")
 */
export function appToEngineSquare(appSquare: string): string {
  const col = appSquare.charAt(0);
  const rank = parseInt(appSquare.substring(1), 10);
  return `${col}${rank + 1}`;
}

/**
 * Fairy-Stockfish UCI 引擎坐標 (Rank 1~10, 如 "b1", "b10") 轉換為 系統坐標 (Rank 0~9, 如 "b0", "b9")
 */
export function engineToAppSquare(engineSquare: string): string {
  const col = engineSquare.charAt(0);
  const rank = parseInt(engineSquare.substring(1), 10);
  return `${col}${rank - 1}`;
}

/**
 * 將系統 Move ({ from: 'b0', to: 'c2' }) 轉為引擎 UCI 走步字串 (例如 "b1c3")
 */
export function appToEngineMove(move: Move): string {
  return `${appToEngineSquare(move.from)}${appToEngineSquare(move.to)}`;
}

/**
 * 將引擎輸出的走步字串 (例如 "b1c3" 或 "b10b9") 解析轉為系統 Move ({ from: 'b0', to: 'c2' })
 */
export function engineToAppMove(engineMove: string): Move {
  // 格式可能是 "b1c3", "b1c10", "b10b9", "b10b10"
  const match = engineMove.match(/^([a-i]\d+)([a-i]\d+)$/);
  if (!match) {
    throw new Error(`Invalid engine move string: ${engineMove}`);
  }
  return {
    from: engineToAppSquare(match[1]),
    to: engineToAppSquare(match[2]),
  };
}

/**
 * 畫布像素座標換算 (支援執黑 180 度翻轉視角)
 */
export function posToPixel(
  col: number,
  row: number,
  cellSize: number,
  padding: number,
  isFlipped: boolean = false
): { x: number; y: number } {
  let displayCol = col;
  let displayRow = row;

  if (isFlipped) {
    displayCol = 8 - col;
    displayRow = row;
  } else {
    displayRow = 9 - row;
  }

  const x = displayCol * cellSize + padding;
  const y = displayRow * cellSize + padding;
  return { x, y };
}
