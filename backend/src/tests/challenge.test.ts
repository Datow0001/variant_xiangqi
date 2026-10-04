import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSession } from '../session';
import { ChallengeRuntime } from '../ChallengeRuntime';
import { CHALLENGES, publicChallenge, validateChallengeDefinition } from '../challenges';
import { normalizeStart } from '../validation';
import { GameError } from '../errors';
import { TestEngine } from './helpers';

test('challenge catalogue exposes summaries and rejects client-authored rules and invalid upgrades', () => {
  for (const definition of CHALLENGES) {
    validateChallengeDefinition(definition);
    const summary = publicChallenge(definition);
    if (definition.goal.type === 'CHECKMATE') assert.match(summary.goalText, /將死.*困斃不算/);
    else assert.doesNotMatch(summary.goalText, /困斃不算/);
    assert.equal('initialFen' in summary, false); assert.equal('hintBranches' in summary, false); assert.equal('goal' in summary, false);
  }
  for (const extra of [{ initialFen: CHALLENGES[0].initialFen }, { maxPlayerMoves: 99 }, { budget: 10 }, { playerColor: 'black' }, { challengeId: 'unknown' }, { loadouts: [{ position: 'b0', upgradeId: 'TIAN_MA' }] }]) {
    assert.throws(() => normalizeStart({ gameMode: 'CHALLENGE', challengeId: 'rook-mate', ...extra }));
  }
  assert.equal(normalizeStart({ gameMode: 'CHALLENGE', challengeId: 'knight-loadout', loadouts: [{ position: 'c3', upgradeId: 'TIAN_MA' }] }).budget, 3);
});

test('target identity follows movement and only player moves count; settlement freezes stars', () => {
  const runtime = new ChallengeRuntime(CHALLENGES[1]);
  runtime.recordMove({ from: 'a5', to: 'a4' }, 'red');
  runtime.recordMove({ from: 'd5', to: 'd4' }, 'black');
  assert.equal(runtime.getState().targetSquare, 'd4'); assert.equal(runtime.getState().playerMoves, 1);
  runtime.recordMove({ from: 'c3', to: 'd5' }, 'red');
  assert.equal(runtime.captureSucceeded, false);
  runtime.recordMove({ from: 'a4', to: 'd4' }, 'red'); assert.equal(runtime.captureSucceeded, true);
  runtime.settle('SUCCEEDED', 'TARGET_CAPTURED'); runtime.settle('FAILED', 'MOVE_LIMIT');
  assert.equal(runtime.getState().stars, 3); assert.equal(runtime.getState().outcome, 'SUCCEEDED');
});

test('hint branches require legal current moves and unavailable hints do not penalize stars', () => {
  const runtime = new ChallengeRuntime(CHALLENGES[1]);
  assert.equal(runtime.hint('MOVE', CHALLENGES[1].initialFen, [], 0).available, false);
  assert.equal(runtime.getState().moveHintUses, 0);
  runtime.hint('DIRECTION', CHALLENGES[1].initialFen, [], 0);
  runtime.settle('SUCCEEDED', 'TARGET_CAPTURED'); assert.equal(runtime.getState().stars, 2);
  const concrete = new ChallengeRuntime(CHALLENGES[1]);
  assert.deepEqual(concrete.hint('MOVE', CHALLENGES[1].initialFen, [{ from: 'a5', to: 'd5' }], 0).hint.move, { from: 'a5', to: 'd5' });
  concrete.settle('SUCCEEDED', 'TARGET_CAPTURED'); assert.equal(concrete.getState().stars, 1);
});

test('real engine: mate on final allowed move wins, alternative target captures win, and upgrade enables blocked jump', async () => {
  for (const [id, from, to, loadouts] of [
    ['rook-mate', 'e7', 'e8', []],
    ['hunt-shotgun', 'c3', 'd5', []],
    ['hunt-shotgun', 'a5', 'd5', []],
    ['knight-loadout', 'c3', 'd5', [{ position: 'c3', upgradeId: 'TIAN_MA' }]],
  ] as const) {
    const session = new GameSession({ gameMode: 'CHALLENGE', challengeId: id, loadouts: loadouts.map(item => ({ ...item })) });
    try {
      await session.init(); assert.equal(session.status, 'READY');
      const final = await session.makePlayerMove(from, to, 0);
      assert.equal(final.challenge?.outcome, 'SUCCEEDED', id); assert.equal(final.challenge?.stars, 3);
      assert.equal(final.challenge?.playerMoves, 1); assert.equal(final.status, 'FINISHED');
      assert.equal(final.version, 1); await assert.rejects(session.makePlayerMove(from, to, 1), { code: 'GAME_OVER' });
    } finally { session.destroy(); }
  }
});

