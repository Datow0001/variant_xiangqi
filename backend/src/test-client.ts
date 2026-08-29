import { WebSocketServer, WebSocket } from 'ws';
import { GameSession } from './session';
import { ClientAction, ServerEvent, GameStatePayload } from '../../shared/types';

async function runIntegrationTest() {
  console.log('=== [Level 3] WebSocket 整合測試開始 ===');

  const TEST_PORT = 8999;
  const wss = new WebSocketServer({ port: TEST_PORT });
  const sessions = new Map<string, GameSession>();

  wss.on('connection', (ws) => {
    ws.on('message', async (data) => {
      const msg: ClientAction = JSON.parse(data.toString());
      if (msg.action === 'START_GAME') {
        const session = new GameSession(msg.payload);
        await session.init();
        sessions.set(session.gameId, session);
        ws.send(JSON.stringify({ event: 'GAME_STATE', payload: session.getState() }));
      } else if (msg.action === 'MAKE_MOVE') {
        const session = sessions.get(msg.payload.gameId);
        if (session) {
          await session.makePlayerMove(msg.payload.from, msg.payload.to);
          ws.send(JSON.stringify({ event: 'GAME_STATE', payload: session.getState() }));
        }
      } else if (msg.action === 'RESIGN') {
        const session = sessions.get(msg.payload.gameId);
        if (session) {
          session.resign();
          ws.send(JSON.stringify({ event: 'GAME_STATE', payload: session.getState() }));
        }
      }
    });
  });

  const client = new WebSocket(`ws://localhost:${TEST_PORT}`);

  await new Promise<void>((resolve) => client.on('open', resolve));
  console.log('✅ 客戶端成功連線至 WebSocket 測試伺服器！');

  try {
    // 步驟 1: 發送 START_GAME
    console.log('1. 發送 START_GAME (Stage 2: 玩家配天馬+飛象，AI 5 點)...');
    const statePromise1 = waitForGameState(client);
    client.send(
      JSON.stringify({
        action: 'START_GAME',
        payload: {
          stageId: 2,
          playerColor: 'red',
          budget: 10,
          loadouts: [
            { position: 'b0', upgradeId: 'TIAN_MA' },
            { position: 'c0', upgradeId: 'FEI_XIANG' },
          ],
        },
      })
    );
    const state1 = await statePromise1;
    console.log(`✅ 收到開局 GAME_STATE:`);
    console.log(`   - gameId: ${state1.gameId}`);
    console.log(`   - legalMoves: ${state1.legalMoves.length} 個`);
    console.log(`   - aiLoadouts: ${state1.aiLoadouts.length} 個 (${state1.aiLoadouts.map(a => `${a.position}:${a.upgradeId}`).join(', ')})`);

    if (state1.legalMoves.length === 0) {
      throw new Error('開局合法步清單為空！');
    }
    if (state1.aiLoadouts.length !== 2) {
      throw new Error('Stage 2 AI 陣容數量不正確！');
    }

    // 步驟 2: 發送 MAKE_MOVE (天馬走步 b0 -> c2)
    console.log('2. 玩家以天馬出步: b0 -> c2...');
    const statePromise2 = waitForGameState(client);
    client.send(
      JSON.stringify({
        action: 'MAKE_MOVE',
        payload: {
          gameId: state1.gameId,
          from: 'b0',
          to: 'c2',
        },
      })
    );
    const state2 = await statePromise2;
    console.log(`✅ 收到 AI 回覆後的 GAME_STATE:`);
    console.log(`   - AI 走步: ${JSON.stringify(state2.lastMove)}`);
    console.log(`   - 輪到: ${state2.currentTurn}`);
    console.log(`   - 玩家當前合法步: ${state2.legalMoves.length} 個`);

    if (!state2.lastMove) {
      throw new Error('AI 未能給出有效走步！');
    }
    if (state2.currentTurn !== 'red') {
      throw new Error('AI 走完後應輪回紅方 (玩家)！');
    }

    // 步驟 3: 發送 RESIGN (玩家認輸)
    console.log('3. 測試認輸 (RESIGN)...');
    const statePromise3 = waitForGameState(client);
    client.send(
      JSON.stringify({
        action: 'RESIGN',
        payload: { gameId: state1.gameId },
      })
    );
    const state3 = await statePromise3;
    console.log(`✅ 收到認輸結算 GAME_STATE:`);
    console.log(`   - isGameOver: ${state3.isGameOver}`);
    console.log(`   - winner: ${state3.winner}`);
    console.log(`   - gameOverReason: ${state3.gameOverReason}`);

    if (state3.winner !== 'black' || state3.gameOverReason !== 'RESIGN') {
      throw new Error('認輸判定結果不正確！');
    }

    console.log('\n🎉🎉🎉 Task 2 / Level 3 WebSocket 整合測試全部通過！ 🎉🎉🎉');
  } finally {
    client.close();
    for (const session of sessions.values()) {
      session.destroy();
    }
    wss.close();
  }
}

function waitForGameState(ws: WebSocket): Promise<GameStatePayload> {
  return new Promise((resolve) => {
    const handler = (data: any) => {
      const msg: ServerEvent = JSON.parse(data.toString());
      if (msg.event === 'GAME_STATE') {
        ws.removeListener('message', handler);
        resolve(msg.payload);
      }
    };
    ws.on('message', handler);
  });
}

runIntegrationTest();
