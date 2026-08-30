<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { fenToBoard } from '@shared/fen';
import { posToUci } from '@shared/coordinates';
import ChessPiece from './ChessPiece.vue';
import EnemyIntel from './EnemyIntel.vue';

const store = useGameStore();

const boardMatrix = computed(() => {
  if (!store.gameState) return [];
  return fenToBoard(store.gameState.fen);
});

const isFlipped = computed(() => store.isFlipped);

// 9 欄 (0~8) 與 10 列 (0~9)
const displayRows = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const displayCols = [0, 1, 2, 3, 4, 5, 6, 7, 8];

// SVG 內部坐標參數 (viewBox: 0 0 560 620)
const PADDING_X = 40;
const PADDING_Y = 40;
const STEP_X = 60;
const STEP_Y = 60;

function getX(c: number): number {
  return PADDING_X + c * STEP_X;
}

function getY(r: number): number {
  return PADDING_Y + r * STEP_Y;
}

function getPctX(c: number): number {
  return (getX(c) / 560) * 100;
}

function getPctY(r: number): number {
  return (getY(r) / 620) * 100;
}

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

function getPieceAt(uci: string): string {
  if (!boardMatrix.value.length) return '.';
  const col = uci.charCodeAt(0) - 97;
  const row = parseInt(uci.substring(1), 10);
  const rowIndex = 9 - row;
  return boardMatrix.value[rowIndex]?.[col] || '.';
}

function isSelected(uci: string): boolean {
  return store.selectedSquare === uci;
}

function isLegalTarget(uci: string): boolean {
  return store.currentLegalMovesForSelected.some((m) => m.to === uci);
}

