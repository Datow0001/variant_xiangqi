<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  char: string;
  isUpgraded?: boolean;
}>();

const isRed = computed(() => props.char === props.char.toUpperCase());

const pieceLabel = computed(() => {
  switch (props.char) {
    // 紅方
    case 'R': return '俥';
    case 'N': return '傌';
    case 'B': return '相';
    case 'A': return '仕';
    case 'K': return '帥';
    case 'C': return '炮';
    case 'P': return '兵';
    case 'U': return '天';
    case 'F': return '飛';
    case 'M': return '霰';
    case 'S': return '突';

    // 黑方
    case 'r': return '車';
    case 'n': return '馬';
    case 'b': return '象';
    case 'a': return '士';
    case 'k': return '將';
    case 'c': return '砲';
    case 'p': return '卒';
    case 'u': return '天';
    case 'f': return '飛';
    case 'm': return '霰';
    case 's': return '突';

    default: return '';
  }
});
</script>

<template>
  <div
    :class="[
      'w-full h-full rounded-full flex items-center justify-center select-none shadow-md transition-transform duration-150',
      isRed
        ? 'bg-amber-100 border-2 border-red-600 text-red-600 shadow-red-900/30'
        : 'bg-stone-200 border-2 border-slate-900 text-slate-900 shadow-black/40',
      isUpgraded ? 'ring-2 ring-amber-400 shadow-amber-400/50 scale-105' : ''
    ]"
  >
    <!-- 內圓圈裝飾 -->
    <div
      :class="[
        'w-[84%] h-[84%] rounded-full border flex items-center justify-center',
        isRed ? 'border-red-400' : 'border-slate-600',
        isUpgraded ? 'border-amber-500 bg-amber-50/20' : ''
      ]"
    >
      <span class="piece-font text-lg sm:text-xl md:text-2xl font-black">
        {{ pieceLabel }}
      </span>
    </div>
  </div>
</template>
