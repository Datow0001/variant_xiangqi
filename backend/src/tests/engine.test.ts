import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ChildProcessWithoutNullStreams } from 'node:child_process';
import { FairyEngine } from '../FairyEngine';
import { DEFAULT_XIANGQI_FEN } from '../../../shared/fen';

function processStub(reply?: (command: string, output: PassThrough) => void) {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let killed = 0; let pending = '';
  child.kill = () => { killed++; return true; };
  child.stdin.on('data', chunk => {
    pending += chunk.toString();
    let index: number;
    while ((index = pending.indexOf('\n')) !== -1) {
      const command = pending.slice(0, index); pending = pending.slice(index + 1);
      queueMicrotask(() => reply?.(command, child.stdout as PassThrough));
    }
  });
  return { child, killed: () => killed };
}
test('serialized queries do not consume another query response', async () => {
  const commands: string[] = [];
  const stub = processStub((command, output) => {
    commands.push(command);
    if (command === 'isready') output.write('readyok\n');
    if (command === 'go perft 1') output.write('b1c3: 1\nNodes searched: 1\n');
    if (command === 'd') output.write('Checkers:\n');
  });
  const engine = new FairyEngine(undefined, undefined, undefined, { spawnProcess: () => stub.child });
  await engine.waitReady();
  const [moves, check] = await Promise.all([engine.getLegalMoves(DEFAULT_XIANGQI_FEN), engine.isCheck(DEFAULT_XIANGQI_FEN)]);
  assert.deepEqual(moves, [{ from: 'b0', to: 'c2' }]); assert.equal(check, false);
  assert.ok(commands.indexOf('go perft 1') < commands.indexOf('d'));
  engine.destroy(); engine.destroy(); assert.equal(stub.killed(), 1);
});
test('query timeout destroys stream and rejects queued queries', async () => {
  const stub = processStub((command, output) => { if (command === 'isready') output.write('readyok\n'); });
  const engine = new FairyEngine(undefined, undefined, undefined, { spawnProcess: () => stub.child, queryTimeoutMs: 20 });
  await engine.waitReady();
  const first = engine.getLegalMoves(DEFAULT_XIANGQI_FEN); const next = engine.isCheck(DEFAULT_XIANGQI_FEN);
  await Promise.all([assert.rejects(first, { code: 'ENGINE_TIMEOUT' }), assert.rejects(next, { code: 'ENGINE_TIMEOUT' })]);
  assert.equal(stub.killed(), 1);
});
test('process exit cancels pending queries immediately', async () => {
  const stub = processStub((command, output) => { if (command === 'isready') output.write('readyok\n'); });
  const engine = new FairyEngine(undefined, undefined, undefined, { spawnProcess: () => stub.child });
  await engine.waitReady();
  const waiting = engine.getLegalMoves(DEFAULT_XIANGQI_FEN);
  await Promise.resolve(); await Promise.resolve(); stub.child.emit('exit', 1);
  await assert.rejects(waiting, { code: 'ENGINE_EXITED' }); assert.equal(stub.killed(), 1);
});
test('initialization timeout and missing binary fail without an unhandled process error', async () => {
  const stub = processStub();
  const engine = new FairyEngine(undefined, undefined, undefined, { spawnProcess: () => stub.child, initTimeoutMs: 20 });
  await assert.rejects(engine.waitReady(), { code: 'ENGINE_INIT_TIMEOUT' }); assert.equal(stub.killed(), 1);
  const missing = new FairyEngine('Z:/does-not-exist/fairy-stockfish');
  await assert.rejects(missing.waitReady(), { code: 'ENGINE_UNAVAILABLE' }); missing.destroy();
});