function isLastMove(uci: string): boolean {
  if (!store.gameState?.lastMove) return false;
  return (
    store.gameState.lastMove.from === uci || store.gameState.lastMove.to === uci
  );
}

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
          {{ store.gameMode === 'PVE' ? `關卡 ${store.stageId} 對決` : '👥 雙人同機切磋' }}
        </div>
      </div>

      <!-- 回合與狀態提示 -->
      <div class="flex items-center gap-3 sm:gap-4 flex-wrap">
        <!-- PVE 狀態 -->
        <template v-if="store.gameMode === 'PVE'">
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
        </template>

        <!-- PVP 狀態與視角工具 -->
        <template v-else>
          <div class="flex items-center gap-2 text-sm">
            <span class="text-slate-400">輪到出步:</span>
            <span :class="store.gameState?.currentTurn === 'red' ? 'text-red-400 font-black' : 'text-neutral-100 font-black'">
              {{ store.gameState?.currentTurn === 'red' ? '🔴 紅方行棋' : '⚫ 黑方行棋' }}
            </span>
          </div>

          <button
            @click="store.toggleManualFlip()"
            class="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-amber-300 border border-slate-600 transition flex items-center gap-1"
            title="手動旋轉 180 度棋盤視角"
          >
            🔄 翻轉視角
          </button>

          <button
            @click="store.toggleAutoFlip()"
            :class="[
              'text-xs font-bold px-2.5 py-1.5 rounded-lg border transition',
              store.autoFlipOnTurn
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-slate-900/60 text-slate-400 border-slate-700 hover:text-slate-200'
            ]"
            title="換手時自動旋轉棋盤"
          >
            {{ store.autoFlipOnTurn ? '✓ 自動翻轉' : '自動翻轉: 關' }}
          </button>
        </template>

        <button
          v-if="!store.gameState?.isGameOver"
          @click="store.resign()"
          class="text-xs font-bold px-3 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800 transition"
        >
          認輸投降
        </button>
      </div>
    </div>

    <!-- 主區塊：棋盤與側欄情報 -->
    <div class="grid lg:grid-cols-[1fr_320px] gap-8 items-start">
      <!-- 傳統標準象棋棋盤 -->
      <div class="relative flex flex-col items-center">
        <!-- 被將軍警戒橫幅 -->
        <div
          v-if="store.gameState?.isCheck && !store.gameState?.isGameOver"
          class="absolute -top-4 z-30 bg-red-600 text-white text-xs font-black px-4 py-1 rounded-full shadow-lg animate-bounce uppercase tracking-wider"
        >
          ⚠️ 將軍！
        </div>

        <!-- 棋盤容器 -->
        <div class="relative w-[340px] sm:w-[480px] md:w-[520px] aspect-[560/620] bg-amber-100/95 rounded-2xl shadow-2xl p-2 select-none border-2 border-amber-950/70">
          <!-- 1. 底層標準 SVG 盤線繪製 (精確 9x10 幾何) -->
          <svg
            viewBox="0 0 560 620"
            class="absolute inset-0 w-full h-full pointer-events-none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <!-- 外部雙邊裝飾框 -->
            <rect
              x="26"
              y="26"
              width="508"
              height="568"
              fill="none"
              stroke="#6b3710"
              stroke-width="3.5"
              rx="6"
            />
            <rect
              :x="getX(0)"
              :y="getY(0)"
              :width="STEP_X * 8"
              :height="STEP_Y * 9"
              fill="none"
              stroke="#7c3f13"
              stroke-width="2"
            />

            <!-- 10 條橫線 (完整橫貫欄 0 到 欄 8) -->
            <line
              v-for="r in displayRows"
              :key="`h-line-${r}`"
              :x1="getX(0)"
              :y1="getY(r)"
              :x2="getX(8)"
              :y2="getY(r)"
              stroke="#7c3f13"
              stroke-width="1.6"
            />

            <!-- 直線 (左右外邊欄 0 與 8 貫穿楚河漢界) -->
            <line
              :x1="getX(0)"
              :y1="getY(0)"
              :x2="getX(0)"
              :y2="getY(9)"
              stroke="#7c3f13"
              stroke-width="2"
            />
            <line
              :x1="getX(8)"
              :y1="getY(0)"
              :x2="getX(8)"
              :y2="getY(9)"
              stroke="#7c3f13"
              stroke-width="2"
            />

            <!-- 中間直欄 (欄 1 ~ 7)：楚河漢界中間完全斷開，無任何穿透直線 -->
            <!-- 上半部 (列 0 ~ 4) -->
            <line
              v-for="c in [1, 2, 3, 4, 5, 6, 7]"
              :key="`v-top-${c}`"
              :x1="getX(c)"
              :y1="getY(0)"
              :x2="getX(c)"
              :y2="getY(4)"
              stroke="#7c3f13"
              stroke-width="1.6"
            />
            <!-- 下半部 (列 5 ~ 9) -->
            <line
              v-for="c in [1, 2, 3, 4, 5, 6, 7]"
              :key="`v-bottom-${c}`"
              :x1="getX(c)"
              :y1="getY(5)"
              :x2="getX(c)"
              :y2="getY(9)"
              stroke="#7c3f13"
              stroke-width="1.6"
            />

            <!-- 帥/將 九宮格斜線 (以粗線 stroke-width="2.6" 繪製斜交叉) -->
            <!-- 上方九宮格 (列 0~2, 欄 3~5) -->
            <line
              :x1="getX(3)"
              :y1="getY(0)"
              :x2="getX(5)"
              :y2="getY(2)"
              stroke="#7c3f13"
              stroke-width="2.6"
            />
            <line
              :x1="getX(5)"
              :y1="getY(0)"
              :x2="getX(3)"
              :y2="getY(2)"
              stroke="#7c3f13"
              stroke-width="2.6"
            />

            <!-- 下方九宮格 (列 7~9, 欄 3~5) -->
            <line
              :x1="getX(3)"
              :y1="getY(7)"
              :x2="getX(5)"
              :y2="getY(9)"
              stroke="#7c3f13"
              stroke-width="2.6"
            />
            <line
              :x1="getX(5)"
              :y1="getY(7)"
              :x2="getX(3)"
              :y2="getY(9)"
              stroke="#7c3f13"
              stroke-width="2.6"
            />

            <!-- 楚河漢界文字 (乾淨印在無直條干擾的河界中) -->
            <text
              :x="getX(2)"
              :y="(getY(4) + getY(5)) / 2 + 8"
              fill="#854817"
              font-size="28"
              font-family="'Noto Serif TC', serif"
              font-weight="900"
              text-anchor="middle"
              letter-spacing="12"
            >
              楚河
            </text>
            <text
              :x="getX(6)"
              :y="(getY(4) + getY(5)) / 2 + 8"
              fill="#854817"
              font-size="28"
              font-family="'Noto Serif TC', serif"
              font-weight="900"
              text-anchor="middle"
              letter-spacing="12"
            >
              漢界
            </text>
          </svg>

          <!-- 2. 交叉格點互動與棋子層 (精確定位在每個交點中心) -->
          <div class="absolute inset-0">
            <div
              v-for="r in displayRows"
              :key="`row-${r}`"
            >
              <div
                v-for="c in displayCols"
                :key="`cell-${r}-${c}`"
                @click="store.selectSquare(getUciFromDisplay(r, c))"
                class="absolute flex items-center justify-center cursor-pointer group"
                :style="{
                  left: `${getPctX(c)}%`,
                  top: `${getPctY(r)}%`,
                  width: '10.5%',
                  height: '9.5%',
                  transform: 'translate(-50%, -50%)',
                }"
              >
                <!-- 最後一步背景光暈 -->
                <div
                  v-if="isLastMove(getUciFromDisplay(r, c))"
                  class="absolute inset-0 rounded-full bg-amber-400/35 animate-pulse"
                ></div>

                <!-- 被選中棋子發光光環 -->
                <div
                  v-if="isSelected(getUciFromDisplay(r, c))"
                  class="absolute inset-[-4px] rounded-full ring-4 ring-amber-500 bg-amber-400/30 z-10 animate-pulse pointer-events-none"
                ></div>

                <!-- 棋子本體 -->
                <div
                  v-if="getPieceAt(getUciFromDisplay(r, c)) !== '.'"
                  class="relative z-10 w-full h-full transition-transform group-hover:scale-105"
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

        <!-- 底部座標軸提示 -->
        <div class="w-[340px] sm:w-[480px] md:w-[520px] flex justify-between px-6 pt-2.5 text-[11px] sm:text-xs text-amber-900/70 font-mono font-bold">
          <span v-for="c in displayCols" :key="`col-lbl-${c}`">
            {{ isFlipped ? String.fromCharCode(105 - c) : String.fromCharCode(97 + c) }}
          </span>
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
          <template v-if="store.gameMode === 'PVE'">
            {{ store.gameState.winner === store.playerColor ? '🏆' : '💀' }}
          </template>
          <template v-else>
            {{ store.gameState.winner === 'draw' ? '🤝' : '🏆' }}
          </template>
        </div>
        <h2 class="text-3xl font-black mb-2 text-slate-100">
          <template v-if="store.gameMode === 'PVE'">
            {{ store.gameState.winner === store.playerColor ? '大獲全勝！' : '遺憾落敗' }}
          </template>
          <template v-else>
            {{ store.gameState.winner === 'red' ? '🔴 紅方大獲全勝！' : store.gameState.winner === 'black' ? '⚫ 黑方大獲全勝！' : '雙方握手言和！' }}
          </template>
        </h2>
        <p class="text-slate-400 text-sm mb-6">
          <span v-if="store.gameState.gameOverReason === 'CHECKMATE'">雙方戰至最後，將死勝出！</span>
          <span v-else-if="store.gameState.gameOverReason === 'STALEMATE'">無子可動（困斃判勝）！</span>
          <span v-else-if="store.gameState.gameOverReason === 'RESIGN'">
            {{ store.gameMode === 'PVE' ? '玩家認輸放棄。' : (store.gameState.winner === 'red' ? '黑方認輸放棄。' : '紅方認輸放棄。') }}
          </span>
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
