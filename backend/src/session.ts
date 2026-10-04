import { randomUUID } from 'node:crypto';
import { Engine, FairyEngine } from './FairyEngine';
import { ChallengeHint, GameMode, GameStatePayload, LoadoutItem, Move, SessionStatus, StartGamePayload } from '../../shared/types';
import { applyLoadoutsToFen, applyMoveToFen, generateCustomFen, generateInitialFen, validateInitialFen } from '../../shared/fen';
import { getChallenge } from './challenges';
import { ChallengeRuntime } from './ChallengeRuntime';
import { STAGES } from '../../shared/stages';
import { GameError } from './errors';
import { normalizeStart } from './validation';

/** Trusted server-authored position; never accepted from the public socket. */
export interface SessionOptions {
  initialFen?: string;
  movetimeMs?: number;
  engineFactory?: () => Engine;
  onState?: (state: GameStatePayload) => void;
  onFault?: (error: GameError) => void;
}
export class GameSession {
  public readonly gameId = randomUUID();
  public readonly gameMode: GameMode;
  public readonly stageId?: 1 | 2 | 3;
  public readonly playerColor?: 'red' | 'black';
  public readonly playerLoadouts: LoadoutItem[];
  public readonly redLoadouts: LoadoutItem[];
  public readonly blackLoadouts: LoadoutItem[];
  public aiLoadouts: LoadoutItem[] = [];
  public fen = '';
  public initialFen = '';
  public readonly history: Move[] = [];
  public currentTurn: 'red' | 'black' = 'red';
  public lastMove: Move | null = null;
  public legalMoves: Move[] = [];
  public isCheck = false;
  public isGameOver = false;
  public winner: GameStatePayload['winner'] = null;
  public gameOverReason: GameStatePayload['gameOverReason'] = null;
  public status: SessionStatus = 'INITIALIZING';
  public version = 0;
  private engine: Engine;
  private busy = false;
  private destroyed = false;
  private generation = 0;
  private challenge: ChallengeRuntime | null = null;

