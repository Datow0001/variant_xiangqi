import * as os from 'os';
import { FairyEngine } from './FairyEngine';
import { generateCustomFen, applyMoveToFen, fenToBoard } from '../../shared/fen';
import { LoadoutItem } from '../../shared/types';

export interface GameResult {
  winner: 'red' | 'black' | 'draw';
  reason: 'CHECKMATE' | 'STALEMATE' | 'MAX_PLY' | 'REPETITION';
  totalPly: number;
  earlyCaptures: string[];
}

export interface ExperimentStats {
  name: string;
  totalGames: number;
  redWins: number;
  blackWins: number;
  draws: number;
  avgPly: number;
  earlyDecapitations: number; // < 15 步結束
}

/**
 * 執行單場自我對弈 (在單一 Engine 實例上快速完成)
 */
export async function playGame(
  engine: FairyEngine,
  startFen: string,
  movetimeMs: number = 10,
  maxPly: number = 120
): Promise<GameResult> {
  let currentFen = startFen;
  const fenHistory = new Map<string, number>();
  const earlyCaptures: string[] = [];

  fenHistory.set(currentFen.split(' ')[0], 1);

  for (let ply = 1; ply <= maxPly; ply++) {
    const isRedTurn = currentFen.split(' ')[1] === 'w';

    const bestMove = await engine.getBestMove(currentFen, movetimeMs);

    if (!bestMove) {
      const isCheck = await engine.isCheck(currentFen);
      const winner = isRedTurn ? 'black' : 'red';
      const reason = isCheck ? 'CHECKMATE' : 'STALEMATE';
      return {
        winner,
        reason,
        totalPly: ply - 1,
        earlyCaptures,
      };
    }

    if (ply <= 6) {
      const board = fenToBoard(currentFen);
      const toCol = bestMove.to.charCodeAt(0) - 97;
      const toRow = 9 - parseInt(bestMove.to.substring(1), 10);
      const targetPiece = board[toRow]?.[toCol];
      if (targetPiece && targetPiece !== '.') {
        earlyCaptures.push(
          `Ply ${ply} (${isRedTurn ? 'Red' : 'Black'}): ${bestMove.from}->${bestMove.to} 吃了 ${targetPiece}`
        );
      }
    }

    currentFen = applyMoveToFen(currentFen, bestMove.from, bestMove.to);

    const boardKey = currentFen.split(' ')[0];
    const repCount = (fenHistory.get(boardKey) || 0) + 1;
    fenHistory.set(boardKey, repCount);

    if (repCount >= 3) {
      return {
        winner: 'draw',
        reason: 'REPETITION',
        totalPly: ply,
        earlyCaptures,
      };
    }
  }

  return {
    winner: 'draw',
    reason: 'MAX_PLY',
    totalPly: maxPly,
    earlyCaptures,
  };
}

/**
 * 平行化對弈池 (Parallel Engine Pool) 批次執行實驗
 */
