"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var classify_exports = {};
__export(classify_exports, {
  classifyFromNotes: () => classifyFromNotes,
  loadClassifier: () => loadClassifier,
  loadClassifierFromBuffers: () => loadClassifierFromBuffers,
  loadClassifierFromFetch: () => loadClassifierFromFetch,
  preprocess: () => preprocess,
  setOrtInstance: () => setOrtInstance,
  setWasmPaths: () => setWasmPaths
});
module.exports = __toCommonJS(classify_exports);
var import_features = require("./features.js");
let _injectedOrt = null;
function setOrtInstance(ort) {
  _injectedOrt = ort;
}
async function setWasmPaths(wasmDir) {
  const ort = _injectedOrt ?? await _loadOrt();
  ort.env.wasm.wasmPaths = wasmDir;
}
function preprocess(vec, meta) {
  const { imputer_medians, scaler_mean, scaler_scale } = meta;
  for (let i = 0; i < vec.length; i++) {
    if (!isFinite(vec[i])) vec[i] = imputer_medians[i];
    vec[i] = (vec[i] - scaler_mean[i]) / scaler_scale[i];
  }
  return vec;
}
async function _loadOrt() {
  if (_injectedOrt) return _injectedOrt;
  try {
    return await import("onnxruntime-node");
  } catch {
  }
  try {
    return await import("onnxruntime-web");
  } catch {
  }
  throw new Error(
    "No ONNX runtime found. Install onnxruntime-node (Node.js) or onnxruntime-web (browser)."
  );
}
async function loadClassifier(modelPath, metaPath) {
  const { readFile } = await import("node:fs/promises");
  const ort = await _loadOrt();
  const [modelBuf, metaText] = await Promise.all([
    readFile(modelPath),
    readFile(metaPath, "utf8")
  ]);
  const session = await ort.InferenceSession.create(modelBuf, { executionProviders: ["wasm"] });
  const meta = JSON.parse(metaText);
  return { session, meta, ort };
}
async function loadClassifierFromFetch(modelUrl, metaUrl) {
  const ort = await _loadOrt();
  const [modelResp, metaResp] = await Promise.all([
    fetch(modelUrl),
    fetch(metaUrl)
  ]);
  if (!modelResp.ok) throw new Error(`Failed to fetch model: ${modelResp.status}`);
  if (!metaResp.ok) throw new Error(`Failed to fetch meta: ${metaResp.status}`);
  const [modelBuf, meta] = await Promise.all([
    modelResp.arrayBuffer(),
    metaResp.json()
  ]);
  const session = await ort.InferenceSession.create(new Uint8Array(modelBuf), { executionProviders: ["wasm"] });
  return { session, meta, ort };
}
async function loadClassifierFromBuffers(modelBuffer, meta) {
  const ort = await _loadOrt();
  const session = await ort.InferenceSession.create(new Uint8Array(modelBuffer), { executionProviders: ["wasm"] });
  return { session, meta, ort };
}
async function classifyFromNotes(notes, obstacles, arcs, chains, bpm, bombs = [], classifier) {
  const { session, meta, ort } = classifier;
  const featureMap = (0, import_features.computeFeatures)(notes, obstacles, arcs, chains, bpm, bombs);
  const rawVec = (0, import_features.toFeatureVector)(featureMap, meta.features);
  preprocess(rawVec, meta);
  const inputName = session.inputNames[0];
  const tensor = new ort.Tensor("float32", rawVec, [1, meta.n_features]);
  const outputs = await session.run({ [inputName]: tensor });
  const labelArr = outputs[session.outputNames[0]].data;
  const probArr = outputs[session.outputNames[1]].data;
  const classIdx = Number(labelArr[0]);
  const category = meta.classes[classIdx];
  const probabilities = {};
  for (let i = 0; i < meta.classes.length; i++) {
    probabilities[meta.classes[i]] = Number(probArr[i].toFixed(4));
  }
  const confidence = probabilities[category];
  return { category, confidence, probabilities };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  classifyFromNotes,
  loadClassifier,
  loadClassifierFromBuffers,
  loadClassifierFromFetch,
  preprocess,
  setOrtInstance,
  setWasmPaths
});
