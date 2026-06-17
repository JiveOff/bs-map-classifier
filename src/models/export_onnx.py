#!/usr/bin/env python3
"""
Export the trained pattern classifier to ONNX for the JS/browser inference pipeline.

Exports:
  pattern_classifier.onnx  — LightGBM (best model, 88.89% test acc), trained fresh
                             on the canonical JS feature vector. No BeatSaver metadata
                             API needed; runs in browser and Node.js.

LightGBM is exported via onnxmltools (opset 15, zipmap=False) which produces the
same output layout as skl2onnx: output[0]=class indices, output[1]=float32 probs.

Each ONNX file ships with a *_meta.json containing preprocessing params
(imputer medians, scaler mean/scale, feature names, class order) so any
runtime can reproduce the sklearn pipeline without sklearn itself.

Usage:
    python src/models/export_onnx.py --maps data/raw/maps
"""

import json
import logging
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.model_selection import cross_val_score, StratifiedKFold
from sklearn.preprocessing import LabelEncoder, StandardScaler
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType
from onnxmltools.convert import convert_lightgbm
from onnxmltools.convert.common.data_types import FloatTensorType as OnnxFloatTensorType
from lightgbm import LGBMClassifier
import onnxruntime as rt

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

OUTPUT_DIR = Path('models/onnx')

DROP_COLS = ['category', 'map_id', 'key', 'map_name', 'hash',
             'upload_date', 'last_update_date', 'uploader_id', 'difficulty',
             'map_key']

# Best Optuna params — GradientBoosting (86.87% test acc, skl2onnx fallback)
PATTERN_GB_PARAMS = {
    'n_estimators':      554,
    'max_depth':         3,
    'learning_rate':     0.02816929988402289,
    'subsample':         0.7765125740456844,
    'min_samples_split': 13,
    'min_samples_leaf':  7,
    'max_features':      'sqrt',
    'ccp_alpha':         2.349278273300721e-05,
    'random_state':      42,
}

