<script setup>
import { computed } from 'vue';

const props = defineProps({
  song:           { type: String,  required: true },
  difficulty:     { type: String,  required: true },
  classification: { type: Object,  required: true },
  features:       { type: Object,  required: true },
  patternCount:   { type: Number,  required: true },
});

const COLORS = {
  Tech:     '#a855f7',
  Speed:    '#ef4444',
  Accuracy: '#22c55e',
  Standard: '#3b82f6',
  Extreme:  '#f97316',
};

const category = computed(() => props.classification.category);
const color    = computed(() => COLORS[category.value] ?? '#888');

const bars = computed(() =>
  Object.entries(props.classification.probabilities)
    .sort((a, b) => b[1] - a[1])
    .map(([cls, p]) => ({ cls, p, color: COLORS[cls] ?? '#888' })),
);

const meta = computed(() => {
  const f = props.features;
  return [
    { label: 'NJS',      value: f.njs ?? '—' },
    { label: 'JD',       value: f.jump_distance?.toFixed(2) ?? '—' },
    { label: 'RT',       value: f.reaction_time ? (f.reaction_time * 1000).toFixed(0) + 'ms' : '—' },
    { label: 'NPS',      value: f.nps_mapped?.toFixed(2) ?? '—' },
    { label: 'SPS',      value: f.sps_total_avg?.toFixed(2) ?? '—' },
    { label: 'Patterns', value: props.patternCount },
  ];
});
</script>

<template>
  <div class="card">
    <p class="song">{{ song }} — Standard/{{ difficulty }}</p>

    <span class="badge" :style="{ background: color + '22', color, border: `1px solid ${color}55` }">
      {{ category }} · {{ (classification.confidence * 100).toFixed(1) }}%
    </span>

    <div class="bars">
      <div v-for="{ cls, p, color: c } in bars" :key="cls" class="bar-row">
        <span class="bar-label">{{ cls }}</span>
        <div class="bar-track">
          <div class="bar-fill" :style="{ width: (p * 100).toFixed(1) + '%', background: c }" />
        </div>
        <span class="bar-pct">{{ (p * 100).toFixed(1) }}%</span>
      </div>
    </div>

    <div class="meta">
      <span v-for="{ label, value } in meta" :key="label">
        {{ label }} <em>{{ value }}</em>
      </span>
    </div>
  </div>
</template>

<style scoped>
.card  { background: #1a1a1a; border-radius: 8px; padding: 16px; }
.song  { font-weight: 600; color: #fff; margin: 0 0 12px; }
.badge { display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 0.8rem; font-weight: 600; margin-bottom: 12px; }

.bars     { display: flex; flex-direction: column; gap: 6px; }
.bar-row  { display: flex; align-items: center; gap: 8px; font-size: 0.8rem; }
.bar-label{ width: 72px; text-align: right; color: #aaa; }
.bar-track{ flex: 1; background: #2a2a2a; border-radius: 3px; height: 8px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 3px; transition: width 0.4s ease; }
.bar-pct  { width: 44px; color: #aaa; }

.meta    { margin-top: 12px; display: flex; gap: 16px; flex-wrap: wrap; font-size: 0.75rem; color: #666; }
.meta em { font-style: normal; color: #999; }
</style>
