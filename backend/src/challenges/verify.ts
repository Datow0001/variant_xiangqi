import { Engine } from '../FairyEngine';
import { ChallengeDefinition, positionKey } from './model';
import { LoadoutItem, Move, UPGRADES } from '../../../shared/types';
import { applyLoadoutsToFen, applyMoveToFen, validateInitialFen, fenToBoard, boardToFen } from '../../../shared/fen';
import { uciToPos } from '../../../shared/coordinates';

interface Proof { hints: Record<string, Move[]>; replies: number; line: Move[] }
export interface VerificationResult {
  id: string;
  configurations: { loadouts: LoadoutItem[]; solvable: boolean; minimumPlayerMoves: number | null }[];
  referenceMinimumMoves: number;
  referenceLine: Move[];
  opponentRepliesVerified: number;
  positionsQueried: number;
  hints: Record<string, Move[]>;
  requiredAbilityChecks?: { position: string; upgradeId: LoadoutItem['upgradeId']; ordinarySolvable: boolean; positionsQueried: number }[];
}
export function configurations(definition: ChallengeDefinition): LoadoutItem[][] {
  const values: LoadoutItem[][] = [[]];
  for (const upgrade of definition.allowedUpgrades) {
    for (const existing of [...values]) values.push([...existing, upgrade]);
  }
  // normalizeStart performs the same server-side budget validation before play.
  const costs = { TIAN_MA: 3, FEI_XIANG: 2, PO_JI_PAO: 3, TU_JI_BING: 1 };
  return values.filter(items => new Set(items.map(item => item.position)).size === items.length && items.reduce((sum, item) => sum + costs[item.upgradeId], 0) <= definition.budget);
}

