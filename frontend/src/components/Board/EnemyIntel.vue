<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { STAGES } from '@shared/stages';
import { UPGRADES } from '@shared/types';

const store = useGameStore();

const stage = computed(() => STAGES[store.stageId || 1]);
const isPvp = computed(() => store.gameMode === 'PVP');
const aiLoadouts = computed(() => store.gameState?.aiLoadouts || []);
</script>

<template>
  <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-4 shadow-lg backdrop-blur">
    <!-- PVE 敵方情報 -->
    <div v-if="!isPvp">
      <div class="flex items-center justify-between mb-3 border-b border-slate-700/60 pb-2.5">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span>
          <span class="font-black text-sm text-slate-200">敵方情報：{{ stage.name }}</span>
        </div>
        <span class="text-xs font-mono px-2 py-0.5 rounded bg-slate-900 text-amber-400">
          AI 預算: {{ stage.budget }} 點
        </span>
      </div>

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

    <!-- PVP 雙方陣容情報 -->
    <div v-else class="space-y-4">
      <div class="flex items-center justify-between border-b border-slate-700/60 pb-2.5">
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
          <span class="font-black text-sm text-slate-200">雙方變體棋子配置</span>
        </div>
        <span class="text-xs font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-400">
          裁判: 引擎把關
        </span>
      </div>

      <!-- 紅方陣容 -->
      <div>
        <div class="text-xs font-bold text-red-400 mb-1.5 flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-red-500"></span>
          紅方升級棋子 ({{ store.redLoadouts.length }})
        </div>
        <div v-if="store.redLoadouts.length === 0" class="text-xs text-slate-500 pl-3">
          傳統標準棋子
        </div>
        <div v-else class="flex flex-wrap gap-1.5 pl-3">
          <span
            v-for="(item, idx) in store.redLoadouts"
            :key="idx"
            class="text-xs px-2 py-0.5 rounded bg-red-950/60 text-red-300 border border-red-800"
          >
            {{ UPGRADES[item.upgradeId]?.name }} ({{ item.position }})
          </span>
        </div>
      </div>

      <!-- 黑方陣容 -->
      <div>
        <div class="text-xs font-bold text-neutral-300 mb-1.5 flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-neutral-300"></span>
          黑方升級棋子 ({{ store.blackLoadouts.length }})
        </div>
        <div v-if="store.blackLoadouts.length === 0" class="text-xs text-slate-500 pl-3">
          傳統標準棋子
        </div>
        <div v-else class="flex flex-wrap gap-1.5 pl-3">
          <span
            v-for="(item, idx) in store.blackLoadouts"
            :key="idx"
            class="text-xs px-2 py-0.5 rounded bg-neutral-900 text-neutral-200 border border-neutral-700"
          >
            {{ UPGRADES[item.upgradeId]?.name }} ({{ item.position }})
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
