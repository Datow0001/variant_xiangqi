import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStart, parseAction, validateLoadouts } from '../validation';
import { applyMoveToFen, DEFAULT_XIANGQI_FEN, validateInitialFen } from '../../../shared/fen';
import { engineToAppMove, uciToPos } from '../../../shared/coordinates';

test('normalize defaults and validate standard budgets and original pieces', () => {
  assert.deepEqual(normalizeStart({}), { gameMode: 'PVE', budget: 10, stageId: 1, playerColor: 'red', loadouts: [] });
  assert.equal(validateLoadouts([{ position: 'b0', upgradeId: 'TIAN_MA' }], 'red').length, 1);
  for (const value of [null, [], { gameMode: 'BAD' }, { budget: 100 }, { stageId: 4 }, { playerColor: 'white' }, { initialFen: DEFAULT_XIANGQI_FEN }]) assert.throws(() => normalizeStart(value));
  for (const items of [
    [{ position: 'e0', upgradeId: 'TIAN_MA' }], [{ position: 'b9', upgradeId: 'TIAN_MA' }],
    [{ position: 'b0', upgradeId: 'TIAN_MA' }, { position: 'b0', upgradeId: 'TIAN_MA' }],
    [{ position: 'z0', upgradeId: 'TIAN_MA' }], [{ position: 'b0', upgradeId: '__proto__' }],
  ]) assert.throws(() => validateLoadouts(items, 'red'));
  const over = [
    { position: 'b0', upgradeId: 'TIAN_MA' }, { position: 'h0', upgradeId: 'TIAN_MA' },
    { position: 'b2', upgradeId: 'PO_JI_PAO' }, { position: 'h2', upgradeId: 'PO_JI_PAO' },
  ];
  assert.throws(() => normalizeStart({ loadouts: over }), { code: 'BUDGET_EXCEEDED' });
  assert.throws(() => normalizeStart({ gameMode: 'PVP', blackLoadouts: over }), { code: 'INVALID_PAYLOAD' });
  assert.throws(() => normalizeStart({ gameMode: 'PVP', redLoadouts: over }), { code: 'BUDGET_EXCEEDED' });
});
test('protocol requires request ids, valid coordinates and safe versions', () => {
  assert.throws(() => parseAction({ action: 'START_GAME', payload: {} }));
  assert.throws(() => parseAction({ requestId: 'x', action: 'MAKE_MOVE', payload: { gameId: 'g', from: 'a0', to: 'a1' } }));
  assert.equal(parseAction({ requestId: 'x', action: 'START_GAME', payload: {} }).action, 'START_GAME');
  assert.throws(() => uciToPos('a10'));
  assert.deepEqual(engineToAppMove('b10c8'), { from: 'b9', to: 'c7' });
  assert.throws(() => engineToAppMove('b11c8'));
});
test('authored FEN validation and move counters', () => {
  validateInitialFen(DEFAULT_XIANGQI_FEN);
  validateInitialFen('4k4/3RPR3/9/9/9/9/9/9/9/4K4 b - - 0 1');
  for (const fen of [
    DEFAULT_XIANGQI_FEN.replace('rnbakabnr', 'rnbakabn'), DEFAULT_XIANGQI_FEN.replace('RNBAKABNR', 'RNBAAABNR'),
    DEFAULT_XIANGQI_FEN.replace(' w ', ' x '), DEFAULT_XIANGQI_FEN + '\nquit',
    '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1',
    DEFAULT_XIANGQI_FEN.replace('rnbakabnr', 'rnbqkabnr'),
  ]) assert.throws(() => validateInitialFen(fen));
  let fen = applyMoveToFen(DEFAULT_XIANGQI_FEN, 'b0', 'c2');
  assert.equal(fen.split(' ').slice(1).join(' '), 'b - - 1 1');
  fen = applyMoveToFen(fen, 'b9', 'c7');
  assert.equal(fen.split(' ').slice(1).join(' '), 'w - - 2 2');
  fen = applyMoveToFen(fen, 'a3', 'a4');
  assert.equal(fen.split(' ')[4], '0');
});

test('authored positions enforce original material limits including upgraded pieces for both colors', () => {
  for (const color of ['red', 'black']) {
    for (const symbols of ['rrr', 'nnu', 'uunn', 'bbf', 'ccm', 'aaa', 'ppppps']) {
      const pieces = color === 'red' ? symbols.toUpperCase() : symbols;
      const fen = `4k4/9/${pieces}${9 - pieces.length}/9/9/4P4/9/9/9/4K4 w - - 0 1`;
      assert.throws(() => validateInitialFen(fen), /Piece inventory exceeded/, `${color}: ${symbols}`);
    }
  }
  const upgraded = DEFAULT_XIANGQI_FEN.replace(/n/g, 'u').replace(/N/g, 'U').replace(/b/g, 'f').replace(/B/g, 'F')
    .replace(/c/g, 'm').replace(/C/g, 'M').replace(/p/g, 's').replace(/P/g, 'S');
  assert.doesNotThrow(() => validateInitialFen(upgraded));
});
