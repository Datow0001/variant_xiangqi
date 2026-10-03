import { LoadoutItem, UPGRADES } from './types';
import { getAiLoadout } from './stages';
import { uciToPos } from './coordinates';

export const DEFAULT_XIANGQI_FEN =
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

// 10 個 Rank 的展開矩陣 (Rank 9 到 Rank 0)
const INITIAL_RANKS: string[] = [
  'rnbakabnr', // Rank 9 (黑底)
  '.........', // Rank 8
  '.c.....c.', // Rank 7 (黑砲)
  'p.p.p.p.p', // Rank 6 (黑卒)
  '.........', // Rank 5
  '.........', // Rank 4
  'P.P.P.P.P', // Rank 3 (紅兵)
  '.C.....C.', // Rank 2 (紅炮)
  '.........', // Rank 1
  'RNBAKABNR', // Rank 0 (紅底)
];

/** Validate authored starting positions, not proof of historical reachability. */
export function validateInitialFen(fen: string): void {
  if (typeof fen !== 'string' || fen.length > 300 || /[\r\n]/.test(fen)) throw new Error('Invalid FEN');
  const parts = fen.trim().split(/\s+/);
  if (parts.length !== 6 || !['w', 'b'].includes(parts[1]) || parts[2] !== '-' || parts[3] !== '-' ||
      !/^\d+$/.test(parts[4]) || !/^[1-9]\d*$/.test(parts[5]) ||
      !Number.isSafeInteger(Number(parts[4])) || !Number.isSafeInteger(Number(parts[5]))) throw new Error('Invalid FEN fields');
  const ranks = parts[0].split('/');
  if (ranks.length !== 10) throw new Error('FEN requires 10 ranks');
  for (const rank of ranks) {
    if (!/^[1-9rnbakcpufmsRNBAKCPUFMS]+$/.test(rank) || /\d\d/.test(rank)) throw new Error('Invalid FEN pieces');
    const width = [...rank].reduce((n, char) => n + (/\d/.test(char) ? Number(char) : 1), 0);
    if (width !== 9) throw new Error('FEN requires 9 files');
  }
  const board = fenToBoard(fen);
  for (const king of ['K', 'k']) {
    const positions = board.flatMap((rank, row) => rank.flatMap((piece, col) => piece === king ? [{ row, col }] : []));
    if (positions.length !== 1) throw new Error('Each side needs exactly one king');
    const { row, col } = positions[0];
    if (col < 3 || col > 5 || (king === 'K' ? row < 7 : row > 2)) throw new Error('King outside palace');
  }
  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
    const p = board[row][col];
    if ((p === 'A' || p === 'a') && (col < 3 || col > 5 || (p === 'A' ? row < 7 : row > 2))) throw new Error('Advisor outside palace');
    if ((p === 'B' && row < 5) || (p === 'b' && row > 4)) throw new Error('Traditional elephant crossed river');
  }
  const redRow = board.findIndex(rank => rank.includes('K'));
  const blackRow = board.findIndex(rank => rank.includes('k'));
  const file = board[redRow].indexOf('K');
  if (file === board[blackRow].indexOf('k') && board.slice(blackRow + 1, redRow).every(rank => rank[file] === '.')) throw new Error('Kings facing each other');
}

/**
 * 將 FEN 棋盤字串解析為 10x9 的二維字元陣列 (row 0 為 Rank 9，row 9 為 Rank 0)
 */
export function fenToBoard(fen: string): string[][] {
  const parts = fen.split(' ');
  const ranks = parts[0].split('/');
  const board: string[][] = [];

  for (const rankStr of ranks) {
    const row: string[] = [];
    for (let i = 0; i < rankStr.length; i++) {
      const char = rankStr[i];
      if (char >= '1' && char <= '9') {
        const emptyCount = parseInt(char, 10);
        for (let e = 0; e < emptyCount; e++) {
          row.push('.');
        }
      } else {
        row.push(char);
      }
    }
    board.push(row);
  }
  return board;
}

/**
 * 將 10x9 的二維字元陣列壓縮回 FEN 字串
 */
export function boardToFen(board: string[][], turn: 'w' | 'b' = 'w', halfmove = 0, fullmove = 1): string {
  if (board.length !== 10 || board.some(row => row.length !== 9)) throw new Error('Invalid board dimensions');
  const fenRanks = board.map((row) => {
    return row
      .join('')
      .replace(/\.+/g, (dots) => dots.length.toString());
  });
  return `${fenRanks.join('/')} ${turn} - - ${halfmove} ${fullmove}`;
}

