<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import ProgressPanel from './ProgressPanel.vue';
import { useGameStore } from '@/stores/gameStore';
import { UPGRADES } from '@shared/types';
const store = useGameStore();
const chapters = [
  { id: 1, name: '基礎入門', description: '認識目標、將殺與變體棋子的能力。' },
  { id: 2, name: '變體戰術', description: '練習近戰、炮架與兩步配合。' },
  { id: 3, name: '構築挑戰', description: '選擇升級位置與預算用途，完成綜合題。' },
  { id: 4, name: '戰術挑戰', description: '三步推演，找出不同防守下的接續攻勢。' },
  { id: 5, name: '高手推演', description: '三至四步將殺，計算轉位、封路與多種回應。' },
] as const;
const chapter = ref(1);
const configuration = ref<HTMLElement | null>(null);
async function chooseChallenge(id: string) {
  store.selectChallenge(id); await nextTick();
  configuration.value?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
watch(() => store.selectedChallenge?.chapter, value => { if (value) chapter.value = value; }, { immediate: true });
const visibleChallenges = computed(() => store.challenges.filter(item => item.chapter === chapter.value));
function selectChapter(id: number) {
  chapter.value = id;
  const first = store.challenges.find(item => item.chapter === id);
  if (first) store.selectChallenge(first.id);
}
</script>

<template>
  <section class="max-w-4xl w-full mx-auto px-4 py-8">
    <button class="text-slate-400 mb-6" @click="store.requestConfirmation('LEAVE')">← 返回首頁</button>
    <h1 class="text-3xl font-black text-amber-400">短局挑戰</h1>
    <p class="mt-3 text-slate-400">第 1～3 章為教學篇，第 4～5 章挑戰多步推演。步數只計算玩家出步。</p>
    <div class="flex flex-wrap items-center gap-4 mt-5 text-sm">
      <span class="text-emerald-300">已通關 {{ store.completedChallenges }} / {{ store.challenges.length }} 關</span>
      <span class="text-amber-300">★ {{ store.totalStars }} / {{ store.challenges.length * 3 }}</span>
      <button v-if="store.challengeProgress.lastChallengeId" @click="store.continueChallenges()" :disabled="store.isStarting" class="text-emerald-300 underline underline-offset-4">繼續上次挑戰 →</button>
    </div>
    <p class="mt-3 text-xs" :class="store.progressStorageAvailable ? 'text-slate-500' : 'text-amber-300'">
      {{ store.progressStorageAvailable ? '成績保存在此瀏覽器，所有關卡皆可自由選擇。' : '瀏覽器目前無法保存進度，仍可正常遊玩；關閉頁面後成績可能遺失。' }}
    </p>
    <nav class="grid sm:grid-cols-3 gap-3 mt-7" aria-label="挑戰章節">
      <button v-for="item in chapters" :key="item.id" :disabled="store.isStarting" @click="selectChapter(item.id)" :aria-pressed="chapter === item.id"
        :class="['text-left rounded-xl border p-4', chapter === item.id ? 'bg-emerald-900/60 border-emerald-500' : 'bg-slate-800 border-slate-700']">
        <span class="font-bold">第 {{ item.id }} 章 · {{ item.name }}</span>
        <p class="text-xs text-slate-400 mt-2">{{ item.description }}</p>
      </button>
    </nav>
    <div class="grid sm:grid-cols-2 gap-4 my-6">
      <button v-for="challenge in visibleChallenges" :key="challenge.id" :disabled="store.isStarting"
        @click="chooseChallenge(challenge.id)" :aria-pressed="store.selectedChallengeId === challenge.id"
        :class="['text-left rounded-2xl border-2 p-5 bg-slate-800', store.selectedChallengeId === challenge.id ? 'border-amber-500' : 'border-slate-700']">
        <span class="text-xs text-amber-300">挑戰 {{ challenge.order }} · {{ challenge.difficulty }} · {{ challenge.maxPlayerMoves }} 步</span>
        <h2 class="text-xl font-bold mt-2">{{ challenge.name }}</h2>
        <p class="text-sm text-slate-400 mt-3">{{ challenge.description }}</p>
        <div class="flex flex-wrap gap-2 mt-3"><span v-for="theme in challenge.themes" :key="theme" class="text-xs rounded bg-slate-700 px-2 py-1 text-slate-300">{{ theme }}</span></div>
        <p class="text-sm mt-4" :class="store.bestStars(challenge) ? 'text-amber-300' : 'text-slate-500'">
          {{ store.bestStars(challenge) ? `已通關 ${'★'.repeat(store.bestStars(challenge))}${'☆'.repeat(3 - store.bestStars(challenge))}` : '未通關' }}
        </p>
      </button>
    </div>
    <div ref="configuration" v-if="store.selectedChallenge && store.challenges.length" class="scroll-mt-4 rounded-2xl bg-slate-800 border border-slate-700 p-5 space-y-4">
      <h2 class="font-bold text-xl">{{ store.selectedChallenge.name }}</h2>
      <p class="text-emerald-300">目標：{{ store.selectedChallenge.goalText }}</p>
      <p class="text-sm text-slate-300">學習重點：{{ store.selectedChallenge.learningPoint }}</p>
      <p class="text-sm text-slate-300">執{{ store.selectedChallenge.playerColor === 'red' ? '紅' : '黑' }} · 升級預算 {{ store.maxBudget }} 點 · 剩餘 {{ store.remainingBudget }} 點</p>
      <div v-if="store.selectedChallenge.allowedUpgrades.length" class="flex flex-wrap gap-3">
        <button v-for="item in store.selectedChallenge.allowedUpgrades" :key="`${item.position}-${item.upgradeId}`"
          :disabled="store.isStarting" @click="store.toggleUpgrade(item.position, item.upgradeId)"
          :aria-pressed="store.playerLoadouts.some(selected => selected.position === item.position && selected.upgradeId === item.upgradeId)"
          :class="['rounded-xl border px-4 py-3', store.playerLoadouts.some(selected => selected.position === item.position && selected.upgradeId === item.upgradeId) ? 'bg-amber-500 text-slate-950 border-amber-400' : 'border-slate-600']">
          {{ item.position }} 升級{{ UPGRADES[item.upgradeId].name }}（{{ UPGRADES[item.upgradeId].cost }} 點）
        </button>
      </div>
      <p v-else class="text-sm text-slate-400">此關使用固定陣容。</p>
      <p class="text-xs text-slate-400">通關星級：無提示 ★★★ · 方向提示 ★★ · 走步提示 ★。中斷不計失敗。</p>
      <button @click="store.startGame()" :disabled="store.isStarting || store.connectionStatus !== 'CONNECTED'"
        class="rounded-xl bg-amber-500 text-slate-950 font-black px-8 py-3 disabled:opacity-50">開始挑戰</button>
    </div>
    <div v-else class="text-slate-400 my-6">正在取得關卡… <button @click="store.showChallenges()" class="text-amber-400">重新載入</button></div>
    <ProgressPanel v-if="store.challenges.length" />
  </section>
</template>
