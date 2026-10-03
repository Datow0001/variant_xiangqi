import test from 'node:test';
import assert from 'node:assert/strict';
import { CHALLENGES, getChallenge, publicChallenge } from '../challenges';
import { FairyEngine } from '../FairyEngine';
import { configurations, verifyChallenge, verifyHints } from '../challenges/verify';
import { applyLoadoutsToFen, validateInitialFen } from '../../../shared/fen';
import { GameSession } from '../session';
import { normalizeStart } from '../validation';

test('catalogue has 20 linked levels, 5 chapters, and no private answers in summaries', () => {
  assert.equal(CHALLENGES.length, 20);
  for (const chapter of [1, 2, 3, 4, 5]) assert.equal(CHALLENGES.filter(item => item.chapter === chapter).length, 4);
  for (const [index, definition] of CHALLENGES.entries()) {
    assert.equal(definition.nextChallengeId, CHALLENGES[index + 1]?.id ?? null);
    const summary = publicChallenge(definition);
    for (const key of ['initialFen', 'hintBranches', 'preferredMoves', 'referenceLoadouts', 'commonMistake', 'completionExplanation']) assert.equal(key in summary, false);
    for (const loadout of definition.referenceLoadouts) assert.ok(definition.allowedUpgrades.some(item => item.position === loadout.position && item.upgradeId === loadout.upgradeId));
    normalizeStart({ gameMode: 'CHALLENGE', challengeId: definition.id, loadouts: definition.referenceLoadouts });
    for (const loadouts of configurations(definition)) validateInitialFen(applyLoadoutsToFen(definition.initialFen, loadouts, definition.playerColor));
  }
  assert.equal(getChallenge('rook-mate')!.contentVersion, 3);
  assert.equal(getChallenge('palace-finale')!.contentVersion, 2);
});

test('real engine proves every level and all defensive branches; advanced levels require 3 or 4 moves', async () => {
  const engine = new FairyEngine();
  try {
    await engine.waitReady();
    for (const definition of CHALLENGES) {
      const result = await verifyChallenge(definition, engine);
      await verifyHints(definition, result.hints);
      assert.ok(result.referenceMinimumMoves <= definition.maxPlayerMoves);
      if (definition.chapter >= 4) {
        assert.equal(result.referenceMinimumMoves, definition.maxPlayerMoves, definition.id);
        assert.ok(result.referenceMinimumMoves >= 3, definition.id);
        assert.ok(result.opponentRepliesVerified >= 3, definition.id);
        const hintMoves = Object.values(result.hints).map(moves => JSON.stringify(moves));
        assert.ok(new Set(hintMoves).size >= 3, `${definition.id}: must adapt moves along the strategy`);
      }
      if (['screen-team', 'build-a-screen', 'palace-finale'].includes(definition.id)) {
        assert.equal(result.referenceMinimumMoves, 2); assert.ok(result.opponentRepliesVerified > 0);
      }
      if (definition.allowedUpgrades.length) assert.equal(result.configurations.find(config => config.loadouts.length === 0)?.solvable, false, definition.id);
      if (['budget-choice', 'which-knight', 'build-a-screen'].includes(definition.id)) assert.equal(result.configurations.filter(config => config.solvable).length, 1);
    }
  } finally { engine.destroy(); }
});

test('verification rejects a stale hint and refuses to call a search limit a proof', async () => {
  const definition = getChallenge('screen-team')!;
  await assert.rejects(verifyHints({ ...definition, hintBranches: { wrong: [{ from: 'a1', to: 'a2' }] } }, {}), /unproven hint/);
  const engine = new FairyEngine();
  try { await engine.waitReady(); await assert.rejects(verifyChallenge(definition, engine, 1), /position limit/); }
  finally { engine.destroy(); }
});

test('production GameSession plays every level with real AI and verified hints through to completion', async () => {
  for (const definition of CHALLENGES) {
    const session = new GameSession({ gameMode: 'CHALLENGE', challengeId: definition.id, loadouts: definition.referenceLoadouts });
    try {
      await session.init();
      for (let playerMove = 0; playerMove < definition.maxPlayerMoves && !session.isGameOver; playerMove++) {
        const hint = session.requestHint('MOVE', session.version);
        assert.ok(hint.available && hint.hint.move, `${definition.id}: no verified hint`);
        await session.makePlayerMove(hint.hint.move!.from, hint.hint.move!.to, session.version);
      }
      const result = session.getState();
      assert.equal(result.challenge?.outcome, 'SUCCEEDED', definition.id); assert.equal(result.challenge?.stars, 1);
      assert.ok(result.challenge!.playerMoves <= definition.maxPlayerMoves);
    } finally { session.destroy(); }
  }
});
