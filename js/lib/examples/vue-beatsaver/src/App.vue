<script setup>
import { ref } from 'vue';
import { useClassifier } from './composables/useClassifier.js';
import ResultCard from './components/ResultCard.vue';

const mapKey    = ref('2b120');
const difficulty = ref('ExpertPlus');

const { ready, busy, status, result, classify } = useClassifier();

function submit() {
  classify(mapKey.value.trim(), difficulty.value.trim() || 'ExpertPlus');
}
</script>

<template>
  <main>
    <h1>Beat Saber Map Classifier</h1>
    <p>Enter a BeatSaver map key to classify it into Tech / Speed / Accuracy / Standard / Extreme.</p>

    <form class="row" @submit.prevent="submit">
      <input v-model="mapKey"     placeholder="Map key (e.g. 2b120)" />
      <input v-model="difficulty" placeholder="Difficulty" class="diff-input" />
      <button type="submit" :disabled="!ready || busy">Classify</button>
    </form>

    <p class="status">{{ status }}</p>

    <Transition name="fade">
      <ResultCard v-if="result" v-bind="result" />
    </Transition>
  </main>
</template>

<style>
*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #0f0f0f;
  color: #e0e0e0;
}

main {
  max-width: 640px;
  margin: 40px auto;
  padding: 0 16px;
}

h1 { font-size: 1.4rem; color: #fff; margin: 0 0 4px; }
p  { color: #888; margin: 0 0 20px; font-size: 0.85rem; }

.row   { display: flex; gap: 8px; margin-bottom: 16px; }

input  { flex: 1; padding: 8px 12px; border-radius: 6px; border: 1px solid #333; background: #1a1a1a; color: #fff; font-size: 0.9rem; }
input.diff-input { flex: 0 0 130px; }

button { padding: 8px 18px; border-radius: 6px; border: none; background: #4f46e5; color: #fff; cursor: pointer; font-size: 0.9rem; }
button:disabled { opacity: 0.5; cursor: default; }

.status { font-size: 0.8rem; color: #888; min-height: 1.2em; margin-bottom: 16px; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.25s ease; }
.fade-enter-from, .fade-leave-to       { opacity: 0; }
</style>
