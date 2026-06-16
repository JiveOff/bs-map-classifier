'use strict';
/**
 * classify.node.js — Node.js variant.
 *
 * Imports onnxruntime-node statically — no runtime detection, no try/catch.
 * Routed via the "node" export condition in package.json.
 */

import * as _defaultOrt from 'onnxruntime-node';

export { preprocess, classifyFromNotes } from './infer.js';

let _ort = _defaultOrt;

/** Override the ORT instance (useful for testing / mocking). */
export function setOrtInstance(ort) { _ort = ort; }

/** Set WASM file paths on the ORT runtime before any session is created. */
export async function setWasmPaths(wasmDir) {
  _ort.env.wasm.wasmPaths = wasmDir;
}

export async function loadClassifier(modelPath, metaPath) {
  const { readFile } = await import('node:fs/promises');
  const [modelBuf, metaText] = await Promise.all([
    readFile(modelPath),
    readFile(metaPath, 'utf8'),
  ]);
  const session = await _ort.InferenceSession.create(modelBuf, { executionProviders: ['cpu'] });
  return { session, meta: JSON.parse(metaText), ort: _ort };
}

export async function loadClassifierFromFetch(modelUrl, metaUrl) {
  const [modelResp, metaResp] = await Promise.all([fetch(modelUrl), fetch(metaUrl)]);
  if (!modelResp.ok) throw new Error(`Failed to fetch model: ${modelResp.status}`);
  if (!metaResp.ok)  throw new Error(`Failed to fetch meta: ${metaResp.status}`);
  const [modelBuf, meta] = await Promise.all([modelResp.arrayBuffer(), metaResp.json()]);
  const session = await _ort.InferenceSession.create(new Uint8Array(modelBuf), { executionProviders: ['cpu'] });
  return { session, meta, ort: _ort };
}

export async function loadClassifierFromBuffers(modelBuffer, meta) {
  const session = await _ort.InferenceSession.create(new Uint8Array(modelBuffer), { executionProviders: ['cpu'] });
  return { session, meta, ort: _ort };
}
