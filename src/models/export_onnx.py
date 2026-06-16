#!/usr/bin/env python3
"""
Export trained models to ONNX format for external use.

Three exports, all via skl2onnx (pure sklearn models only — XGBoost/LightGBM
have no reliable skl2onnx converter at this time):

  gradient_boosting.onnx   — best overall (84.2%), 191 merged features
                             Python users who have metadata + pattern features
  random_forest.onnx       — fast alternative (82.1%), 191 merged features
  pattern_classifier.onnx  — NPM/browser target, 130 pattern-only features
                             No external API calls needed; trained fresh here

Each ONNX file ships with a *_meta.json containing preprocessing params
(imputer medians, scaler mean/scale, feature names, class order) so any
runtime can reproduce the sklearn pipeline without sklearn itself.

Usage:
    python src/models/export_onnx.py
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
import onnxruntime as rt

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

OUTPUT_DIR = Path('models/onnx')

DROP_COLS = ['category', 'map_id', 'key', 'map_name', 'hash',
             'upload_date', 'last_update_date', 'uploader_id', 'difficulty',
             'map_key']

# Hyperparameters for the fresh pattern-only GradientBoosting
PATTERN_GB_PARAMS = {
    'n_estimators': 300,
    'max_depth': 4,
    'learning_rate': 0.05,
    'subsample': 0.8,
    'min_samples_split': 5,
    'random_state': 42,
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


def export_pattern_classifier(features_csv: Path) -> Path:
    """Train a fresh GradientBoosting on pattern-only features and export.

    This is the model for the NPM/browser package. It only needs features
    computable from the map zip file — no BeatSaver metadata API required.
    GradientBoosting is used because skl2onnx has full native support for it.
    """
    logger.info(f"\n{'='*60}\nExporting pattern_classifier (GradientBoosting, train fresh)\n{'='*60}")

    X, y  = _load_features(features_csv)
    X_sc, y_enc, le, imputer, scaler = _fit_pipeline(X, y)
    feature_names = list(X.columns)
    n = len(feature_names)
    logger.info(f"  Features: {n}  |  Classes: {list(le.classes_)}")
    logger.info(f"  Training on {len(X_sc)} samples…")

    model = GradientBoostingClassifier(**PATTERN_GB_PARAMS)
    model.fit(X_sc, y_enc)

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    scores = cross_val_score(
        GradientBoostingClassifier(**PATTERN_GB_PARAMS),
        X_sc, y_enc, cv=cv, scoring='f1_weighted',
    )
    logger.info(f"  5-fold CV F1: {scores.mean():.4f} ± {scores.std():.4f}")

    onnx_bytes = _to_onnx(model, n)
    _verify(model, onnx_bytes, X_sc.values[:50])
    return _save('pattern_classifier', onnx_bytes, feature_names, le, imputer, scaler)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    merged  = Path('data/processed/features_merged.csv')
    pattern = Path('data/processed/pattern_features.csv')

    exported = []

    tuned = Path('models/tuned')

    # gradient_boosting: tuned (87.40% CV F1), 263 merged features
    exported.append(export_from_pkl('gradient_boosting', merged, pkl_dir=tuned))

    # random_forest: tuned winner (88.54% CV F1), 263 merged features
    exported.append(export_from_pkl('random_forest', merged, pkl_dir=tuned))

    # pattern_classifier: NPM/browser target (pattern features only, no metadata)
    exported.append(export_pattern_classifier(pattern))

    logger.info(f"\n{'='*60}\nSummary\n{'='*60}")
    for p in exported:
        meta = json.loads((OUTPUT_DIR / (p.stem + '_meta.json')).read_text())
        logger.info(f"  {p.name:45s} {p.stat().st_size/1024:7.1f} KB  "
                    f"({meta['n_features']} features)")


if __name__ == '__main__':
    main()
