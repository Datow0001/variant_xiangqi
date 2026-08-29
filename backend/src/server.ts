import { WebSocketServer, WebSocket } from 'ws';
import { GameSession } from './session';
import { ClientAction, ServerEvent } from '../../shared/types';

const PORT = parseInt(process.env.PORT || '8080', 10);
const wss = new WebSocketServer({ port: PORT });

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
          console.log(`🎮 玩家請求開局: Stage ${msg.payload.stageId}, 陣營 ${msg.payload.playerColor}`);
          const session = new GameSession(msg.payload);
          await session.init();

          activeGameId = session.gameId;
          sessions.set(session.gameId, { session, ws });

          console.log(`✅ 對局已建立: ${session.gameId}`);
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

          console.log(`♟️ 玩家走步: ${from} -> ${to}`);
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
        // 連線斷開釋放資源
        entry.session.destroy();
        sessions.delete(activeGameId);
        console.log(`🧹 已清理釋放 GameSession: ${activeGameId}`);
      }
    }
  });
});

console.log(`🚀 變體象棋 WebSocket 伺服器啟動於 ws://localhost:${PORT}`);