test('real engine: illegal blocked jump costs no move; a legal non-goal move exhausts the one-move challenge', async () => {
  const session = new GameSession({ gameMode: 'CHALLENGE', challengeId: 'knight-loadout' });
  try {
    await session.init();
    await assert.rejects(session.makePlayerMove('c3', 'd5', 0), { code: 'ILLEGAL_MOVE' });
    assert.equal(session.getState().challenge?.playerMoves, 0);
    assert.equal(session.requestHint('MOVE', 0).available, false);
    const move = session.legalMoves[0]; const final = await session.makePlayerMove(move.from, move.to, 0);
    assert.equal(final.challenge?.outcome, 'FAILED'); assert.equal(final.challenge?.reason, 'MOVE_LIMIT');
    assert.equal(final.challenge?.remainingMoves, 0); assert.equal(final.version, 1);
  } finally { session.destroy(); }
});

test('challenge resignation fails; engine interruption does not count as defeat', async () => {
  const resigned = new GameSession({ gameMode: 'CHALLENGE', challengeId: 'rook-mate' });
  try { await resigned.init(); assert.equal(resigned.resign().challenge?.reason, 'RESIGN'); } finally { resigned.destroy(); }
  const faulted = new GameSession({ gameMode: 'CHALLENGE', challengeId: 'rook-mate' });
  try {
    await faulted.init(); faulted.fault(new GameError('ENGINE_EXITED', 'test'));
    assert.equal(faulted.getState().challenge?.outcome, 'INTERRUPTED'); assert.equal(faulted.winner, null);
  } finally { faulted.destroy(); }
});

test('AI response does not consume player budget and target follows the AI move', async () => {
  const engine = new TestEngine();
  engine.getLegalMoves = async fen => fen.split(' ')[1] === 'b' ? [{ from: 'd5', to: 'd4' }] : [{ from: 'a5', to: 'a4' }, { from: 'a4', to: 'd4' }];
  const session = new GameSession({ gameMode: 'CHALLENGE', challengeId: 'hunt-shotgun' }, { engineFactory: () => engine });
  try {
    await session.init();
    const ongoing = await session.makePlayerMove('a5', 'a4', 0);
    assert.equal(ongoing.version, 2); assert.equal(ongoing.challenge?.playerMoves, 1);
    assert.equal(ongoing.challenge?.remainingMoves, 1); assert.equal(ongoing.challenge?.targetSquare, 'd4');
    assert.equal(session.requestHint('MOVE', 2).available, false);
    const final = await session.makePlayerMove('a4', 'd4', 2);
    assert.equal(final.challenge?.outcome, 'SUCCEEDED'); assert.equal(final.challenge?.remainingMoves, 0);
  } finally { session.destroy(); }
});

test('stalemate does not satisfy checkmate goal, and an AI checkmate fails the challenge', async () => {
  for (const aiDefeat of [false, true]) {
    const engine = new TestEngine(); let queries = 0;
    engine.getLegalMoves = async () => ++queries === (aiDefeat ? 3 : 2) ? [] : queries === 1 ? [{ from: 'a5', to: 'a4' }] : [{ from: 'e9', to: 'd9' }];
    engine.checked = aiDefeat;
    const session = new GameSession({ gameMode: 'CHALLENGE', challengeId: aiDefeat ? 'hunt-shotgun' : 'rook-mate' }, { engineFactory: () => engine });
    if (!aiDefeat) engine.getLegalMoves = async () => ++queries === 1 ? [{ from: 'e7', to: 'e6' }] : [];
    // getBestMove normally queries legal moves in the test double; avoid altering the query counter.
    engine.getBestMove = async () => ({ from: 'e9', to: 'd9' });
    try {
      await session.init();
      const final = await session.makePlayerMove(aiDefeat ? 'a5' : 'e7', aiDefeat ? 'a4' : 'e6', 0);
      assert.equal(final.challenge?.outcome, 'FAILED');
      assert.equal(final.challenge?.reason, aiDefeat ? 'PLAYER_DEFEATED' : 'STALEMATE_NOT_MATE');
      if (!aiDefeat) {
        assert.equal(final.winner, 'red');
        assert.equal(final.gameOverReason, 'STALEMATE');
        assert.equal(final.challenge?.failureExplanation, null);
      }
    } finally { session.destroy(); }
  }
});
