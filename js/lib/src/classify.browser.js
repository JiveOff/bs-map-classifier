'use strict';
/**
 * classify.browser.js — Browser variant.
 *
 * No onnxruntime-node. Uses setOrtInstance() injection (preferred) or
 * falls back to a dynamic import of onnxruntime-web.
 * Routed via the "browser" export condition in package.json.
 */

export { preprocess, classifyFromNotes } from './infer.js';

let _injectedOrt = null;

/** Inject an already-loaded ORT runtime (e.g. `window.ort` from ort.min.js). */
export function setOrtInstance(ort) { _injectedOrt = ort; }

/** Set WASM file paths on the ORT runtime before any session is created. */
export async function setWasmPaths(wasmDir) {
  const ort = _injectedOrt ?? await _loadOrt();
  ort.env.wasm.wasmPaths = wasmDir;
}

async function _loadOrt() {
  if (_injectedOrt) return _injectedOrt;
  try { return await import('onnxruntime-web'); } catch {}
  throw new Error(
    'No ONNX runtime found. Install onnxruntime-web or call setOrtInstance() first.',
  );
}

export async function loadClassifier() {
  throw new Error(
    'loadClassifier() requires filesystem access — use loadClassifierFromFetch() ' +
    'or loadClassifierFromBuffers() in browser environments.',
  );
}

export async function loadClassifierFromFetch(modelUrl, metaUrl) {
  const ort = await _loadOrt();
  const [modelResp, metaResp] = await Promise.all([fetch(modelUrl), fetch(metaUrl)]);
  if (!modelResp.ok) throw new Error(`Failed to fetch model: ${modelResp.status}`);
  if (!metaResp.ok)  throw new Error(`Failed to fetch meta: ${metaResp.status}`);
  const [modelBuf, meta] = await Promise.all([modelResp.arrayBuffer(), metaResp.json()]);
  const session = await ort.InferenceSession.create(new Uint8Array(modelBuf), { executionProviders: ['wasm'] });
  return { session, meta, ort };
}

export async function loadClassifierFromBuffers(modelBuffer, meta) {
  const ort = await _loadOrt();
  const session = await ort.InferenceSession.create(new Uint8Array(modelBuffer), { executionProviders: ['wasm'] });
  return { session, meta, ort };
}