# Best Optuna params — LightGBM (88.89% test acc, onnxmltools opset 15)
PATTERN_LGBM_PARAMS = {
    'n_estimators':      386,
    'max_depth':         7,
    'num_leaves':        53,
    'learning_rate':     0.037527595466927015,
    'subsample':         0.7494094286308378,
    'colsample_bytree':  0.534027414000583,
    'min_child_samples': 42,
    'reg_alpha':         0.00167922146532801,
    'reg_lambda':        0.0018336289476512569,
    'class_weight':      'balanced',
    'random_state':      42,
    'n_jobs':            -1,
    'verbose':           -1,
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_features(csv_path: Path):
    df = pd.read_csv(csv_path)
    df = df[df['category'] != 'Balanced'].copy()
    X = df.drop(columns=[c for c in DROP_COLS if c in df.columns])
    X = X.select_dtypes(include=[np.number])
    y = df['category']
    return X, y


def _fit_pipeline(X: pd.DataFrame, y):
    le = LabelEncoder()
    y_enc = le.fit_transform(y)

    imputer = SimpleImputer(strategy='median')
    X_imp = pd.DataFrame(imputer.fit_transform(X), columns=X.columns)

    scaler = StandardScaler()
    X_sc = pd.DataFrame(scaler.fit_transform(X_imp), columns=X.columns)

    return X_sc, y_enc, le, imputer, scaler


def _to_onnx(model, n_features: int) -> bytes:
    onnx_model = convert_sklearn(
        model,
        initial_types=[('float_input', FloatTensorType([None, n_features]))],
        options={type(model): {'zipmap': False}},
        target_opset=17,
    )
    return onnx_model.SerializeToString()


def _to_onnx_lgbm(model, n_features: int) -> bytes:
    """Export LightGBM via onnxmltools (opset 15, zipmap=False).
    Produces the same output layout as skl2onnx: [class_indices, float32_probs].
    """
    onnx_model = convert_lightgbm(
        model,
        initial_types=[('float_input', OnnxFloatTensorType([None, n_features]))],
        target_opset=15,
        zipmap=False,
    )
    return onnx_model.SerializeToString()


def _verify(model, onnx_bytes: bytes, X_sample: np.ndarray) -> float:
    sess = rt.InferenceSession(onnx_bytes)
    inp  = sess.get_inputs()[0].name
    onnx_probs = sess.run(None, {inp: X_sample.astype(np.float32)})[1]
    skl_probs  = model.predict_proba(X_sample)
    max_diff   = float(np.abs(onnx_probs - skl_probs).max())
    agree      = float((np.argmax(onnx_probs, 1) == model.predict(X_sample)).mean())
    logger.info(f"  Parity: max prob diff = {max_diff:.2e}  |  "
                f"agreement = {agree:.1%}  |  {'✓' if max_diff < 1e-3 else '⚠'}")
    return agree


def _save(name: str, onnx_bytes: bytes, feature_names: list,
          le: LabelEncoder, imputer: SimpleImputer, scaler: StandardScaler) -> Path:
    out = OUTPUT_DIR / f'{name}.onnx'
    out.write_bytes(onnx_bytes)
    logger.info(f"  → {out}  ({len(onnx_bytes)/1024:.1f} KB)")

    meta = {
        'model':           name,
        'onnx_file':       out.name,
        'features':        feature_names,
        'n_features':      len(feature_names),
        'classes':         list(le.classes_),
        'imputer_medians': imputer.statistics_.tolist(),
        'scaler_mean':     scaler.mean_.tolist(),
        'scaler_scale':    scaler.scale_.tolist(),
    }
    meta_out = OUTPUT_DIR / f'{name}_meta.json'
    meta_out.write_text(json.dumps(meta, indent=2))
    logger.info(f"  → {meta_out}")
    return out


# ── Exporters ─────────────────────────────────────────────────────────────────

def export_from_pkl(pkl_name: str, features_csv: Path,
                    pkl_dir: Path = Path('models/baseline_models')) -> Path:
    """Export a pre-trained sklearn model from its .pkl file."""
    logger.info(f"\n{'='*60}\nExporting {pkl_name} (from {pkl_dir})\n{'='*60}")

    pkl = pkl_dir / f'{pkl_name}.pkl'
    if not pkl.exists():
        raise FileNotFoundError(f"{pkl} — run baseline.py or tune.py first")

    model = joblib.load(pkl)
    X, y  = _load_features(features_csv)
    X_sc, y_enc, le, imputer, scaler = _fit_pipeline(X, y)
    n = len(X.columns)
    logger.info(f"  Features: {n}  |  Classes: {list(le.classes_)}")

    onnx_bytes = _to_onnx(model, n)
    _verify(model, onnx_bytes, X_sc.values[:50])
    return _save(pkl_name, onnx_bytes, list(X.columns), le, imputer, scaler)


def _make_sample_weights(y_enc: np.ndarray, le, X_sc: np.ndarray,
                         feature_names: list) -> np.ndarray:
    """
    Balanced weights with eBPM-split boosting for the Extreme class.

    Extreme = Tier 4 Speed (>400 BPM) OR Tier 4 Tech. The two sub-populations
    are confused with Speed and Tech respectively. Tech-side Extreme maps
    (ebpm_left_mean < 200) are nearly indistinguishable from Tech and need a
    stronger boost; Speed-side Extreme maps are more separable via crossover_rate.

    Weights (per fold, applied to training set only):
      Accuracy / Speed / Standard / Tech : balanced inverse-frequency
      Extreme Tech-side (eBPM < 200)     : balanced × 4.0
      Extreme Speed-side (eBPM ≥ 200)    : balanced × 2.5
    """
    from sklearn.utils.class_weight import compute_sample_weight
    weights = compute_sample_weight('balanced', y_enc).astype(float)
    extreme_idx  = list(le.classes_).index('Extreme')
    ext_mask     = y_enc == extreme_idx

    ebpm_col = feature_names.index('ebpm_left_mean')
    ebpm     = X_sc[ext_mask, ebpm_col]
    idx      = np.where(ext_mask)[0]
    weights[idx[ebpm <  0]] *= 4.0   # Tech-side  (standardised eBPM < mean)
    weights[idx[ebpm >= 0]] *= 2.5   # Speed-side (standardised eBPM ≥ mean)
    return weights


def _cv_f1_weighted(params: dict, X: np.ndarray, y: np.ndarray,
                    le, feature_names: list, n_splits: int = 5) -> np.ndarray:
    """5-fold CV with per-fold eBPM-split Extreme sample weights."""
    from sklearn.metrics import f1_score
    cv = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=42)
    scores = []
    for train_idx, test_idx in cv.split(X, y):
        w = _make_sample_weights(y[train_idx], le, X[train_idx], feature_names)
        m = GradientBoostingClassifier(**params)
        m.fit(X[train_idx], y[train_idx], sample_weight=w)
        scores.append(f1_score(y[test_idx], m.predict(X[test_idx]), average='weighted'))
    return np.array(scores)


