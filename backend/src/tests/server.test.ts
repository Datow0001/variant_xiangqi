import test from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { ServerEvent } from '../../../shared/types';
import { createGameServer, ServerOptions } from '../server';
import { TestEngine, deferred } from './helpers';

async function harness(options: ServerOptions = {}) {
  const app = createGameServer(options);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const port = (app.server.address() as AddressInfo).port;
  const clients: WebSocket[] = [];
  async function connect() {
    const serverConnection = new Promise<WebSocket>(resolve => app.wss.once('connection', resolve));
    const ws = new WebSocket(`ws://127.0.0.1:${port}`); clients.push(ws);
    const backlog: ServerEvent[] = [];
    const waiters = new Set<{ predicate: (event: ServerEvent) => boolean; resolve: (event: ServerEvent) => void }>();
    ws.on('message', raw => {
      const event = JSON.parse(raw.toString()) as ServerEvent;
      const waiter = [...waiters].find(w => w.predicate(event));
      if (waiter) { waiters.delete(waiter); waiter.resolve(event); } else backlog.push(event);
    });
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const serverSocket = await serverConnection;
    function wait(predicate: (event: ServerEvent) => boolean): Promise<ServerEvent> {
      const index = backlog.findIndex(predicate);
      if (index !== -1) return Promise.resolve(backlog.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiters.delete(waiter); reject(new Error('Server event timeout')); }, 7000);
        const waiter = { predicate, resolve: (event: ServerEvent) => { clearTimeout(timer); resolve(event); } };
        waiters.add(waiter);
      });
    }
    function request(action: string, payload: object, requestId = randomUUID()) {
      const result = wait(event => event.requestId === requestId);
      ws.send(JSON.stringify({ action, payload, requestId })); return result;
    }
    async function disconnect() {
      const closed = new Promise<void>(resolve => ws.once('close', () => resolve()));
      const serverClosed = new Promise<void>(resolve => serverSocket.once('close', () => resolve()));
      ws.close(); await Promise.all([closed, serverClosed]);
    }
    return { ws, wait, request, disconnect };
  }
  return { app, port, connect, async close() { for (const ws of clients) ws.terminate(); await app.close(); } };
}
function started(event: ServerEvent) { assert.equal(event.event, 'GAME_STARTED'); if (event.event !== 'GAME_STARTED') throw new Error('Not started'); return event.payload; }
function state(event: ServerEvent) { assert.equal(event.event, 'GAME_STATE'); if (event.event !== 'GAME_STATE') throw new Error('Not state'); return event.payload; }
function error(event: ServerEvent, code: string) { assert.equal(event.event, 'ERROR'); if (event.event === 'ERROR') assert.equal(event.payload.code, code); }

test('challenge catalogue, hint deduplication across reconnect, terminal recovery and retry use production sockets', async () => {
  const h = await harness();
  try {
    const owner = await h.connect();
    const catalogue = await owner.request('LIST_CHALLENGES', {});
    assert.equal(catalogue.event, 'CHALLENGE_LIST');
    if (catalogue.event === 'CHALLENGE_LIST') { assert.equal(catalogue.payload.length, 12); assert.equal('hintBranches' in catalogue.payload[0], false); assert.equal('referenceLoadouts' in catalogue.payload[0], false); }
    const game = started(await owner.request('START_GAME', { gameMode: 'CHALLENGE', challengeId: 'rook-mate' }));
    const hintPayload = { gameId: game.state.gameId, level: 'DIRECTION', expectedVersion: 0 }; const hintId = randomUUID();
    const hint = await owner.request('REQUEST_HINT', hintPayload, hintId);
    assert.equal(hint.event, 'CHALLENGE_HINT');
    await owner.disconnect(); const restored = await h.connect();
    const restoredState = state(await restored.request('RECONNECT', { gameId: game.state.gameId, resumeToken: game.resumeToken }));
    assert.equal(restoredState.challenge?.directionHintUses, 1);
    const duplicate = await restored.request('REQUEST_HINT', hintPayload, hintId);
    assert.equal(duplicate.event, 'CHALLENGE_HINT');
    if (duplicate.event === 'CHALLENGE_HINT') assert.equal(duplicate.payload.state.challenge?.directionHintUses, 1);
    const final = state(await restored.request('MAKE_MOVE', { gameId: game.state.gameId, from: 'e7', to: 'e8', expectedVersion: 0 }));
    assert.equal(final.challenge?.stars, 2); assert.equal(final.challenge?.outcome, 'SUCCEEDED');
    await restored.disconnect(); const next = await h.connect();
    assert.deepEqual(state(await next.request('RECONNECT', { gameId: game.state.gameId, resumeToken: game.resumeToken })).challenge, final.challenge);
    const retry = started(await next.request('START_GAME', { gameMode: 'CHALLENGE', challengeId: 'rook-mate' }));
    assert.notEqual(retry.state.gameId, game.state.gameId); assert.equal(retry.state.challenge?.playerMoves, 0);
    assert.equal(retry.state.challenge?.directionHintUses, 0); assert.equal(h.app.manager.size, 1);
  } finally { await h.close(); }
});

