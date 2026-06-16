'use strict';

import { unzipSync } from 'fflate';
import {
  parseBeatmap, findDatFilename,
  annotatePatterns, TYPE_LABELS,
  loadClassifierFromFetch, classifyFromNotes,
} from 'bs-map-classifier';
import { getURL } from './platform.js';

const TAG = '[BSO]';
console.log(TAG, 'content.js running on', location.href);

// ── 1. Inject AudioContext hook before Unity loads ────────────────────────
// __PLATFORM__ and __INJECTED_SRC__ are injected at build time by build.js.
// Extension: load injected.js via extension URL (separate web-accessible resource).
// Userscript: inline the script content directly (no URL needed, avoids timing issues).
const hookScript = document.createElement('script');
if (__PLATFORM__ === 'userscript') {
  hookScript.textContent = __INJECTED_SRC__;
} else {
  hookScript.src    = getURL('injected.js');
  hookScript.onerror = () => console.error(TAG, 'injected.js FAILED');
}
hookScript.onload = () => { console.log(TAG, 'injected.js ✓'); hookScript.remove(); };
(document.head || document.documentElement).prepend(hookScript);

// ── 2. State ──────────────────────────────────────────────────────────────
let D             = null;
let activeTypes   = new Set();
let filteredCache = [];
let selIdx        = -1;
let liveMode      = true;
let lastLiveIdx   = -1;
let shadow        = null;
let panelVisible  = true;
let timeCount     = 0;
let lastMapId     = null;

// ONNX classifier (lazy-loaded on first map)
let _clf      = null;
let _clfReady = false;

const CATEGORY_COLORS = {
  Tech:     '#a371f7',
  Speed:    '#3fb950',
  Accuracy: '#58a6ff',
  Standard: '#8b949e',
  Extreme:  '#f85149',
};

async function loadClassifierModels() {
  if (_clfReady) return true;
  try {
    // Userscript build pre-loads the model from embedded bytes (window.__bso_clf_promise).
    // Extension build fetches it from the extension package resources.
    _clf = await (window.__bso_clf_promise ?? loadClassifierFromFetch(
      getURL('pattern_classifier.onnx'),
      getURL('pattern_classifier_meta.json'),
    ));
    _clfReady = true;
    console.log(TAG, `ONNX classifier loaded: ${_clf.meta.features.length} features`);
    return true;
  } catch (e) {
    console.error(TAG, 'Failed to load ONNX classifier:', e);
    return false;
  }
}

function showPrediction(category, confidence) {
  const row   = shadow.getElementById('pred-row');
  const badge = shadow.getElementById('pred-badge');
  const conf  = shadow.getElementById('pred-conf');
  badge.textContent      = category;
  badge.style.background = CATEGORY_COLORS[category] || '#555';
  conf.textContent       = `${(confidence * 100).toFixed(0)}% confidence`;
  row.style.display      = 'flex';
}

function hidePrediction() {
  const row = shadow.getElementById('pred-row');
  if (row) row.style.display = 'none';
}

