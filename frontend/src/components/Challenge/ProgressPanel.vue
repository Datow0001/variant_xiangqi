<script setup lang="ts">
import { ref } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { decodeProgress, exportProgress, importProgress, reconcileProgress } from '@/services/challengeProgress';
const store = useGameStore();
const pendingBackup = ref<string | null>(null);
const preview = ref('');
const pasted = ref('');
const error = ref('');
const busy = ref(false);
function prepare(raw: string) {
  error.value = ''; pendingBackup.value = null;
  try {
    importProgress(raw, store.challengeProgress, store.challenges);
    const compatible = reconcileProgress(decodeProgress(raw), store.challenges);
    preview.value = `可合併 ${Object.keys(compatible.records).length} 筆成績、${Object.keys(compatible.preferences).length} 筆配點。保留較高星級，沿用目前選關位置。`;
    pendingBackup.value = raw;
  } catch (reason) { error.value = reason instanceof Error ? reason.message : '無法讀取備份'; }
}
async function readFile(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = '';
  if (!file) return;
  pendingBackup.value = null; error.value = '';
  if (file.size > 100000) { error.value = '備份檔案不可超過 100 KB'; return; }
  try { prepare(await file.text()); } catch { error.value = '無法讀取這個檔案'; }
}
async function importBackup() {
  if (!pendingBackup.value || busy.value) return;
  busy.value = true; error.value = '';
  try {
    store.challengeProgress = importProgress(pendingBackup.value, store.challengeProgress, store.challenges);
    await store.saveProgress(); store.progressMessage = store.progressStorageAvailable ? '備份已合併，最佳成績已保存' : '備份已合併，但此瀏覽器無法保存，請另行匯出備份';
    pendingBackup.value = null; pasted.value = '';
  } catch (reason) { error.value = reason instanceof Error ? reason.message : '匯入失敗'; }
  finally { busy.value = false; }
}
async function downloadBackup() {
  if (busy.value) return; busy.value = true;
  try {
    await store.saveProgress();
    const url = URL.createObjectURL(new Blob([exportProgress(store.challengeProgress)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `variant-xiangqi-progress-${new Date().toISOString().slice(0, 10)}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    store.progressMessage = '已匯出進度備份';
  } catch { error.value = '無法匯出備份'; }
  finally { busy.value = false; }
}
</script>
<template>
  <details class="rounded-xl border border-slate-700 bg-slate-800/60 p-4 mt-6">
    <summary class="cursor-pointer py-2 font-bold text-slate-300">進度與備份</summary>
    <p class="text-xs text-slate-400 my-3">成績與配點保存在此瀏覽器。可匯出備份，再於其他裝置匯入；進行中的對局不包含在備份內。</p>
    <p v-if="store.progressRevisionNotice" role="status" class="text-sm text-amber-300 mb-3">部分關卡已更新或移除，不相容的舊成績已排除。</p>
    <div class="flex flex-wrap gap-3">
      <button @click="downloadBackup()" :disabled="busy || store.isStarting" class="rounded-lg bg-slate-700 px-4 py-2">匯出備份</button>
      <label class="rounded-lg bg-slate-700 px-4 py-3 cursor-pointer focus-within:ring-2 focus-within:ring-sky-400">
        匯入備份檔案<input type="file" accept="application/json,.json" class="sr-only" :disabled="busy || store.isStarting" @change="readFile" aria-label="匯入備份檔案" />
      </label>
      <button @click="store.requestConfirmation('RESET_PROGRESS')" :disabled="busy || store.isStarting" class="rounded-lg border border-red-800 text-red-300 px-4 py-2">重設本機進度</button>
    </div>
    <details class="mt-3 text-sm text-slate-400">
      <summary class="cursor-pointer py-2">或貼上備份內容</summary>
      <textarea v-model="pasted" aria-label="備份內容" maxlength="100000" rows="4" class="w-full mt-2 rounded-lg bg-slate-900 p-3 text-sm" placeholder="貼上已匯出的備份內容"></textarea>
      <button @click="prepare(pasted)" :disabled="busy || !pasted || store.isStarting" class="rounded-lg bg-slate-700 px-4 py-2 mt-2">檢查備份</button>
    </details>
    <div v-if="pendingBackup" class="mt-4 rounded-xl bg-emerald-950 p-4">
      <p class="text-sm text-emerald-200">{{ preview }}</p>
      <div class="flex gap-3 mt-3">
        <button @click="importBackup()" :disabled="busy || store.isStarting" class="rounded-lg bg-emerald-700 px-4 py-2 font-bold">確認合併備份</button>
        <button @click="pendingBackup = null" class="rounded-lg bg-slate-700 px-4 py-2">取消</button>
      </div>
    </div>
    <p v-if="error" role="alert" class="text-sm text-red-300 mt-3">{{ error }}</p>
    <p v-if="store.progressMessage" role="status" class="text-sm text-emerald-300 mt-3">{{ store.progressMessage }}</p>
  </details>
</template>
