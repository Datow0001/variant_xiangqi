<script setup lang="ts">
import { useGameStore } from '@/stores/gameStore';
import { computed, onMounted, onBeforeUnmount, watch } from 'vue';
import ConfirmDialog from '@/components/Common/ConfirmDialog.vue';
import { PROGRESS_KEY } from '@/services/challengeProgress';
import StageSelector from '@/components/Stage/StageSelector.vue';
import LoadoutPanel from '@/components/Loadout/LoadoutPanel.vue';
import ChessBoard from '@/components/Board/ChessBoard.vue';
import ChallengeSelector from '@/components/Challenge/ChallengeSelector.vue';

const store = useGameStore();
watch(() => store.status, status => { if (status === 'PLAYING') window.scrollTo(0, 0); }, { flush: 'post' });
const confirmation = computed(() => store.pendingConfirmation === 'RESET_PROGRESS'
  ? { title: '重設本機進度？', message: '將清除這個瀏覽器的成績與配點，也會同步到其他分頁。建議先匯出備份。', label: '重設進度' }
  : store.pendingConfirmation === 'RESIGN'
  ? { title: '確定認輸？', message: '本次對局會結束。短局挑戰會記為未完成，既有最佳成績仍保留。', label: '確認認輸' }
  : { title: '離開目前對局？', message: '離開後這個對局無法繼續，既有最佳成績與配點仍保留。', label: '離開對局' });
function visibilityChanged() {
  store.isForeground = document.visibilityState !== 'hidden';
  if (store.isForeground) { try { store.mergeStoredProgress(localStorage.getItem(PROGRESS_KEY)); } catch { store.progressStorageAvailable = false; } void store.recoverForeground(); }
}
function storageChanged(event: StorageEvent) { if (event.key === PROGRESS_KEY) store.mergeStoredProgress(event.newValue); }
function beforeUnload(event: BeforeUnloadEvent) {
  if (store.isStarting || (store.resume && store.gameState && !['FINISHED', 'FAULTED'].includes(store.gameState.status))) { event.preventDefault(); event.returnValue = ''; }
}
function online() { if (document.visibilityState !== 'hidden') void store.recoverForeground(); }
function pageShown(event: PageTransitionEvent) { if (event.persisted) visibilityChanged(); }
onMounted(() => {
  void store.initialize(); document.addEventListener('visibilitychange', visibilityChanged);
  window.addEventListener('storage', storageChanged); window.addEventListener('online', online); window.addEventListener('beforeunload', beforeUnload);
  window.addEventListener('pageshow', pageShown);
});
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', visibilityChanged); window.removeEventListener('storage', storageChanged);
  window.removeEventListener('online', online); window.removeEventListener('beforeunload', beforeUnload);
  window.removeEventListener('pageshow', pageShown);
});
</script>

<template>
  <main class="app-shell bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 text-slate-100 flex flex-col justify-between">
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
        role="alert" class="mx-3 mt-3 bg-red-900/90 border border-red-500 text-white px-4 py-3 rounded-xl flex items-center gap-3"
      >
        <span class="text-xl">⚠️</span>
        <span class="text-sm font-semibold">{{ store.errorMessage }}</span>
        <button @click="store.errorMessage = null" aria-label="關閉錯誤提示" class="ml-auto px-2">×</button>
      </div>
    </transition>

    <!-- 動態視圖切換 -->
    <div v-if="store.connectionStatus === 'CONNECTING' || store.connectionStatus === 'RECONNECTING' || store.isStarting || store.isRecovering || store.isMovePending"
      role="status" class="text-center py-3 text-amber-300">
      {{ store.isStarting ? '正在建立對局…' : store.isRecovering ? '正在確認最新盤面…' : store.isMovePending ? '正在送出走步…' : store.connectionStatus === 'RECONNECTING' ? '連線中斷，正在恢復對局…' : '正在連線…' }}
    </div>
    <ConfirmDialog v-if="store.pendingConfirmation" :title="confirmation.title" :message="confirmation.message" :confirm-label="confirmation.label"
      @cancel="store.pendingConfirmation = null" @confirm="store.confirmAction()" />
    <div class="flex-1 flex flex-col justify-center">
      <StageSelector v-if="store.status === 'STAGE_SELECT'" />
      <LoadoutPanel v-else-if="store.status === 'LOADOUT'" />
      <ChallengeSelector v-else-if="store.status === 'CHALLENGE_SELECT'" />
      <ChessBoard v-else-if="store.status === 'PLAYING'" />
    </div>

    <!-- 底部版權宣告 -->
    <footer class="py-4 text-center text-xs text-slate-400/60 border-t border-slate-800/40">
      自訂變體象棋對弈系統 (MVP) &bull; Powered by Fairy-Stockfish Largeboard &amp; Vue 3
    </footer>
  </main>
</template>
