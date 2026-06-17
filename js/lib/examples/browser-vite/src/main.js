import * as ort from 'onnxruntime-web';
import { extractPatternsAndClassifyMap } from 'bs-map-classifier';
import { loadFromKey } from 'bs-map-classifier/beatsaver';
import { loadEmbeddedClassifier } from 'bs-map-classifier/embedded';

ort.env.wasm.numThreads = 1;

const COLORS = {
  Tech:     '#a855f7',
  Speed:    '#ef4444',
  Accuracy: '#22c55e',
  Standard: '#3b82f6',
  Extreme:  '#f97316',
};

const keyInput  = document.getElementById('key');
const diffInput = document.getElementById('diff');
const btn       = document.getElementById('btn');
const status    = document.getElementById('status');
const result    = document.getElementById('result');

let classifier = null;

btn.disabled = true;
loadEmbeddedClassifier()
  .then(clf => {
    classifier = clf;
    status.textContent = 'Model ready.';
    btn.disabled = false;
  })
  .catch(err => { status.textContent = `Failed to load model: ${err.message}`; });

btn.addEventListener('click', async () => {
  if (!classifier) return;

  const mapKey     = keyInput.value.trim();
  const difficulty = diffInput.value.trim() || 'ExpertPlus';
  if (!mapKey) { status.textContent = 'Enter a map key first.'; return; }

  btn.disabled = true;
  result.style.display = 'none';
  status.textContent = `Fetching map ${mapKey}…`;

  try {
    const { beatmap, bpm, songName, songAuthor, characteristic, njs } =
      await loadFromKey(mapKey, 'Standard', difficulty);

    status.textContent = 'Classifying…';

    const { classification, features, patterns } =
      await extractPatternsAndClassifyMap(beatmap, bpm, classifier);

    const cat   = classification.category;
    const color = COLORS[cat] ?? '#888';

    document.getElementById('song').textContent =
      `"${songName}" by ${songAuthor} — ${characteristic}/${difficulty}`;

    const badge = document.getElementById('badge');
    badge.textContent = `${cat} · ${(classification.confidence * 100).toFixed(1)}%`;
    badge.style.cssText = `background:${color}22;color:${color};border:1px solid ${color}55`;

    document.getElementById('bars').innerHTML = Object.entries(classification.probabilities)
      .sort((a, b) => b[1] - a[1])
      .map(([cls, p]) => `
        <div class="bar-row">
          <div class="bar-label">${cls}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${(p * 100).toFixed(1)}%;background:${COLORS[cls] ?? '#888'}"></div>
          </div>
          <div class="bar-pct">${(p * 100).toFixed(1)}%</div>
        </div>`)
      .join('');

    document.getElementById('meta').innerHTML = [
      `NJS <span>${njs ?? '—'}</span>`,
      `JD <span>${features.jump_distance?.toFixed(2) ?? '—'}</span>`,
      `RT <span>${features.reaction_time ? (features.reaction_time * 1000).toFixed(0) + 'ms' : '—'}</span>`,
      `NPS <span>${features.nps_mapped?.toFixed(2) ?? '—'}</span>`,
      `SPS <span>${features.sps_total_avg?.toFixed(2) ?? '—'}</span>`,
      `Patterns <span>${patterns.length}</span>`,
    ].join('');

    result.style.display = 'block';
    status.textContent = 'Done.';
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    console.error(err);
  } finally {
    btn.disabled = false;
  }
});
