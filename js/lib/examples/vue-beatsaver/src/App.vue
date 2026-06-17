<script setup lang="ts">
import { useClassifier } from './composables/useClassifier';
import InputPanel from './components/InputPanel.vue';
import Loader     from './components/Loader.vue';
import ResultPanel from './components/ResultPanel.vue';
import type { DiffPair } from './types';

const {
  ready, busy, loading, loadingText, status, isError, payload,
  classifyFromKey, classifyFromZip, classifyFromDat,
} = useClassifier();
</script>

<template>
  <div class="wrap">
    <header>
      <div class="logo">
        <div class="saber red" />
        <h1>BS Map Classifier</h1>
        <div class="saber blue" />
      </div>
      <p class="tagline">ML-powered Beat Saber map classification · 88.89% accuracy · 85.13% CV F1</p>
    </header>

    <InputPanel
      :ready="ready"
      :busy="busy"
      :status="status"
      :is-error="isError"
      @classify-key="(key: string, pairs: DiffPair[], char: string, diff: string) => classifyFromKey(key, pairs, char, diff)"
      @classify-zip="(buf: ArrayBuffer, char: string, diff: string, name: string) => classifyFromZip(buf, char, diff, name)"
      @classify-dat="(buf: ArrayBuffer, bpm: number, name: string) => classifyFromDat(buf, bpm, name)"
    />

    <Loader v-if="loading" :text="loadingText" />

    <Transition name="result">
      <ResultPanel v-if="payload" :meta="payload.meta" :result="payload.result" />
    </Transition>

    <div class="panel how-it-works">
      <div class="section-label">// how it works</div>
      <p>
        The classifier parses the actual <strong>.dat beatmap file</strong> — the raw note data a player hits — and extracts 125 features:
        NJS, jump distance, reaction time, NPS bursts, SPS per hand (via bsmap), eBPM, direction histograms, lane/layer usage,
        rotation, and counts of named patterns (crossovers, doubles, streams, inverts, hooks, etc.).
      </p>
      <p>
        Those features are fed into a <strong>LightGBM classifier</strong> trained on 493 maps from the
        <a href="https://cube.community/pooling">BSWC pooling database</a> — a curated set of competitive maps labelled
        by the BSWC pooling team. The model runs fully in-browser via ONNX Runtime WebAssembly; no server, no metadata API call needed.
      </p>
      <p>
        <strong>88.89% accuracy · 85.13% CV F1</strong> &nbsp;·&nbsp; 493 maps &nbsp;·&nbsp; 5 classes &nbsp;·&nbsp;
        Accuracy = 100% · Speed ≈ 95% · Standard ≈ 90% · Tech ≈ 84% · Extreme ≈ 76%
      </p>
    </div>
  </div>

  <footer>
    <a href="https://github.com/JiveOff/bs-map-classifier">GitHub</a> ·
    <a href="https://www.npmjs.com/package/bs-map-classifier">npm</a> ·
    data from <a href="https://beatsaver.com">BeatSaver</a>
  </footer>
</template>

<style scoped>
.wrap   { position: relative; z-index: 1; width: 100%; max-width: 680px; }

header  { text-align: center; margin-bottom: 48px; }
.logo   { display: inline-flex; align-items: center; gap: 10px; margin-bottom: 12px; }

.saber       { width: 28px; height: 4px; border-radius: 2px; box-shadow: 0 0 8px currentColor, 0 0 20px currentColor; }
.saber.red   { background: #ef4444; color: #ef4444; }
.saber.blue  { background: #60a5fa; color: #60a5fa; }

h1 {
  font-family: 'Orbitron', sans-serif;
  font-size: clamp(1.4rem, 5vw, 2.2rem);
  font-weight: 900;
  letter-spacing: 0.15em;
  color: #fff;
  text-transform: uppercase;
}

.tagline { font-size: 0.8rem; color: var(--muted); letter-spacing: 0.1em; margin-top: 6px; }

.how-it-works { font-size: 0.72rem; line-height: 1.9; color: var(--muted); }
.how-it-works p          { margin-bottom: 10px; }
.how-it-works p:last-child { margin-bottom: 0; }
.how-it-works :deep(strong) { color: var(--text); }
.how-it-works a          { color: inherit; text-decoration: underline; text-underline-offset: 3px; }
.section-label           { font-size: 0.65rem; letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 12px; color: var(--text); }

footer {
  position: relative;
  z-index: 1;
  text-align: center;
  margin-top: 48px;
  font-size: 0.65rem;
  letter-spacing: 0.1em;
  color: var(--muted);
  line-height: 2;
}
footer a { color: inherit; text-decoration: underline; text-underline-offset: 3px; }

.result-enter-active { animation: fadeUp 0.4s ease both; }
.result-leave-active { transition: opacity 0.2s; }
.result-leave-to     { opacity: 0; }
</style>