  constructor(payload: StartGamePayload, private options: SessionOptions = {}) {
    const config = normalizeStart(payload);
    this.gameMode = config.gameMode!;
    this.stageId = config.stageId;
    this.playerColor = config.playerColor;
    this.playerLoadouts = config.loadouts ?? [];
    if (this.gameMode === 'CHALLENGE') {
      const definition = getChallenge(config.challengeId!)!;
      this.challenge = new ChallengeRuntime(definition);
      this.fen = applyLoadoutsToFen(definition.initialFen, this.playerLoadouts, definition.playerColor);
    } else if (options.initialFen !== undefined) {
      try { validateInitialFen(options.initialFen); } catch { throw new GameError('INVALID_FEN', '指定盤面格式或基本棋子位置錯誤'); }
      if (this.playerLoadouts.length || config.redLoadouts?.length || config.blackLoadouts?.length) throw new GameError('INVALID_PAYLOAD', '指定盤面須已包含升級棋子');
      this.fen = options.initialFen.trim().replace(/\s+/g, ' ');
    } else if (this.gameMode === 'PVP') {
      this.fen = generateCustomFen(config.redLoadouts ?? [], config.blackLoadouts ?? []);
    } else {
      const initial = generateInitialFen(this.playerColor!, this.playerLoadouts, this.stageId!);
      this.fen = initial.fen;
      this.aiLoadouts = initial.aiLoadouts;
    }
    this.redLoadouts = this.gameMode === 'PVP' ? config.redLoadouts! : this.playerColor === 'red' ? this.playerLoadouts : this.aiLoadouts;
    this.blackLoadouts = this.gameMode === 'PVP' ? config.blackLoadouts! : this.playerColor === 'black' ? this.playerLoadouts : this.aiLoadouts;
    if (options.movetimeMs !== undefined && (!Number.isInteger(options.movetimeMs) || options.movetimeMs < 1 || options.movetimeMs > 10000)) throw new GameError('INVALID_PAYLOAD', 'AI 思考時間錯誤');
    this.initialFen = this.fen;
    this.currentTurn = this.fen.split(' ')[1] === 'w' ? 'red' : 'black';
    this.engine = (options.engineFactory ?? (() => new FairyEngine()))();
    this.engine.onFailure = error => this.fault(error);
  }
  private live(generation: number): void {
    if (this.destroyed || generation !== this.generation || this.status === 'FAULTED') throw new GameError('SESSION_CLOSED', '對局已停止');
  }
  private emit(): void { this.options.onState?.(this.getState()); }
  private finish(): void {
    this.status = 'FINISHED'; this.isGameOver = true; this.legalMoves = []; this.generation++; this.engine.destroy();
  }
  public fault(error: GameError): void {
    if (this.destroyed || this.isGameOver || this.status === 'FAULTED') return;
    this.status = 'FAULTED'; this.legalMoves = []; this.generation++; this.engine.destroy();
    this.challenge?.settle('INTERRUPTED', 'INTERRUPTED');
    this.options.onFault?.(error); this.emit();
  }
  private async refresh(generation: number): Promise<void> {
    const moves = await this.engine.getLegalMoves(this.fen);
    this.live(generation);
    const check = await this.engine.isCheck(this.fen);
    this.live(generation);
    this.legalMoves = moves; this.isCheck = check;
    if (!moves.length) {
      this.winner = this.currentTurn === 'red' ? 'black' : 'red';
      this.gameOverReason = check ? 'CHECKMATE' : 'STALEMATE';
      if (this.challenge) {
        const success = this.winner === this.playerColor && check && this.challenge.definition.goal.type === 'CHECKMATE';
        const stalemateNotMate = this.winner === this.playerColor && !check && this.challenge.definition.goal.type === 'CHECKMATE';
        this.challenge.settle(success ? 'SUCCEEDED' : 'FAILED', success ? 'CHECKMATE' : this.winner !== this.playerColor ? 'PLAYER_DEFEATED' : stalemateNotMate ? 'STALEMATE_NOT_MATE' : 'OBJECTIVE_NOT_MET');
      }
      this.finish();
    }
  }
  public async init(): Promise<void> {
    if (this.status !== 'INITIALIZING') throw new GameError('SESSION_BUSY', '對局已初始化');
    const generation = this.generation;
    try {
      await this.engine.waitReady(); this.live(generation);
      await this.refresh(generation);
      if (!this.isGameOver && this.gameMode !== 'PVP' && this.currentTurn !== this.playerColor) await this.aiMove(generation);
      if (!this.isGameOver) this.status = 'READY';
    } catch (error) { this.fault(error instanceof GameError ? error : new GameError('ENGINE_ERROR', '對弈引擎處理失敗')); throw error; }
  }
  private apply(move: Move): void {
    this.challenge?.recordMove(move, this.currentTurn);
    this.fen = applyMoveToFen(this.fen, move.from, move.to);
    this.history.push({ ...move }); this.lastMove = { ...move }; this.version++;
    this.currentTurn = this.fen.split(' ')[1] === 'w' ? 'red' : 'black';
    this.legalMoves = [];
  }
  private async aiMove(generation: number): Promise<void> {
    this.status = 'AI_THINKING'; this.emit();
    const move = await this.engine.getBestMove(this.fen, this.options.movetimeMs ?? this.challenge?.definition.movetimeMs ?? STAGES[this.stageId ?? 1].movetimeMs);
    this.live(generation);
    if (!move || !this.legalMoves.some(m => m.from === move.from && m.to === move.to)) throw new GameError('ENGINE_INVALID_MOVE', '對弈引擎回傳不合法走步');
    this.apply(move); await this.refresh(generation);
  }
  public async makePlayerMove(from: string, to: string, expectedVersion = this.version): Promise<GameStatePayload> {
    if (this.destroyed || this.status === 'FAULTED') throw new GameError('SESSION_CLOSED', '對局已中斷');
    if (this.isGameOver) throw new GameError('GAME_OVER', '對局已結束');
    if (this.busy || this.status !== 'READY') throw new GameError('SESSION_BUSY', '請等待目前操作完成');
    if (expectedVersion !== this.version) throw new GameError('STALE_STATE', '盤面已更新，請依最新盤面走棋');
    if (this.gameMode !== 'PVP' && this.currentTurn !== this.playerColor) throw new GameError('NOT_YOUR_TURN', '尚未輪到您的回合');
    if (!this.legalMoves.some(m => m.from === from && m.to === to)) throw new GameError('ILLEGAL_MOVE', '這一步不符合目前合法走步');
    this.busy = true;
    this.status = 'PROCESSING';
    const generation = this.generation;
    try {
      this.apply({ from, to });
      if (this.challenge?.captureSucceeded) {
        this.challenge.settle('SUCCEEDED', 'TARGET_CAPTURED');
        this.winner = this.playerColor!; this.gameOverReason = 'CHALLENGE_COMPLETE'; this.finish();
      } else {
        await this.refresh(generation);
        if (!this.isGameOver && this.challenge?.limitReached) {
          this.challenge.settle('FAILED', 'MOVE_LIMIT');
          this.winner = null; this.gameOverReason = 'MOVE_LIMIT'; this.finish();
        }
      }
      if (!this.isGameOver && this.gameMode !== 'PVP') await this.aiMove(generation);
      if (!this.isGameOver) this.status = 'READY';
      return this.getState();
    } catch (error) {
      this.fault(error instanceof GameError ? error : new GameError('ENGINE_ERROR', '對弈引擎處理失敗'));
      throw error;
    } finally { this.busy = false; }
  }
  public resign(): GameStatePayload {
    if (this.destroyed || this.status === 'FAULTED') throw new GameError('SESSION_CLOSED', '對局已中斷');
    if (this.isGameOver) throw new GameError('GAME_OVER', '對局已結束');
    this.winner = (this.gameMode === 'PVP' ? this.currentTurn : this.playerColor) === 'red' ? 'black' : 'red';
    this.challenge?.settle('FAILED', 'RESIGN');
    this.gameOverReason = 'RESIGN'; this.version++; this.finish(); return this.getState();
  }
  public requestHint(level: 'DIRECTION' | 'MOVE', expectedVersion: number): { hint: ChallengeHint; available: boolean } {
    if (!this.challenge) throw new GameError('INVALID_ACTION', '只有短局挑戰可以使用提示');
    if (this.status !== 'READY' || this.busy || this.isGameOver || this.destroyed) throw new GameError('SESSION_BUSY', '目前無法使用提示');
    if (expectedVersion !== this.version) throw new GameError('STALE_STATE', '盤面已更新，請重新取得提示');
    if (this.currentTurn !== this.playerColor) throw new GameError('NOT_YOUR_TURN', '請等待您的回合');
    return this.challenge.hint(level, this.fen, this.legalMoves, this.version);
  }
  public getState(): GameStatePayload {
    return { gameId: this.gameId, version: this.version, status: this.status, gameMode: this.gameMode,
      stageId: this.stageId, playerColor: this.playerColor, redLoadouts: this.redLoadouts.map(x => ({ ...x })), blackLoadouts: this.blackLoadouts.map(x => ({ ...x })),
      fen: this.fen, currentTurn: this.currentTurn, lastMove: this.lastMove && { ...this.lastMove }, legalMoves: this.legalMoves.map(x => ({ ...x })),
      aiLoadouts: this.aiLoadouts.map(x => ({ ...x })), isCheck: this.isCheck, isGameOver: this.isGameOver, winner: this.winner, gameOverReason: this.gameOverReason,
      challenge: this.challenge?.getState() ?? null };
  }
  public destroy(): void { if (this.destroyed) return; this.destroyed = true; this.generation++; this.engine.destroy(); }
}
