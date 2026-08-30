import { GameSession } from './session';

async function runPvpTest() {
  console.log('=== [PvP] 雙人同機對弈模式會話測試開始 ===');

  const session = new GameSession({
    gameMode: 'PVP',
    redLoadouts: [
      { position: 'b0', upgradeId: 'TIAN_MA' },
      { position: 'h0', upgradeId: 'TIAN_MA' },
    ],
    blackLoadouts: [
      { position: 'b7', upgradeId: 'PO_JI_PAO' },
      { position: 'h7', upgradeId: 'PO_JI_PAO' },
    ],
  });

  try {
    console.log('1. 初始化 PVP 會話 (紅方配雙天馬，黑方配雙迫擊砲)...');
    await session.init();

    const initialState = session.getState();
    console.log('✅ 開局狀態確認:');
    console.log(`   - gameId: ${initialState.gameId}`);
    console.log(`   - gameMode: ${initialState.gameMode}`);
    console.log(`   - 首步輪到: ${initialState.currentTurn}`);
    console.log(`   - 紅方初始合法步: ${initialState.legalMoves.length} 步`);

    if (initialState.currentTurn !== 'red') {
      throw new Error('預期開局必須為紅方行棋！');
    }
    if (initialState.legalMoves.length === 0) {
      throw new Error('未取得紅方合法步！');
    }

    console.log('2. 紅方玩家走步: b0(天馬) -> c2...');
    const stateAfterRed = await session.makePlayerMove('b0', 'c2');

    console.log('✅ 紅方走步後狀態確認:');
    console.log(`   - 輪到: ${stateAfterRed.currentTurn}`);
    console.log(`   - 最後一步: ${JSON.stringify(stateAfterRed.lastMove)}`);
    console.log(`   - 黑方當前合法步: ${stateAfterRed.legalMoves.length} 步`);

    if (stateAfterRed.currentTurn !== 'black') {
      throw new Error('紅方走步後應立即切換為黑方，不應被 AI 搶先！');
    }

    console.log('3. 黑方玩家走步: b7(迫擊砲) -> c7...');
    const stateAfterBlack = await session.makePlayerMove('b7', 'c7');

    console.log('✅ 黑方走步後狀態確認:');
    console.log(`   - 輪到: ${stateAfterBlack.currentTurn}`);
    console.log(`   - 最後一步: ${JSON.stringify(stateAfterBlack.lastMove)}`);
    console.log(`   - 紅方當前合法步: ${stateAfterBlack.legalMoves.length} 步`);

    if (stateAfterBlack.currentTurn !== 'red') {
      throw new Error('黑方走步後應切換回紅方！');
    }

    console.log('4. 測試輪到紅方時認輸 (RESIGN)...');
    const resignState = session.resign();
    console.log('✅ 認輸結算確認:');
    console.log(`   - isGameOver: ${resignState.isGameOver}`);
    console.log(`   - winner: ${resignState.winner} (預期 black)`);
    console.log(`   - reason: ${resignState.gameOverReason}`);

    if (!resignState.isGameOver || resignState.winner !== 'black') {
      throw new Error('紅方認輸時應判黑方勝出！');
    }

    console.log('\n🎉🎉🎉 PvP 雙人對弈會話測試全部通過！ 🎉🎉🎉\n');
  } finally {
    session.destroy();
  }
}

runPvpTest().catch((err) => {
  console.error('❌ PvP 測試失敗:', err);
  process.exit(1);
});
