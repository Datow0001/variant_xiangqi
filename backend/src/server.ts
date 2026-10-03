import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { ServerEvent } from '../../shared/types';
import { ManagerOptions, SessionManager, send, ConnectionContext } from './SessionManager';
import { parseAction } from './validation';
import { GameError, asGameError } from './errors';
import { FairyEngine } from './FairyEngine';
import { CHALLENGES, publicChallenge } from './challenges';

const DIST_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
export interface ServerOptions extends ManagerOptions { heartbeatMs?: number; distPath?: string }

export function createGameServer(options: ServerOptions = {}) {
  const manager = new SessionManager(options);
  const dist = path.resolve(options.distPath ?? DIST_PATH);
  const server = http.createServer((req, res) => {
    if (req.url === '/api/health') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ status: 'ok', version: process.env.APP_VERSION ?? 'development' })); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    let pathname: string;
    try { pathname = decodeURIComponent((req.url ?? '/').split('?')[0]); } catch { res.writeHead(400); res.end(); return; }
    // Reject encoded/backslash traversal before resolving; directory prefix alone is insufficient.
    if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').includes('..')) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(dist)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<h1>變體象棋伺服器已就緒</h1><p>開發前端：http://localhost:5173</p>'); return; }
    let target = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    const relative = path.relative(dist, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) target = path.join(dist, 'index.html');
    const ext = path.extname(target);
    fs.readFile(target, (error, content) => {
      if (error) { res.writeHead(500); res.end('Internal Server Error'); return; }
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' });
      res.end(req.method === 'HEAD' ? undefined : content);
    });
  });
  const wss = new WebSocketServer({ server, maxPayload: 16384 });
  const alive = new WeakMap<WebSocket, boolean>();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) { ws.terminate(); continue; }
      alive.set(ws, false); ws.ping();
    }
  }, options.heartbeatMs ?? 30000);
  heartbeat.unref();
  wss.on('connection', ws => {
    const context: ConnectionContext = { gameId: null, starting: false, closed: false };
    const requests = new Map<string, { fingerprint: string; result: Promise<ServerEvent> }>();
    let inFlight = 0;
    let windowStart = Date.now();
    let messages = 0;
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    ws.on('error', () => ws.terminate());
    ws.on('message', async (raw, isBinary) => {
      let requestId: string | undefined;
      let gameId: string | undefined;
      try {
        if (Date.now() - windowStart > 60000) { windowStart = Date.now(); messages = 0; }
        if (++messages > 120 || inFlight >= 16) throw new GameError('RATE_LIMITED', '操作過於頻繁，請稍後再試');
        if (isBinary) throw new GameError('INVALID_PAYLOAD', '請使用 JSON 文字封包');
        let data: unknown;
        try { data = JSON.parse(raw.toString()); } catch { throw new GameError('INVALID_PAYLOAD', 'JSON 格式錯誤'); }
        if (data && typeof data === 'object' && 'requestId' in data && typeof data.requestId === 'string' && data.requestId.length <= 80) requestId = data.requestId;
        const msg = parseAction(data);
        requestId = msg.requestId;
        gameId = 'gameId' in msg.payload ? msg.payload.gameId : undefined;
        const fingerprint = JSON.stringify(msg);
        let cached = requests.get(msg.requestId);
        if (cached && cached.fingerprint !== fingerprint) throw new GameError('REQUEST_CONFLICT', '請求編號不可重複用於不同操作');
        if (!cached) {
          const result = (async (): Promise<ServerEvent> => {
            switch (msg.action) {
              case 'LIST_CHALLENGES': return { event: 'CHALLENGE_LIST', requestId: msg.requestId, payload: CHALLENGES.map(publicChallenge) };
              case 'START_GAME': return manager.start(ws, context, msg.payload, msg.requestId);
              case 'RECONNECT': return manager.reconnect(ws, context, msg.payload.gameId, msg.payload.resumeToken, msg.requestId);
              default: return manager.operate(ws, msg);
            }
          })();
          cached = { fingerprint, result };
          requests.set(msg.requestId, cached);
          if (requests.size > 256) requests.delete(requests.keys().next().value!);
        }
        inFlight++;
        try {
          const event = await cached.result;
          if (event.event === 'GAME_LEFT' && context.gameId === event.payload.gameId) context.gameId = null;
          // A superseded START response must not overwrite a newer game on the client.
          const responseGameId = event.event === 'GAME_STARTED' ? event.payload.state.gameId : event.event === 'GAME_STATE' || event.event === 'CHALLENGE_HINT' ? event.payload.gameId : undefined;
          if (!responseGameId || responseGameId === context.gameId) send(ws, event);
          if (responseGameId) manager.sync(ws, responseGameId);
        } finally { inFlight--; }
      } catch (error) {
        const safe = asGameError(error);
        if (safe.code === 'INTERNAL_ERROR') console.error('Request failure', error);
        send(ws, { event: 'ERROR', requestId, payload: { code: safe.code, message: safe.message } });
        if (gameId) manager.sync(ws, gameId);
      }
    });
    ws.on('close', () => { manager.disconnect(ws, context); requests.clear(); });
  });
  return {
    server, wss, manager,
    async close(): Promise<void> {
      clearInterval(heartbeat); manager.close();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>(resolve => wss.close(() => resolve()));
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
  return value;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hashMb = envInt('ENGINE_HASH_MB', 16);
  const threads = envInt('ENGINE_THREADS', 1);
  if (hashMb > 256 || threads > 4) throw new Error('ENGINE_HASH_MB must be <= 256; ENGINE_THREADS must be <= 4');
  const app = createGameServer({
    reconnectMs: envInt('RECONNECT_MS', 120000), resultMs: envInt('RESULT_MS', 120000), idleMs: envInt('IDLE_MS', 900000),
    maxEngines: envInt('MAX_ENGINES', 16), maxSessions: envInt('MAX_SESSIONS', 128),
    engineFactory: () => new FairyEngine(undefined, undefined, undefined, { hashMb, threads }),
  });
  const port = envInt('PORT', 8080);
  app.server.listen(port, process.env.HOST ?? '0.0.0.0', () => console.log(`變體象棋伺服器：http://localhost:${port}`));
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
    if (!closing) { closing = true; void app.close().catch(error => { console.error(error); process.exitCode = 1; }); }
  });
}
