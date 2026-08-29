<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { fenToBoard } from '@shared/fen';
import { posToUci } from '@shared/coordinates';
import ChessPiece from './ChessPiece.vue';
import EnemyIntel from './EnemyIntel.vue';

const store = useGameStore();

// 將當前 FEN 轉為 10x9 矩陣 (row 0 為 Rank 9，row 9 為 Rank 0)
const boardMatrix = computed(() => {
  if (!store.gameState) return [];
  return fenToBoard(store.gameState.fen);
});

// 是否為翻轉視角 (玩家執黑時翻轉)
const isFlipped = computed(() => store.isFlipped);

// 產生格點座標陣列
// displayRows: 0 ~ 9 畫面由上而下的列
// displayCols: 0 ~ 8 畫面由左而右的欄
const displayRows = computed(() => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const displayCols = computed(() => [0, 1, 2, 3, 4, 5, 6, 7, 8]);

// 畫面格點 (r, c) 轉為系統 (col, row) 與 UCI 座標 (如 "b0")
function getUciFromDisplay(displayRow: number, displayCol: number): string {
  let col: number;
  let row: number;

  if (isFlipped.value) {
    col = 8 - displayCol;
    row = displayRow;
  } else {
    col = displayCol;
    row = 9 - displayRow;
  }

  return posToUci(col, row);
}

// 根據系統 UCI 坐標取得該位置的棋子字元
function getPieceAt(uci: string): string {
  if (!boardMatrix.value.length) return '.';
  const col = uci.charCodeAt(0) - 97;
  const row = parseInt(uci.substring(1), 10);
  const rowIndex = 9 - row; // 陣列 row 0 代表 Rank 9
  return boardMatrix.value[rowIndex]?.[col] || '.';
}

// 是否為選中格
function isSelected(uci: string): boolean {
  return store.selectedSquare === uci;
}

// 是否為合法目標點
function isLegalTarget(uci: string): boolean {
  return store.currentLegalMovesForSelected.some((m) => m.to === uci);
}

// 是否為最後一步的起點或終點
function isLastMove(uci: string): boolean {
  if (!store.gameState?.lastMove) return false;
  return (
    store.gameState.lastMove.from === uci || store.gameState.lastMove.to === uci
  );
}

// 是否為變體棋子 (U, F, M, S, u, f, m, s)
function isUpgradedPiece(char: string): boolean {
  return 'UFMSufms'.includes(char);
}
</script>

<template>
  <div class="max-w-5xl mx-auto py-6 px-4">
    <!-- 頂部資訊列 -->
    <div class="flex flex-wrap items-center justify-between gap-4 bg-slate-800/80 border border-slate-700 rounded-2xl p-4 mb-6 shadow-lg">
      <div class="flex items-center gap-3">
        <button
          @click="store.returnToStageSelect()"
          class="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition"
        >
          ← 返回首頁
        </button>
        <div class="text-sm font-bold text-slate-200">
          關卡 {{ store.stageId }} 對決
        </div>
      </div>

      <!-- 回合與狀態提示 -->
      <div class="flex items-center gap-4">
        <div v-if="store.isAiThinking" class="flex items-center gap-2 text-amber-400 font-bold text-sm">
          <svg class="animate-spin h-4 w-4 text-amber-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
          </svg>
          AI 思考中...
        </div>
        <div v-else class="flex items-center gap-2 text-sm">
          <span class="text-slate-400">目前輪到:</span>
          <span :class="store.gameState?.currentTurn === 'red' ? 'text-red-400 font-bold' : 'text-slate-200 font-bold'">
            {{ store.gameState?.currentTurn === 'red' ? '紅方行棋' : '黑方行棋' }}
          </span>
          <span v-if="store.gameState?.currentTurn === store.playerColor" class="text-xs font-semibold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-700">
            您的回合
          </span>
        </div>

        <button
          v-if="!store.gameState?.isGameOver"
          @click="store.resign()"
          class="text-xs font-bold px-3 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800 transition"
        >
          認輸投降
        </button>
      </div>
    </div>

    <!-- 主區塊：棋盤與敵方情報 -->
    <div class="grid lg:grid-cols-[1fr_320px] gap-8 items-start">
      <!-- 象棋棋盤 -->
      <div class="relative flex flex-col items-center">
        <!-- 被將軍警戒橫幅 -->
        <div
          v-if="store.gameState?.isCheck && !store.gameState?.isGameOver"
          class="absolute -top-4 z-20 bg-red-600 text-white text-xs font-black px-4 py-1 rounded-full shadow-lg animate-bounce uppercase tracking-wider"
        >
          ⚠️ 將軍！
        </div>

        <!-- 棋盤外框木紋底板 -->
        <div class="bg-amber-100 p-4 sm:p-6 rounded-2xl shadow-2xl border-4 border-amber-900/60 relative select-none">
          <!-- 棋盤 9x10 網格層 -->
          <div class="relative w-[340px] h-[378px] sm:w-[480px] sm:h-[533px] md:w-[540px] md:h-[600px] border border-amber-900/40">
            <!-- 繪製楚河漢界 (第 4 與第 5 列之間) -->
            <div class="absolute inset-x-0 top-[45%] h-[10%] flex items-center justify-around pointer-events-none text-amber-900/50 font-serif font-black text-xl sm:text-2xl">
              <span>楚 河</span>
              <span>漢 界</span>
            </div>

            <!-- 棋盤格點點選區域 (9x10 = 90 格) -->
            <div class="absolute inset-0 grid grid-rows-10 grid-cols-9">
              <div
                v-for="r in displayRows"
                :key="`row-${r}`"
                class="contents"
              >
                <div
                  v-for="c in displayCols"
                  :key="`cell-${r}-${c}`"
                  @click="store.selectSquare(getUciFromDisplay(r, c))"
                  class="relative flex items-center justify-center cursor-pointer group"
                >
                  <!-- 十字交叉格線繪製 -->
                  <div class="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <!-- 橫線 -->
                    <div class="absolute w-full h-[1px] bg-amber-900/60"></div>
                    <!-- 直線 (注意楚河漢界中間斷開，第 4 列底到第 5 列頂) -->
                    <div
                      v-if="(c === 0 || c === 8) || (r !== 4)"
                      class="absolute h-full w-[1px] bg-amber-900/60"
                    ></div>
                  </div>

                  <!-- 最後一步背景高亮 -->
                  <div
                    v-if="isLastMove(getUciFromDisplay(r, c))"
                    class="absolute inset-1 rounded-full bg-amber-400/25 pointer-events-none animate-pulse"
                  ></div>

                  <!-- 被選中棋子高亮 -->
                  <div
                    v-if="isSelected(getUciFromDisplay(r, c))"
                    class="absolute inset-0.5 rounded-full ring-4 ring-amber-500 bg-amber-400/30 z-10 animate-pulse pointer-events-none"
                  ></div>

                  <!-- 棋子本身 -->
                  <div
                    v-if="getPieceAt(getUciFromDisplay(r, c)) !== '.'"
                    class="relative z-10 w-[84%] h-[84%] transition-transform group-hover:scale-105"
                  >
                    <ChessPiece
                      :char="getPieceAt(getUciFromDisplay(r, c))"
                      :is-upgraded="isUpgradedPiece(getPieceAt(getUciFromDisplay(r, c)))"
                    />
                  </div>

                  <!-- 可走步標記圓點 (MoveIndicator) -->
                  <div
                    v-if="isLegalTarget(getUciFromDisplay(r, c))"
                    class="absolute z-20 w-4 h-4 rounded-full bg-emerald-500/80 shadow-md shadow-emerald-500/50 pointer-events-none animate-ping"
                  ></div>
                  <div
                    v-if="isLegalTarget(getUciFromDisplay(r, c))"
                    class="absolute z-20 w-3 h-3 rounded-full bg-emerald-400 shadow-md pointer-events-none ring-2 ring-emerald-200"
                  ></div>
                </div>
              </div>
            </div>
          </div>

          <!-- 底部標籤座標 -->
          <div class="flex justify-between px-2 pt-2 text-[10px] sm:text-xs text-amber-900/60 font-mono font-bold">
            <span v-for="c in displayCols" :key="`col-lbl-${c}`">
              {{ isFlipped ? String.fromCharCode(105 - c) : String.fromCharCode(97 + c) }}
            </span>
          </div>
        </div>
      </div>

      <!-- 側邊：敵方情報與歷史走步 -->
      <div class="space-y-6">
        <EnemyIntel />

        <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4 shadow-lg">
          <h3 class="font-bold text-sm text-slate-300 mb-2">對局狀態</h3>
          <div class="text-xs text-slate-400 space-y-1.5 font-mono">
            <div>最後一步: {{ store.gameState?.lastMove ? `${store.gameState.lastMove.from} → ${store.gameState.lastMove.to}` : '尚未出步' }}</div>
            <div>當前合法步數: {{ store.gameState?.legalMoves.length || 0 }} 步</div>
            <div>將軍警示: {{ store.gameState?.isCheck ? '已將軍' : '正常' }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 勝負結算彈窗 -->
    <div
      v-if="store.gameState?.isGameOver"
      class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
    >
      <div class="bg-slate-800 border-2 border-amber-500 rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
        <div class="text-5xl mb-4">
          {{ store.gameState.winner === store.playerColor ? '🏆' : '💀' }}
        </div>
        <h2 class="text-3xl font-black mb-2 text-slate-100">
          {{ store.gameState.winner === store.playerColor ? '大獲全勝！' : '遺憾落敗' }}
        </h2>
        <p class="text-slate-400 text-sm mb-6">
          <span v-if="store.gameState.gameOverReason === 'CHECKMATE'">雙方戰至最後，將死勝出！</span>
          <span v-else-if="store.gameState.gameOverReason === 'STALEMATE'">對方無子可動（困斃判勝）！</span>
          <span v-else-if="store.gameState.gameOverReason === 'RESIGN'">玩家認輸放棄。</span>
          <span v-else>對局已結束。</span>
        </p>

        <div class="space-y-3">
          <button
            @click="store.startGame()"
            class="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-black py-3 px-6 rounded-xl shadow-lg transition"
          >
            再戰一局 ⚔️
          </button>
          <button
            @click="store.returnToStageSelect()"
            class="w-full bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold py-3 px-6 rounded-xl transition"
          >
            返回關卡選擇
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
