import type { ClientAction, ServerEvent } from '../../../shared/types';

export type ConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING';
type Request = ClientAction extends infer T ? T extends ClientAction ? Omit<T, 'requestId'> : never : never;
interface Callbacks {
  onEvent: (event: ServerEvent) => void;
  onStatus: (status: ConnectionStatus) => void;
  onReconnected: () => void;
  shouldReconnect: () => boolean;
  onRecoveryExpired: () => void;
}
export class SocketError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export function websocketUrl(): string {
  const env = (import.meta as ImportMeta & { env?: { VITE_WS_URL?: string; DEV?: boolean } }).env;
  const configured = env?.VITE_WS_URL;
  if (configured) return configured;
  if (env?.DEV) return `ws://${window.location.hostname}:8080`;
  return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
}
export class GameSocket {
  private ws: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private pending = new Map<string, { resolve: (event: ServerEvent) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private stopped = false;
  private attempt = 0;
  private recoveryStarted = 0;
  constructor(private callbacks: Callbacks, private options: { url?: string; retryMs?: number; requestTimeoutMs?: number; recoveryMs?: number } = {}) {}
  connect(reconnecting = false): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.stopped = false;
    clearTimeout(this.retryTimer);
    this.callbacks.onStatus(reconnecting ? 'RECONNECTING' : 'CONNECTING');
    const ws = new WebSocket(this.options.url ?? websocketUrl());
    this.ws = ws;
    this.connecting = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => ws.close(), 10000);
      ws.onopen = () => {
        if (this.stopped) { clearTimeout(timeout); reject(new SocketError('CANCELLED', '操作已取消')); ws.close(); return; }
        if (this.ws !== ws) return;
        clearTimeout(timeout); this.connecting = null;
        this.attempt = 0;
        this.callbacks.onStatus('CONNECTED'); resolve();
        if (reconnecting) this.callbacks.onReconnected();
      };
      ws.onmessage = message => {
        if (this.ws !== ws || this.stopped) return;
        try {
          const event = JSON.parse(message.data) as ServerEvent;
          if (!event || !['GAME_STARTED', 'GAME_STATE', 'GAME_LEFT', 'CHALLENGE_LIST', 'CHALLENGE_HINT', 'ERROR'].includes(event.event)) return;
          const call = event.requestId ? this.pending.get(event.requestId) : undefined;
          if (call && event.requestId) {
            clearTimeout(call.timer); this.pending.delete(event.requestId);
            if (event.event === 'ERROR') call.reject(new SocketError(event.payload.code, event.payload.message));
            else call.resolve(event);
          }
          this.callbacks.onEvent(event);
        } catch { /* Ignore malformed server messages; request timeout remains bounded. */ }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (this.ws !== ws) return;
        clearTimeout(timeout); this.ws = null; this.connecting = null;
        reject(new SocketError('CONNECTION_LOST', '伺服器連線中斷'));
        this.rejectPending(new SocketError('CONNECTION_LOST', '連線中斷，正在確認最新盤面'));
        this.callbacks.onStatus('DISCONNECTED');
        if (!this.stopped && this.callbacks.shouldReconnect()) this.scheduleRecovery();
      };
    });
    return this.connecting;
  }
  private scheduleRecovery(): void {
    this.recoveryStarted ||= Date.now();
    if (Date.now() - this.recoveryStarted >= (this.options.recoveryMs ?? 120000)) { this.callbacks.onRecoveryExpired(); return; }
    this.callbacks.onStatus('RECONNECTING');
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (!this.stopped && this.callbacks.shouldReconnect()) void this.connect(true).catch(() => {});
    }, Math.min((this.options.retryMs ?? 1000) * 2 ** this.attempt++, 10000));
  }
  recovered(): void { this.recoveryStarted = 0; }
  async refreshConnection(): Promise<void> {
    // A mobile browser can leave an apparently OPEN socket after suspension.
    // Replace it and restore a snapshot, rather than replaying pending moves.
    if (this.connecting) { try { await this.connecting; } catch { /* Retry below. */ } }
    const previous = this.ws;
    this.ws = null; this.connecting = null; clearTimeout(this.retryTimer);
    this.rejectPending(new SocketError('CONNECTION_LOST', '正在確認最新盤面，請稍候'));
    previous?.close();
    await this.connect();
  }
  request(action: Request): Promise<ServerEvent> {
    if (this.ws?.readyState !== WebSocket.OPEN) return Promise.reject(new SocketError('NOT_CONNECTED', '尚未連線，請稍候'));
    const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new SocketError('REQUEST_TIMEOUT', '操作回應逾時，正在確認對局狀態'));
        // Recover from ambiguous acknowledgements using a full server snapshot.
        this.ws?.close();
      }, this.options.requestTimeoutMs ?? 20000);
      this.pending.set(requestId, { resolve, reject, timer });
      try { this.ws!.send(JSON.stringify({ ...action, requestId })); }
      catch { clearTimeout(timer); this.pending.delete(requestId); reject(new SocketError('CONNECTION_LOST', '伺服器連線中斷')); }
    });
  }
  private rejectPending(error: Error): void {
    for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(error); }
    this.pending.clear();
  }
  stop(): void {
    this.stopped = true; clearTimeout(this.retryTimer); this.recoveryStarted = 0;
    this.rejectPending(new SocketError('CANCELLED', '操作已取消'));
    this.ws?.close(); this.callbacks.onStatus('DISCONNECTED');
  }
}