export async function runParallelExperiment(
  engines: FairyEngine[],
  name: string,
  loadoutsSideA: LoadoutItem[],
  loadoutsSideB: LoadoutItem[],
  totalGames: number,
  movetimeMs: number = 10
): Promise<ExperimentStats> {
  console.log(`\n======================================================`);
  console.log(`🔬 啟動平行實驗：【${name}】`);
  console.log(`   * 總場次: ${totalGames} 場 | 平行 Worker: ${engines.length} 個 | 思考限時: ${movetimeMs}ms/步`);
  console.log(`======================================================`);

  const isMirror = loadoutsSideA === loadoutsSideB;
  const halfGames = Math.floor(totalGames / 2);

  // 預先生成所有對局的初始 FEN (後半場強制紅黑互換)
  const gameFens: string[] = [];
  for (let i = 1; i <= totalGames; i++) {
    const isSwapped = !isMirror && i > halfGames;
    const redLoadouts = isSwapped ? loadoutsSideB : loadoutsSideA;
    const blackLoadouts = isSwapped ? loadoutsSideA : loadoutsSideB;
    gameFens.push(generateCustomFen(redLoadouts, blackLoadouts));
  }

  let completed = 0;
  let redWins = 0;
  let blackWins = 0;
  let draws = 0;
  let totalPlySum = 0;
  let earlyDecapitations = 0;

  const startTime = Date.now();
  let taskIndex = 0;

  async function workerLoop(workerEngine: FairyEngine, workerId: number) {
    while (true) {
      const currentIndex = taskIndex++;
      if (currentIndex >= totalGames) {
        break;
      }

      const fen = gameFens[currentIndex];
      const result = await playGame(workerEngine, fen, movetimeMs);

      completed++;
      totalPlySum += result.totalPly;
      if (result.winner === 'red') redWins++;
      else if (result.winner === 'black') blackWins++;
      else draws++;

      if (result.totalPly < 15) {
        earlyDecapitations++;
        if (result.earlyCaptures.length > 0) {
          console.log(`\n🚨 [Worker ${workerId}] 偵測到早夭局 (回合: ${result.totalPly}): ${result.earlyCaptures.join('; ')}`);
        }
      }

      // 定期刷新進度列
      if (completed % 10 === 0 || completed === totalGames) {
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
        const percent = ((completed / totalGames) * 100).toFixed(1);
        const speed = (completed / Math.max(0.1, Date.now() - startTime) * 1000).toFixed(1);
        process.stdout.write(
          `\r▶ 並行對弈中 [${completed}/${totalGames}] (${percent}%) | 紅勝: ${redWins} 黑勝: ${blackWins} 和: ${draws} | 耗時: ${elapsedSec}s (${speed} 場/秒)`
        );
      }
    }
  }

  // 同時啟動所有 Worker
  await Promise.all(engines.map((eng, id) => workerLoop(eng, id + 1)));

  const totalTimeSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ 實驗完成！總耗時: ${totalTimeSec} 秒`);

  return {
    name,
    totalGames,
    redWins,
    blackWins,
    draws,
    avgPly: Math.round(totalPlySum / totalGames),
    earlyDecapitations,
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

    const redWinNum = parseFloat(redRate);
    const earlyNum = parseFloat(earlyRate);

    const isFirstMoveBiased = redWinNum > 65.0;
    const isDecapitationRisk = earlyNum > 5.0;

    console.log(`  * 平衡性紅線檢核 (對照 PIECE_BALANCE_TESTING.md):`);
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
  const workersArg = args.find((a) => a.startsWith('--concurrency='));
  const timeArg = args.find((a) => a.startsWith('--movetime='));

  const totalGames = gamesArg ? parseInt(gamesArg.split('=')[1], 10) : 1000;
  const numWorkers = workersArg
    ? parseInt(workersArg.split('=')[1], 10)
    : Math.min(8, Math.max(2, os.cpus().length - 2));
  const movetimeMs = timeArg ? parseInt(timeArg.split('=')[1], 10) : 10;

  console.log(`⚡ 啟動 1000 場大量自我對弈壓力測試...`);
  console.log(`系統邏輯核心數: ${os.cpus().length} | 啟用 Worker: ${numWorkers} 個進程並行`);
  console.log(`總測試場次: ${totalGames} 場 | 思考限時: ${movetimeMs}ms/步`);

  // 初始化並行 Worker 進程池
  process.stdout.write(`正在初始化 ${numWorkers} 個 Fairy-Stockfish Largeboard 引擎進程... `);
  const engines: FairyEngine[] = [];
  for (let i = 0; i < numWorkers; i++) {
    engines.push(new FairyEngine());
  }
  await Promise.all(engines.map((e) => e.waitReady()));
  console.log(`全部 Ready！\n`);

  try {
    const statsList: ExperimentStats[] = [];

    // 實驗 1：對稱鏡像組 (500 場)
    const mirrorMortars: LoadoutItem[] = [
      { position: 'b2', upgradeId: 'PO_JI_PAO' },
      { position: 'h2', upgradeId: 'PO_JI_PAO' },
    ];
    const mirrorMortarsBlack: LoadoutItem[] = [
      { position: 'b7', upgradeId: 'PO_JI_PAO' },
      { position: 'h7', upgradeId: 'PO_JI_PAO' },
    ];
    const mirrorGames = Math.floor(totalGames / 2); // 500 場
    const stat1 = await runParallelExperiment(
      engines,
      `實驗 A：迫擊砲鏡像對抗 (雙迫擊砲 vs 雙迫擊砲)`,
      mirrorMortars,
      mirrorMortarsBlack,
      mirrorGames,
      movetimeMs
    );
    statsList.push(stat1);

    // 實驗 2：等點交叉對抗組 (500 場，雙迫擊砲 6pt vs 雙天馬 6pt，紅黑各半)
    const teamTianMaBlack: LoadoutItem[] = [
      { position: 'b9', upgradeId: 'TIAN_MA' },
      { position: 'h9', upgradeId: 'TIAN_MA' },
    ];
    const crossGames = totalGames - mirrorGames; // 500 場
    const stat2 = await runParallelExperiment(
      engines,
      `實驗 B：等點兵種交叉對抗 (雙迫擊砲 6pt vs 雙天馬 6pt，紅黑互換各半)`,
      mirrorMortars,
      teamTianMaBlack,
      crossGames,
      movetimeMs
    );
    statsList.push(stat2);

    // 印出最終統計報告
    printEvaluationReport(statsList);
  } finally {
    for (const eng of engines) {
      eng.destroy();
    }
  }
}

main();
