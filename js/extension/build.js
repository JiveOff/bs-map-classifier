/**
 * build.js — esbuild-based build script for bs-pattern-overlay.
 *
 * Usage:
 *   node build.js                  # build both targets
 *   node build.js --target=extension
 *   node build.js --target=userscript
 *
 * Outputs:
 *   dist/extension/   — unpacked Chrome/Firefox MV3 extension
 *   dist/bs-pattern-overlay.user.js  — Tampermonkey/Violentmonkey userscript
 */

import esbuild from 'esbuild';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const DIST      = join(ROOT, 'dist');
const EXT_OUT   = join(DIST, 'extension');
const US_OUT    = join(DIST);

const args   = process.argv.slice(2);
const target = args.find(a => a.startsWith('--target='))?.split('=')[1] ?? 'all';

const _require = createRequire(import.meta.url);

// Walk up from a resolved module file to find the nearest package.json directory
function findPkgRoot(resolvedPath) {
  let dir = dirname(resolvedPath);
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Cannot locate package.json from: ${resolvedPath}`);
}

const ortPkgDir  = findPkgRoot(_require.resolve('onnxruntime-web'));
const ortVersion = JSON.parse(await readFile(join(ortPkgDir, 'package.json'), 'utf8')).version;
const ORT_DIST   = join(ortPkgDir, 'dist');

// ONNX model files — canonical output of export_onnx.py at the repo root
const MODEL_DIR = join(ROOT, '..', 'models', 'onnx');

// CDN URL base for the userscript (WASM served from jsDelivr)
const ORT_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/`;

// Hosted model base for the userscript (update to wherever you host the files)
const MODEL_BASE_URL = process.env.MODEL_BASE_URL
  ?? 'https://raw.githubusercontent.com/JiveOff/bs-map-classifier/main/models/onnx/';

// Read injected.js source for inlining into the userscript build
const injectedSrc = await readFile(join(__dirname, 'public', 'injected.js'), 'utf8');

// Version: prefer RELEASE_VERSION env (set by CI from the git tag), else read from package.json
const _pkg     = JSON.parse(await readFile(join(__dirname, 'package.json'), 'utf8'));
const version  = process.env.RELEASE_VERSION ?? _pkg.version;

// ── Shared esbuild options ─────────────────────────────────────────────────────

// Stub path for Node.js built-ins that bsmap shims import.
// We only use NoteJumpSpeed and swing.count from bsmap — both are pure math
// with no I/O — so these built-ins are never actually called at runtime.
const NODE_STUB = join(__dirname, 'src', 'stubs', 'node-builtins.js');

const sharedOptions = {
  bundle: true,
  minify: true,
  target: ['es2020'],
  logLevel: 'info',
  // onnxruntime-node is Node.js only — never bundle it for browser targets.
  // onnxruntime-web is bundled directly into the IIFE so it works in both
  // extension content scripts and userscript sandboxes without relying on globals.
  external: ['onnxruntime-node'],
  // Redirect Node.js built-ins imported by bsmap's filesystem shims to empty
  // browser-safe stubs so esbuild can bundle without errors.
  alias: {
    'node:path':         NODE_STUB,
    'node:fs':           NODE_STUB,
    'node:fs/promises':  NODE_STUB,
  },
};

// ── Extension build ────────────────────────────────────────────────────────────

async function buildExtension() {
  console.log('\n▸ Building extension →', EXT_OUT);
  await mkdir(join(EXT_OUT, 'wasm'), { recursive: true });

  // Bundle content_entry.js → single IIFE (includes library + content.js)
  await esbuild.build({
    ...sharedOptions,
    entryPoints: [join(__dirname, 'src', 'content_entry.js')],
    outfile: join(EXT_OUT, 'content.js'),
    format: 'iife',
    define: {
      __PLATFORM__:     '"extension"',
      __INJECTED_SRC__: '""',          // unused in extension (dead-code eliminated)
      __ORT_WASM_URL__: '""',          // unused in extension
      __MODEL_BASE_URL__: '""',        // unused in extension
    },
  });

  // Static copies
  await copyFile(join(__dirname, 'public', 'injected.js'), join(EXT_OUT, 'injected.js'));
  await copyFile(join(__dirname, 'public', 'popup.html'), join(EXT_OUT, 'popup.html'));
  await copyFile(join(MODEL_DIR, 'pattern_classifier.onnx'),      join(EXT_OUT, 'pattern_classifier.onnx'));
  await copyFile(join(MODEL_DIR, 'pattern_classifier_meta.json'), join(EXT_OUT, 'pattern_classifier_meta.json'));

  // ORT WASM runtime files — must be web-accessible so ORT can fetch/import them
  await copyFile(
    join(ORT_DIST, 'ort-wasm-simd-threaded.wasm'),
    join(EXT_OUT, 'wasm', 'ort-wasm-simd-threaded.wasm'),
  );
  await copyFile(
    join(ORT_DIST, 'ort-wasm-simd-threaded.mjs'),
    join(EXT_OUT, 'wasm', 'ort-wasm-simd-threaded.mjs'),
  );

  // Manifest (copy from public/ as-is — already has the right structure)
  await copyFile(join(__dirname, 'public', 'manifest.json'), join(EXT_OUT, 'manifest.json'));

  console.log('✓ Extension built');
}

// ── Userscript build ───────────────────────────────────────────────────────────

const ortMajorMinor = ortVersion.split('.').slice(0, 2).join('.');

const GH_REPO = 'JiveOff/bs-map-classifier';
const STABLE_USERSCRIPT_URL = `https://github.com/${GH_REPO}/releases/latest/download/bs-pattern-overlay.user.js`;

const USERSCRIPT_HEADER = `// ==UserScript==
// @name         BS Pattern Overlay
// @namespace    https://github.com/${GH_REPO}
// @version      ${version}
// @description  Beat Saber map pattern overlay and ONNX classifier (Tech / Speed / Accuracy / Standard / Extreme)
// @author       JiveOff
// @updateURL    ${STABLE_USERSCRIPT_URL}
// @downloadURL  ${STABLE_USERSCRIPT_URL}
// @match        https://allpoland.github.io/ArcViewer/*
// @match        https://watch.scoresaber.com/*
// @connect      beatsaver.com
// @connect      cdn.beatsaver.com
// @connect      cdn.jsdelivr.net
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==
`;

async function buildUserscript() {
  console.log('\n▸ Building userscript →', US_OUT);
  await mkdir(US_OUT, { recursive: true });

  // Embed the ONNX model directly so the userscript needs no external model fetch
  const modelBytes = await readFile(join(MODEL_DIR, 'pattern_classifier.onnx'));
  const modelB64   = modelBytes.toString('base64');
  const modelMeta  = await readFile(join(MODEL_DIR, 'pattern_classifier_meta.json'), 'utf8');
  console.log(`  Embedding model: ${(modelBytes.length / 1024).toFixed(0)} KB → ${(modelB64.length / 1024).toFixed(0)} KB base64`);

  await esbuild.build({
    ...sharedOptions,
    entryPoints: [join(__dirname, 'src', 'userscript_entry.js')],
    outfile: join(US_OUT, 'bs-pattern-overlay.user.js'),
    format: 'iife',
    banner: { js: USERSCRIPT_HEADER },
    define: {
      __PLATFORM__:     '"userscript"',
      __INJECTED_SRC__: JSON.stringify(injectedSrc),
      __ORT_WASM_URL__: JSON.stringify(ORT_CDN),
      __MODEL_BASE_URL__: JSON.stringify(MODEL_BASE_URL),
      __MODEL_B64__:    JSON.stringify(modelB64),
      __MODEL_META__:   JSON.stringify(modelMeta),
    },
  });

  console.log('✓ Userscript built (model embedded, no external fetch needed)');
  console.log(`  Version      = ${version}`);
  console.log(`  ORT WASM CDN = ${ORT_CDN}`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

if (target === 'all' || target === 'extension') await buildExtension();
if (target === 'all' || target === 'userscript') await buildUserscript();
