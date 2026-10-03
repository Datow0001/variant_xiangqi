<script setup lang="ts">
import { useGameStore } from '@/stores/gameStore';
import { STAGES } from '@shared/stages';
import { UPGRADES } from '@shared/types';

const store = useGameStore();

const stagesList = [STAGES[1], STAGES[2], STAGES[3]];

function goToLoadout() {
  store.status = 'LOADOUT';
}
</script>

<template>
  <div class="max-w-4xl mx-auto py-10 px-4">
    <div class="text-center mb-8">
      <h1 class="text-4xl md:text-5xl font-extrabold tracking-wider text-amber-400 mb-3 drop-shadow-md">
        自訂變體象棋對弈系統
      </h1>
      <p class="text-slate-400 text-lg">
        構築你的 10 點特殊棋子陣容，體驗全新戰術博弈
      </p>
    </div>

    <!-- 對弈模式切換頁籤 -->
    <div class="flex justify-center mb-4">
      <button @click="store.showChallenges()" class="bg-emerald-700 hover:bg-emerald-600 rounded-2xl px-8 py-4 font-bold text-lg">⚡ 短局挑戰 · 限步解題</button>
    </div>
    <div v-if="store.challengeProgress.lastChallengeId" class="text-center mb-6">
      <button @click="store.continueChallenges()" class="text-emerald-300 underline underline-offset-4">繼續上次挑戰 →</button>
    </div>
    <div class="flex justify-center mb-8">
      <div class="inline-flex flex-wrap justify-center p-1.5 rounded-2xl bg-slate-800/90 border border-slate-700 shadow-xl">
        <button
          @click="store.gameMode = 'PVE'"
          :class="[
            'px-6 py-2.5 rounded-xl font-bold text-sm transition-all duration-200 flex items-center gap-2',
            store.gameMode === 'PVE'
              ? 'bg-amber-500 text-slate-950 shadow-md font-black scale-102'
              : 'text-slate-400 hover:text-slate-200'
          ]"
        >
          🤖 單人挑戰 AI (PVE)
        </button>
        <button
          @click="store.setPvpMode()"
          :class="[
            'px-6 py-2.5 rounded-xl font-bold text-sm transition-all duration-200 flex items-center gap-2',
            store.gameMode === 'PVP'
              ? 'bg-amber-500 text-slate-950 shadow-md font-black scale-102'
              : 'text-slate-400 hover:text-slate-200'
          ]"
        >
          👥 雙人同機對戰 (PVP)
        </button>
      </div>
    </div>

    <!-- PVE 專屬設定區塊 -->
    <div v-if="store.gameMode === 'PVE'">
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

      <!-- 前進構件按鈕 (PVE) -->
      <div class="text-center">
        <button
          @click="goToLoadout"
          class="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xl py-4 px-12 rounded-2xl shadow-xl shadow-amber-500/20 hover:scale-105 active:scale-95 transition-all duration-200"
        >
          進入局前構築 (玩家配點 10 點) →
        </button>
      </div>
    </div>

    <!-- PVP 專屬說明區塊 -->
    <div v-else class="space-y-8">
      <div class="bg-slate-800/80 border border-slate-700 rounded-3xl p-8 shadow-xl backdrop-blur">
        <div class="max-w-2xl mx-auto text-center space-y-4">
          <div class="inline-flex p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-3xl">
            ⚔️ 雙人面對面切磋
          </div>
          <h2 class="text-2xl md:text-3xl font-black text-slate-100">
            同機對戰模式 (Referee Mode)
          </h2>
          <p class="text-slate-300 text-sm md:text-base leading-relaxed">
            兩位玩家將各擁有 <strong class="text-amber-400 font-bold">10 點特殊棋子構築預算</strong>，在同一台設備面對面對局。<br>
            系統由 Fairy-Stockfish 引擎擔任專業裁判，嚴格把關雙方合法步、將軍警示與絕殺結算，不介入任何 AI 走步。
          </p>

          <div class="grid sm:grid-cols-3 gap-4 pt-4 text-left">
            <div class="bg-slate-900/60 p-4 rounded-xl border border-slate-700/60">
              <div class="text-amber-400 font-bold text-sm mb-1">🔴 紅方 10 點預算</div>
              <div class="text-xs text-slate-400">自由升級紅方馬、象、砲、兵。</div>
            </div>
            <div class="bg-slate-900/60 p-4 rounded-xl border border-slate-700/60">
              <div class="text-neutral-300 font-bold text-sm mb-1">⚫ 黑方 10 點預算</div>
              <div class="text-xs text-slate-400">自由升級黑方馬、象、砲、卒。</div>
            </div>
            <div class="bg-slate-900/60 p-4 rounded-xl border border-slate-700/60">
              <div class="text-emerald-400 font-bold text-sm mb-1">🔄 靈活視角切換</div>
              <div class="text-xs text-slate-400">支援手動翻轉或隨換手自動翻轉。</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 前進構件按鈕 (PVP) -->
      <div class="text-center">
        <button
          @click="goToLoadout"
          class="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xl py-4 px-12 rounded-2xl shadow-xl shadow-amber-500/20 hover:scale-105 active:scale-95 transition-all duration-200"
        >
          開始雙方配點 (紅方 10 點 / 黑方 10 點) →
        </button>
      </div>
    </div>
  </div>
</template>
