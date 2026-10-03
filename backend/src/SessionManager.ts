import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocket } from 'ws';
import { ChallengeHint, ClientAction, ServerEvent, StartGamePayload } from '../../shared/types';
import { Engine } from './FairyEngine';
import { GameSession } from './session';
import { GameError } from './errors';

export interface ManagerOptions {
  reconnectMs?: number;
  resultMs?: number;
  idleMs?: number;
  maxEngines?: number;
  maxSessions?: number;
  engineFactory?: () => Engine;
}
interface Entry {
  session: GameSession;
  ws: WebSocket | null;
  token: string;
  announced: boolean;
  lastActivity: number;
  detachedAt?: number;
  terminalAt?: number;
  requests: Map<string, { fingerprint: string; result: Promise<{ hint: ChallengeHint; available: boolean } | void> }>;
}
export interface ConnectionContext { gameId: string | null; starting: boolean; closed: boolean }

export function send(ws: WebSocket | null, event: ServerEvent): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
}
export class SessionManager {
  private entries = new Map<string, Entry>();
  private timer: ReturnType<typeof setInterval>;
  private closed = false;
  constructor(private options: ManagerOptions = {}) {
    this.timer = setInterval(() => this.sweep(), Math.min(1000, options.reconnectMs ?? 120000, options.resultMs ?? 120000, options.idleMs ?? 900000));
    this.timer.unref();
  }
  public get size(): number { return this.entries.size; }
  public get engineCount(): number {
    return [...this.entries.values()].filter(e => !['FINISHED', 'FAULTED'].includes(e.session.status)).length;
  }
  private publish(entry: Entry): void {
    if (!this.entries.has(entry.session.gameId)) return;
    if (entry.session.isGameOver || entry.session.status === 'FAULTED') entry.terminalAt ??= Date.now();
    if (entry.announced) send(entry.ws, { event: 'GAME_STATE', payload: entry.session.getState() });
  }
  private owned(ws: WebSocket, id: string): Entry {
    this.sweep();
    const entry = this.entries.get(id);
    if (!entry) throw new GameError('SESSION_EXPIRED', '對局已過期或伺服器已重新啟動');
    if (entry.ws !== ws) throw new GameError('SESSION_FORBIDDEN', '目前連線無權操作這個對局');
    return entry;
  }
  public async start(ws: WebSocket, context: ConnectionContext, payload: StartGamePayload, requestId: string): Promise<ServerEvent> {
    if (context.starting) throw new GameError('SESSION_BUSY', '對局正在建立中');
    if (this.closed || context.closed) throw new GameError('SESSION_CLOSED', '連線已關閉');
    this.sweep();
    // Replacing a session owned by this socket cannot leave an orphaned engine.
    if (context.gameId) {
      const previous = this.entries.get(context.gameId);
      if (previous?.ws === ws) this.remove(context.gameId);
      context.gameId = null;
    }
    if (this.engineCount >= (this.options.maxEngines ?? 16) || this.size >= (this.options.maxSessions ?? 128)) throw new GameError('SERVER_BUSY', '目前對局已滿，請稍後再試');
    context.starting = true;
    let session: GameSession | undefined;
    try {
      let entry: Entry;
      session = new GameSession(payload, {
        engineFactory: this.options.engineFactory,
        onState: () => this.publish(entry),
        onFault: error => {
          console.error('Engine failure', session?.gameId, error.code);
          if (entry?.announced) send(entry.ws, { event: 'ERROR', payload: { code: error.code, message: '對局因引擎異常中斷，請重新開局' } });
        },
      });
      entry = { session, ws, token: randomBytes(32).toString('hex'), announced: false, lastActivity: Date.now(), requests: new Map() };
      this.entries.set(session.gameId, entry);
      context.gameId = session.gameId;
      await session.init();
      if (context.closed || this.closed || !this.entries.has(session.gameId)) throw new GameError('SESSION_CLOSED', '建立對局時連線已關閉');
      entry.announced = true;
      if (session.isGameOver) entry.terminalAt = Date.now();
      return { event: 'GAME_STARTED', requestId, payload: { state: session.getState(), resumeToken: entry.token } };
    } catch (error) {
      if (session) this.remove(session.gameId);
      context.gameId = null;
      throw error;
    } finally { context.starting = false; }
  }
  public reconnect(ws: WebSocket, context: ConnectionContext, gameId: string, token: string, requestId: string): ServerEvent {
    this.sweep();
    if (context.starting) throw new GameError('SESSION_BUSY', '對局正在建立中');
    const entry = this.entries.get(gameId);
    if (!entry || !entry.announced) throw new GameError('SESSION_EXPIRED', '對局已過期或伺服器已重新啟動');
    const supplied = Buffer.from(token);
    const expected = Buffer.from(entry.token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new GameError('SESSION_FORBIDDEN', '恢復憑證無效');
    if (context.gameId && context.gameId !== gameId) {
      const previous = this.entries.get(context.gameId);
      if (previous?.ws === ws) this.remove(context.gameId);
    }
    const oldSocket = entry.ws;
    entry.ws = ws; entry.detachedAt = undefined; entry.lastActivity = Date.now(); context.gameId = gameId;
    if (oldSocket && oldSocket !== ws) {
      send(oldSocket, { event: 'ERROR', payload: { code: 'SESSION_REPLACED', message: '對局已由新的連線接手' } });
      oldSocket.close(4001, 'Session resumed elsewhere');
    }
    return { event: 'GAME_STATE', requestId, payload: entry.session.getState() };
  }
  public async operate(ws: WebSocket, msg: Extract<ClientAction, { action: 'MAKE_MOVE' | 'RESIGN' | 'LEAVE_GAME' | 'REQUEST_HINT' }>): Promise<ServerEvent> {
    const entry = this.owned(ws, msg.payload.gameId);
    if (!entry.announced) throw new GameError('SESSION_BUSY', '對局尚未建立完成');
    entry.lastActivity = Date.now();
    const fingerprint = JSON.stringify({ action: msg.action, payload: msg.payload });
    const old = entry.requests.get(msg.requestId);
    if (old) {
      if (old.fingerprint !== fingerprint) throw new GameError('REQUEST_CONFLICT', '請求編號不可重複用於不同操作');
      const cached = await old.result;
      return cached ? { event: 'CHALLENGE_HINT', requestId: msg.requestId, payload: { gameId: msg.payload.gameId, ...cached, state: entry.session.getState() } }
        : { event: 'GAME_STATE', requestId: msg.requestId, payload: entry.session.getState() };
    }
    // Store the promise before beginning work, including across reconnection.
    const result = Promise.resolve().then(async () => {
      if (msg.action === 'MAKE_MOVE') {
        try { await entry.session.makePlayerMove(msg.payload.from, msg.payload.to, msg.payload.expectedVersion); }
        catch (error) {
          // Resignation cancels a pending search; its successful final state wins.
          if (entry.session.status !== 'FINISHED') throw error;
        }
      }
      else if (msg.action === 'REQUEST_HINT') return entry.session.requestHint(msg.payload.level, msg.payload.expectedVersion);
      else if (msg.action === 'RESIGN') entry.session.resign();
      else this.remove(entry.session.gameId);
    });
    entry.requests.set(msg.requestId, { fingerprint, result });
    if (entry.requests.size > 256) entry.requests.delete(entry.requests.keys().next().value!);
    let hintResult;
    try { hintResult = await result; } finally {
      if (entry.session.isGameOver || entry.session.status === 'FAULTED') entry.terminalAt ??= Date.now();
    }
    if (hintResult) return { event: 'CHALLENGE_HINT', requestId: msg.requestId, payload: { gameId: msg.payload.gameId, ...hintResult, state: entry.session.getState() } };
    return msg.action === 'LEAVE_GAME'
      ? { event: 'GAME_LEFT', requestId: msg.requestId, payload: { gameId: msg.payload.gameId } }
      : { event: 'GAME_STATE', requestId: msg.requestId, payload: entry.session.getState() };
  }
  public sync(ws: WebSocket, id: string): void {
    const entry = this.entries.get(id);
    if (entry?.ws === ws && entry.announced) send(ws, { event: 'GAME_STATE', payload: entry.session.getState() });
  }
  public disconnect(ws: WebSocket, context: ConnectionContext): void {
    context.closed = true;
    if (!context.gameId) return;
    const entry = this.entries.get(context.gameId);
    if (entry?.ws !== ws) return;
    if (!entry.announced) { this.remove(context.gameId); return; }
    entry.ws = null; entry.detachedAt = Date.now();
  }
  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id); entry.session.destroy(); entry.requests.clear();
  }
  public sweep(now = Date.now()): void {
    for (const [id, entry] of this.entries) {
      const terminal = entry.terminalAt !== undefined && now - entry.terminalAt >= (this.options.resultMs ?? 120000);
      const disconnected = entry.detachedAt !== undefined && now - entry.detachedAt >= (this.options.reconnectMs ?? 120000);
      const idle = now - entry.lastActivity >= (this.options.idleMs ?? 900000);
      if (terminal || disconnected || idle) {
        send(entry.ws, { event: 'ERROR', payload: { code: 'SESSION_EXPIRED', message: '對局因閒置或保留時間到期而結束，請重新開局' } });
        this.remove(id);
      }
    }
  }
  public close(): void { this.closed = true; clearInterval(this.timer); for (const id of this.entries.keys()) this.remove(id); }
}
