import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import type { ServerEvent } from '../../shared/types';
import { createGameServer } from './server';

class SmokeClient {
  private socket: WebSocket;
  private pending = new Map<string, { resolve: (event: ServerEvent) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  gameId: string | null = null;
  constructor(url: string) {
    this.socket = new WebSocket(url, { handshakeTimeout: 15000 });
    this.socket.on('message', raw => {
      try {
        const event = JSON.parse(raw.toString()) as ServerEvent;
        if (event.event === 'GAME_STARTED') this.gameId = event.payload.state.gameId;
        const waiter = event.requestId ? this.pending.get(event.requestId) : undefined;
        if (!waiter || !event.requestId) return;
        clearTimeout(waiter.timer); this.pending.delete(event.requestId);
        if (event.event === 'ERROR') waiter.reject(new Error(`Server error: ${event.payload.code}`));
        else waiter.resolve(event);
      } catch { this.fail(new Error('Malformed server response')); }
    });
    this.socket.on('error', () => this.fail(new Error('WebSocket connection failed')));
    this.socket.on('close', () => this.fail(new Error('WebSocket closed before acknowledgement')));
  }
  async connected(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', resolve); this.socket.once('error', () => reject(new Error('WebSocket handshake failed')));
      this.socket.once('close', () => reject(new Error('WebSocket handshake closed')));
    });
  }
  request(action: string, payload: object): Promise<ServerEvent> {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('WebSocket is not open'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`Request timeout: ${action}`)); }, 15000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ action, payload, requestId }), error => {
        if (error) { clearTimeout(timer); this.pending.delete(requestId); reject(new Error('WebSocket send failed')); }
      });
    });
  }
  private fail(error: Error) { for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); } this.pending.clear(); }
  async disconnect(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.socket.terminate(); resolve(); }, 2000);
      this.socket.once('close', () => { clearTimeout(timer); resolve(); }); this.socket.close();
    });
  }
  async dispose(): Promise<void> {
    if (this.gameId && this.socket.readyState === WebSocket.OPEN) {
      try { await this.request('LEAVE_GAME', { gameId: this.gameId }); } catch { /* Detached sessions expire server-side. */ }
    }
    await this.disconnect();
  }
}
function game(event: ServerEvent) { assert.equal(event.event, 'GAME_STARTED'); if (event.event !== 'GAME_STARTED') throw new Error('Missing game'); return event.payload; }
function state(event: ServerEvent) { assert.equal(event.event, 'GAME_STATE'); if (event.event !== 'GAME_STATE') throw new Error('Missing state'); return event.payload; }

export async function smokeDeployment(base: string, expectedVersion?: string) {
  const url = new URL(base);
  assert.ok(['http:', 'https:'].includes(url.protocol), 'Use HTTP or HTTPS');
  assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Use a base URL without credentials, path, query or fragment');
  let healthResponse: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { healthResponse = await fetch(new URL('/api/health', url), { signal: AbortSignal.timeout(15000) }); break; }
    catch (error) { if (attempt === 2) throw error; await new Promise(resolve => setTimeout(resolve, 1000)); }
  }
  assert.ok(healthResponse);
  assert.equal(healthResponse.status, 200, `Health endpoint /api/health returned HTTP ${healthResponse.status}`);
  assert.match(healthResponse.headers.get('content-type') ?? '', /application\/json/, 'Health endpoint must return JSON');
  const health = await healthResponse.json() as { status: string; version: string };
  assert.equal(health.status, 'ok'); if (expectedVersion) assert.equal(health.version, expectedVersion, 'Wrong deployed commit');
  const indexResponse = await fetch(url, { signal: AbortSignal.timeout(15000) });
  assert.equal(indexResponse.status, 200, `Frontend / returned HTTP ${indexResponse.status}`); const index = await indexResponse.text();
  assert.match(index, /id="app"/); const asset = index.match(/src="(\/assets\/[^"]+\.js)"/);
  assert.ok(asset, 'Built frontend asset missing');
  const assetResponse = await fetch(new URL(asset[1], url), { signal: AbortSignal.timeout(15000) });
  assert.equal(assetResponse.status, 200, `Frontend asset ${asset[1]} returned HTTP ${assetResponse.status}`); assert.match(assetResponse.headers.get('content-type') ?? '', /javascript/);
  // Consume the response so the test does not leave an open HTTP stream.
  await assetResponse.arrayBuffer();
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const clients: SmokeClient[] = [];
  async function connect() { const client = new SmokeClient(url.href); clients.push(client); await client.connected(); return client; }
  try {
    const first = await connect(); const catalogue = await first.request('LIST_CHALLENGES', {});
    assert.equal(catalogue.event, 'CHALLENGE_LIST');
    if (catalogue.event !== 'CHALLENGE_LIST') throw new Error('Missing catalogue');
    assert.equal(catalogue.payload.length, 20);
    assert.equal(catalogue.payload.filter(item => item.chapter >= 4).length, 8);
    const started = game(await first.request('START_GAME', { gameMode: 'CHALLENGE', challengeId: 'rook-mate' }));
    const hint = await first.request('REQUEST_HINT', { gameId: started.state.gameId, level: 'DIRECTION', expectedVersion: 0 });
    assert.equal(hint.event, 'CHALLENGE_HINT');
    await first.disconnect(); const recovered = await connect();
    const snapshot = state(await recovered.request('RECONNECT', { gameId: started.state.gameId, resumeToken: started.resumeToken }));
    recovered.gameId = started.state.gameId;
    assert.equal(snapshot.version, 0); assert.equal(snapshot.challenge?.directionHintUses, 1);
    const won = state(await recovered.request('MAKE_MOVE', { gameId: snapshot.gameId, from: 'e7', to: 'e8', expectedVersion: 0 }));
    assert.equal(won.challenge?.outcome, 'SUCCEEDED'); assert.equal(won.challenge.stars, 2);
    const upgraded = game(await recovered.request('START_GAME', { gameMode: 'CHALLENGE', challengeId: 'knight-loadout', loadouts: [{ position: 'c3', upgradeId: 'TIAN_MA' }] }));
    const captured = state(await recovered.request('MAKE_MOVE', { gameId: upgraded.state.gameId, from: 'c3', to: 'd5', expectedVersion: 0 }));
    assert.equal(captured.challenge?.outcome, 'SUCCEEDED');
    const pve = game(await recovered.request('START_GAME', { gameMode: 'PVE', stageId: 1 }));
    const ai = state(await recovered.request('MAKE_MOVE', { gameId: pve.state.gameId, from: 'b0', to: 'c2', expectedVersion: 0 }));
    assert.equal(ai.version, 2); assert.equal(ai.status, 'READY');
    const ended = state(await recovered.request('RESIGN', { gameId: ai.gameId }));
    assert.equal(ended.status, 'FINISHED');
    let advanced = game(await recovered.request('START_GAME', { gameMode: 'CHALLENGE', challengeId: 'four-move-siege' })).state;
    for (let moveNumber = 0; moveNumber < 4 && advanced.challenge?.outcome === 'ACTIVE'; moveNumber++) {
      const hint = await recovered.request('REQUEST_HINT', { gameId: advanced.gameId, level: 'MOVE', expectedVersion: advanced.version });
      assert.equal(hint.event, 'CHALLENGE_HINT');
      if (hint.event !== 'CHALLENGE_HINT' || !hint.payload.available || !hint.payload.hint.move) throw new Error('Advanced challenge verified hint missing');
      const { from, to } = hint.payload.hint.move;
      advanced = state(await recovered.request('MAKE_MOVE', { gameId: advanced.gameId, from, to, expectedVersion: advanced.version }));
    }
    assert.equal(advanced.challenge?.outcome, 'SUCCEEDED', 'Advanced challenge must complete within four moves');
    assert.equal(advanced.challenge.stars, 1);
    return { status: 'passed', version: health.version, checks: ['health', 'frontend-asset', '20-level-catalogue', 'hint', 'reconnect', 'challenge-settlement', 'upgrade', 'pve-ai', 'resign', 'advanced-challenge'] };
  } finally { await Promise.all(clients.map(client => client.dispose())); }
}

