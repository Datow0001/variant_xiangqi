<script setup lang="ts">
import { useGameStore } from '@/stores/gameStore';
import { STAGES } from '@shared/stages';
import { UPGRADES } from '@shared/types';

const store = useGameStore();

const stagesList = [STAGES[1], STAGES[2], STAGES[3]];
</script>

<template>
  <div class="max-w-4xl mx-auto py-10 px-4">
    <div class="text-center mb-10">
      <h1 class="text-4xl md:text-5xl font-extrabold tracking-wider text-amber-400 mb-3 drop-shadow-md">
        自訂變體象棋對弈系統
      </h1>
      <p class="text-slate-400 text-lg">
        構築你的 10 點特殊棋子陣容，挑戰三大漸進式 AI 關卡
      </p>
    </div>

    <!-- 陣營選擇 -->
    <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-6 mb-8 shadow-xl backdrop-blur">
      <h2 class="text-lg font-bold text-slate-200 mb-4 flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
        選擇出戰陣營 (先後手)
      </h2>
      <div class="grid grid-cols-2 gap-4 max-w-md mx-auto">
        <button
          @click="store.setPlayerColor('red')"
          :class="[
            'py-3.5 px-6 rounded-xl font-bold flex items-center justify-center gap-3 transition-all duration-200 border-2',
            store.playerColor === 'red'
              ? 'bg-red-950/80 border-red-500 text-red-300 shadow-lg shadow-red-950/50 scale-105'
              : 'bg-slate-700/50 border-slate-600 text-slate-400 hover:border-slate-500'
          ]"
        >
          <span class="w-4 h-4 rounded-full bg-red-500 inline-block shadow"></span>
          執紅 (先手出步)
        </button>
        <button
          @click="store.setPlayerColor('black')"
          :class="[
            'py-3.5 px-6 rounded-xl font-bold flex items-center justify-center gap-3 transition-all duration-200 border-2',
            store.playerColor === 'black'
              ? 'bg-neutral-900 border-neutral-400 text-neutral-200 shadow-lg shadow-black/50 scale-105'
              : 'bg-slate-700/50 border-slate-600 text-slate-400 hover:border-slate-500'
          ]"
        >
          <span class="w-4 h-4 rounded-full bg-neutral-300 inline-block shadow"></span>
          執黑 (後手迎擊)
        </button>
      </div>
    </div>

    <!-- 關卡選擇卡片 -->
    <div class="mb-10">
      <h2 class="text-lg font-bold text-slate-200 mb-4 flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
        選擇挑戰關卡
      </h2>
      <div class="grid md:grid-cols-3 gap-6">
        <div
          v-for="stg in stagesList"
          :key="stg.id"
          @click="store.stageId = stg.id"
          :class="[
            'relative cursor-pointer rounded-2xl p-6 transition-all duration-300 border-2 flex flex-col justify-between overflow-hidden',
            store.stageId === stg.id
              ? 'bg-slate-800 border-amber-500 shadow-xl shadow-amber-500/10 scale-102 ring-2 ring-amber-400/20'
              : 'bg-slate-800/50 border-slate-700/80 hover:border-slate-600 hover:bg-slate-800/80'
          ]"
        >
          <!-- 標記 -->
          <div
            v-if="store.stageId === stg.id"
            class="absolute top-0 right-0 bg-amber-500 text-slate-950 text-xs font-black px-3 py-1 rounded-bl-lg uppercase tracking-wider"
          >
            已選中
          </div>

          <div>
            <div class="flex justify-between items-center mb-2">
              <span class="text-xs font-bold px-2.5 py-1 rounded bg-slate-700 text-slate-300">
                關卡 {{ stg.id }}
              </span>
              <span class="text-xs font-semibold text-amber-400/90">
                AI 預算: {{ stg.budget }} 點
              </span>
            </div>

            <h3 class="text-2xl font-black text-slate-100 mb-3 tracking-wide">
              {{ stg.name }}
            </h3>

            <p class="text-sm text-slate-400 mb-5 leading-relaxed">
              {{ stg.description }}
            </p>

            <!-- 敵方情報 -->
            <div class="bg-slate-900/60 rounded-xl p-3 border border-slate-700/50 mb-4">
              <div class="text-xs text-slate-400 font-medium mb-1.5 flex items-center gap-1.5">
                <span>敵方變體陣容:</span>
              </div>
              <div v-if="stg.defaultBlackLoadouts.length === 0" class="text-xs text-slate-400 font-mono">
                全傳統標準棋子 (0 升級)
              </div>
              <div v-else class="flex flex-wrap gap-1.5">
                <span
                  v-for="(item, idx) in stg.defaultBlackLoadouts"
                  :key="idx"
                  class="text-xs font-semibold px-2 py-0.5 rounded bg-slate-800 text-amber-300 border border-slate-600"
                >
                  {{ UPGRADES[item.upgradeId]?.name }} ({{ item.position }})
                </span>
              </div>
            </div>
          </div>

          <div class="text-xs text-slate-400 text-right">
            思考速度: 約 {{ stg.movetimeMs }}ms
          </div>
        </div>
      </div>
    </div>

    <!-- 前進構築按鈕 -->
    <div class="text-center">
      <button
        @click="store.status = 'LOADOUT'"
        class="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xl py-4 px-12 rounded-2xl shadow-xl shadow-amber-500/20 hover:scale-105 active:scale-95 transition-all duration-200"
      >
        進入局前構築 (配點 10 點) →
      </button>
    </div>
  </div>
</template>
