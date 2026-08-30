import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { GameSession } from './session';
import { ClientAction, ServerEvent } from '../../shared/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = '0.0.0.0';

// 前端靜態資源打包路徑 (frontend/dist)
const DIST_PATH = path.resolve(__dirname, '../../frontend/dist');

// 常見 MIME 類型字典
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// 1. 建立兼具靜態資源託管的 HTTP 伺服器
const server = http.createServer((req, res) => {
  if (!fs.existsSync(DIST_PATH)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      '<h1>變體象棋伺服器已就緒 (WebSocket 運作中)</h1><p>本地開發模式請造訪 Vite 前端 (http://localhost:5173)</p>'
    );
    return;
  }

  let reqPath = req.url ? req.url.split('?')[0] : '/';
  if (reqPath === '/') reqPath = '/index.html';

  let filePath = path.join(DIST_PATH, reqPath);

  // 安全防護：避免目錄遍歷攻擊
  if (!filePath.startsWith(DIST_PATH)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // SPA 路由支援：若非實體資源檔，退回 index.html
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_PATH, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end('Internal Server Error');
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control':
          ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      });
      res.end(content);
    }
  });
});

// 2. 將 WebSocket 掛載至同一個 HTTP 伺服器 (單一連接埠合一)
const wss = new WebSocketServer({ server });

// 儲存當前進行中的 GameSession
const sessions = new Map<string, { session: GameSession; ws: WebSocket }>();

function send(ws: WebSocket, event: ServerEvent) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

function sendError(ws: WebSocket, code: string, message: string) {
  send(ws, {
    event: 'ERROR',
    payload: { code, message },
  });
}

wss.on('connection', (ws: WebSocket) => {
  console.log('📡 收到新的 WebSocket 連線');

  let activeGameId: string | null = null;

  ws.on('message', async (data: string) => {
    try {
      const msg: ClientAction = JSON.parse(data.toString());

      switch (msg.action) {
        case 'START_GAME': {
          const mode = msg.payload.gameMode || 'PVE';
          console.log(`🎮 玩家開局請求: [${mode}]`);
          const session = new GameSession(msg.payload);
          await session.init();

          activeGameId = session.gameId;
          sessions.set(session.gameId, { session, ws });

          console.log(`✅ 對局建立成功: ${session.gameId}`);
          send(ws, {
            event: 'GAME_STATE',
            payload: session.getState(),
          });
          break;
        }

        case 'MAKE_MOVE': {
          const { gameId, from, to } = msg.payload;
          const entry = sessions.get(gameId);
          if (!entry) {
            sendError(ws, 'GAME_NOT_FOUND', '找不到對局或已過期');
            return;
          }

          console.log(`♟️ 走步: ${from} -> ${to}`);
          try {
            await entry.session.makePlayerMove(from, to);
            send(ws, {
              event: 'GAME_STATE',
              payload: entry.session.getState(),
            });
          } catch (err: any) {
            console.warn(`⚠️ 走步失敗: ${err.message}`);
            sendError(ws, 'ILLEGAL_MOVE', err.message);
          }
          break;
        }

        case 'RESIGN': {
          const { gameId } = msg.payload;
          const entry = sessions.get(gameId);
          if (entry) {
            console.log(`🏳️ 玩家認輸: ${gameId}`);
            entry.session.resign();
            send(ws, {
              event: 'GAME_STATE',
              payload: entry.session.getState(),
            });
          }
          break;
        }

        case 'RECONNECT': {
          const { gameId } = msg.payload;
          const entry = sessions.get(gameId);
          if (entry) {
            console.log(`🔄 玩家重連: ${gameId}`);
            activeGameId = gameId;
            entry.ws = ws;
            send(ws, {
              event: 'GAME_STATE',
              payload: entry.session.getState(),
            });
          } else {
            sendError(ws, 'SESSION_EXPIRED', '該局已結束或不存在');
          }
          break;
        }

        default:
          sendError(ws, 'INVALID_ACTION', '未知的請求類型');
      }
    } catch (err: any) {
      console.error('❌ 處理封包時發生異常:', err);
      sendError(ws, 'INTERNAL_ERROR', err.message || '伺服器內部錯誤');
    }
  });

  ws.on('close', () => {
    console.log(`🔌 連線斷開: ${activeGameId || '未知'}`);
    if (activeGameId) {
      const entry = sessions.get(activeGameId);
      if (entry) {
        entry.session.destroy();
        sessions.delete(activeGameId);
        console.log(`🧹 已釋放 GameSession: ${activeGameId}`);
      }
    }
  });
});

// 3. 啟動監聽 (支援 0.0.0.0 供 Docker / GCP Cloud Run 對外連接)
server.listen(PORT, HOST, () => {
  console.log(`🚀 變體象棋全端整合伺服器啟動於 http://${HOST}:${PORT}`);
  console.log(`📡 WebSocket 服務就緒於 ws://${HOST}:${PORT}`);
});
