/**
 * userscript_entry.js — userscript build entry point.
 *
 * onnxruntime-web, fflate, and the ONNX model are all bundled into this IIFE by
 * esbuild — no external requests needed at runtime.
 *
 * Build-time defines injected by build.js:
 *   __ORT_WASM_URL__  — CDN URL for WASM binary (fetched by ORT at session creation)
 *   __INJECTED_SRC__  — injected.js inlined as string
 *   __MODEL_B64__     — pattern_classifier.onnx as base64
 *   __MODEL_META__    — pattern_classifier_meta.json as JSON string
 */

import * as ort from 'onnxruntime-web/wasm';
import { setOrtInstance, loadClassifierFromBuffers } from 'bs-map-classifier';

// WASM-only backend, no threading
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = __ORT_WASM_URL__;
setOrtInstance(ort);

// Decode the model embedded at build time and start loading it immediately.
// content.js awaits window.__bso_clf_promise in loadClassifierModels() —
// by the time inference is triggered the session is likely already ready.
const _modelBuf = Uint8Array.from(atob(__MODEL_B64__), c => c.charCodeAt(0)).buffer;
window.__bso_clf_promise = loadClassifierFromBuffers(_modelBuf, JSON.parse(__MODEL_META__));

import './content.js';