// ── 3. Panel markup ───────────────────────────────────────────────────────
const PANEL_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:host { all: initial; }
#panel {
  width: 310px; height: 100%; background: rgba(13, 17, 23, 0.82);
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(48, 54, 61, 0.6); border-right: none;
  border-radius: 12px 0 0 12px;
  display: flex; flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #e6edf3; pointer-events: all; overflow: hidden; font-size: 12px;
}
#header { padding: 7px 10px; background: rgba(0,0,0,0.25); border-bottom: 1px solid rgba(48,54,61,0.5); flex-shrink: 0; }
#map-name { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#map-sub  { font-size: 10px; color: #8b949e; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#pred-row { display: none; align-items: center; gap: 6px; margin-top: 5px; }
#pred-badge { padding: 2px 8px; border-radius: 9px; font-size: 11px; font-weight: 700; color: #fff; flex-shrink: 0; }
#pred-conf  { font-size: 10px; color: #8b949e; }
#sync-bar {
  padding: 5px 10px; background: rgba(0,0,0,0.2); border-bottom: 1px solid rgba(48,54,61,0.4);
  display: flex; align-items: center; gap: 8px; flex-shrink: 0;
}
#sync-dot  { font-size: 10px; flex-shrink: 0; }
#sync-time { font-size: 11px; color: #8b949e; flex: 1; font-variant-numeric: tabular-nums; }
button { cursor: pointer; border: none; font-family: inherit; transition: background .12s, color .12s; }
#live-btn {
  padding: 2px 7px; border-radius: 9px; border: 1px solid #30363d;
  background: transparent; color: #8b949e; font-size: 10px; font-weight: 600;
}
#live-btn.on { background: #1f3a1f; border-color: #3fb950; color: #3fb950; }
#hide-btn { padding: 2px 5px; border-radius: 4px; background: #21262d; color: #8b949e; font-size: 11px; }
#hide-btn:hover { background: #30363d; color: #e6edf3; }
#filters {
  padding: 5px 8px; border-bottom: 1px solid rgba(48,54,61,0.4);
  display: flex; flex-wrap: wrap; gap: 3px; flex-shrink: 0;
}
.fbtn {
  padding: 2px 6px; border-radius: 8px; border: 1px solid transparent;
  font-size: 9px; font-weight: 700; opacity: .4;
  text-transform: uppercase; letter-spacing: .3px;
  transition: opacity .12s, border-color .12s;
}
.fbtn.on { opacity: 1; border-color: rgba(255,255,255,.18); }
#fall { background: #30363d; color: #e6edf3; }
#stats { padding: 3px 10px; font-size: 10px; color: #8b949e; border-bottom: 1px solid #30363d; flex-shrink: 0; }
#status-msg { padding: 20px 14px; font-size: 11px; color: #8b949e; text-align: center; display: none; }
#list { flex: 1; overflow-y: auto; }
#list::-webkit-scrollbar { width: 4px; }
#list::-webkit-scrollbar-track { background: #161b22; }
#list::-webkit-scrollbar-thumb { background: #30363d; border-radius: 2px; }
.pi {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-bottom: 1px solid #21262d;
  cursor: pointer; transition: background .08s;
}
.pi:hover { background: #21262d; }
.pi.sel { background: #1c2433; border-left: 2px solid #58a6ff; padding-left: 8px; }
.pi.now { background: #1a2d1a; border-left: 2px solid #3fb950; padding-left: 8px; }
.pi .ts  { font-size: 10px; color: #8b949e; min-width: 52px; font-variant-numeric: tabular-nums; }
.pi .badge {
  padding: 1px 5px; border-radius: 7px; font-size: 9px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .3px; color: #000; flex-shrink: 0;
}
.pi .pr { font-size: 10px; color: #6e7681; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#grid-panel { border-top: 1px solid rgba(48,54,61,0.4); padding: 7px 10px 9px; background: rgba(0,0,0,0.2); flex-shrink: 0; }
#grid-lbl   { font-size: 10px; color: #8b949e; margin-bottom: 4px; min-height: 14px; }
#note-grid  { display: block; border: 1px solid #30363d; border-radius: 3px; width: 100%; }
#grid-sub   { font-size: 9px; color: #484f58; margin-top: 3px; text-align: center; }
#resize-handle {
  height: 8px; flex-shrink: 0; cursor: ns-resize;
  border-radius: 0 0 0 12px;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
}
#resize-handle:hover { background: rgba(88,166,255,0.15); }
#resize-handle::before {
  content: ''; display: block; width: 32px; height: 3px;
  border-radius: 2px; background: rgba(255,255,255,0.15);
}
#resize-handle:hover::before { background: rgba(88,166,255,0.6); }
#show-btn {
  position: fixed; top: 50%; right: 0; transform: translateY(-50%);
  width: 20px; padding: 12px 3px; background: #161b22;
  border: 1px solid #30363d; border-right: none; border-radius: 5px 0 0 5px;
  color: #8b949e; font-size: 8px; writing-mode: vertical-rl;
  pointer-events: all; display: none; letter-spacing: 1px; font-weight: 600;
}
#show-btn:hover { background: #21262d; color: #e6edf3; }
`;

const PANEL_HTML = `
<style>${PANEL_CSS}</style>
<div id="panel">
  <div id="header">
    <div id="map-name">—</div>
    <div id="map-sub">—</div>
    <div id="pred-row">
      <span id="pred-badge">?</span>
      <span id="pred-conf"></span>
    </div>
  </div>
  <div id="sync-bar">
    <span id="sync-dot">⚪</span>
    <span id="sync-time">Press play in ArcViewer</span>
    <button id="live-btn" class="on">⟳ Live</button>
    <button id="hide-btn">✕</button>
  </div>
  <div id="filters"><button id="fall" class="fbtn on">All</button></div>
  <div id="stats">—</div>
  <div id="status-msg">—</div>
  <div id="list"></div>
  <div id="grid-panel">
    <div id="grid-lbl">Select a pattern to see its notes</div>
    <canvas id="note-grid" height="150"></canvas>
    <div id="grid-sub"></div>
  </div>
  <div id="resize-handle"></div>
</div>
<button id="show-btn">PATTERNS</button>
`;

function initResize() {
  const handle = shadow.getElementById('resize-handle');
  const host   = document.getElementById('__bso_host');
  let startY, startH;

  handle.addEventListener('mousedown', (e) => {
    startY = e.clientY;
    startH = host.offsetHeight;
    e.preventDefault();

    const onMove = (e) => {
      const newH = Math.max(200, Math.min(window.innerHeight - 32, startH + (e.clientY - startY)));
      host.style.height = newH + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ── 4. Panel injection ────────────────────────────────────────────────────
function injectPanel() {
  const host = document.createElement('div');
  host.id = '__bso_host';
  host.style.cssText = 'position:fixed;top:16px;right:0;width:310px;height:calc(100vh - 132px);z-index:2147483647;pointer-events:none;';
  document.body.appendChild(host);

  shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = PANEL_HTML;

  shadow.getElementById('note-grid').width = 290;
  shadow.getElementById('hide-btn').addEventListener('click', () => setPanel(false));
  shadow.getElementById('show-btn').addEventListener('click', () => setPanel(true));
  shadow.getElementById('live-btn').addEventListener('click', toggleLive);
  shadow.getElementById('fall').addEventListener('click', toggleAll);

  initResize();
  console.log(TAG, 'Panel injected ✓');
}

function setPanel(on) {
  panelVisible = on;
  shadow.getElementById('panel').style.display    = on ? 'flex' : 'none';
  shadow.getElementById('show-btn').style.display = on ? 'none' : 'block';
  document.getElementById('__bso_host').style.width = on ? '310px' : '20px';
}

function setStatus(msg) {
  const el = shadow.getElementById('status-msg');
  el.textContent   = msg;
  el.style.display = msg ? 'block' : 'none';
  shadow.getElementById('list').style.display = msg ? 'none' : 'block';
  console.log(TAG, 'status:', msg);
}

// ── 5. Auto-detection from URL ────────────────────────────────────────────
function getUrlParams() {
  const p = new URLSearchParams(location.search);
  return {
    id:         p.get('id'),
    difficulty: p.get('difficulty') || 'ExpertPlus',
    mode:       p.get('mode')       || 'Standard',
  };
}

async function autoLoadFromUrl() {
  const { id, difficulty, mode } = getUrlParams();
  if (!id) {
    console.log(TAG, 'No map ID in URL — manual load only');
    setStatus('Open ArcViewer with a map URL to auto-load patterns.');
    return;
  }
  if (id === lastMapId) return;
  lastMapId = id;
  hidePrediction();

  console.log(TAG, `Auto-detecting: id=${id} diff=${difficulty} mode=${mode}`);
  try {
    await loadMapFromBeatSaver(id, difficulty, mode);
  } catch (err) {
    console.error(TAG, 'Auto-load failed:', err);
    setStatus(`Failed to load map: ${err.message}`);
  }
}

async function loadMapFromBeatSaver(id, difficulty, mode) {
  setStatus(`Fetching map info for ${id}…`);

  const info = await fetch(`https://beatsaver.com/api/maps/id/${id}`)
    .then(r => { if (!r.ok) throw new Error(`BeatSaver API ${r.status}`); return r.json(); });

  const meta    = info.metadata || {};
  const bpm     = parseFloat(meta.bpm || 120);
  const version = info.versions?.[info.versions.length - 1];
  if (!version?.downloadURL) throw new Error('No download URL in API response');

  updateHeader({
    name: meta.songName || id,
    sub:  `${meta.songAuthorName || ''}  ·  ${difficulty}  ·  ${bpm} BPM`,
  });

  setStatus('Downloading map zip…');
  console.log(TAG, `Fetching zip: ${version.downloadURL}`);
  const zipResp = await fetch(version.downloadURL);
  if (!zipResp.ok) throw new Error(`Download failed: ${zipResp.status}`);

  // Use arrayBuffer() instead of blob() — sandbox environments (e.g. userscript)
  // proxy Blob objects in a way that stalls JSZip; ArrayBuffer is always safe.
  const zipBuffer = await zipResp.arrayBuffer();
  console.log(TAG, `Downloaded ${(zipBuffer.byteLength / 1024).toFixed(0)} KB from ${zipResp.url}`);
  if (zipBuffer.byteLength < 500) throw new Error(`Response too small (${zipBuffer.byteLength} B) — likely blocked by CDN CORS`);

  // Verify ZIP magic bytes (PK = 0x504B)
  const magic = new Uint8Array(zipBuffer, 0, 2);
  if (magic[0] !== 0x50 || magic[1] !== 0x4B) {
    throw new Error(`Response is not a ZIP file (magic: ${magic[0].toString(16)} ${magic[1].toString(16)}) — possibly a CORS/auth error page`);
  }
  console.log(TAG, 'ZIP magic OK — parsing with fflate.unzipSync');

  setStatus('Parsing beatmap…');
  // unzipSync is fully synchronous — no Promises, no DecompressionStream, no timers.
  // Works reliably inside Tampermonkey / Violentmonkey sandboxes.
  const zipEntries = unzipSync(new Uint8Array(zipBuffer));
  console.log(TAG, `Unzipped ${Object.keys(zipEntries).length} entries`);

  const infoRaw = readZipEntry(zipEntries, 'Info.dat') || readZipEntry(zipEntries, 'info.dat');
  if (!infoRaw) throw new Error('Info.dat not found in zip');
  const infoDat = JSON.parse(infoRaw);

  const datFilename = findDatFilename(infoDat, mode, difficulty);
  console.log(TAG, `Loading .dat file: ${datFilename}`);
  const datRaw = readZipEntry(zipEntries, datFilename);
  if (!datRaw) throw new Error(`${datFilename} not found in zip`);

  const { notes, obstacles, arcs, chains, bombs } = parseBeatmap(JSON.parse(datRaw));
  console.log(TAG, `Parsed ${notes.length} notes, ${bombs.length} bombs`);

  setStatus('Detecting patterns…');
  const annotation = annotatePatterns(notes, bpm, {
    id, difficulty, mode, bpm,
    title:  meta.songName        || id,
    artist: meta.songAuthorName  || '',
    mapper: meta.levelAuthorName || '',
  });

  console.log(TAG, `Detected ${annotation.patterns.length} pattern instances`);
  setStatus('');
  initWithData(annotation);

  // ── Classify with ONNX ─────────────────────────────────────────────────
  hidePrediction();
  loadClassifierModels().then(async ready => {
    if (!ready) return;
    try {
      const result = await classifyFromNotes(notes, obstacles, arcs, chains, bpm, bombs, _clf);
      console.log(TAG, `ONNX predicted: ${result.category} (${(result.confidence * 100).toFixed(1)}%)`);
      showPrediction(result.category, result.confidence);
    } catch (e) {
      console.error(TAG, 'ONNX inference error:', e);
    }
  });
}

function readZipEntry(entries, name) {
  const data = entries[name] ?? entries[name.toLowerCase()];
  return data ? new TextDecoder().decode(data) : null;
}

// ── 6. Data init ──────────────────────────────────────────────────────────
function initWithData(data) {
  D = data;
  activeTypes = new Set(Object.keys(D.colors || {}));
  updateHeader({
    name: D.meta?.title || D.meta?.id || '?',
    sub:  [D.meta?.artist, D.meta?.difficulty, D.meta?.bpm ? `${D.meta.bpm} BPM` : '']
            .filter(Boolean).join('  ·  '),
  });
  buildFilters();
  rebuildCache();
  renderList();
  if (filteredCache.length) selectPattern(filteredCache[0]._i, false);
}

function updateHeader({ name, sub }) {
  shadow.getElementById('map-name').textContent = name || '—';
  shadow.getElementById('map-sub').textContent  = sub  || '—';
}

// ── 8. Filters ────────────────────────────────────────────────────────────
function buildFilters() {
  shadow.querySelectorAll('.fbtn[data-type]').forEach(b => b.remove());
  const counts = {};
  D.patterns.forEach(p => { counts[p.type] = (counts[p.type] || 0) + 1; });
  Object.entries(D.colors || {}).forEach(([type, clr]) => {
    if (!counts[type]) return;
    const btn = document.createElement('button');
    btn.className   = 'fbtn on';
    btn.dataset.type = type;
    btn.textContent = `${TYPE_LABELS[type] || type} ${counts[type]}`;
    btn.style.cssText = `background:${clr};color:#000`;
    btn.addEventListener('click', () => toggleType(type, btn));
    shadow.getElementById('filters').appendChild(btn);
  });
}

function toggleAll() {
  const allOn = activeTypes.size === Object.keys(D.colors || {}).length;
  if (allOn) activeTypes.clear(); else Object.keys(D.colors || {}).forEach(t => activeTypes.add(t));
  shadow.querySelectorAll('.fbtn[data-type]').forEach(b => b.classList.toggle('on', activeTypes.has(b.dataset.type)));
  shadow.getElementById('fall').classList.toggle('on', !allOn);
  rebuildCache(); renderList();
}

function toggleType(type, btn) {
  if (activeTypes.has(type)) activeTypes.delete(type); else activeTypes.add(type);
  btn.classList.toggle('on', activeTypes.has(type));
  rebuildCache(); renderList();
}

function rebuildCache() {
  filteredCache = (D?.patterns || []).map((p, i) => ({ ...p, _i: i })).filter(p => activeTypes.has(p.type));
}

// ── 9. List ───────────────────────────────────────────────────────────────
const DIR_SYM = ['↑', '↓', '←', '→', '↖', '↗', '↙', '↘', '•'];

function notePreview(notes) {
  if (notes.length > 4) return `${notes.length} notes`;
  return notes.map(n => `${n.color === 0 ? 'L' : 'R'}(${n.x},${n.y})${DIR_SYM[n.direction] || ''}`).join('  ');
}

function renderList() {
  shadow.getElementById('stats').textContent =
    `${filteredCache.length} of ${D?.patterns?.length || 0} patterns`;
  const frag = document.createDocumentFragment();
  filteredCache.forEach(p => {
    const div = document.createElement('div');
    div.className = 'pi' + (p._i === selIdx ? (liveMode ? ' now' : ' sel') : '');
    div.dataset.i = p._i;

    const ts = document.createElement('span'); ts.className = 'ts';
    ts.textContent = p.beat.toFixed(2) + 'b';

    const badge = document.createElement('span'); badge.className = 'badge';
    badge.textContent    = p.label || TYPE_LABELS[p.type] || p.type;
    badge.style.background = (D.colors || {})[p.type] || '#888';

    const pr = document.createElement('span'); pr.className = 'pr';
    pr.textContent = notePreview(p.notes);

    div.append(ts, badge, pr);
    div.addEventListener('click', () => { if (liveMode) toggleLive(); selectPattern(p._i, true); });
    frag.appendChild(div);
  });
  const list = shadow.getElementById('list');
  list.innerHTML = ''; list.appendChild(frag);
}

// ── 10. Selection ─────────────────────────────────────────────────────────
function selectPattern(idx, scroll) {
  selIdx = idx;
  const p = D?.patterns[idx]; if (!p) return;
  shadow.querySelectorAll('.pi').forEach(el => {
    el.classList.remove('sel', 'now');
    if (+el.dataset.i === idx) el.classList.add(liveMode ? 'now' : 'sel');
  });
  if (scroll) {
    const el = shadow.querySelector(`.pi[data-i="${idx}"]`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  drawGrid(p);
}

// ── 11. Live mode ─────────────────────────────────────────────────────────
function toggleLive() {
  liveMode = !liveMode; lastLiveIdx = -1;
  const btn = shadow.getElementById('live-btn');
  btn.textContent = liveMode ? '⟳ Live' : '⟳ Manual';
  btn.classList.toggle('on', liveMode);
}

document.addEventListener('__bso_time', (e) => {
  const t    = e.detail;
  const bpm  = D?.meta?.bpm || 120;
  const beat = t * bpm / 60;

  timeCount++;
  if (timeCount === 1) console.log(TAG, `First TIME: t=${t.toFixed(3)}s beat=${beat.toFixed(2)} ✓`);
  else if (timeCount % 300 === 0) console.log(TAG, `TIME #${timeCount}: beat=${beat.toFixed(2)}`);

  shadow.getElementById('sync-dot').textContent  = '🟢';
  shadow.getElementById('sync-time').textContent = `▶  ${beat.toFixed(2)} b`;

  if (!liveMode || !D) return;
  const items = filteredCache; if (!items.length) return;
  let lo = 0, hi = items.length - 1, found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].beat <= beat) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const idx = items[found]._i;
  if (idx !== lastLiveIdx) { lastLiveIdx = idx; selectPattern(idx, true); }
});

// ── 12. Note grid ─────────────────────────────────────────────────────────
const DIR_DEG  = { 0: 90, 1: 270, 2: 180, 3: 0, 4: 135, 5: 45, 6: 225, 7: 315 };
const CTX_WIN  = 1.5;
const COLS = 4, ROWS = 3;

const BLOQ_TOP = ['#ff9590', '#c8e8ff'];
const BLOQ_MID = ['#f85149', '#79c0ff'];
const BLOQ_BOT = ['#6b1f1c', '#1a4573'];

function _rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
  g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
  g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
  g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r);
  g.closePath();
}