test('real production server handles PVE, versioned moves and resignation', async () => {
  const h = await harness();
  try {
    const client = await h.connect(); const game = started(await client.request('START_GAME', { stageId: 2, loadouts: [{ position: 'b0', upgradeId: 'TIAN_MA' }] }));
    assert.equal(game.state.status, 'READY');
    const thinking = client.wait(event => event.event === 'GAME_STATE' && event.payload.status === 'AI_THINKING');
    const move = client.request('MAKE_MOVE', { gameId: game.state.gameId, from: 'b0', to: 'c2', expectedVersion: 0 });
    await thinking; const moved = state(await move);
    assert.equal(moved.currentTurn, 'red'); assert.equal(moved.version, 2);
    error(await client.request('MAKE_MOVE', { gameId: game.state.gameId, from: 'a0', to: 'a1', expectedVersion: 0 }), 'STALE_STATE');
    const final = state(await client.request('RESIGN', { gameId: game.state.gameId }));
    assert.equal(final.winner, 'black'); assert.equal(final.status, 'FINISHED'); assert.equal(h.app.manager.engineCount, 0);
    assert.equal((await fetch(`http://127.0.0.1:${h.port}/api/health`)).status, 200);
  } finally { await h.close(); }
});
test('PVP duplicate request executes once, request id conflicts and invalid move are explicit', async () => {
  const h = await harness();
  try {
    const client = await h.connect(); const game = started(await client.request('START_GAME', { gameMode: 'PVP' }));
    const payload = { gameId: game.state.gameId, from: 'b0', to: 'c2', expectedVersion: 0 };
    const requestId = randomUUID();
    assert.equal(state(await client.request('MAKE_MOVE', payload, requestId)).version, 1);
    assert.equal(state(await client.request('MAKE_MOVE', payload, requestId)).version, 1);
    error(await client.request('MAKE_MOVE', { ...payload, to: 'a2' }, requestId), 'REQUEST_CONFLICT');
    error(await client.request('MAKE_MOVE', { ...payload, from: 'e9', to: 'e0', expectedVersion: 1 }), 'ILLEGAL_MOVE');
    assert.equal(state(await client.request('MAKE_MOVE', { gameId: game.state.gameId, from: 'b9', to: 'c7', expectedVersion: 1 })).version, 2);
  } finally { await h.close(); }
});
test('reconnect credentials protect ownership and survive old socket closure and duplicate retry', async () => {
  const h = await harness();
  try {
    const owner = await h.connect(); const game = started(await owner.request('START_GAME', { gameMode: 'PVP' }));
    const payload = { gameId: game.state.gameId, from: 'b0', to: 'c2', expectedVersion: 0 }; const id = randomUUID();
    await owner.request('MAKE_MOVE', payload, id);
    const intruder = await h.connect();
    error(await intruder.request('RESIGN', { gameId: game.state.gameId }), 'SESSION_FORBIDDEN');
    error(await intruder.request('RECONNECT', { gameId: game.state.gameId, resumeToken: 'wrong' }), 'SESSION_FORBIDDEN');
    const restored = state(await intruder.request('RECONNECT', { gameId: game.state.gameId, resumeToken: game.resumeToken }));
    assert.equal(restored.version, 1);
    assert.equal(state(await intruder.request('MAKE_MOVE', payload, id)).version, 1);
    assert.equal(h.app.manager.size, 1);
    await intruder.disconnect();
    const refreshed = await h.connect();
    assert.equal(state(await refreshed.request('RECONNECT', { gameId: game.state.gameId, resumeToken: game.resumeToken })).version, 1);
    assert.equal((await refreshed.request('LEAVE_GAME', { gameId: game.state.gameId })).event, 'GAME_LEFT');
    assert.equal(h.app.manager.size, 0);
  } finally { await h.close(); }
});
test('replacement, expiration, idle timeout and capacity release engines', async () => {
  const engines: TestEngine[] = [];
  const h = await harness({ maxEngines: 1, reconnectMs: 1000, idleMs: 5000, resultMs: 1000, engineFactory: () => { const engine = new TestEngine(); engines.push(engine); return engine; } });
  try {
    const a = await h.connect(); const b = await h.connect();
    const old = started(await a.request('START_GAME', {}));
    error(await b.request('START_GAME', {}), 'SERVER_BUSY');
    const next = started(await a.request('START_GAME', {}));
    assert.notEqual(next.state.gameId, old.state.gameId); assert.equal(engines[0].destroyed, 1); assert.equal(h.app.manager.size, 1);
    await a.disconnect(); h.app.manager.sweep(Date.now() + 1001);
    assert.equal(h.app.manager.size, 0); assert.equal(engines[1].destroyed, 1);
    error(await b.request('RECONNECT', { gameId: next.state.gameId, resumeToken: next.resumeToken }), 'SESSION_EXPIRED');
    await b.request('START_GAME', {}); h.app.manager.sweep(Date.now() + 5001);
    assert.equal(h.app.manager.size, 0); assert.equal(engines[2].destroyed, 1);
  } finally { await h.close(); }
});
test('invalid JSON/config creates no engine, initialization failure cleans resources', async () => {
  const engines: TestEngine[] = [];
  const h = await harness({ engineFactory: () => { const engine = new TestEngine(); engine.failReady = true; engines.push(engine); return engine; } });
  try {
    const c = await h.connect(); const malformed = c.wait(event => event.event === 'ERROR'); c.ws.send('{'); error(await malformed, 'INVALID_PAYLOAD');
    error(await c.request('START_GAME', { budget: 100 }), 'INVALID_PAYLOAD'); assert.equal(engines.length, 0);
    error(await c.request('START_GAME', {}), 'ENGINE_UNAVAILABLE'); assert.equal(h.app.manager.size, 0); assert.ok(engines[0].destroyed >= 1);
    assert.equal((await fetch(`http://127.0.0.1:${h.port}/%2e%2e%2fREADME.md`)).status, 403);
  } finally { await h.close(); }
});
test('disconnect while initialization is pending releases the unannounced game', async () => {
  const delay = deferred(); const engine = new TestEngine(); engine.legalDelay = delay.promise;
  const initialized = deferred(); engine.onLegal = () => initialized.resolve();
  const h = await harness({ engineFactory: () => engine });
  try {
    const c = await h.connect(); c.ws.send(JSON.stringify({ requestId: 'start', action: 'START_GAME', payload: {} }));
    await initialized.promise;
    await c.disconnect(); delay.resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(h.app.manager.size, 0); assert.ok(engine.destroyed >= 1);
  } finally { await h.close(); }
});
test('resign during AI search returns final state to both requests and expires result snapshot', async () => {
  const engine = new TestEngine(); const release = deferred(); engine.searchDelay = release.promise;
  const h = await harness({ resultMs: 1000, engineFactory: () => engine });
  try {
    const c = await h.connect(); const game = started(await c.request('START_GAME', {}));
    const thinking = c.wait(event => event.event === 'GAME_STATE' && event.payload.status === 'AI_THINKING');
    const move = c.request('MAKE_MOVE', { gameId: game.state.gameId, from: 'b0', to: 'c2', expectedVersion: 0 });
    await thinking;
    const final = state(await c.request('RESIGN', { gameId: game.state.gameId }));
    release.resolve();
    const acknowledged = state(await move);
    assert.equal(acknowledged.fen, final.fen); assert.equal(acknowledged.status, 'FINISHED'); assert.equal(acknowledged.version, 2);
    assert.equal(h.app.manager.engineCount, 0); assert.equal(h.app.manager.size, 1);
    h.app.manager.sweep(Date.now() + 1001); assert.equal(h.app.manager.size, 0);
  } finally { release.resolve(); await h.close(); }
});
