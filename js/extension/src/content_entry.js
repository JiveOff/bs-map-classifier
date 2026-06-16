/**
 * content_entry.js — extension build entry point.
 *
 * onnxruntime-web and jszip are bundled directly into this IIFE by esbuild —
 * no separate content script or window global needed.
 */

import * as ort from 'onnxruntime-web/wasm';
import { setOrtInstance, setWasmPaths } from 'bs-map-classifier';

// Use WASM-only backend: no JSEP/WebGPU probing, no SharedArrayBuffer required
ort.env.wasm.numThreads = 1;
setOrtInstance(ort);
setWasmPaths(chrome.runtime.getURL('wasm/'));

import './content.js';