function drawBloq(g, cx, cy, hw, hh, color, dir, alpha, isPat) {
  const x = cx - hw, y = cy - hh, w = hw * 2, h = hh * 2;
  const cr = Math.min(hw, hh) * 0.22;

  g.globalAlpha = alpha;

  if (isPat) {
    g.shadowColor = color === 0 ? 'rgba(248,81,73,0.9)' : 'rgba(121,192,255,0.9)';
    g.shadowBlur  = 18;
  }

  const grad = g.createLinearGradient(cx, y, cx, y + h);
  grad.addColorStop(0,    BLOQ_TOP[color]);
  grad.addColorStop(0.38, BLOQ_MID[color]);
  grad.addColorStop(1,    BLOQ_BOT[color]);

  _rrect(g, x, y, w, h, cr);
  g.fillStyle = grad;
  g.fill();

  g.shadowBlur  = 0;
  g.strokeStyle = isPat ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.10)';
  g.lineWidth   = isPat ? 1.5 : 0.8;
  g.stroke();

  g.fillStyle = 'rgba(255,255,255,0.12)';
  _rrect(g, x + 1, y + 1, w - 2, h * 0.28, cr * 0.7);
  g.fill();

  _drawChevron(g, cx, cy, dir, Math.min(hw, hh) * 0.72, isPat);
  g.globalAlpha = 1;
}

