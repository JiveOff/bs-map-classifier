<script setup lang="ts">
import { computed } from 'vue';
import type { MapAnalysisResult } from 'bs-map-classifier';

const props = defineProps<{
  meta:   string
  result: MapAnalysisResult
}>();

const COLORS: Record<string, string> = {
  Tech: '#c084fc', Speed: '#fb923c', Accuracy: '#38bdf8', Standard: '#4ade80', Extreme: '#fbbf24',
};

const category = computed(() => props.result.classification.category);
const color    = computed(() => COLORS[category.value] ?? '#fff');
const confidence = computed(() => (props.result.classification.confidence * 100).toFixed(1));

const probs = computed(() =>
  Object.entries(props.result.classification.probabilities)
    .sort((a, b) => b[1] - a[1])
    .map(([cls, p]) => ({ cls, pct: (p * 100).toFixed(1), color: COLORS[cls] ?? '#fff', active: cls === category.value })),
);

const patternChips = computed(() => {
  const counts: Record<string, number> = {};
  for (const p of props.result.patterns) counts[p.type] = (counts[p.type] ?? 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([type, n]) => ({ label: type.replace(/_/g, ' '), count: n }));
});
</script>

<template>
  <div class="panel result-panel" :style="{ '--active': color }">
    <div class="map-meta" v-html="meta" />

    <div class="category-badge">
      <div class="category-name" :style="{ color, textShadow: `0 0 30px ${color}, 0 0 60px ${color}` }">
        {{ category.toUpperCase() }}
      </div>
      <div class="confidence">{{ confidence }}%</div>
    </div>

    <div class="probs">
      <div v-for="{ cls, pct, color: c, active } in probs" :key="cls" class="prob-row">
        <div class="prob-label" :class="{ active }">{{ cls }}</div>
        <div class="prob-track">
          <div class="prob-fill" :style="{ width: pct + '%', background: c, boxShadow: `0 0 6px ${c}` }" />
        </div>
        <div class="prob-pct" :class="{ active }">{{ pct }}%</div>
      </div>
    </div>

    <div class="patterns-label">// top patterns</div>
    <div class="patterns-grid">
      <div v-for="{ label, count } in patternChips" :key="label" class="pattern-chip">
        {{ label }} <span>×{{ count }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.result-panel { animation: fadeUp 0.4s ease both; }

.map-meta    { font-size: 0.72rem; color: var(--muted); letter-spacing: 0.05em; margin-bottom: 20px; line-height: 1.6; }
.map-meta :deep(strong) { color: var(--text); }

.category-badge { display: flex; align-items: baseline; gap: 16px; margin-bottom: 28px; }

.category-name {
  font-family: 'Orbitron', sans-serif;
  font-size: clamp(2rem, 10vw, 3.5rem);
  font-weight: 900;
  letter-spacing: 0.08em;
  line-height: 1;
  transition: color 0.4s, text-shadow 0.4s;
}

.confidence { font-size: 1rem; color: var(--muted); letter-spacing: 0.05em; }

.probs       { display: flex; flex-direction: column; gap: 10px; margin-bottom: 28px; }
.prob-row    { display: grid; grid-template-columns: 90px 1fr 52px; align-items: center; gap: 12px; }
.prob-label  { font-size: 0.7rem; letter-spacing: 0.1em; color: var(--muted); text-transform: uppercase; }
.prob-label.active { color: var(--text); }
.prob-track  { height: 3px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; }
.prob-fill   { height: 100%; border-radius: 2px; transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
.prob-pct    { font-size: 0.68rem; letter-spacing: 0.05em; color: var(--muted); text-align: right; }
.prob-pct.active { color: var(--text); }

.patterns-label { font-size: 0.65rem; letter-spacing: 0.2em; color: var(--muted); text-transform: uppercase; margin-bottom: 12px; }
.patterns-grid  { display: flex; flex-wrap: wrap; gap: 8px; }
.pattern-chip   { background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius: 2px; padding: 5px 10px; font-size: 0.68rem; letter-spacing: 0.06em; }
.pattern-chip span { color: var(--active); font-weight: 700; }
</style>