def export_pattern_classifier(features_csv: Path) -> Path:
    """Train a fresh LightGBM on pattern-only features and export via onnxmltools.

    LightGBM (88.89% test acc) is the best model and is ONNX-exportable via
    onnxmltools (opset 15, zipmap=False) — same output layout as skl2onnx.
    Extreme class uses eBPM-split weights (Tech-side 4×, Speed-side 2.5×).
    """
    logger.info(f"\n{'='*60}\nExporting pattern_classifier (LightGBM, train fresh)\n{'='*60}")

    X, y  = _load_features(features_csv)
    X_sc, y_enc, le, imputer, scaler = _fit_pipeline(X, y)
    feature_names = list(X.columns)
    n = len(feature_names)
    logger.info(f"  Features: {n}  |  Classes: {list(le.classes_)}")
    logger.info(f"  Training on {len(X_sc)} samples…")

    # Final model on all data with eBPM-split weights
    sample_weights = _make_sample_weights(y_enc, le, X_sc.values, feature_names)
    model = LGBMClassifier(**PATTERN_LGBM_PARAMS)
    model.fit(X_sc, y_enc, sample_weight=sample_weights)

    onnx_bytes = _to_onnx_lgbm(model, n)
    _verify(model, onnx_bytes, X_sc.values[:50])
    return _save('pattern_classifier', onnx_bytes, feature_names, le, imputer, scaler)


# ── Main ──────────────────────────────────────────────────────────────────────

REPO_ROOT  = Path(__file__).resolve().parent.parent.parent
JS_SCRIPT  = REPO_ROOT / 'js' / 'lib' / 'scripts' / 'compute_features_batch.js'


def compute_js_features(maps_dir: Path) -> pd.DataFrame:
    """
    Run compute_features_batch.js to get the exact feature vector that the
    ONNX inference pipeline will compute at runtime.
    """
    import shutil, subprocess, sys
    node = shutil.which('node')
    if not node:
        raise RuntimeError('node not found in PATH')
    if not JS_SCRIPT.exists():
        raise FileNotFoundError(f'JS script not found: {JS_SCRIPT}')

    logger.info(f'Running JS feature extractor on {maps_dir}…')
    result = subprocess.run(
        [node, str(JS_SCRIPT), '--maps', str(maps_dir)],
        capture_output=True, text=True, cwd=str(REPO_ROOT),
    )
    for line in result.stderr.strip().splitlines():
        logger.info(f'  [node] {line}')
    if result.returncode != 0:
        raise RuntimeError(f'JS script failed (exit {result.returncode})')

    records = json.loads(result.stdout)
    df = pd.DataFrame(records).fillna(0)
    logger.info(f'  JS features: {len(df)} maps × {len(df.columns)} columns')
    return df


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--maps', default='data/raw/maps')
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    maps_dir = Path(args.maps)

    # Compute features using the EXACT same pipeline as JS inference
    df = compute_js_features(maps_dir)
    df = df[df['category'] != 'Balanced'].copy()

    # Save the JS feature CSV for inspection / reuse
    js_csv = Path('data/processed/js_features.csv')
    df.to_csv(js_csv, index=False)
    logger.info(f'  Saved JS features → {js_csv}')

    exported = []
    exported.append(export_pattern_classifier(js_csv))

    logger.info(f"\n{'='*60}\nSummary\n{'='*60}")
    for p in exported:
        meta = json.loads((OUTPUT_DIR / (p.stem + '_meta.json')).read_text())
        logger.info(f"  {p.name:45s} {p.stat().st_size/1024:7.1f} KB  "
                    f"({meta['n_features']} features)")


if __name__ == '__main__':
    main()
