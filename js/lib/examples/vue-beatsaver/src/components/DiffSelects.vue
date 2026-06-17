<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { CHAR_LABEL, DIFF_LABEL, RANK } from '../composables/useBeatSaver';
import type { DiffPair } from '../types';

const props = defineProps<{ pairs: DiffPair[] }>();

const emit = defineEmits<{
  change: [char: string, diff: string]
}>();

const char = ref('');
const diff = ref('');

const chars = computed(() => [...new Set(props.pairs.map(p => p.characteristic))]);
const diffs = computed(() =>
  props.pairs
    .filter(p => p.characteristic === char.value)
    .sort((a, b) => (RANK[b.difficulty] ?? 0) - (RANK[a.difficulty] ?? 0))
    .map(p => p.difficulty),
);

const loaded = ref(false);

watch(() => props.pairs, (pairs) => {
  if (!pairs.length) { char.value = ''; diff.value = ''; loaded.value = false; return; }
  if (!chars.value.includes(char.value)) char.value = chars.value[0] ?? '';
  if (!diffs.value.includes(diff.value))  diff.value = diffs.value[0] ?? '';
  loaded.value = true;
  emit('change', char.value, diff.value);
}, { immediate: true });

watch(char, () => {
  diff.value = diffs.value[0] ?? '';
  emit('change', char.value, diff.value);
});

watch(diff, () => emit('change', char.value, diff.value));
</script>

<template>
  <div class="selects">
    <select v-model="char" :disabled="!pairs.length" :class="{ 'select-loaded': loaded }">
      <option v-if="!pairs.length" value="">— waiting —</option>
      <option v-for="c in chars" :key="c" :value="c">{{ CHAR_LABEL[c] ?? c }}</option>
    </select>
    <select v-model="diff" :disabled="!pairs.length" :class="{ 'select-loaded': loaded }">
      <option v-if="!pairs.length" value="">— waiting —</option>
      <option v-for="d in diffs" :key="d" :value="d">{{ DIFF_LABEL[d] ?? d }}</option>
    </select>
  </div>
</template>

<style scoped>
.selects { display: flex; gap: 10px; margin-bottom: 14px; }

select {
  flex: 1;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text);
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.75rem;
  padding: 8px 12px;
  outline: none;
  cursor: pointer;
  appearance: none;
  transition: border-color 0.2s, opacity 0.2s;
}
select:disabled           { opacity: 0.3; cursor: not-allowed; color: var(--muted); }
select:not(:disabled)     { border-color: rgba(255,255,255,0.12); }
select:focus              { border-color: rgba(255,255,255,0.25); }
select option             { background: #0f0f18; }
.select-loaded            { animation: selectPop 0.6s ease; }
</style>
