// bs-map-classifier — TypeScript definitions

// ── Beatmap data types ────────────────────────────────────────────────────────

export interface Note {
  beat:      number;  // position in beats
  x:         number;  // lane  0–3 (0=far-left, 3=far-right)
  y:         number;  // layer 0–2 (0=bottom, 2=top)
  color:     number;  // 0=red(left hand) 1=blue(right hand)
  direction: number;  // 0=Up 1=Down 2=Left 3=Right 4=UpLeft 5=UpRight 6=DownLeft 7=DownRight 8=dot
}

export interface Obstacle {
  beat:     number;  // start position in beats
  x:        number;  // start lane
  y:        number;  // start layer
  w:        number;  // width in lanes
  h:        number;  // height in layers
  duration: number;  // length in beats
}

export interface ParsedBeatmap {
  notes:     Note[];
  obstacles: Obstacle[];
  /** Raw arc JSON objects (v3/v4 sliders) */
  arcs:      object[];
  /** Raw chain JSON objects (v3/v4 burstSliders) */
  chains:    object[];
  bombs:     Note[];  // color = -1, direction = 8
}

// ── Classifier types ──────────────────────────────────────────────────────────

export type Category = 'Tech' | 'Speed' | 'Accuracy' | 'Standard' | 'Extreme';

export interface ClassifyResult {
  /** Predicted category */
  category:      Category;
  /** Probability of the predicted category (0–1) */
  confidence:    number;
  /** Probability for each category */
  probabilities: Record<Category, number>;
}

export interface ClassifierMeta {
  model:            string;
  onnx_file:        string;
  features:         string[];
  n_features:       number;
  classes:          Category[];
  imputer_medians:  number[];
  scaler_mean:      number[];
  scaler_scale:     number[];
}

/** Opaque handle returned by loader functions — pass to classifyFromNotes(). */
export interface Classifier {
  session: unknown;  // onnxruntime InferenceSession
  meta:    ClassifierMeta;
  ort:     unknown;  // onnxruntime namespace
}

// ── Parser ────────────────────────────────────────────────────────────────────

/**
 * Parse a .dat beatmap JSON object into typed arrays.
 * Handles v2, v3, and v4 formats.
 */
export function parseBeatmap(data: object): ParsedBeatmap;

/**
 * Locate the correct .dat filename inside Info.dat for a given
 * characteristic (e.g. "Standard") and difficulty (e.g. "ExpertPlus").
 */
export function findDatFilename(
  infoDat:        object,
  characteristic: string,
  difficulty:     string,
): string;

// ── Feature extraction ────────────────────────────────────────────────────────

/**
 * Compute all 202 pattern features from parsed beatmap data.
 * Mirrors Python's compute_pattern_features() + compute_windowed_features().
 */
export function computeFeatures(
  notes:     Note[],
  obstacles: Obstacle[],
  arcs:      object[],
  chains:    object[],
  bpm:       number,
  bombs?:    Note[],
): Record<string, number>;

/**
 * Convert a feature map to a Float32Array in the exact column order
 * defined by ClassifierMeta.features.
 */
export function toFeatureVector(
  featureMap:   Record<string, number>,
  featureNames: string[],
): Float32Array;

// ── Model loading ─────────────────────────────────────────────────────────────

/**
 * Load model from filesystem paths. Node.js only.
 */
export function loadClassifier(
  modelPath: string,
  metaPath:  string,
): Promise<Classifier>;

/**
 * Load model via fetch(). Works in browsers, Deno, and Node.js ≥ 18.
 * Requires onnxruntime-web to be installed.
 *
 * Note: onnxruntime-web serves its WASM engine as a separate file.
 * If the WASM file is not co-located with your JS bundle, set its location:
 *   import { env } from 'onnxruntime-web';
 *   env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21/dist/';
 */
export function loadClassifierFromFetch(
  modelUrl: string | URL,
  metaUrl:  string | URL,
): Promise<Classifier>;

/**
 * Load from pre-fetched buffers. Works in any environment.
 */
export function loadClassifierFromBuffers(
  modelBuffer: ArrayBuffer,
  meta:        ClassifierMeta,
): Promise<Classifier>;

// ── Inference ─────────────────────────────────────────────────────────────────

/**
 * Run the full pipeline: parsed beatmap → category prediction.
 *
 * @example
 * const { notes, obstacles, arcs, chains, bombs } = parseBeatmap(datJson);
 * const result = await classifyFromNotes(notes, obstacles, arcs, chains, bpm, bombs, clf);
 * console.log(result.category, result.confidence);
 */
export function classifyFromNotes(
  notes:      Note[],
  obstacles:  Obstacle[],
  arcs:       object[],
  chains:     object[],
  bpm:        number,
  bombs:      Note[],
  classifier: Classifier,
): Promise<ClassifyResult>;

/**
 * Apply median imputation and StandardScaler in-place.
 * Called internally by classifyFromNotes — exposed for advanced use.
 */
export function preprocess(
  vec:  Float32Array,
  meta: ClassifierMeta,
): Float32Array;

// ── Embedded model (bs-map-classifier/embedded) ───────────────────────────────

/**
 * Load the classifier with the model bundled at build time.
 * No paths or URLs needed — works offline and in any environment.
 *
 * Exported from the `bs-map-classifier/embedded` subpath.
 *
 * @example
 * import { loadEmbeddedClassifier } from 'bs-map-classifier/embedded';
 * import { parseBeatmap, parseMap } from 'bs-map-classifier';
 *
 * const clf    = await loadEmbeddedClassifier();
 * const result = await parseMap(parseBeatmap(datJson), bpm, clf);
 */
export function loadEmbeddedClassifier(): Promise<Classifier>;
