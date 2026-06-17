'use strict';
/**
 * infer.js — shared preprocessing and inference logic.
 *
 * These functions are environment-agnostic: they operate on an already-loaded
 * classifier object (which carries its own `ort` reference) and never touch
 * the module-level ORT instance.  Imported by all classify.*.js variants.
 */

import { computeFeatures, toFeatureVector } from './features.js';

export function preprocess(vec, meta) {
  const { imputer_medians, scaler_mean, scaler_scale } = meta;
  for (let i = 0; i < vec.length; i++) {
    if (!isFinite(vec[i])) vec[i] = imputer_medians[i];
    vec[i] = (vec[i] - scaler_mean[i]) / scaler_scale[i];
  }
  return vec;
}

export async function classifyFromNotes(notes, obstacles, arcs, chains, bpm, bombs = [], classifier, njs = 0, njsOffset = 0) {
  const { session, meta, ort } = classifier;

  const featureMap = computeFeatures(notes, obstacles, arcs, chains, bpm, bombs, njs, njsOffset);
  const rawVec     = toFeatureVector(featureMap, meta.features);
  preprocess(rawVec, meta);

  const inputName = session.inputNames[0];
  const tensor    = new ort.Tensor('float32', rawVec, [1, meta.n_features]);
  const outputs   = await session.run({ [inputName]: tensor });

  const labelArr = outputs[session.outputNames[0]].data;
  const probArr  = outputs[session.outputNames[1]].data;
  const classIdx = Number(labelArr[0]);
  const category = meta.classes[classIdx];

  const probabilities = {};
  for (let i = 0; i < meta.classes.length; i++) {
    probabilities[meta.classes[i]] = Number(probArr[i].toFixed(4));
  }

  return { category, confidence: probabilities[category], probabilities };
}
