import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import * as readline from 'node:readline';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Move } from '../../shared/types';
import { engineToAppMove } from '../../shared/coordinates';
import { GameError } from './errors';

export interface EngineOptions {
  spawnProcess?: (binary: string) => ChildProcessWithoutNullStreams;
  initTimeoutMs?: number;
  queryTimeoutMs?: number;
  hashMb?: number;
  threads?: number;
}
export interface Engine {
  waitReady(): Promise<void>;
  getBestMove(fen: string, movetimeMs: number): Promise<Move | null>;
  getLegalMoves(fen: string): Promise<Move[]>;
  isCheck(fen: string): Promise<boolean>;
  destroy(): void;
  onFailure?: (error: GameError) => void;
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export class FairyEngine implements Engine {
  private process: ChildProcessWithoutNullStreams;
  private rl: readline.Interface;
  private initPromise: Promise<void>;
  private failure: GameError | null = null;
  private destroyed = false;
  private tail: Promise<unknown> = Promise.resolve();
  private cancelActive?: (error: GameError) => void;
  public onFailure?: (error: GameError) => void;

  constructor(enginePath?: string, variantPath?: string, variantName = 'customxiangqi', private options: EngineOptions = {}) {
    const binary = enginePath || process.env.ENGINE_PATH || path.join(root, 'engine', process.platform === 'win32' ? 'fairy-stockfish-largeboard_x86-64.exe' : 'fairy-stockfish-largeboard_x86-64');
    const config = variantPath || process.env.VARIANT_PATH || path.join(root, 'variants.ini');
    this.process = (options.spawnProcess ?? (p => spawn(p)))(binary);
    this.rl = readline.createInterface({ input: this.process.stdout });
    this.process.stderr.on('data', () => {});
    this.process.on('error', () => this.fail(new GameError('ENGINE_UNAVAILABLE', '對弈引擎無法啟動')));
    this.process.on('exit', () => { if (!this.destroyed) this.fail(new GameError('ENGINE_EXITED', '對弈引擎意外停止')); });
    this.process.stdin.on('error', () => { if (!this.destroyed) this.fail(new GameError('ENGINE_UNAVAILABLE', '對弈引擎連線中斷')); });
    this.initPromise = this.readResponse<void>(options.initTimeoutMs ?? 5000, line => line === 'readyok' ? { value: undefined } : undefined, () => {
      this.send('uci');
      this.send(`setoption name VariantPath value ${config}`);
      this.send(`setoption name UCI_Variant value ${variantName}`);
      this.send(`setoption name Hash value ${Math.max(1, Math.min(256, options.hashMb ?? 16))}`);
      this.send(`setoption name Threads value ${Math.max(1, Math.min(4, options.threads ?? 1))}`);
      this.send('isready');
    }, 'ENGINE_INIT_TIMEOUT');
    void this.initPromise.catch(() => {});
  }
  public async waitReady(): Promise<void> { await this.initPromise; this.assertAlive(); }
  private assertAlive(): void { if (this.failure) throw this.failure; if (this.destroyed) throw new GameError('ENGINE_DESTROYED', '對弈引擎已關閉'); }
  public send(command: string): void {
    this.assertAlive();
    this.process.stdin.write(`${command}\n`, error => { if (error && !this.destroyed) this.fail(new GameError('ENGINE_UNAVAILABLE', '對弈引擎寫入失敗')); });
  }
  private fail(error: GameError): void {
    if (this.failure || this.destroyed) return;
    this.failure = error;
    this.cancelActive?.(error);
    this.closeProcess();
    this.onFailure?.(error);
  }
  private closeProcess(): void { this.destroyed = true; this.rl.close(); this.process.kill(); }
  public destroy(): void {
    if (this.destroyed) return;
    this.cancelActive?.(new GameError('ENGINE_DESTROYED', '對弈引擎已關閉'));
    if (this.process.stdin.writable) this.process.stdin.write('stop\nquit\n', () => {});
    this.closeProcess();
  }
  private readResponse<T>(timeoutMs: number, parse: (line: string) => { value: T } | undefined, start: () => void, timeoutCode = 'ENGINE_TIMEOUT'): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => { clearTimeout(timer); this.rl.removeListener('line', onLine); this.cancelActive = undefined; };
      const cancel = (error: GameError) => { if (settled) return; settled = true; cleanup(); reject(error); };
      const onLine = (line: string) => {
        try {
          const result = parse(line);
          if (result && !settled) { settled = true; cleanup(); resolve(result.value); }
        } catch { this.fail(new GameError('ENGINE_PROTOCOL_ERROR', '對弈引擎回覆無法解析')); }
      };
      const timer = setTimeout(() => {
        // Timed-out streams are destroyed: late replies must not satisfy later requests.
        if (this.process.stdin.writable) this.process.stdin.write('stop\n', () => {});
        this.fail(new GameError(timeoutCode, '對弈引擎回應逾時'));
      }, timeoutMs);
      this.cancelActive = cancel;
      this.rl.on('line', onLine);
      try { start(); } catch (error) { cancel(error instanceof GameError ? error : new GameError('ENGINE_UNAVAILABLE', '對弈引擎無法使用')); }
    });
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => { await this.waitReady(); return operation(); });
    this.tail = result.catch(() => {});
    return result;
  }
  public getBestMove(fen: string, movetimeMs: number): Promise<Move | null> {
    return this.enqueue(() => this.readResponse(movetimeMs + 2000, line => {
      if (!line.startsWith('bestmove ')) return;
      const move = line.split(' ')[1];
      return { value: move === '(none)' || move === '0000' ? null : engineToAppMove(move) };
    }, () => { this.send(`position fen ${fen}`); this.send(`go movetime ${movetimeMs}`); }));
  }
  public getLegalMoves(fen: string): Promise<Move[]> {
    return this.enqueue(() => {
      const moves: Move[] = [];
      return this.readResponse(this.options.queryTimeoutMs ?? 3000, line => {
        const match = line.match(/^([a-i]\d+)([a-i]\d+):/);
        if (match) moves.push(engineToAppMove(`${match[1]}${match[2]}`));
        if (line.startsWith('Nodes searched:') || line.startsWith('Total:')) return { value: moves };
      }, () => { this.send(`position fen ${fen}`); this.send('go perft 1'); });
    });
  }
  public isCheck(fen: string): Promise<boolean> {
    return this.enqueue(() => this.readResponse(this.options.queryTimeoutMs ?? 3000, line => {
      if (line.startsWith('Checkers:')) return { value: line.slice('Checkers:'.length).trim().length > 0 };
    }, () => { this.send(`position fen ${fen}`); this.send('d'); }));
  }
}
