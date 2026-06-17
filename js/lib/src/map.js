'use strict';
/**
 * map.js — high-level convenience functions.
 * Shared by all index.*.js entry points.
 */

import { computeFeatures } from './features.js';
import { classifyFromNotes } from './infer.js';
import { annotatePatterns } from './patterns.js';

function _unpack(parsedBeatmap) {
  const { notes, obstacles = [], arcs = [], chains = [], bombs = [] } = parsedBeatmap;
  return { notes, obstacles, arcs, chains, bombs };
}

/** Extract pattern features and named pattern events from a parsed beatmap. */
export function extractPatterns(parsedBeatmap, bpm, meta = {}) {
  const { notes, obstacles, arcs, chains, bombs } = _unpack(parsedBeatmap);
  const annotation = annotatePatterns(notes, bpm, meta);
  return {
    features:      computeFeatures(notes, obstacles, arcs, chains, bpm, bombs),
    patterns:      annotation.patterns,
    patternColors: annotation.colors,
    allNotes:      annotation.all_notes,
  };
}

/** Classify a parsed beatmap into a category. */
export async function classifyMap(parsedBeatmap, bpm, classifier, njs = 0, njsOffset = 0) {
  const { notes, obstacles, arcs, chains, bombs } = _unpack(parsedBeatmap);
  return classifyFromNotes(notes, obstacles, arcs, chains, bpm, bombs, classifier, njs, njsOffset);
}

/** Extract pattern features, named pattern events, and classify in one call. */
export async function extractPatternsAndClassifyMap(parsedBeatmap, bpm, classifier, meta = {}, njs = 0, njsOffset = 0) {
  const { notes, obstacles, arcs, chains, bombs } = _unpack(parsedBeatmap);
  const annotation = annotatePatterns(notes, bpm, meta);
  const [features, classification] = await Promise.all([
    computeFeatures(notes, obstacles, arcs, chains, bpm, bombs, njs, njsOffset),
    classifyFromNotes(notes, obstacles, arcs, chains, bpm, bombs, classifier, njs, njsOffset),
  ]);
  return {
    features,
    patterns:      annotation.patterns,
    patternColors: annotation.colors,
    allNotes:      annotation.all_notes,
    classification,
  };
}

/**
 * @deprecated Use extractPatterns(), classifyMap(), or extractPatternsAndClassifyMap() instead.
 */
export async function parseMap(parsedBeatmap, bpm, classifier = null, meta = {}) {
  if (classifier) return extractPatternsAndClassifyMap(parsedBeatmap, bpm, classifier, meta);
  return extractPatterns(parsedBeatmap, bpm, meta);
}
