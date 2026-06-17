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

export interface DatInfo {
  filename:  string;
  njs:       number;
  njsOffset: number;
}

/**
 * Locate the .dat filename and extract NJS / NJS offset for a given
 * characteristic + difficulty from a parsed Info.dat object.
 */
export function findDatInfo(
  infoDat:        object,
  characteristic: string,
  difficulty:     string,
): DatInfo;

// ── Feature extraction ────────────────────────────────────────────────────────

/**
 * Compute all pattern features from parsed beatmap data.
 */
export function computeFeatures(
  notes:     Note[],
  obstacles: Obstacle[],
  arcs:      object[],
  chains:    object[],
  bpm:       number,
  bombs?:    Note[],
  njs?:      number,
  njsOffset?: number,
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

/** Inject an ORT runtime instance. In Node.js, also accepts an execution provider. */
export function setOrtInstance(ort: unknown, provider?: string): void;

/** Set WASM file paths on the ORT runtime before any session is created. */
export function setWasmPaths(wasmDir: string): Promise<void>;

/** Load model from filesystem paths. Node.js only. */
export function loadClassifier(
  modelPath: string,
  metaPath:  string,
): Promise<Classifier>;

/** Load model via fetch(). Works in browsers and Node.js ≥ 18. */
export function loadClassifierFromFetch(
  modelUrl: string | URL,
  metaUrl:  string | URL,
): Promise<Classifier>;

/** Load from pre-fetched buffers. Works in any environment. */
export function loadClassifierFromBuffers(
  modelBuffer: ArrayBuffer,
  meta:        ClassifierMeta,
): Promise<Classifier>;

// ── Inference ─────────────────────────────────────────────────────────────────

/**
 * Apply median imputation and StandardScaler in-place.
 * Called internally by classifyFromNotes — exposed for advanced use.
 */
export function preprocess(
  vec:  Float32Array,
  meta: ClassifierMeta,
): Float32Array;

/**
 * Run the full pipeline: parsed beatmap → category prediction.
 */
export function classifyFromNotes(
  notes:      Note[],
  obstacles:  Obstacle[],
  arcs:       object[],
  chains:     object[],
  bpm:        number,
  bombs:      Note[],
  classifier: Classifier,
  njs?:       number,
  njsOffset?: number,
): Promise<ClassifyResult>;

// ── Pattern annotation ────────────────────────────────────────────────────────

export interface PatternEvent {
  type:   string;
  label:  string;
  beat:   number;
  time:   number;
  notes:  Note[];
}

export interface AnnotationResult {
  patterns:  PatternEvent[];
  colors:    Record<string, string>;
  all_notes: Note[];
}

/** Map of pattern type → hex color string used for the viewer overlay. */
export const PATTERN_COLORS: Record<string, string>;

/** Map of pattern type → human-readable label. */
export const TYPE_LABELS: Record<string, string>;

/**
 * Annotate notes with named pattern events.
 * Single source of truth for all pattern detection.
 */
export function annotatePatterns(
  notes:      Note[],
  bpm:        number,
  meta?:      object,
  obstacles?: Obstacle[],
  bombs?:     Note[],
): AnnotationResult;

// ── High-level convenience ────────────────────────────────────────────────────

export interface PatternResult {
  features:      Record<string, number>;
  patterns:      PatternEvent[];
  patternColors: Record<string, string>;
  allNotes:      Note[];
}

export interface MapAnalysisResult extends PatternResult {
  classification: ClassifyResult;
}

/** Extract pattern features and named pattern events from a parsed beatmap. */
export function extractPatterns(
  parsedBeatmap: ParsedBeatmap & { njs?: number; njsOffset?: number },
  bpm:           number,
  meta?:         object,
): PatternResult;

/** Classify a parsed beatmap into a category. */
export function classifyMap(
  parsedBeatmap: ParsedBeatmap & { njs?: number; njsOffset?: number },
  bpm:           number,
  classifier:    Classifier,
  njs?:          number,
  njsOffset?:    number,
): Promise<ClassifyResult>;

/** Extract pattern features, named pattern events, and classify in one call. */
export function extractPatternsAndClassifyMap(
  parsedBeatmap: ParsedBeatmap & { njs?: number; njsOffset?: number },
  bpm:           number,
  classifier:    Classifier,
  meta?:         object,
  njs?:          number,
  njsOffset?:    number,
): Promise<MapAnalysisResult>;

/**
 * @deprecated Use extractPatterns(), classifyMap(), or extractPatternsAndClassifyMap() instead.
 */
export function parseMap(
  parsedBeatmap: ParsedBeatmap,
  bpm:           number,
  classifier?:   Classifier | null,
  meta?:         object,
): Promise<PatternResult | MapAnalysisResult>;

// ── BeatSaver helpers (bs-map-classifier/beatsaver) ──────────────────────────

export interface BeatSaverResult {
  /** Parsed beatmap with njs and njsOffset pre-set — pass directly to extractPatternsAndClassifyMap. */
  beatmap:        ParsedBeatmap & { njs: number; njsOffset: number };
  bpm:            number;
  njs:            number;
  njsOffset:      number;
  characteristic: string;
  difficulty:     string;
  songName:       string;
  songAuthor:     string;
  mapAuthor:      string;
}

/**
 * Download and parse a Beat Saber map by its BeatSaver short key (e.g. "2b120").
 * Defaults to Standard / highest available difficulty when omitted.
 *
 * Exported from the `bs-map-classifier/beatsaver` subpath.
 */
export function loadFromKey(
  key:             string,
  characteristic?: string,
  difficulty?:     string,
): Promise<BeatSaverResult>;

/**
 * Download and parse a Beat Saber map by its zip hash.
 * Metadata is fetched from the BeatSaver API when available.
 *
 * Exported from the `bs-map-classifier/beatsaver` subpath.
 */
export function loadFromHash(
  hash:            string,
  characteristic?: string,
  difficulty?:     string,
): Promise<BeatSaverResult>;

// ── Embedded model (bs-map-classifier/embedded) ───────────────────────────────

/**
 * Load the classifier with the model bundled at build time.
 * No paths or URLs needed — works offline and in any environment.
 *
 * Exported from the `bs-map-classifier/embedded` subpath.
 */
export function loadEmbeddedClassifier(): Promise<Classifier>;
