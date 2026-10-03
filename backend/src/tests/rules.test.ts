import test from 'node:test';
import assert from 'node:assert/strict';
import { FairyEngine } from '../FairyEngine';
import { position } from '../challenges/model';
import { generateCustomFen, fenToBoard } from '../../../shared/fen';
import { LoadoutItem } from '../../../shared/types';

// These fixtures assert the actual engine's legal moves; they never generate game moves.
test('real engine matches all four upgrade descriptions for both colors', async () => {
  const engine = new FairyEngine();
  try {
    await engine.waitReady();
    for (const black of [false, true]) {
      const square = (s: string) => black ? s[0] + (9 - Number(s[1])) : s;
      const symbol = (p: string) => !black ? p : p === p.toUpperCase() ? p.toLowerCase() : p.toUpperCase();
      async function check(label: string, pieces: Record<string, string>, from: string, to: string, expected: boolean) {
        const board = Object.fromEntries(Object.entries({ e0: 'K', f9: 'k', ...pieces }).map(([s, p]) => [square(s), symbol(p)]));
        const legal = await engine.getLegalMoves(position(board, black ? 'b' : 'w'));
        assert.equal(legal.some(m => m.from === square(from) && m.to === square(to)), expected, `${black ? 'black' : 'red'}: ${label}`);
      }
      for (const p of ['N', 'U']) {
        await check(`${p} clear horse leg`, { c3: p }, 'c3', 'd5', true);
        for (const blocker of ['R', 'r']) await check(`${p} occupied horse leg ${blocker}`, { c3: p, c4: blocker }, 'c3', 'd5', p === 'U');
        await check(`${p} still moves in an L`, { c3: p }, 'c3', 'e5', false);
        await check(`${p} cannot capture own piece`, { c3: p, d5: 'R' }, 'c3', 'd5', false);
      }
      for (const p of ['B', 'F']) {
        await check(`${p} river restriction`, { c4: p, a6: 'p' }, 'c4', 'a6', p === 'F');
        await check(`${p} empty eye on own side`, { c4: p }, 'c4', 'a2', true);
        for (const blocker of ['R', 'r']) {
          await check(`${p} occupied eye ${blocker}`, { c4: p, b3: blocker }, 'c4', 'a2', false);
          await check(`${p} occupied eye across river ${blocker}`, { c4: p, b5: blocker, a6: 'p' }, 'c4', 'a6', false);
        }
        await check(`${p} cannot capture own piece`, { c4: p, a2: 'R' }, 'c4', 'a2', false);
        await check(`${p} cannot move one diagonal square`, { c4: p }, 'c4', 'b5', false);
      }
      for (const p of ['C', 'M']) {
        await check(`${p} travels on empty file`, { a3: p }, 'a3', 'a6', true);
        await check(`${p} cannot jump to an empty square`, { a3: p, a4: 'P' }, 'a3', 'a6', false);
        await check(`${p} distant capture needs screen`, { a3: p, a6: 'r' }, 'a3', 'a6', false);
        for (const screen of ['P', 'p']) await check(`${p} one screen ${screen}`, { a3: p, a4: screen, a6: 'r' }, 'a3', 'a6', true);
        await check(`${p} two screens fail`, { a3: p, a4: 'P', a5: 'p', a6: 'r' }, 'a3', 'a6', false);
        await check(`${p} cannot capture own piece`, { a3: p, a4: 'P', a6: 'R' }, 'a3', 'a6', false);
        for (const target of ['c4', 'e4', 'd3', 'd5']) await check(`${p} adjacent ${target}`, { d4: p, [target]: 'r' }, 'd4', target, p === 'M');
        await check(`${p} diagonal capture forbidden`, { d4: p, c5: 'r' }, 'd4', 'c5', false);
      }
      for (const p of ['P', 'S']) {
        await check(`${p} forward`, { c3: p, c4: 'r' }, 'c3', 'c4', true);
        await check(`${p} never backward`, { c3: p }, 'c3', 'c2', false);
        for (const target of ['b3', 'd3']) await check(`${p} before river ${target}`, { c3: p, [target]: 'r' }, 'c3', target, p === 'S');
        await check(`${p} after river sideways`, { c5: p, b5: 'r' }, 'c5', 'b5', true);
        await check(`${p} after river never backward`, { c5: p }, 'c5', 'c4', false);
        await check(`${p} cannot capture own piece`, { c5: p, b5: 'R' }, 'c5', 'b5', false);
      }
    }
  } finally { engine.destroy(); }
});

test('real engine excludes self-check, facing kings, palace escapes and illegal check evasions', async () => {
  const engine = new FairyEngine();
  try {
    await engine.waitReady();
    const pinned = position({ e0: 'K', e9: 'k', e4: 'R' });
    assert.ok(!(await engine.getLegalMoves(pinned)).some(m => m.from === 'e4' && m.to === 'd4'));
    const checked = position({ e0: 'K', f9: 'k', a0: 'r', a3: 'R' });
    assert.equal(await engine.isCheck(checked), true);
    const moves = await engine.getLegalMoves(checked);
    assert.ok(!moves.some(m => m.from === 'a3' && m.to === 'a4'));
    assert.ok(moves.some(m => m.from === 'a3' && m.to === 'a0'));
    const palace = await engine.getLegalMoves(position({ d0: 'K', f9: 'k', e1: 'A' }));
    assert.ok(!palace.some(m => m.from === 'd0' && m.to === 'c0'));
    assert.deepEqual(palace.filter(m => m.from === 'e1').map(m => m.to).sort(), ['d2', 'f0', 'f2']);
  } finally { engine.destroy(); }
});

test('mixed opening upgrades introduce no new back-rank captures over traditional xiangqi', async () => {
  const choices: LoadoutItem[] = [
    { position: 'b0', upgradeId: 'TIAN_MA' }, { position: 'c0', upgradeId: 'FEI_XIANG' },
    { position: 'b2', upgradeId: 'PO_JI_PAO' }, { position: 'a3', upgradeId: 'TU_JI_BING' },
  ];
  const engine = new FairyEngine();
  try {
    await engine.waitReady();
    const baseline = new Map<string, Set<string>>();
    for (const turn of ['w', 'b']) {
      const fen = generateCustomFen([], []).replace(' w ', ` ${turn} `);
      // Traditional cannon captures b2-b9/h2-h9 already exist in the initial position.
      baseline.set(turn, new Set((await engine.getLegalMoves(fen)).map(m => m.from + m.to)));
    }
    // All 16 subsets of this mixed 9-point loadout, including each upgrade alone.
    for (let mask = 0; mask < 16; mask++) {
      const loadout = choices.filter((_, i) => mask & (1 << i));
      const black = loadout.map(item => ({ ...item, position: item.position[0] + (9 - Number(item.position[1])) }));
      const fen = generateCustomFen(loadout, black);
      for (const turn of ['w', 'b']) {
        const board = fenToBoard(fen);
        for (const m of await engine.getLegalMoves(fen.replace(' w ', ` ${turn} `))) {
          const rank = Number(m.to[1]), piece = board[9 - rank][m.to.charCodeAt(0) - 97];
          if (rank === (turn === 'w' ? 9 : 0) && piece !== '.') {
            assert.ok(baseline.get(turn)!.has(m.from + m.to), `new opening back-rank capture: ${turn} ${m.from}${m.to}`);
          }
        }
      }
    }
  } finally { engine.destroy(); }
});