export async function capacityProbe(base: string, count: number) {
  assert.ok(Number.isInteger(count) && count >= 1 && count <= 8, '--clients must be 1..8');
  const url = new URL(base); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const clients = Array.from({ length: count }, () => new SmokeClient(url.href));
  const latencies: number[] = [];
  try {
    await Promise.all(clients.map(client => client.connected()));
    const starts = await Promise.allSettled(clients.map(client => client.request('START_GAME', { gameMode: 'PVE', stageId: 1 })));
    const moves = await Promise.allSettled(starts.map(async (result, index) => {
      if (result.status !== 'fulfilled') return;
      const started = game(result.value), start = performance.now();
      const moved = state(await clients[index].request('MAKE_MOVE', { gameId: started.state.gameId, from: 'b0', to: 'c2', expectedVersion: 0 }));
      assert.equal(moved.status, 'READY'); assert.equal(moved.version, 2); latencies.push(Math.round(performance.now() - start));
    }));
    const failures = starts.filter(result => result.status === 'rejected').map(result => (result as PromiseRejectedResult).reason.message as string);
    assert.ok(failures.every(message => message === 'Server error: SERVER_BUSY'), 'Unexpected capacity failure');
    assert.ok(moves.every(result => result.status === 'fulfilled'), 'A player/AI move failed under load');
    latencies.sort((a, b) => a - b);
    return { requested: count, accepted: count - failures.length, busy: failures.length, moveP95Ms: latencies[Math.max(0, Math.ceil(latencies.length * .95) - 1)] ?? null, moveLatenciesMs: latencies };
  } finally { await Promise.all(clients.map(client => client.dispose())); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let app: ReturnType<typeof createGameServer> | undefined;
  try {
    const args = process.argv.slice(2); const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
    let base = value('--url');
    if (args.includes('--self-host')) {
      if (base) throw new Error('Choose --self-host or --url');
      app = createGameServer({ maxEngines: 4, maxSessions: 32 });
      await new Promise<void>(resolve => app!.server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/`;
    }
    if (!base) throw new Error('Usage: smoke:deployment -- --url https://... --expect-version COMMIT (or --self-host)');
    console.log(JSON.stringify(await smokeDeployment(base, value('--expect-version'))));
    if (value('--clients')) console.log(JSON.stringify(await capacityProbe(base, Number(value('--clients')))));
  } catch (error) {
    const cause = (error as { cause?: { code?: string } })?.cause?.code;
    console.error(error instanceof Error ? error.message : 'Deployment smoke failed', cause ?? ''); process.exitCode = 1;
  }
  finally { if (app) await app.close(); }
}
