/**
 * Inference benchmark — reports init time and per-map classifyMap latency.
 * Run: node js/lib/scripts/benchmark.mjs
 * Used by the benchmark CI workflow to establish a baseline.
 */

import { loadEmbeddedClassifier } from '../dist/embedded.mjs';
import { classifyMap, parseBeatmap } from '../dist/cjs/index.js';
import { createRequire } from 'module';

// Minimal beatmap — stable inference target, no network required
const emptyBeatmap = parseBeatmap({
  version: '3.0.0',
  colorNotes: [],
  obstacles: [],
  sliders: [],
  burstSliders: [],
  bombNotes: [],
});

// ── Init ─────────────────────────────────────────────────────────────────────
const t0  = performance.now();
const clf = await loadEmbeddedClassifier();
const initMs = performance.now() - t0;

// ── Inference ────────────────────────────────────────────────────────────────
const N = 200;

// warm up (excluded from results)
for (let i = 0; i < 5; i++) await classifyMap(emptyBeatmap, 120, clf);

const times = [];
for (let i = 0; i < N; i++) {
  const t = performance.now();
  await classifyMap(emptyBeatmap, 120, clf);
  times.push(performance.now() - t);
}
times.sort((a, b) => a - b);

const mean   = times.reduce((a, b) => a + b, 0) / N;
const median = times[Math.floor(N / 2)];
const p95    = times[Math.floor(N * 0.95)];
const p99    = times[Math.floor(N * 0.99)];

// ── Output ───────────────────────────────────────────────────────────────────
const fmt = (ms) => `${ms.toFixed(2)}ms`;

console.log('');
console.log('=== bs-map-classifier benchmark ===');
console.log('');
console.log(`  Init (loadEmbeddedClassifier)  ${fmt(initMs)}`);
console.log('');
console.log(`  classifyMap (${N} runs, empty beatmap)`);
console.log(`    mean    ${fmt(mean)}`);
console.log(`    median  ${fmt(median)}`);
console.log(`    p95     ${fmt(p95)}`);
console.log(`    p99     ${fmt(p99)}`);
console.log('');

// github-action-benchmark JSON output (customSmallerIsBetter)
const benchmarkJson = [
  { name: 'Init (loadEmbeddedClassifier)', unit: 'ms', value: parseFloat(initMs.toFixed(2)) },
  { name: 'classifyMap mean',              unit: 'ms', value: parseFloat(mean.toFixed(3)) },
  { name: 'classifyMap median',            unit: 'ms', value: parseFloat(median.toFixed(3)) },
  { name: 'classifyMap p95',               unit: 'ms', value: parseFloat(p95.toFixed(3)) },
  { name: 'classifyMap p99',               unit: 'ms', value: parseFloat(p99.toFixed(3)) },
];

const outputFile = process.env.BENCHMARK_OUTPUT ?? 'benchmark-results.json';
const { writeFileSync, appendFileSync } = await import('fs');
writeFileSync(outputFile, JSON.stringify(benchmarkJson, null, 2));
console.log(`Results written to ${outputFile}`);

// GitHub Actions step summary
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    '## Benchmark results',
    '',
    '| Metric | Result |',
    '|--------|--------|',
    `| Init (\`loadEmbeddedClassifier\`) | ${fmt(initMs)} |`,
    `| \`classifyMap\` mean | ${fmt(mean)} |`,
    `| \`classifyMap\` median | ${fmt(median)} |`,
    `| \`classifyMap\` p95 | ${fmt(p95)} |`,
    `| \`classifyMap\` p99 | ${fmt(p99)} |`,
    '',
    `_${N} runs on an empty beatmap (no network required)_`,
    '',
  ].join('\n'));
}
