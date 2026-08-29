import { FairyEngine } from './FairyEngine';
import { generateCustomFen, applyMoveToFen, fenToBoard } from '../../shared/fen';
import { LoadoutItem } from '../../shared/types';

export interface GameResult {
  winner: 'red' | 'black' | 'draw';
  reason: 'CHECKMATE' | 'STALEMATE' | 'MAX_PLY' | 'REPETITION';
  totalPly: number;
  moves: Array<{ from: string; to: string }>;
  earlyCaptures: string[]; // 前 6 步發生的吃子紀錄
}

export interface ExperimentStats {
  name: string;
  totalGames: number;
  redWins: number;
  blackWins: number;
  draws: number;
  avgPly: number;
  earlyDecapitations: number; // < 15 步結束
  first5MovesPieces: Record<string, number>;
}

/**
 * 執行單場自我對弈
 */
export async function playGame(
  engine: FairyEngine,
  startFen: string,
  movetimeMs: number = 15,
  maxPly: number = 120
): Promise<GameResult> {
  let currentFen = startFen;
  const historyMoves: Array<{ from: string; to: string }> = [];
  const fenHistory = new Map<string, number>();
  const earlyCaptures: string[] = [];

  fenHistory.set(currentFen.split(' ')[0], 1);

  for (let ply = 1; ply <= maxPly; ply++) {
    const isRedTurn = currentFen.split(' ')[1] === 'w';

    // 檢查盤面是否有合法步與最佳步
    const bestMove = await engine.getBestMove(currentFen, movetimeMs);

    if (!bestMove) {
      // 走棋方無子可動 -> 判負
      const isCheck = await engine.isCheck(currentFen);
      const winner = isRedTurn ? 'black' : 'red';
      const reason = isCheck ? 'CHECKMATE' : 'STALEMATE';
      return {
        winner,
        reason,
        totalPly: ply - 1,
        moves: historyMoves,
        earlyCaptures,
      };
    }

    // 檢查是否吃子
    if (ply <= 6) {
      const board = fenToBoard(currentFen);
      const toCol = bestMove.to.charCodeAt(0) - 97;
      const toRow = 9 - parseInt(bestMove.to.substring(1), 10);
      const targetPiece = board[toRow]?.[toCol];
      if (targetPiece && targetPiece !== '.') {
        earlyCaptures.push(
          `Ply ${ply} (${isRedTurn ? 'Red' : 'Black'}): ${bestMove.from} -> ${bestMove.to} 吃了 ${targetPiece}`
        );
      }
    }

    // 套用走步
    currentFen = applyMoveToFen(currentFen, bestMove.from, bestMove.to);
    historyMoves.push(bestMove);

    // 三次重複局面判和檢測
    const boardKey = currentFen.split(' ')[0];
    const repCount = (fenHistory.get(boardKey) || 0) + 1;
    fenHistory.set(boardKey, repCount);

    if (repCount >= 3) {
      return {
        winner: 'draw',
        reason: 'REPETITION',
        totalPly: ply,
        moves: historyMoves,
        earlyCaptures,
      };
    }
  }

  return {
    winner: 'draw',
    reason: 'MAX_PLY',
    totalPly: maxPly,
    moves: historyMoves,
    earlyCaptures,
  };
}

/**
 * 執行一組對抗實驗並統計數據
 */
export async function runExperiment(
  engine: FairyEngine,
  name: string,
  loadoutsSideA: LoadoutItem[], // 陣容 A (例如新棋子)
  loadoutsSideB: LoadoutItem[], // 陣容 B (例如天馬或標準棋)
  totalGames: number = 20,
  movetimeMs: number = 15
): Promise<ExperimentStats> {
  console.log(`\n======================================================`);
  console.log(`🔬 開始測試實驗：【${name}】 (總場次: ${totalGames} 場)`);
  console.log(`======================================================`);

  let redWins = 0;
  let blackWins = 0;
  let draws = 0;
  let totalPlySum = 0;
  let earlyDecapitations = 0;
  const pieceMoveCounts: Record<string, number> = {};

  const isMirror = loadoutsSideA === loadoutsSideB;
  const halfGames = Math.floor(totalGames / 2);

  for (let i = 1; i <= totalGames; i++) {
    // 若不是鏡像對決，前後半場強制「紅黑互換」以排除先手優勢誤差
    const isSwapped = !isMirror && i > halfGames;
    const redLoadouts = isSwapped ? loadoutsSideB : loadoutsSideA;
    const blackLoadouts = isSwapped ? loadoutsSideA : loadoutsSideB;

    const startFen = generateCustomFen(redLoadouts, blackLoadouts);
    process.stdout.write(`\r▶ 正在對弈 [場次 ${i}/${totalGames}]... `);

    const result = await playGame(engine, startFen, movetimeMs);

    totalPlySum += result.totalPly;
    if (result.winner === 'red') redWins++;
    else if (result.winner === 'black') blackWins++;
    else draws++;

    if (result.totalPly < 15) {
      earlyDecapitations++;
      if (result.earlyCaptures.length > 0) {
        console.log(`\n⚠️ 偵測到早夭局 (回合數: ${result.totalPly})，前 6 步吃子: ${result.earlyCaptures.join('; ')}`);
      }
    }

    // 統計前 5 步動用的起始格
    for (let p = 0; p < Math.min(5, result.moves.length); p++) {
      const from = result.moves[p].from;
      pieceMoveCounts[from] = (pieceMoveCounts[from] || 0) + 1;
    }
  }

  process.stdout.write(`完成！\n`);

  return {
    name,
    totalGames,
    redWins,
    blackWins,
    draws,
    avgPly: Math.round(totalPlySum / totalGames),
    earlyDecapitations,
    first5MovesPieces: pieceMoveCounts,
  };
}