/** Construct a strategy against EVERY legal opponent reply, without relying on AI search choices. */
export async function verifyChallenge(definition: ChallengeDefinition, engine: Engine, maxPositions = 100000): Promise<VerificationResult> {
  const legalCache = new Map<string, Move[]>();
  const memo = new Map<string, Proof | null>();
  const playerTurn = definition.playerColor === 'red' ? 'w' : 'b';
  async function legal(fen: string): Promise<Move[]> {
    const key = positionKey(fen); const cached = legalCache.get(key);
    if (cached) return cached;
    if (legalCache.size >= maxPositions) throw new Error(`${definition.id}: verification position limit reached (not a proof)`);
    const moves = await engine.getLegalMoves(fen); legalCache.set(key, moves); return moves;
  }
  async function solve(fen: string, target: string | null, remaining: number): Promise<Proof | null> {
    const key = `${positionKey(fen)}|${target}|${remaining}`;
    if (memo.has(key)) return memo.get(key)!;
    const ownTurn = fen.split(' ')[1] === playerTurn;
    // No player moves remain: an opponent turn that could complete mate was already checked.
    if (ownTurn && remaining === 0) { memo.set(key, null); return null; }
    const moves = await legal(fen);
    if (!moves.length) {
      const success = !ownTurn && definition.goal.type === 'CHECKMATE' && await engine.isCheck(fen);
      const proof = success ? { hints: {}, replies: 0, line: [] } : null;
      memo.set(key, proof); return proof;
    }
    const ordered = ownTurn ? [...moves].sort((a, b) => {
      const priority = (move: Move) => {
        const preferred = definition.preferredMoves.findIndex(item => item.from === move.from && item.to === move.to);
        return preferred >= 0 ? preferred : move.to === target ? 50 : 100;
      };
      return priority(a) - priority(b);
    }) : moves;
    const combined: Proof = { hints: {}, replies: 0, line: [] };
    for (const move of ordered) {
      const captured = ownTurn && target !== null && move.to === target;
      const nextTarget = target === move.from ? move.to : target;
      const child = captured ? { hints: {}, replies: 0, line: [] } : await solve(applyMoveToFen(fen, move.from, move.to), nextTarget, remaining - (ownTurn ? 1 : 0));
      if (ownTurn && child) {
        // Include all immediately winning capture alternatives, not just the preferred route.
        const immediate = target ? moves.filter(candidate => candidate.to === target) : [];
        const proof = { hints: { ...child.hints, [positionKey(fen)]: immediate.length ? immediate : [move] }, replies: child.replies, line: [move, ...child.line] };
        memo.set(key, proof); return proof;
      }
      if (!ownTurn) {
        if (!child) { memo.set(key, null); return null; }
        Object.assign(combined.hints, child.hints); combined.replies += 1 + child.replies;
        if (!combined.line.length) combined.line = [move, ...child.line];
      }
    }
    const result = ownTurn ? null : combined; memo.set(key, result); return result;
  }
  const results: VerificationResult['configurations'] = [];
  let reference: Proof | null = null; let referenceMinimumMoves = 0;
  const allHints: Record<string, Move[]> = {};
  for (const loadouts of configurations(definition)) {
    const fen = applyLoadoutsToFen(definition.initialFen, loadouts, definition.playerColor);
    validateInitialFen(fen);
    if (fen.split(' ')[1] !== playerTurn) throw new Error(`${definition.id}: starting turn must match player color`);
    if (!(await legal(fen)).length) throw new Error(`${definition.id}: terminal starting position`);
    if (await engine.isCheck(fen.replace(` ${playerTurn} `, ` ${playerTurn === 'w' ? 'b' : 'w'} `))) throw new Error(`${definition.id}: opposing king is already in check at start`);
    let proof: Proof | null = null; let minimum: number | null = null;
    for (let limit = 1; limit <= definition.maxPlayerMoves; limit++) {
      proof = await solve(fen, definition.goal.type === 'CAPTURE' ? definition.goal.targetSquare : null, limit);
      if (proof) { minimum = limit; break; }
    }
    results.push({ loadouts, solvable: !!proof, minimumPlayerMoves: minimum });
    if (proof) Object.assign(allHints, proof.hints);
    if (JSON.stringify(loadouts) === JSON.stringify(definition.referenceLoadouts)) {
      reference = proof; referenceMinimumMoves = minimum ?? 0;
    }
  }
  if (!reference) throw new Error(`${definition.id}: reference loadout has no forced solution within ${definition.maxPlayerMoves} player moves`);
  const requiredAbilityChecks: VerificationResult['requiredAbilityChecks'] = [];
  for (const upgrade of definition.requiredUpgrades ?? []) {
    const upgradedFen = applyLoadoutsToFen(definition.initialFen, definition.referenceLoadouts, definition.playerColor);
    const board = fenToBoard(upgradedFen), { col, row } = uciToPos(upgrade.position);
    const info = UPGRADES[upgrade.upgradeId];
    const red = definition.playerColor === 'red';
    if (board[9 - row][col] !== (red ? info.symbolRed : info.symbolBlack)) throw new Error(`${definition.id}: required ability must match the reference piece`);
    const original = { TIAN_MA: 'n', FEI_XIANG: 'b', PO_JI_PAO: 'c', TU_JI_BING: 'p' }[upgrade.upgradeId];
    board[9 - row][col] = red ? original.toUpperCase() : original;
    const fields = upgradedFen.split(' ');
    const ordinaryFen = boardToFen(board, fields[1] as 'w' | 'b', Number(fields[4]), Number(fields[5]));
    // Reuse exhaustive configuration proof, including a legal ordinary-piece control.
    // Remove this field to avoid recursive ability checks. A search limit remains an error.
    const comparison = await verifyChallenge({ ...definition, requiredUpgrades: undefined, initialFen: ordinaryFen,
      budget: info.cost, allowedUpgrades: [upgrade], referenceLoadouts: [upgrade] }, engine, maxPositions);
    const ordinarySolvable = comparison.configurations.find(config => config.loadouts.length === 0)!.solvable;
    if (ordinarySolvable) throw new Error(`${definition.id}: ${upgrade.upgradeId} at ${upgrade.position} is not necessary within the move limit`);
    requiredAbilityChecks.push({ ...upgrade, ordinarySolvable, positionsQueried: comparison.positionsQueried });
  }
  return { id: definition.id, configurations: results, referenceMinimumMoves, referenceLine: reference.line,
    opponentRepliesVerified: reference.replies, positionsQueried: legalCache.size, hints: allHints,
    ...(requiredAbilityChecks.length ? { requiredAbilityChecks } : {}) };
}

/** Verify shipped hints independently: every hinted choice must retain a forced solution. */
export async function verifyHints(definition: ChallengeDefinition, expected: Record<string, Move[]>): Promise<void> {
  for (const [key, moves] of Object.entries(definition.hintBranches)) {
    const proven = expected[key];
    if (!proven || moves.length === 0 || moves.some(move => !proven.some(item => item.from === move.from && item.to === move.to))) throw new Error(`${definition.id}: stale/unproven hint at ${key}`);
  }
  if (Object.keys(expected).some(key => !definition.hintBranches[key])) throw new Error(`${definition.id}: missing proven hint branch`);
}
