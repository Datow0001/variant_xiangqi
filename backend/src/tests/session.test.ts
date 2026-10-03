import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSession } from '../session';
import { GameError } from '../errors';
import { DEFAULT_XIANGQI_FEN } from '../../../shared/fen';
import { TestEngine, deferred } from './helpers';

test('invalid configurations allocate no engine', () => {
  let created = 0;
  assert.throws(() => new GameSession({ budget: 100 }, { engineFactory: () => { created++; return new TestEngine(); } }));
  assert.throws(() => new GameSession({}, { initialFen: 'bad', engineFactory: () => { created++; return new TestEngine(); } }));
  assert.equal(created, 0);
});
test('default red PVE completes one player move and AI reply with history', async () => {
  const engine = new TestEngine();
  const states: string[] = [];
  const session = new GameSession({}, { engineFactory: () => engine, onState: state => states.push(state.status) });
  try {
    await session.init();
    const state = await session.makePlayerMove('b0', 'c2', 0);
    assert.equal(state.currentTurn, 'red'); assert.equal(state.version, 2); assert.equal(state.status, 'READY');
    assert.equal(session.history.length, 2); assert.equal(session.initialFen, DEFAULT_XIANGQI_FEN);
    assert.deepEqual(states, ['AI_THINKING']);
    await assert.rejects(session.makePlayerMove('a0', 'a1', 0), { code: 'STALE_STATE' });
  } finally { session.destroy(); }
});
test('PVP rejects concurrent moves and does not invoke AI', async () => {
  const engine = new TestEngine(); const session = new GameSession({ gameMode: 'PVP' }, { engineFactory: () => engine });
  try {
    await session.init(); const delay = deferred(); engine.legalDelay = delay.promise;
    const first = session.makePlayerMove('b0', 'c2', 0);
    assert.equal(session.getState().status, 'PROCESSING');
    assert.equal(session.getState().legalMoves.length, 0);
    await assert.rejects(session.makePlayerMove('b0', 'c2', 0), { code: 'SESSION_BUSY' });
    delay.resolve(); await first;
    assert.equal(session.version, 1); assert.equal(session.currentTurn, 'black');
  } finally { session.destroy(); }
});
test('server-authored black-to-move FEN determines turn and terminal start skips AI', async () => {
  const engine = new TestEngine();
  const session = new GameSession({ playerColor: 'black' }, { initialFen: DEFAULT_XIANGQI_FEN.replace(' w ', ' b '), engineFactory: () => engine });
  await session.init(); assert.equal(session.currentTurn, 'black'); assert.equal(session.version, 0); session.destroy();
  const terminal = new TestEngine(); terminal.noMoves = true; terminal.checked = true;
  const ended = new GameSession({ playerColor: 'red' }, { initialFen: DEFAULT_XIANGQI_FEN.replace(' w ', ' b '), engineFactory: () => terminal });
  await ended.init(); assert.equal(ended.winner, 'red'); assert.equal(ended.gameOverReason, 'CHECKMATE'); assert.equal(terminal.destroyed, 1);
});
test('resignation during search prevents a late AI result from changing final board', async () => {
  const engine = new TestEngine(); const searching = deferred(); const release = deferred();
  engine.searchDelay = release.promise;
  const session = new GameSession({}, { engineFactory: () => engine, onState: () => searching.resolve() });
  await session.init(); const move = session.makePlayerMove('b0', 'c2', 0);
  await searching.promise;
  const state = session.resign(); release.resolve();
  await assert.rejects(move);
  assert.equal(session.fen, state.fen); assert.equal(session.winner, 'black'); assert.equal(session.status, 'FINISHED');
  assert.equal(session.history.length, 1);
});
test('engine faults never count as a player defeat', async () => {
  const engine = new TestEngine(); engine.invalidBest = true;
  const session = new GameSession({}, { engineFactory: () => engine });
  await session.init();
  await assert.rejects(session.makePlayerMove('b0', 'c2'), { code: 'ENGINE_INVALID_MOVE' });
  assert.equal(session.status, 'FAULTED'); assert.equal(session.winner, null); assert.equal(session.isGameOver, false);
  const idleEngine = new TestEngine(); const idle = new GameSession({}, { engineFactory: () => idleEngine });
  await idle.init(); idleEngine.onFailure?.(new GameError('ENGINE_EXITED', 'exit'));
  assert.equal(idle.status, 'FAULTED'); idle.destroy();
});
test('real engine accepts authored residual positions and detects terminal checkmate', async () => {
  const session = new GameSession({ playerColor: 'black' }, { initialFen: '4k4/9/9/9/4p4/9/9/9/9/4K4 b - - 0 1' });
  try { await session.init(); assert.equal(session.currentTurn, 'black'); assert.ok(session.legalMoves.length > 0); } finally { session.destroy(); }
  const mate = new GameSession({}, { initialFen: '4k4/3RRR3/9/9/9/9/9/9/9/4K4 b - - 0 1' });
  try { await mate.init(); assert.equal(mate.isGameOver, true); assert.equal(mate.winner, 'red'); assert.equal(mate.gameOverReason, 'CHECKMATE'); } finally { mate.destroy(); }
});
test('real PVE black player receives AI opening move and full budget stage remains valid', async () => {
  const black = new GameSession({ playerColor: 'black', stageId: 1 });
  try { await black.init(); assert.equal(black.currentTurn, 'black'); assert.equal(black.version, 1); assert.equal(black.status, 'READY'); } finally { black.destroy(); }
  const stage3 = new GameSession({ stageId: 3 });
  try { await stage3.init(); assert.equal(stage3.aiLoadouts.length, 5); assert.ok(stage3.legalMoves.length > 0); } finally { stage3.destroy(); }
});
