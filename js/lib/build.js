/**
 * build.js — library build for bs-map-classifier
 *
 * 1. Compiles ESM source → CJS (dist/cjs/*.js) with a nested package.json
 *    { "type": "commonjs" } so Node.js treats the .js files as CJS even
 *    though the root package is "type": "module".
 *
 * 2. Generates dist/embedded.mjs + dist/cjs/embedded.js — standalone files
 *    that contain the ONNX model as base64 so callers need zero extra setup.
 */

import esbuild from 'esbuild';
import { copyFile, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Source of truth: <repo-root>/models/onnx/ (written by src/models/export_onnx.py)
const REPO_ROOT  = resolve(__dirname, '../..');
const MODELS_SRC = join(REPO_ROOT, 'models', 'onnx');

// ── 1. CJS output ──────────────────────────────────────────────────────────────

await mkdir(join(__dirname, 'dist/cjs'), { recursive: true });

// The nested package.json makes Node.js treat *.js files here as CJS,
// overriding the root-level "type": "module".
await writeFile(
  join(__dirname, 'dist/cjs/package.json'),
  JSON.stringify({ type: 'commonjs' }) + '\n',
);

// Copy the shared declaration file so TypeScript treats it as CJS
// (because dist/cjs/package.json has "type": "commonjs").
await copyFile(
  join(__dirname, 'types/index.d.ts'),
  join(__dirname, 'dist/cjs/index.d.ts'),
);

// Minimal declaration file for the ./embedded subpath in CJS mode.
await writeFile(
  join(__dirname, 'dist/cjs/embedded.d.ts'),
  `export { loadEmbeddedClassifier } from './index';\n`,
);

await esbuild.build({
  // CJS output is always consumed by Node.js, so compile from the node variants.
  // classify.node.js is intentionally excluded — it is generated as a hand-crafted
  // template below to guarantee require('onnxruntime-node') is used without esbuild's
  // __toESM() proxy wrapper, which breaks the backend registry in pnpm projects.
  entryPoints: [
    { in: 'src/index.node.js', out: 'index' },
    'src/infer.js',
    'src/map.js',
    'src/parser.js',
    'src/features.js',
    'src/patterns.js',
  ],
  format: 'cjs',
  platform: 'node',
  bundle: false,
  outdir: 'dist/cjs/',
  logLevel: 'info',
});

// Hand-crafted CJS entry for onnxruntime-node.
// esbuild wraps `import * as x from 'onnxruntime-node'` with __toESM(), which creates
// a proxy object that breaks onnxruntime-node's backend registry in pnpm projects
// (the registered backend lives in one onnxruntime-common instance; the proxy looks
// up a different one).  Using require() directly avoids the proxy entirely.
await writeFile(join(__dirname, 'dist/cjs/classify.node.js'), `"use strict";
const { preprocess, classifyFromNotes } = require("./infer.js");

let _ort = require("onnxruntime-node");

function setOrtInstance(o) { _ort = o; }
async function setWasmPaths(wasmDir) { _ort.env.wasm.wasmPaths = wasmDir; }

async function loadClassifier(modelPath, metaPath) {
  const { readFile } = await import("node:fs/promises");
  const [modelBuf, metaText] = await Promise.all([readFile(modelPath), readFile(metaPath, "utf8")]);
  const session = await _ort.InferenceSession.create(modelBuf, { executionProviders: ["cpu"] });
  return { session, meta: JSON.parse(metaText), ort: _ort };
}

async function loadClassifierFromFetch(modelUrl, metaUrl) {
  const [modelResp, metaResp] = await Promise.all([fetch(modelUrl), fetch(metaUrl)]);
  if (!modelResp.ok) throw new Error("Failed to fetch model: " + modelResp.status);
  if (!metaResp.ok)  throw new Error("Failed to fetch meta: " + metaResp.status);
  const [modelBuf, meta] = await Promise.all([modelResp.arrayBuffer(), metaResp.json()]);
  const session = await _ort.InferenceSession.create(new Uint8Array(modelBuf), { executionProviders: ["cpu"] });
  return { session, meta, ort: _ort };
}

async function loadClassifierFromBuffers(modelBuffer, meta) {
  const session = await _ort.InferenceSession.create(new Uint8Array(modelBuffer), { executionProviders: ["cpu"] });
  return { session, meta, ort: _ort };
}

exports.setOrtInstance          = setOrtInstance;
exports.setWasmPaths            = setWasmPaths;
exports.loadClassifier          = loadClassifier;
exports.loadClassifierFromFetch = loadClassifierFromFetch;
exports.loadClassifierFromBuffers = loadClassifierFromBuffers;
exports.preprocess              = preprocess;
exports.classifyFromNotes       = classifyFromNotes;
`);

// ── 2. Embedded model files ────────────────────────────────────────────────────

const modelBytes = await readFile(join(MODELS_SRC, 'pattern_classifier.onnx'));
const modelB64   = modelBytes.toString('base64');
const modelMeta  = await readFile(join(MODELS_SRC, 'pattern_classifier_meta.json'), 'utf8');

// Works in both browser (atob) and Node.js (Buffer)
const decodeHelper = `\
function _decode(b64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64')).buffer;
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
}`;

// Browser ESM — uses index.browser.js so onnxruntime-node is never imported,
// which avoids Vite/esbuild crashing on native .node binaries.
const embeddedESM = `// Auto-generated by build.js — do not edit.
import { loadClassifierFromBuffers } from '../src/index.browser.js';

${decodeHelper}

const _b64  = ${JSON.stringify(modelB64)};
const _meta = ${modelMeta};

/** Load the classifier with the bundled model — no path or URL needed. */
export async function loadEmbeddedClassifier() {
  return loadClassifierFromBuffers(_decode(_b64), _meta);
}
`;

// Node.js ESM — imports from index.node.js so setOrtInstance/setWasmPaths on the
// Node.js entry point share the same module state as loadEmbeddedClassifier.
const embeddedNodeESM = `// Auto-generated by build.js — do not edit.
import { loadClassifierFromBuffers } from '../src/index.node.js';

${decodeHelper}

const _b64  = ${JSON.stringify(modelB64)};
const _meta = ${modelMeta};

/** Load the classifier with the bundled model — no path or URL needed. */
export async function loadEmbeddedClassifier() {
  return loadClassifierFromBuffers(_decode(_b64), _meta);
}
`;

const embeddedCJS = `// Auto-generated by build.js — do not edit.
'use strict';
const { loadClassifierFromBuffers } = require('./index.js');

${decodeHelper}

const _b64  = ${JSON.stringify(modelB64)};
const _meta = ${modelMeta};

/** Load the classifier with the bundled model — no path or URL needed. */
async function loadEmbeddedClassifier() {
  return loadClassifierFromBuffers(_decode(_b64), _meta);
}

exports.loadEmbeddedClassifier = loadEmbeddedClassifier;
`;

await writeFile(join(__dirname, 'dist/embedded.mjs'),      embeddedESM);
await writeFile(join(__dirname, 'dist/embedded.node.mjs'), embeddedNodeESM);
await writeFile(join(__dirname, 'dist/cjs/embedded.js'),   embeddedCJS);

console.log(
  `✓ Built CJS + embedded model ` +
  `(${(modelBytes.length / 1024).toFixed(0)} KB → ${(modelB64.length / 1024).toFixed(0)} KB base64)`,
);
