import { Engine } from '../FairyEngine';
import { GameError } from '../errors';
import { Move } from '../../../shared/types';
import { fenToBoard } from '../../../shared/fen';

export class TestEngine implements Engine {
  destroyed = 0;
  failReady = false;
  legalDelay?: Promise<void>;
  searchDelay?: Promise<void>;
  noMoves = false;
  checked = false;
  invalidBest = false;
  onLegal?: () => void;
  onFailure?: (error: GameError) => void;
  async waitReady(): Promise<void> { if (this.failReady) throw new GameError('ENGINE_UNAVAILABLE', 'test init failure'); }
  async getLegalMoves(fen: string): Promise<Move[]> {
    this.onLegal?.();
    await this.legalDelay;
    if (this.noMoves) return [];
    const board = fenToBoard(fen);
    return fen.split(' ')[1] === 'b' ? [{ from: 'b9', to: 'c7' }] : board[9][1] !== '.' ? [{ from: 'b0', to: 'c2' }] : [{ from: 'a0', to: 'a1' }];
  }
  async isCheck(): Promise<boolean> { return this.checked; }
  async getBestMove(fen: string): Promise<Move | null> { await this.searchDelay; return this.invalidBest ? { from: 'e0', to: 'e9' } : (await this.getLegalMoves(fen))[0] ?? null; }
  destroy(): void { this.destroyed++; }
}
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
