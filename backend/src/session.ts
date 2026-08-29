import { v4 as uuidv4 } from 'crypto';
import { FairyEngine } from './FairyEngine';
import {
  GameStatePayload,
  LoadoutItem,
  Move,
  StartGamePayload,
} from '../../shared/types';
import { generateInitialFen, applyMoveToFen } from '../../shared/fen';
import { STAGES } from '../../shared/stages';

export class GameSession {
  public readonly gameId: string;
  public readonly stageId: 1 | 2 | 3;
  public readonly playerColor: 'red' | 'black';
  public readonly playerLoadouts: LoadoutItem[];
  public aiLoadouts: LoadoutItem[] = [];

  public fen: string = '';
  public currentTurn: 'red' | 'black' = 'red';
  public lastMove: Move | null = null;
  public legalMoves: Move[] = [];
  public isCheck: boolean = false;
  public isGameOver: boolean = false;
  public winner: 'red' | 'black' | 'draw' | null = null;
  public gameOverReason:
    | 'CHECKMATE'
    | 'STALEMATE'
    | 'RESIGN'
    | 'REPETITION'
    | null = null;

  private engine: FairyEngine;
  private isThinking: boolean = false;

  constructor(payload: StartGamePayload) {
    this.gameId = (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).substring(2));
    this.stageId = payload.stageId;
    this.playerColor = payload.playerColor;
    this.playerLoadouts = payload.loadouts || [];
    this.engine = new FairyEngine();
  }

  /**
   * 初始化對局：生成初始變體 FEN，並查詢開局合法步；若玩家執黑，AI 自動下第一步
   */
  public async init(): Promise<void> {
    await this.engine.waitReady();

    const { fen, aiLoadouts } = generateInitialFen(
      this.playerColor,
      this.playerLoadouts,
      this.stageId
    );
    this.fen = fen;
    this.aiLoadouts = aiLoadouts;
    this.currentTurn = 'red';

    // 如果玩家執黑，AI 是紅方，AI 需先手出第一步
    if (this.playerColor === 'black') {
      await this.executeAiMove();
    } else {
      await this.updateGameState();
    }
  }

  /**
   * 刷新當前盤面的合法步與將軍狀態
   */
  private async updateGameState(): Promise<void> {
    this.legalMoves = await this.engine.getLegalMoves(this.fen);
    this.isCheck = await this.engine.isCheck(this.fen);

    // 如果當前行棋方沒有任何合法步，代表被將死 (Checkmate) 或困斃 (Stalemate)
    if (this.legalMoves.length === 0) {
      this.isGameOver = true;
      // 在象棋中，輪到走棋卻無步可走，該方直接判負 (無論是否被將軍)
      const loser = this.currentTurn;
      this.winner = loser === 'red' ? 'black' : 'red';
      this.gameOverReason = this.isCheck ? 'CHECKMATE' : 'STALEMATE';
    }
  }

  /**
   * 執行玩家走步
   */
  public async makePlayerMove(from: string, to: string): Promise<GameStatePayload> {
    if (this.isGameOver) {
      throw new Error('對局已結束，無法再行棋！');
    }
    if (this.currentTurn !== this.playerColor) {
      throw new Error('尚未輪到您的回合！');
    }
    if (this.isThinking) {
      throw new Error('AI 正在思考中，請稍候！');
    }

    // 檢查是否為合法步
    const isLegal = this.legalMoves.some((m) => m.from === from && m.to === to);
    if (!isLegal) {
      throw new Error(`非法走步: ${from} -> ${to}`);
    }

    // 1. 套用玩家走步
    this.fen = applyMoveToFen(this.fen, from, to);
    this.lastMove = { from, to };
    this.currentTurn = this.playerColor === 'red' ? 'black' : 'red';

    // 2. 更新盤面狀態
    await this.updateGameState();

    // 3. 若遊戲尚未結束，觸發 AI 行棋
    if (!this.isGameOver) {
      await this.executeAiMove();
    }

    return this.getState();
  }

  /**
   * 觸發 AI 計算並走步
   */
  public async executeAiMove(): Promise<void> {
    this.isThinking = true;
    try {
      const stageConfig = STAGES[this.stageId] || STAGES[1];
      const movetime = stageConfig.movetimeMs;

      // 取得 AI 最佳步
      const bestMove = await this.engine.getBestMove(this.fen, movetime);

      if (!bestMove) {
        // AI 無步可走，玩家獲勝
        this.isGameOver = true;
        this.winner = this.playerColor;
        this.gameOverReason = this.isCheck ? 'CHECKMATE' : 'STALEMATE';
        return;
      }

      // 套用 AI 走步
      this.fen = applyMoveToFen(this.fen, bestMove.from, bestMove.to);
      this.lastMove = bestMove;
      this.currentTurn = this.playerColor;

      // 刷新盤面供玩家操作
      await this.updateGameState();
    } finally {
      this.isThinking = false;
    }
  }

  /**
   * 玩家認輸
   */
  public resign(): GameStatePayload {
    this.isGameOver = true;
    this.winner = this.playerColor === 'red' ? 'black' : 'red';
    this.gameOverReason = 'RESIGN';
    this.legalMoves = [];
    return this.getState();
  }

  /**
   * 取得最新 GameStatePayload
   */
  public getState(): GameStatePayload {
    return {
      gameId: this.gameId,
      stageId: this.stageId,
      fen: this.fen,
      currentTurn: this.currentTurn,
      lastMove: this.lastMove,
      legalMoves: this.isGameOver ? [] : this.legalMoves,
      aiLoadouts: this.aiLoadouts,
      isCheck: this.isCheck,
      isGameOver: this.isGameOver,
      winner: this.winner,
      gameOverReason: this.gameOverReason,
    };
  }

  public destroy(): void {
    this.engine.destroy();
  }
}
