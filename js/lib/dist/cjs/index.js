"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  PATTERN_COLORS: () => import_patterns2.PATTERN_COLORS,
  TYPE_LABELS: () => import_patterns2.TYPE_LABELS,
  annotatePatterns: () => import_patterns2.annotatePatterns,
  classifyFromNotes: () => import_classify2.classifyFromNotes,
  computeFeatures: () => import_features2.computeFeatures,
  findDatFilename: () => import_parser.findDatFilename,
  loadClassifier: () => import_classify2.loadClassifier,
  loadClassifierFromBuffers: () => import_classify2.loadClassifierFromBuffers,
  loadClassifierFromFetch: () => import_classify2.loadClassifierFromFetch,
  parseBeatmap: () => import_parser.parseBeatmap,
  parseMap: () => parseMap,
  preprocess: () => import_classify2.preprocess,
  setOrtInstance: () => import_classify2.setOrtInstance,
  setWasmPaths: () => import_classify2.setWasmPaths,
  toFeatureVector: () => import_features2.toFeatureVector
});
module.exports = __toCommonJS(index_exports);
var import_features = require("./features.js");
var import_classify = require("./classify.js");
var import_patterns = require("./patterns.js");
var import_classify2 = require("./classify.js");
var import_features2 = require("./features.js");
var import_parser = require("./parser.js");
var import_patterns2 = require("./patterns.js");
async function parseMap(parsedBeatmap, bpm, classifier = null, meta = {}) {
  const { notes, obstacles = [], arcs = [], chains = [], bombs = [] } = parsedBeatmap;
  const features = (0, import_features.computeFeatures)(notes, obstacles, arcs, chains, bpm, bombs);
  const annotation = (0, import_patterns.annotatePatterns)(notes, bpm, meta);
  const result = {
    features,
    patterns: annotation.patterns,
    patternColors: annotation.colors,
    allNotes: annotation.all_notes
  };
  if (classifier) {
    result.classification = await (0, import_classify.classifyFromNotes)(
      notes,
      obstacles,
      arcs,
      chains,
      bpm,
      bombs,
      classifier
    );
  }
  return result;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PATTERN_COLORS,
  TYPE_LABELS,
  annotatePatterns,
  classifyFromNotes,
  computeFeatures,
  findDatFilename,
  loadClassifier,
  loadClassifierFromBuffers,
  loadClassifierFromFetch,
  parseBeatmap,
  parseMap,
  preprocess,
  setOrtInstance,
  setWasmPaths,
  toFeatureVector
});