function _drawChevron(g, cx, cy, dir, size, isPat) {
  if (dir === 8) {
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.beginPath();
    g.arc(cx, cy, size * 0.28, 0, Math.PI * 2);
    g.fill();
    return;
  }
  const rad = DIR_DEG[dir] * Math.PI / 180;
  const fx =  Math.cos(rad);
  const fy = -Math.sin(rad);
  const px = -fy, py = fx;

  const tp = 0.50, bp = 0.42, ww = 0.70, np = 0.06, nw = 0.16;
  const pts = [
    [cx + fx * size * tp,                cy + fy * size * tp               ],
    [cx - fx * size * bp + px * size * ww, cy - fy * size * bp + py * size * ww],
    [cx + fx * size * np + px * size * nw, cy + fy * size * np + py * size * nw],
    [cx + fx * size * np - px * size * nw, cy + fy * size * np - py * size * nw],
    [cx - fx * size * bp - px * size * ww, cy - fy * size * bp - py * size * ww],
  ];
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  g.fill();
}

function drawGrid(pattern) {
  const canvas = shadow.getElementById('note-grid');
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, cw = W / COLS, ch = H / ROWS;

  g.clearRect(0, 0, W, H);
  g.fillStyle = '#0d1117'; g.fillRect(0, 0, W, H);

  g.strokeStyle = '#21262d'; g.lineWidth = 1;
  for (let i = 0; i <= COLS; i++) { g.beginPath(); g.moveTo(i * cw + .5, 0); g.lineTo(i * cw + .5, H); g.stroke(); }
  for (let i = 0; i <= ROWS; i++) { g.beginPath(); g.moveTo(0, i * ch + .5); g.lineTo(W, i * ch + .5); g.stroke(); }

  g.fillStyle = '#484f58'; g.font = '9px monospace'; g.textAlign = 'center';
  ['←', 'L', 'R', '→'].forEach((l, i) => g.fillText(l, (i + .5) * cw, H - 3));

  const beat   = pattern.beat;
  const pool   = (D?.all_notes?.length > 0) ? D.all_notes : pattern.notes;
  const nearby = pool.filter(n => Math.abs(n.beat - beat) <= CTX_WIN);
  const pkey   = new Set(pattern.notes.map(n => `${n.beat},${n.x},${n.y},${n.color}`));

  nearby.sort((a, b) =>
    pkey.has(`${a.beat},${a.x},${a.y},${a.color}`) -
    pkey.has(`${b.beat},${b.x},${b.y},${b.color}`));

  const padX = cw * 0.10, padY = ch * 0.10;
  const hw = cw * 0.5 - padX, hh = ch * 0.5 - padY;

  for (const n of nearby) {
    const cx   = (n.x + .5) * cw, cy = ((ROWS - 1 - n.y) + .5) * ch;
    const isPat = pkey.has(`${n.beat},${n.x},${n.y},${n.color}`);
    const dist  = Math.abs(n.beat - beat) / CTX_WIN;
    const alpha = isPat ? 1 : Math.max(0.08, 0.32 * (1 - dist));
    drawBloq(g, cx, cy, hw, hh, n.color, n.direction, alpha, isPat);
  }
  g.globalAlpha = 1;

  shadow.getElementById('grid-lbl').textContent =
    `${pattern.label}  ·  beat ${pattern.beat.toFixed(2)}`;
  shadow.getElementById('grid-sub').textContent =
    `Context ±${CTX_WIN} b  ·  ${nearby.length} notes  ·  🔴 left  🔵 right`;
}

// ── 13. Boot ──────────────────────────────────────────────────────────────
function boot() {
  injectPanel();
  autoLoadFromUrl();
}

if (document.body) boot();
else document.addEventListener('DOMContentLoaded', boot);