/** Apply server-validated upgrades to an authored challenge position. */
export function applyLoadoutsToFen(fen: string, loadouts: LoadoutItem[], color: 'red' | 'black'): string {
  const board = fenToBoard(fen);
  for (const item of loadouts) {
    const { col, row } = uciToPos(item.position);
    board[9 - row][col] = color === 'red' ? UPGRADES[item.upgradeId].symbolRed : UPGRADES[item.upgradeId].symbolBlack;
  }
  const fields = fen.split(' ');
  return boardToFen(board, fields[1] as 'w' | 'b', Number(fields[4]), Number(fields[5]));
}

/**
 * 根據玩家陣容與 AI 關卡陣容，生成開局的自訂變體 FEN 字串
 */
export function generateInitialFen(
  playerColor: 'red' | 'black',
  playerLoadouts: LoadoutItem[],
  aiStageId: 1 | 2 | 3
): { fen: string; aiLoadouts: LoadoutItem[] } {
  // 建立乾淨的 10x9 棋盤陣列
  const board: string[][] = INITIAL_RANKS.map((r) => r.split(''));

  // 1. 套用玩家升級
  for (const item of playerLoadouts) {
    const { col, row } = uciToPos(item.position);
    const rowIndex = 9 - row; // row 0 轉為 rowIndex 9
    const upgrade = UPGRADES[item.upgradeId];
    if (upgrade) {
      board[rowIndex][col] = playerColor === 'red' ? upgrade.symbolRed : upgrade.symbolBlack;
    }
  }

  // 2. 套用 AI 關卡升級
  const aiColor = playerColor === 'red' ? 'black' : 'red';
  const aiLoadouts = getAiLoadout(aiStageId, aiColor);
  for (const item of aiLoadouts) {
    const { col, row } = uciToPos(item.position);
    const rowIndex = 9 - row;
    const upgrade = UPGRADES[item.upgradeId];
    if (upgrade) {
      board[rowIndex][col] = aiColor === 'red' ? upgrade.symbolRed : upgrade.symbolBlack;
    }
  }

  const fen = boardToFen(board, 'w'); // 紅方永遠先手
  return { fen, aiLoadouts };
}

/**
 * 依據任意指定的紅方與黑方自訂陣容生成開局 FEN
 */
export function generateCustomFen(
  redLoadouts: LoadoutItem[],
  blackLoadouts: LoadoutItem[]
): string {
  const board: string[][] = INITIAL_RANKS.map((r) => r.split(''));

  for (const item of redLoadouts) {
    const { col, row } = uciToPos(item.position);
    const rowIndex = 9 - row;
    const upgrade = UPGRADES[item.upgradeId];
    if (upgrade) {
      board[rowIndex][col] = upgrade.symbolRed;
    }
  }

  for (const item of blackLoadouts) {
    const { col, row } = uciToPos(item.position);
    const rowIndex = 9 - row;
    const upgrade = UPGRADES[item.upgradeId];
    if (upgrade) {
      board[rowIndex][col] = upgrade.symbolBlack;
    }
  }

  return boardToFen(board, 'w');
}

/**
 * 在 FEN 盤面上執行一步棋並更新回合
 */
export function applyMoveToFen(fen: string, fromUci: string, toUci: string): string {
  const board = fenToBoard(fen);
  const fromPos = uciToPos(fromUci);
  const toPos = uciToPos(toUci);

  const fromRowIndex = 9 - fromPos.row;
  const toRowIndex = 9 - toPos.row;

  const piece = board[fromRowIndex][fromPos.col];
  if (piece === '.') throw new Error('No piece at source');
  const captured = board[toRowIndex][toPos.col] !== '.';
  board[fromRowIndex][fromPos.col] = '.';
  board[toRowIndex][toPos.col] = piece;

  const fields = fen.split(' ');
  const currentTurn = fields[1] === 'w' ? 'b' : 'w';
  const halfmove = captured || piece.toLowerCase() === 'p' || piece.toLowerCase() === 's' ? 0 : Number(fields[4]) + 1;
  const fullmove = Number(fields[5]) + (fields[1] === 'b' ? 1 : 0);
  return boardToFen(board, currentTurn, halfmove, fullmove);
}
