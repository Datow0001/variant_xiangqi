import { ChallengeSummary, UPGRADES } from '../../shared/types';
import { applyLoadoutsToFen, fenToBoard, validateInitialFen } from '../../shared/fen';
import { isValidUci, uciToPos } from '../../shared/coordinates';
import { basics } from './challenges/basics';
import { tactics } from './challenges/tactics';
import { construction } from './challenges/construction';
import { advanced } from './challenges/advanced';
import { ChallengeDefinition, positionKey } from './challenges/model';
import { verifiedHints } from './challenges/verified-hints';
export type { ChallengeDefinition } from './challenges/model';
export { positionKey } from './challenges/model';

export const CHALLENGES: readonly ChallengeDefinition[] = [...basics, ...tactics, ...construction, ...advanced].map((definition, index, all) => ({
  ...definition,
  nextChallengeId: all[index + 1]?.id ?? null,
  hintBranches: verifiedHints[definition.id] ?? { [positionKey(applyLoadoutsToFen(definition.initialFen, definition.referenceLoadouts, definition.playerColor))]: definition.preferredMoves },
}));
export function validateChallengeDefinition(definition: ChallengeDefinition): void {
  validateInitialFen(definition.initialFen);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(definition.id) || !['red', 'black'].includes(definition.playerColor) ||
      !Number.isSafeInteger(definition.maxPlayerMoves) || definition.maxPlayerMoves < 1 || definition.maxPlayerMoves > 50 ||
      !Number.isSafeInteger(definition.budget) || definition.budget < 0 || definition.budget > 10 ||
      !Number.isInteger(definition.movetimeMs) || definition.movetimeMs < 1 || definition.movetimeMs > 10000) throw new Error('Invalid challenge definition');
  if (!['CHECKMATE', 'CAPTURE'].includes(definition.goal.type) || !Number.isSafeInteger(definition.order) || definition.order < 1 || !definition.name || !definition.goalText || !definition.directionHint ||
      ![1, 2, 3, 4, 5].includes(definition.chapter) || !['入門', '進階', '綜合', '挑戰', '高手'].includes(definition.difficulty) ||
      !Number.isSafeInteger(definition.contentVersion) || definition.contentVersion < 1 || !definition.learningPoint || !definition.commonMistake || !definition.completionExplanation ||
      !Array.isArray(definition.themes) || !definition.themes.length || definition.themes.some(theme => typeof theme !== 'string' || !theme)) throw new Error('Invalid challenge metadata');
  const originals = { TIAN_MA: 'n', FEI_XIANG: 'b', PO_JI_PAO: 'c', TU_JI_BING: 'p' };
  const used = new Set<string>();
  for (const item of definition.allowedUpgrades) {
    if (!isValidUci(item.position) || !Object.hasOwn(UPGRADES, item.upgradeId) || used.has(item.position)) throw new Error('Invalid allowed upgrade');
    used.add(item.position);
    const { col, row } = uciToPos(item.position);
    const original = originals[item.upgradeId];
    if (fenToBoard(definition.initialFen)[9 - row][col] !== (definition.playerColor === 'red' ? original.toUpperCase() : original)) throw new Error('Upgrade must match a player piece');
  }
  const referenceCost = definition.referenceLoadouts.reduce((sum, item) => sum + (UPGRADES[item.upgradeId]?.cost ?? Infinity), 0);
  if (referenceCost > definition.budget || new Set(definition.referenceLoadouts.map(item => item.position)).size !== definition.referenceLoadouts.length ||
      definition.referenceLoadouts.some(item => !definition.allowedUpgrades.some(allowed => item.position === allowed.position && item.upgradeId === allowed.upgradeId))) throw new Error('Invalid reference loadout');
  if (definition.goal.type === 'CAPTURE') {
    if (!isValidUci(definition.goal.targetSquare)) throw new Error('Invalid challenge target');
    const { col, row } = uciToPos(definition.goal.targetSquare);
    const piece = fenToBoard(definition.initialFen)[9 - row][col];
    if (piece === '.' || piece.toLowerCase() === 'k' || (piece === piece.toUpperCase()) === (definition.playerColor === 'red')) throw new Error('Target must be an enemy non-king piece');
  }
  for (const moves of Object.values(definition.hintBranches)) for (const move of moves) {
    if (!isValidUci(move.from) || !isValidUci(move.to)) throw new Error('Invalid authored hint');
  }
}
for (const challenge of CHALLENGES) {
  validateChallengeDefinition(challenge);
  if (CHALLENGES.filter(item => item.id === challenge.id).length !== 1 || CHALLENGES.filter(item => item.order === challenge.order).length !== 1 ||
      (challenge.nextChallengeId !== null && !CHALLENGES.some(item => item.id === challenge.nextChallengeId))) throw new Error('Invalid challenge catalogue links');
}
export function getChallenge(id: string): ChallengeDefinition | undefined { return CHALLENGES.find(challenge => challenge.id === id); }
export function publicChallenge(definition: ChallengeDefinition): ChallengeSummary {
  const { id, name, description, order, playerColor, goalText, maxPlayerMoves, budget, allowedUpgrades, nextChallengeId, chapter, difficulty, themes, learningPoint, contentVersion } = definition;
  return { id, name, description, order, playerColor, goalText, maxPlayerMoves, budget, allowedUpgrades: allowedUpgrades.map(item => ({ ...item })), nextChallengeId,
    chapter, difficulty, themes: [...themes], learningPoint, contentVersion };
}
