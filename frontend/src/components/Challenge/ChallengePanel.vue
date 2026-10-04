<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore } from '@/stores/gameStore';
const store = useGameStore();
const challenge = computed(() => store.gameState?.challenge);
const reasons: Record<string, string> = {
  CHECKMATE: '已完成限步將殺。', TARGET_CAPTURED: '已吃掉指定目標。', MOVE_LIMIT: '已用完允許步數，尚未完成目標。',
  STALEMATE_NOT_MATE: '對手已無合法走法，但沒有受到將軍，這是困斃。本關必須將死，困斃不算過關。',
  PLAYER_DEFEATED: '玩家已被擊敗。', OBJECTIVE_NOT_MET: '對局結束，但未達成本關目標。', RESIGN: '已放棄本次挑戰。', INTERRUPTED: '連線或引擎中斷，本次不計失敗。',
};
</script>

<template>
  <section v-if="challenge" class="bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4" aria-label="挑戰資訊">
    <h2 class="text-xl font-bold text-amber-300">{{ challenge.definition.name }}</h2>
    <p class="text-xs text-slate-400">第 {{ challenge.definition.chapter }} 章 · {{ challenge.definition.difficulty }} · 歷史最佳 {{ store.bestStars(challenge.definition) }} 星</p>
    <p class="text-sm text-slate-200">{{ challenge.definition.goalText }}</p>
    <div class="bg-slate-900 rounded-xl p-4">
      <div class="text-3xl font-black text-emerald-400">剩餘 {{ challenge.remainingMoves }} 步</div>
      <p class="text-xs text-slate-400 mt-2">已走 {{ challenge.playerMoves }} / {{ challenge.definition.maxPlayerMoves }} 步，只計玩家出步</p>
    </div>
    <p v-if="challenge.targetSquare" class="text-sm text-fuchsia-300">指定目標：{{ challenge.targetSquare }}（棋盤紫框）</p>
    <template v-if="challenge.outcome === 'ACTIVE'">
      <p class="text-xs text-slate-400">使用方向提示後最高 2 星，走步提示後最高 1 星。</p>
      <div class="flex gap-2">
        <button @click="store.requestHint('DIRECTION')" :disabled="!store.canMove || store.isHintPending"
          class="rounded-lg bg-slate-700 p-3 text-sm disabled:opacity-40">方向提示</button>
        <button @click="store.requestHint('MOVE')" :disabled="!store.canMove || store.isHintPending"
          class="rounded-lg bg-slate-700 p-3 text-sm disabled:opacity-40">走步提示</button>
      </div>
      <p v-if="store.latestHint" role="status" class="text-sm text-amber-200 bg-amber-950/40 rounded-lg p-3">{{ store.latestHint.text }}</p>
    </template>
    <div v-else role="status" class="space-y-3 border-t border-slate-600 pt-4">
      <h3 class="text-2xl font-black" :class="challenge.outcome === 'SUCCEEDED' ? 'text-emerald-400' : 'text-amber-300'">
        {{ challenge.outcome === 'SUCCEEDED' ? '挑戰成功！' : challenge.outcome === 'FAILED' ? '挑戰未完成' : '挑戰已中斷' }}
      </h3>
      <div v-if="challenge.outcome === 'SUCCEEDED'" class="text-3xl text-amber-400" :aria-label="`本次 ${challenge.stars} 星`">{{ '★'.repeat(challenge.stars) }}{{ '☆'.repeat(3 - challenge.stars) }}<span class="text-xs ml-2">本次成績</span></div>
      <p class="text-sm text-slate-300">{{ reasons[challenge.reason ?? ''] }}</p>
      <p v-if="challenge.explanation" class="text-sm text-slate-400">{{ challenge.explanation }}</p>
      <p v-if="challenge.failureExplanation" class="text-sm text-amber-200">常見誤區：{{ challenge.failureExplanation }}</p>
      <button @click="store.startGame()" :disabled="store.isStarting" class="w-full rounded-xl bg-amber-500 text-slate-950 font-bold py-3 disabled:opacity-40">重新挑戰</button>
      <button @click="store.showChallenges(challenge.definition.id)" class="w-full rounded-xl bg-slate-700 py-3">重新配點／選關</button>
      <button v-if="challenge.outcome === 'SUCCEEDED' && challenge.definition.nextChallengeId" @click="store.showChallenges(challenge.definition.nextChallengeId)"
        class="w-full rounded-xl bg-emerald-700 py-3 font-bold">下一關 →</button>
    </div>
    <p class="text-xs text-slate-500">方向提示 {{ challenge.directionHintUses }} 次 · 走步提示 {{ challenge.moveHintUses }} 次</p>
  </section>
</template>
