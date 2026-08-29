<script setup lang="ts">
import { computed } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { UPGRADES, UpgradeId } from '@shared/types';
import { STAGES } from '@shared/stages';

const store = useGameStore();

const isRed = computed(() => store.playerColor === 'red');

// 可升級棋子清單與原始位置
const upgradeableSlots = computed(() => {
  if (isRed.value) {
    return [
      { type: 'HORSE', label: '左馬', pos: 'b0', upgradeId: 'TIAN_MA' as UpgradeId },
      { type: 'HORSE', label: '右馬', pos: 'h0', upgradeId: 'TIAN_MA' as UpgradeId },
      { type: 'ELEPHANT', label: '左相', pos: 'c0', upgradeId: 'FEI_XIANG' as UpgradeId },
      { type: 'ELEPHANT', label: '右相', pos: 'g0', upgradeId: 'FEI_XIANG' as UpgradeId },
      { type: 'CANNON', label: '左炮', pos: 'b2', upgradeId: 'PO_JI_PAO' as UpgradeId },
      { type: 'CANNON', label: '右炮', pos: 'h2', upgradeId: 'PO_JI_PAO' as UpgradeId },
      { type: 'SOLDIER', label: '左一路兵', pos: 'a3', upgradeId: 'TU_JI_BING' as UpgradeId },
      { type: 'SOLDIER', label: '左三路兵', pos: 'c3', upgradeId: 'TU_JI_BING' as UpgradeId },
      { type: 'SOLDIER', label: '中兵', pos: 'e3', upgradeId: 'TU_JI_BING' as UpgradeId },
      { type: 'SOLDIER', label: '右三路兵', pos: 'g3', upgradeId: 'TU_JI_BING' as UpgradeId },
      { type: 'SOLDIER', label: '右一路兵', pos: 'i3', upgradeId: 'TU_JI_BING' as UpgradeId },
    ];
  } else {
    return [
      { type: 'HORSE', label: '左馬', pos: 'b9', upgradeId: 'TIAN_MA' as UpgradeId },
      { type: 'HORSE', label: '右馬', pos: 'h9', upgradeId: 'TIAN_MA' as UpgradeId },
      { type: 'ELEPHANT', label: '左象', pos: 'c9', upgradeId: 'FEI_XIANG' as UpgradeId },
      { type: 'ELEPHANT', label: '右象', pos: 'g9', upgradeId: 'FEI_XIANG' as UpgradeId },
      { type: 'CANNON', label: '左砲', pos: 'b7', upgradeId: 'PO_JI_PAO' as UpgradeId },
      { type: 'CANNON', label: '右砲', pos: 'h7', upgradeId: 'PO_JI_PAO' as UpgradeId },
      { type: 'SOLDIER', label: '左一路卒', pos: 'a6', upgradeId: 'TU_JI_BING' as UpgradeId },
      { type: 'SOLDIER', label: '左三路卒', pos: 'c6', upgradeId: 'TU_JI_BING' as UpgradeId },
      { type: 'SOLDIER', label: '中卒', pos: 'e6', upgradeId: 'TU_JI_BING' as UpgradeId },
      { type: 'SOLDIER', label: '右三路卒', pos: 'g6', upgradeId: 'TU_JI_BING' as UpgradeId },
      { type: 'SOLDIER', label: '右一路卒', pos: 'i6', upgradeId: 'TU_JI_BING' as UpgradeId },
    ];
  }
});

function isSlotUpgraded(pos: string): boolean {
  return store.playerLoadouts.some((l) => l.position === pos);
}

function toggleSlot(slot: { pos: string; upgradeId: UpgradeId }) {
  store.toggleUpgrade(slot.pos, slot.upgradeId);
}

// 快速預設陣容
function applyPreset(presetName: string) {
  store.resetLoadouts();
  const p = isRed.value
    ? {
        horseL: 'b0',
        horseR: 'h0',
        eleL: 'c0',
        eleR: 'g0',
        canL: 'b2',
        canR: 'h2',
        pawn1: 'a3',
        pawn2: 'c3',
        pawn3: 'e3',
        pawn4: 'g3',
      }
    : {
        horseL: 'b9',
        horseR: 'h9',
        eleL: 'c9',
        eleR: 'g9',
        canL: 'b7',
        canR: 'h7',
        pawn1: 'a6',
        pawn2: 'c6',
        pawn3: 'e6',
        pawn4: 'g6',
      };

  if (presetName === 'CAVALRY') {
    // 雙天馬(6) + 雙飛象(4) = 10
    store.toggleUpgrade(p.horseL, 'TIAN_MA');
    store.toggleUpgrade(p.horseR, 'TIAN_MA');
    store.toggleUpgrade(p.eleL, 'FEI_XIANG');
    store.toggleUpgrade(p.eleR, 'FEI_XIANG');
  } else if (presetName === 'ARTILLERY') {
    // 雙迫擊砲(6) + 1飛象(2) + 2突擊兵(2) = 10
    store.toggleUpgrade(p.canL, 'PO_JI_PAO');
    store.toggleUpgrade(p.canR, 'PO_JI_PAO');
    store.toggleUpgrade(p.eleL, 'FEI_XIANG');
    store.toggleUpgrade(p.pawn2, 'TU_JI_BING');
    store.toggleUpgrade(p.pawn3, 'TU_JI_BING');
  } else if (presetName === 'BALANCED') {
    // 1天馬(3) + 1迫擊砲(3) + 1飛象(2) + 2突擊兵(2) = 10
    store.toggleUpgrade(p.horseL, 'TIAN_MA');
    store.toggleUpgrade(p.canR, 'PO_JI_PAO');
    store.toggleUpgrade(p.eleL, 'FEI_XIANG');
    store.toggleUpgrade(p.pawn2, 'TU_JI_BING');
    store.toggleUpgrade(p.pawn3, 'TU_JI_BING');
  }
}
</script>

