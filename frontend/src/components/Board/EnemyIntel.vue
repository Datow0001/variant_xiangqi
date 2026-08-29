<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { STAGES } from '@shared/stages';
import { UPGRADES } from '@shared/types';

const store = useGameStore();

const stage = computed(() => STAGES[store.stageId]);
const aiLoadouts = computed(() => store.gameState?.aiLoadouts || []);
</script>

<template>
  <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4 shadow-lg backdrop-blur">
    <div class="flex items-center justify-between mb-3 border-b border-slate-700/60 pb-2.5">
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span>
        <span class="font-black text-sm text-slate-200">敵方情報：{{ stage.name }}</span>
      </div>
      <span class="text-xs font-mono px-2 py-0.5 rounded bg-slate-900 text-amber-400">
        AI 預算: {{ stage.budget }} 點
      </span>
    </div>

    <!-- AI 升級棋子清單 -->
    <div v-if="aiLoadouts.length === 0" class="text-xs text-slate-400 py-1">
      對手使用純傳統象棋陣容，無特殊棋子。
    </div>
    <div v-else class="space-y-2">
      <div
        v-for="(item, idx) in aiLoadouts"
        :key="idx"
        class="bg-slate-900/60 rounded-xl p-2.5 border border-slate-700/50 flex items-start gap-2.5"
      >
        <span class="text-xs font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 whitespace-nowrap">
          {{ item.position }}
        </span>
        <div>
          <div class="text-xs font-bold text-slate-200">
            {{ UPGRADES[item.upgradeId]?.name }} ({{ UPGRADES[item.upgradeId]?.originalPieceName }}升級)
          </div>
          <div class="text-[11px] text-slate-400 leading-tight mt-0.5">
            {{ UPGRADES[item.upgradeId]?.description }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
