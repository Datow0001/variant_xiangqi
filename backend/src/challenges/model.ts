import { ChallengeSummary, LoadoutItem, Move } from '../../../shared/types';
import { boardToFen } from '../../../shared/fen';
import { uciToPos } from '../../../shared/coordinates';

export interface ChallengeDefinition extends ChallengeSummary {
  initialFen: string;
  movetimeMs: number;
  goal: { type: 'CHECKMATE' } | { type: 'CAPTURE'; targetSquare: string };
  directionHint: string;
  hintBranches: Record<string, Move[]>;
  completionExplanation: string;
  commonMistake: string;
  referenceLoadouts: LoadoutItem[];
  preferredMoves: Move[];
  /** Each listed upgrade must be necessary for a forced solution within the move limit. */
  requiredUpgrades?: LoadoutItem[];
}
export function positionKey(fen: string): string { return fen.split(' ').slice(0, 2).join(' '); }
export function position(pieces: Record<string, string>, turn: 'w' | 'b' = 'w'): string {
  const board = Array.from({ length: 10 }, () => Array(9).fill('.') as string[]);
  for (const [square, piece] of Object.entries(pieces)) {
    const { col, row } = uciToPos(square); board[9 - row][col] = piece;
  }
  return boardToFen(board, turn);
}
export const move = (from: string, to: string): Move => ({ from, to });
type Spec = Omit<ChallengeDefinition, 'movetimeMs' | 'hintBranches' | 'nextChallengeId' | 'contentVersion' | 'playerColor' | 'referenceLoadouts' | 'allowedUpgrades' | 'budget'> &
  Partial<Pick<ChallengeDefinition, 'playerColor' | 'referenceLoadouts' | 'allowedUpgrades' | 'budget' | 'contentVersion'>>;
export function define(spec: Spec): ChallengeDefinition {
  return { movetimeMs: 300, hintBranches: {}, nextChallengeId: null, contentVersion: 1, playerColor: 'red', referenceLoadouts: [], allowedUpgrades: [], budget: 0, ...spec,
    goalText: spec.goal.type === 'CHECKMATE' ? `${spec.goalText}（困斃不算）` : spec.goalText };
}
