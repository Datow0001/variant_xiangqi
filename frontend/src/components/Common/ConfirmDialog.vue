<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
defineProps<{ title: string; message: string; confirmLabel: string }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
onMounted(() => dialog.value?.showModal());
onBeforeUnmount(() => dialog.value?.close());
</script>
<template>
  <dialog ref="dialog" class="confirm-dialog rounded-2xl bg-slate-800 text-slate-100 border border-slate-600 p-5 w-[calc(100%_-_2rem)] max-w-sm" aria-labelledby="confirm-title" aria-describedby="confirm-message" @cancel.prevent="emit('cancel')">
    <h2 id="confirm-title" class="text-xl font-bold">{{ title }}</h2>
    <p id="confirm-message" class="text-sm text-slate-300 my-5">{{ message }}</p>
    <div class="grid grid-cols-2 gap-3">
      <button autofocus @click="emit('cancel')" class="rounded-xl bg-slate-700 px-4 py-3">取消</button>
      <button @click="emit('confirm')" class="rounded-xl bg-red-800 px-4 py-3 font-bold">{{ confirmLabel }}</button>
    </div>
  </dialog>
</template>
