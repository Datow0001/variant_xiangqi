import test from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { createGameServer } from '../server';
import { TestEngine, deferred } from './helpers';
import { GameSocket } from '../../../frontend/src/services/websocket';

test('frontend transport recovers a dropped socket and restores the current snapshot', async () => {
  const app = createGameServer({ engineFactory: () => new TestEngine() });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  let resume: { gameId: string; resumeToken: string } | null = null;
  let version = -1;
  const restored = deferred(); const statuses: string[] = [];
  const socket = new GameSocket({
    onEvent: event => {
      if (event.event === 'GAME_STARTED') { resume = { gameId: event.payload.state.gameId, resumeToken: event.payload.resumeToken }; version = event.payload.state.version; }
      if (event.event === 'GAME_STATE') version = event.payload.version;
    },
    onStatus: status => statuses.push(status),
    shouldReconnect: () => !!resume,
    onRecoveryExpired: () => {},
    onReconnected: () => { void socket.request({ action: 'RECONNECT', payload: resume! }).then(() => { socket.recovered(); restored.resolve(); }); },
  }, { url, retryMs: 10 });
  try {
    await socket.connect();
    const event = await socket.request({ action: 'START_GAME', payload: { gameMode: 'PVP' } });
    assert.equal(event.event, 'GAME_STARTED');
    await socket.request({ action: 'MAKE_MOVE', payload: { gameId: resume!.gameId, from: 'b0', to: 'c2', expectedVersion: 0 } });
    for (const ws of app.wss.clients) ws.terminate();
    await restored.promise;
    assert.equal(version, 1); assert.ok(statuses.includes('RECONNECTING')); assert.equal(app.manager.size, 1);
  } finally { resume = null; socket.stop(); await app.close(); }
});
test('frontend request timeout clears pending work and reconnection does not replay the move', async () => {
  const engine = new TestEngine(); const searching = deferred(); const release = deferred();
  engine.searchDelay = release.promise;
  const app = createGameServer({ engineFactory: () => engine });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  let resume: { gameId: string; resumeToken: string } | null = null;
  let recovered = false;
  const restored = deferred();
  const socket = new GameSocket({
    onEvent: event => {
      if (event.event === 'GAME_STARTED') resume = { gameId: event.payload.state.gameId, resumeToken: event.payload.resumeToken };
      if (event.event === 'GAME_STATE' && event.payload.status === 'AI_THINKING') searching.resolve();
    }, onStatus: () => {}, shouldReconnect: () => !!resume, onRecoveryExpired: () => {},
    onReconnected: () => { void socket.request({ action: 'RECONNECT', payload: resume! }).then(() => { recovered = true; restored.resolve(); }); },
  }, { url: `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}`, retryMs: 10, requestTimeoutMs: 100 });
  try {
    await socket.connect(); await socket.request({ action: 'START_GAME', payload: {} });
    const pending = socket.request({ action: 'MAKE_MOVE', payload: { gameId: resume!.gameId, from: 'b0', to: 'c2', expectedVersion: 0 } });
    const rejection = assert.rejects(pending, { code: 'REQUEST_TIMEOUT' });
    await searching.promise; await rejection; await restored.promise;
    assert.equal(recovered, true); release.resolve();
    // The server continues its existing search; no second player move is sent.
    await socket.request({ action: 'RESIGN', payload: { gameId: resume!.gameId } });
    assert.equal(app.manager.engineCount, 0);
  } finally { resume = null; release.resolve(); socket.stop(); await app.close(); }
});

test('foreground refresh replaces an apparently open socket, rejects ambiguous moves and restores the server snapshot', async () => {
  const engine = new TestEngine(); const searching = deferred(), release = deferred(); engine.searchDelay = release.promise;
  const app = createGameServer({ engineFactory: () => engine });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  let resume: { gameId: string; resumeToken: string } | null = null;
  let version = -1, automaticReconnects = 0;
  const socket = new GameSocket({
    onEvent: event => {
      if (event.event === 'GAME_STARTED') resume = { gameId: event.payload.state.gameId, resumeToken: event.payload.resumeToken };
      if (event.event === 'GAME_STATE') { version = event.payload.version; if (event.payload.status === 'AI_THINKING') searching.resolve(); }
    }, onStatus: () => {}, shouldReconnect: () => !!resume, onRecoveryExpired: () => {},
    onReconnected: () => { automaticReconnects++; },
  }, { url: `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}` });
  try {
    await socket.connect(); await socket.request({ action: 'START_GAME', payload: {} });
    const move = socket.request({ action: 'MAKE_MOVE', payload: { gameId: resume!.gameId, from: 'b0', to: 'c2', expectedVersion: 0 } });
    const rejected = assert.rejects(move, { code: 'CONNECTION_LOST' });
    await searching.promise; await socket.refreshConnection(); await rejected;
    const restored = await socket.request({ action: 'RECONNECT', payload: resume! });
    assert.equal(restored.event, 'GAME_STATE'); assert.equal(version, 1);
    assert.equal(automaticReconnects, 0); assert.equal(app.manager.size, 1);
    release.resolve(); await socket.request({ action: 'RESIGN', payload: { gameId: resume!.gameId } });
    assert.equal(app.manager.engineCount, 0);
  } finally { resume = null; release.resolve(); socket.stop(); await app.close(); }
});
