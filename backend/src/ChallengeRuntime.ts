import { ChallengeHint, ChallengeOutcome, ChallengeReason, ChallengeState, Move } from '../../shared/types';
import { ChallengeDefinition, positionKey, publicChallenge } from './challenges';

export class ChallengeRuntime {
  private outcome: ChallengeOutcome = 'ACTIVE';
  private reason: ChallengeReason | null = null;
  private playerMoves = 0;
  private targetSquare: string | null;
  private capturedByPlayer = false;
  private directionHintUses = 0;
  private moveHintUses = 0;
  private hints: ChallengeHint[] = [];
  private stars = 0;
  constructor(public readonly definition: ChallengeDefinition) {
    this.targetSquare = definition.goal.type === 'CAPTURE' ? definition.goal.targetSquare : null;
  }
  get active(): boolean { return this.outcome === 'ACTIVE'; }
  get captureSucceeded(): boolean { return this.capturedByPlayer; }
  get limitReached(): boolean { return this.playerMoves >= this.definition.maxPlayerMoves; }
  recordMove(move: Move, actor: 'red' | 'black'): void {
    if (!this.active) return;
    if (actor === this.definition.playerColor) this.playerMoves++;
    // Track the original target's identity, even if another identical piece occupies its old square.
    if (this.targetSquare === move.to) { this.targetSquare = null; this.capturedByPlayer = actor === this.definition.playerColor; }
    else if (this.targetSquare === move.from) this.targetSquare = move.to;
  }
  settle(outcome: Exclude<ChallengeOutcome, 'ACTIVE'>, reason: ChallengeReason): void {
    if (!this.active) return;
    this.outcome = outcome; this.reason = reason;
    this.stars = outcome === 'SUCCEEDED' ? this.moveHintUses > 0 ? 1 : this.directionHintUses > 0 ? 2 : 3 : 0;
  }
  hint(level: 'DIRECTION' | 'MOVE', fen: string, legalMoves: Move[], version: number): { hint: ChallengeHint; available: boolean } {
    let text = this.definition.directionHint;
    let move: Move | null = null;
    let available = true;
    if (level === 'MOVE') {
      move = this.definition.hintBranches[positionKey(fen)]?.find(candidate => legalMoves.some(legal => legal.from === candidate.from && legal.to === candidate.to)) ?? null;
      available = !!move;
      text = move ? `試試 ${move.from} → ${move.to}。` : '目前盤面沒有已驗證的走步提示，可使用方向提示或重新挑戰；此次不計提示使用。';
      if (available) this.moveHintUses++;
    } else this.directionHintUses++;
    const hint = { level, text, move: move && { ...move }, version };
    if (available) { this.hints.push(hint); if (this.hints.length > 20) this.hints.shift(); }
    return { hint, available };
  }
  getState(): ChallengeState {
    return { definition: publicChallenge(this.definition), outcome: this.outcome, reason: this.reason,
      playerMoves: this.playerMoves, remainingMoves: Math.max(0, this.definition.maxPlayerMoves - this.playerMoves), targetSquare: this.targetSquare,
      directionHintUses: this.directionHintUses, moveHintUses: this.moveHintUses, hints: this.hints.map(hint => ({ ...hint, move: hint.move && { ...hint.move } })),
      stars: this.stars, explanation: this.outcome === 'SUCCEEDED' ? this.definition.completionExplanation : null,
      failureExplanation: this.outcome === 'FAILED' ? this.definition.commonMistake : null };
  }
}