<template>
  <div class="max-w-4xl mx-auto py-8 px-4">
    <!-- 頂部導航與點數統計 -->
    <div class="flex flex-wrap items-center justify-between gap-4 bg-slate-800/90 border border-slate-700 rounded-2xl p-5 mb-8 shadow-xl backdrop-blur">
      <button
        @click="store.status = 'STAGE_SELECT'"
        class="text-slate-400 hover:text-slate-200 text-sm font-semibold flex items-center gap-1.5 transition-colors"
      >
        ← 重選關卡 (當前: {{ STAGES[store.stageId].name }})
      </button>

      <div class="flex items-center gap-6">
        <div class="text-sm text-slate-300">
          出戰陣營:
          <span :class="isRed ? 'text-red-400 font-bold' : 'text-slate-300 font-bold'">
            {{ isRed ? '紅方 (先手)' : '黑方 (後手)' }}
          </span>
        </div>

        <div class="flex items-center gap-3 bg-slate-900/80 px-4 py-2 rounded-xl border border-slate-700">
          <span class="text-xs text-slate-400 font-medium">剩餘點數</span>
          <div class="text-2xl font-black text-amber-400 font-mono">
            {{ store.remainingBudget }}
            <span class="text-xs text-slate-400 font-normal">/ {{ store.maxBudget }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 特殊棋子說明卡 -->
    <div class="grid sm:grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <div
        v-for="(info, key) in UPGRADES"
        :key="key"
        class="bg-slate-800/60 border border-slate-700/80 rounded-xl p-4 flex flex-col justify-between"
      >
        <div>
          <div class="flex justify-between items-start mb-2">
            <span class="text-lg font-black text-slate-100">{{ info.name }}</span>
            <span class="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {{ info.cost }} 點
            </span>
          </div>
          <div class="text-xs text-slate-400 mb-2">替換原始: {{ info.originalPieceName }}</div>
          <p class="text-xs text-slate-300 leading-relaxed">{{ info.description }}</p>
        </div>
      </div>
    </div>

    <!-- 快速陣容推薦 -->
    <div class="flex flex-wrap items-center gap-3 mb-8">
      <span class="text-xs text-slate-400 font-bold">推薦構築範本:</span>
      <button
        @click="applyPreset('CAVALRY')"
        class="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition"
      >
        🐎 雙天馬雙象流 (10點)
      </button>
      <button
        @click="applyPreset('ARTILLERY')"
        class="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition"
      >
        💣 迫擊砲突擊流 (10點)
      </button>
      <button
        @click="applyPreset('BALANCED')"
        class="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition"
      >
        ⚖️ 步騎砲均衡流 (10點)
      </button>
      <button
        @click="store.resetLoadouts()"
        class="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-red-950/40 text-slate-400 hover:text-red-300 border border-slate-700 transition ml-auto"
      >
        重置清空
      </button>
    </div>

    <!-- 自訂升級選取格點 -->
    <div class="bg-slate-800/80 border border-slate-700 rounded-2xl p-6 mb-8 shadow-xl">
      <h3 class="text-base font-bold text-slate-200 mb-4 flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-amber-400"></span>
        點擊棋子進行升級 / 取消升級
      </h3>

      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        <button
          v-for="slot in upgradeableSlots"
          :key="slot.pos"
          @click="toggleSlot(slot)"
          :disabled="!isSlotUpgraded(slot.pos) && store.remainingBudget < UPGRADES[slot.upgradeId].cost"
          :class="[
            'p-3.5 rounded-xl border-2 text-left transition-all duration-200 flex flex-col justify-between',
            isSlotUpgraded(slot.pos)
              ? 'bg-amber-500/15 border-amber-500 text-slate-100 shadow-md scale-102 ring-1 ring-amber-400/30'
              : store.remainingBudget < UPGRADES[slot.upgradeId].cost
              ? 'bg-slate-900/40 border-slate-800 text-slate-400 opacity-50 cursor-not-allowed'
              : 'bg-slate-700/40 border-slate-600/80 text-slate-300 hover:border-slate-500 hover:bg-slate-700/70'
          ]"
        >
          <div class="flex justify-between items-center mb-1">
            <span class="font-bold text-sm">{{ slot.label }} ({{ slot.pos }})</span>
            <span class="text-xs font-mono px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 font-semibold">
              {{ UPGRADES[slot.upgradeId].cost }}pt
            </span>
          </div>
          <div class="text-xs text-amber-300 font-medium">
            升級: {{ UPGRADES[slot.upgradeId].name }}
          </div>
        </button>
      </div>
    </div>

    <!-- 開始對戰按鈕 -->
    <div class="flex justify-center gap-4">
      <button
        @click="store.startGame()"
        class="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-black text-xl py-4 px-14 rounded-2xl shadow-xl shadow-emerald-500/20 hover:scale-105 active:scale-95 transition-all duration-200"
      >
        開局對弈！ ⚔️
      </button>
    </div>
  </div>
</template>
