<script setup lang="ts">
import { useGameStore } from '@/stores/gameStore';
import StageSelector from '@/components/Stage/StageSelector.vue';
import LoadoutPanel from '@/components/Loadout/LoadoutPanel.vue';
import ChessBoard from '@/components/Board/ChessBoard.vue';

const store = useGameStore();
</script>

<template>
  <main class="min-h-screen bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 text-slate-100 flex flex-col justify-between">
    <!-- 全域錯誤提示 Toast -->
    <transition
      enter-active-class="transform ease-out duration-300 transition"
      enter-from-class="translate-y-2 opacity-0 sm:translate-y-0 sm:translate-x-2"
      enter-to-class="translate-y-0 opacity-100 sm:translate-x-0"
      leave-active-class="transition ease-in duration-100"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="store.errorMessage"
        class="fixed top-6 right-6 z-50 bg-red-900/90 border border-red-500 text-white px-5 py-3 rounded-2xl shadow-2xl backdrop-blur flex items-center gap-3"
      >
        <span class="text-xl">⚠️</span>
        <span class="text-sm font-semibold">{{ store.errorMessage }}</span>
      </div>
    </transition>

    <!-- 動態視圖切換 -->
    <div class="flex-1 flex flex-col justify-center">
      <StageSelector v-if="store.status === 'STAGE_SELECT'" />
      <LoadoutPanel v-else-if="store.status === 'LOADOUT'" />
      <ChessBoard v-else-if="store.status === 'PLAYING'" />
    </div>

    <!-- 底部版權宣告 -->
    <footer class="py-4 text-center text-xs text-slate-400/60 border-t border-slate-800/40">
      自訂變體象棋對弈系統 (MVP) &bull; Powered by Fairy-Stockfish Largeboard &amp; Vue 3
    </footer>
  </main>
</template>