/**
 * 列印格式化平衡性診斷報告
 */
export function printEvaluationReport(statsList: ExperimentStats[]) {
  console.log(`\n======================================================`);
  console.log(`📊 變體新棋子平衡性測試綜合分析報告 (Self-Play Report)`);
  console.log(`======================================================\n`);

  for (const stats of statsList) {
    const redRate = ((stats.redWins / stats.totalGames) * 100).toFixed(1);
    const blackRate = ((stats.blackWins / stats.totalGames) * 100).toFixed(1);
    const drawRate = ((stats.draws / stats.totalGames) * 100).toFixed(1);
    const earlyRate = ((stats.earlyDecapitations / stats.totalGames) * 100).toFixed(1);

    console.log(`【${stats.name}】`);
    console.log(`  * 總局數: ${stats.totalGames} 場 | 平均步數: ${stats.avgPly} 回合`);
    console.log(`  * 紅勝率: ${redRate}% (${stats.redWins}) | 黑勝率: ${blackRate}% (${stats.blackWins}) | 和棋: ${drawRate}% (${stats.draws})`);
    console.log(`  * 早夭短局 (<15步): ${stats.earlyDecapitations} 場 (${earlyRate}%)`);

    // 依據 PIECE_BALANCE_TESTING.md 進行自動診斷
    const redWinNum = parseFloat(redRate);
    const earlyNum = parseFloat(earlyRate);

    const isFirstMoveBiased = redWinNum > 65.0;
    const isDecapitationRisk = earlyNum > 5.0;

    console.log(`  * 平衡性紅線檢核:`);
    console.log(`    - 先手勝率檢測 (門檻 <= 65%): ${isFirstMoveBiased ? '❌ 超標 (先手過強)' : '✅ 通過'}`);
    console.log(`    - 早夭斬首檢測 (門檻 <= 5%):  ${isDecapitationRisk ? '❌ 異常 (存在秒殺盲區)' : '✅ 通過'}`);

    if (!isFirstMoveBiased && !isDecapitationRisk) {
      console.log(`  👉 綜合判定: 🟢 【通過平衡性驗證 (BALANCED)】`);
    } else {
      console.log(`  👉 綜合判定: 🚨 【觸發過強警戒 (OVERPOWERED)，需調低射程或調高費用】`);
    }
    console.log('');
  }
}

// 主執行入口
async function main() {
  const args = process.argv.slice(2);
  const gamesArg = args.find((a) => a.startsWith('--games='));
  const gamesCount = gamesArg ? parseInt(gamesArg.split('=')[1], 10) : 20;

  console.log(`🎮 啟動 Fairy-Stockfish 變體象棋自我對弈壓力測試器...`);
  console.log(`預設每組實驗場次: ${gamesCount} 場 (可在指令加上 --games=50 調整)`);

  const engine = new FairyEngine();
  await engine.waitReady();

  try {
    const statsList: ExperimentStats[] = [];

    // 實驗 1：對稱鏡像組 (測試自衛迫擊砲雙方對撞，看先手勝率是否平穩)
    const mirrorMortars: LoadoutItem[] = [
      { position: 'b2', upgradeId: 'PO_JI_PAO' },
      { position: 'h2', upgradeId: 'PO_JI_PAO' },
    ];
    const mirrorMortarsBlack: LoadoutItem[] = [
      { position: 'b7', upgradeId: 'PO_JI_PAO' },
      { position: 'h7', upgradeId: 'PO_JI_PAO' },
    ];
    const stat1 = await runExperiment(
      engine,
      '實驗 A：迫擊砲鏡像對抗 (雙迫擊砲 vs 雙迫擊砲)',
      mirrorMortars,
      mirrorMortarsBlack,
      gamesCount,
      15
    );
    statsList.push(stat1);

    // 實驗 2：等點兵種對抗組 (雙迫擊砲 6pt vs 雙天馬 6pt)
    const teamTianMaBlack: LoadoutItem[] = [
      { position: 'b9', upgradeId: 'TIAN_MA' },
      { position: 'h9', upgradeId: 'TIAN_MA' },
    ];
    const stat2 = await runExperiment(
      engine,
      '實驗 B：等點交叉對抗 (雙迫擊砲 6pt vs 雙天馬 6pt，紅黑互換)',
      mirrorMortars,
      teamTianMaBlack,
      gamesCount,
      15
    );
    statsList.push(stat2);

    // 實驗 3：純傳統基準組 (雙迫擊砲 6pt vs 純傳統 0pt)
    const stat3 = await runExperiment(
      engine,
      '實驗 C：純傳統防守基準 (雙迫擊砲 6pt vs 純傳統象棋 0pt，紅黑互換)',
      mirrorMortars,
      [],
      gamesCount,
      15
    );
    statsList.push(stat3);

    // 印出最終統計報告
    printEvaluationReport(statsList);
  } finally {
    engine.destroy();
  }
}

main();
