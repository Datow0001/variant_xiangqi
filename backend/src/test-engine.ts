import { FairyEngine } from './FairyEngine';
import { generateInitialFen } from '../../shared/fen';

async function runEngineTest() {
  console.log('=== [Level 2] FairyEngine 單元測試開始 ===');

  const engine = new FairyEngine();

  try {
    console.log('1. 等待引擎初始化與 variants.ini 載入...');
    await engine.waitReady();
    console.log('✅ 引擎初始化成功 (readyok 收到)！');

    // 測試自訂 FEN：玩家配置天馬 (b0) 與飛象 (c0)，AI 為 Stage 2 (黑天馬 b9，黑飛象 g9)
    console.log('2. 測試自訂開局 FEN 生成...');
    const { fen, aiLoadouts } = generateInitialFen(
      'red',
      [
        { position: 'b0', upgradeId: 'TIAN_MA' },
        { position: 'c0', upgradeId: 'FEI_XIANG' },
      ],
      2
    );
    console.log(`生成 FEN: ${fen}`);
    console.log(`AI Loadouts:`, aiLoadouts);

    // 查詢合法走步
    console.log('3. 測試 getLegalMoves (查詢當前盤面所有合法步)...');
    const legalMoves = await engine.getLegalMoves(fen);
    console.log(`✅ 成功取得合法步共 ${legalMoves.length} 個！`);

    // 驗證紅方天馬 (b0) 是否可跳至 a2 或 c2
    const tianMaMoves = legalMoves.filter((m) => m.from === 'b0');
    console.log('天馬 (b0) 可走步數:', tianMaMoves);
    const hasA2 = tianMaMoves.some((m) => m.to === 'a2');
    const hasC2 = tianMaMoves.some((m) => m.to === 'c2');
    if (hasA2 && hasC2) {
      console.log('✅ 天馬 (b0) 成功驗證具備無拐腳走步 (a2, c2)！');
    } else {
      throw new Error(`天馬合法走步異常: ${JSON.stringify(tianMaMoves)}`);
    }

    // 測試 AI 走步計算
    console.log('4. 測試 getBestMove (AI 思考 500ms)...');
    const bestMove = await engine.getBestMove(fen, 500);
    console.log(`✅ AI 回覆最佳步:`, bestMove);
    if (!bestMove || !bestMove.from || !bestMove.to) {
      throw new Error('AI 未能給出合法的最佳步！');
    }

    // 測試將軍狀態檢驗
    console.log('5. 測試 isCheck (開局盤面)...');
    const checkState = await engine.isCheck(fen);
    console.log(`開局將軍狀態: ${checkState} (預期 false)`);
    if (checkState !== false) {
      throw new Error('開局盤面不應為將軍狀態！');
    }

    console.log('\n🎉🎉🎉 Task 1 / Level 2 所有引擎單元測試全部通過！ 🎉🎉🎉');
  } catch (error) {
    console.error('❌ 測試失敗:', error);
    process.exit(1);
  } finally {
    engine.destroy();
  }
}

runEngineTest();
