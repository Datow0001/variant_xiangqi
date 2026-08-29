import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Move } from '../../shared/types';
import { engineToAppMove } from '../../shared/coordinates';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class FairyEngine {
  private process: ChildProcessWithoutNullStreams;
  private rl: readline.Interface;
  private isReady: boolean = false;
  private initPromise: Promise<void>;

  constructor(
    enginePath?: string,
    variantPath?: string,
    variantName: string = 'customxiangqi'
  ) {
    const resolvedEnginePath =
      enginePath ||
      path.resolve(__dirname, '../../engine/fairy-stockfish-largeboard_x86-64.exe');
    const resolvedVariantPath =
      variantPath || path.resolve(__dirname, '../../variants.ini');

    this.process = spawn(resolvedEnginePath);
    this.rl = readline.createInterface({ input: this.process.stdout });

    // 持續消化 stderr 避免緩衝區塞滿
    this.process.stderr.on('data', () => {});

    // 初始化引擎與變體
    this.initPromise = new Promise((resolve, reject) => {
      const initTimer = setTimeout(() => {
        reject(new Error('ENGINE_INIT_TIMEOUT: Fairy-Stockfish failed to respond readyok.'));
      }, 5000);

      const onLine = (line: string) => {
        if (line === 'readyok') {
          clearTimeout(initTimer);
          this.rl.removeListener('line', onLine);
          this.isReady = true;
          resolve();
        }
      };

      this.rl.on('line', onLine);
      this.send('uci');
      this.send(`setoption name VariantPath value ${resolvedVariantPath}`);
      this.send(`setoption name UCI_Variant value ${variantName}`);
      this.send('isready');
    });
  }

  public async waitReady(): Promise<void> {
    await this.initPromise;
  }

  public send(cmd: string): void {
    this.process.stdin.write(`${cmd}\n`);
  }

  /**
   * 計算並取得 AI 最佳走步
   * @param fen 當前盤面 FEN
   * @param movetimeMs 思考時限 (毫秒)
   */
  public async getBestMove(fen: string, movetimeMs: number): Promise<Move | null> {
    await this.waitReady();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rl.removeListener('line', onLine);
        reject(new Error(`ENGINE_TIMEOUT: No bestmove received within ${movetimeMs + 2000}ms`));
      }, movetimeMs + 2000);

      const onLine = (line: string) => {
        if (line.startsWith('bestmove ')) {
          clearTimeout(timer);
          this.rl.removeListener('line', onLine);
          const parts = line.split(' ');
          const moveStr = parts[1];

          // (none) 或 0000 代表將死或困斃無子可動
          if (!moveStr || moveStr === '(none)' || moveStr === '0000') {
            resolve(null);
          } else {
            try {
              const move = engineToAppMove(moveStr);
              resolve(move);
            } catch (err) {
              reject(err);
            }
          }
        }
      };

      this.rl.on('line', onLine);
      this.send(`position fen ${fen}`);
      this.send(`go movetime ${movetimeMs}`);
    });
  }

  /**
   * 查詢當前盤面所有合法走步 (呼叫 perft 1，並將 1-based 坐標轉回 0-based 系統坐標)
   */
  public async getLegalMoves(fen: string): Promise<Move[]> {
    await this.waitReady();

    return new Promise((resolve, reject) => {
      const moves: Move[] = [];
      const timer = setTimeout(() => {
        this.rl.removeListener('line', onLine);
        reject(new Error('ENGINE_PERFT_TIMEOUT: Failed to get legal moves'));
      }, 3000);

      const onLine = (line: string) => {
        // perft 格式例如: "b1c3: 1" 或 "b10b9: 1"
        const match = line.match(/^([a-i]\d+)([a-i]\d+):/);
        if (match) {
          try {
            const move = engineToAppMove(`${match[1]}${match[2]}`);
            moves.push(move);
          } catch {
            // ignore invalid parsing
          }
        }

        if (line.startsWith('Nodes searched:') || line.startsWith('Total:')) {
          clearTimeout(timer);
          this.rl.removeListener('line', onLine);
          resolve(moves);
        }
      };

      this.rl.on('line', onLine);
      this.send(`position fen ${fen}`);
      this.send('go perft 1');
    });
  }

  /**
   * 檢查當前盤面是否處於將軍狀態
   */
  public async isCheck(fen: string): Promise<boolean> {
    await this.waitReady();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rl.removeListener('line', onLine);
        reject(new Error('ENGINE_D_TIMEOUT: Failed to query checkers'));
      }, 3000);

      let isChecking = false;

      const onLine = (line: string) => {
        if (line.startsWith('Checkers:')) {
          const content = line.replace('Checkers:', '').trim();
          isChecking = content.length > 0;
          clearTimeout(timer);
          this.rl.removeListener('line', onLine);
          resolve(isChecking);
        }
      };

      this.rl.on('line', onLine);
      this.send(`position fen ${fen}`);
      this.send('d');
    });
  }

  /**
   * 關閉引擎進程
   */
  public destroy(): void {
    try {
      this.send('quit');
      this.process.kill();
    } catch {
      // ignore
    }
  }
}
