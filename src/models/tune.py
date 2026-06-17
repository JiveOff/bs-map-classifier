#!/usr/bin/env python3
"""
Hyperparameter tuning with Optuna.

Runs Bayesian optimisation over XGBoost, LightGBM, GradientBoosting, and
RandomForest on the merged feature set. Objective is 5-fold CV F1 (weighted).

Usage:
    python src/models/tune.py                          # all models, 150 trials each
    python src/models/tune.py --models xgboost lgbm   # subset
    python src/models/tune.py --trials 300             # more trials
"""

import argparse
import json
import logging
import warnings
from pathlib import Path

import joblib
import numpy as np
import optuna
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score, classification_report, f1_score
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler
from lightgbm import LGBMClassifier
from xgboost import XGBClassifier

optuna.logging.set_verbosity(optuna.logging.WARNING)
warnings.filterwarnings('ignore')
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DROP_COLS = ['category', 'map_id', 'key', 'map_name', 'hash',
             'upload_date', 'last_update_date', 'uploader_id', 'difficulty',
             'map_key', 'n_notes_parsed']

SEED    = 42
OUT_DIR = Path('models/tuned')


# ── Data loading ──────────────────────────────────────────────────────────────

def load_data(csv_path: Path):
    df = pd.read_csv(csv_path)
    df = df[df['category'] != 'Balanced'].copy()
    X  = df.drop(columns=[c for c in DROP_COLS if c in df.columns])
    X  = X.select_dtypes(include=[np.number])
    y  = df['category']

    le      = LabelEncoder()
    y_enc   = le.fit_transform(y)
    imputer = SimpleImputer(strategy='median')
    scaler  = StandardScaler()

    X_train, X_test, y_train, y_test = train_test_split(
        X, y_enc, test_size=0.2, random_state=SEED, stratify=y_enc)

    X_train_sc = pd.DataFrame(
        scaler.fit_transform(imputer.fit_transform(X_train)),
        columns=X.columns)
    X_test_sc  = pd.DataFrame(
        scaler.transform(imputer.transform(X_test)),
        columns=X.columns)

    return X_train_sc, X_test_sc, y_train, y_test, le, imputer, scaler, list(X.columns)


# ── eBPM-split sample weights (mirrors export_onnx.py) ───────────────────────

def make_weights(y_train: np.ndarray, X_train: np.ndarray,
                 le: LabelEncoder, feature_names: list) -> np.ndarray:
    """Balanced weights + eBPM-split boost for Extreme (Tech-side 4×, Speed-side 2.5×)."""
    from sklearn.utils.class_weight import compute_sample_weight
    w = compute_sample_weight('balanced', y_train).astype(float)
    ext_idx  = list(le.classes_).index('Extreme')
    ext_mask = y_train == ext_idx
    ebpm_col = feature_names.index('ebpm_left_mean')
    ebpm     = X_train[ext_mask, ebpm_col]
    idx      = np.where(ext_mask)[0]
    w[idx[ebpm <  0]] *= 4.0   # Tech-side Extreme (standardised eBPM below mean)
    w[idx[ebpm >= 0]] *= 2.5   # Speed-side Extreme
    return w


def _cv_f1_weighted(model_cls, params: dict, X: np.ndarray, y: np.ndarray,
                    le: LabelEncoder, feature_names: list) -> float:
    """5-fold CV with per-fold eBPM-split sample weights."""
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    scores = []
    for tr, te in cv.split(X, y):
        w = make_weights(y[tr], X[tr], le, feature_names)
        m = model_cls(**params)
        m.fit(X[tr], y[tr], sample_weight=w)
        scores.append(f1_score(y[te], m.predict(X[te]), average='weighted'))
    return float(np.mean(scores))


# ── Objective functions ───────────────────────────────────────────────────────

def objective_gb(trial, X, y, le, feature_names):
    """GradientBoosting — skl2onnx-exportable, with eBPM-split weights.
    Search space centred around current best: n_est=500, depth=4, lr=0.04."""
    params = {
        'n_estimators':      trial.suggest_int('n_estimators', 200, 1000),
        'max_depth':         trial.suggest_int('max_depth', 3, 6),
        'learning_rate':     trial.suggest_float('learning_rate', 0.01, 0.15, log=True),
        'subsample':         trial.suggest_float('subsample', 0.6, 1.0),
        'min_samples_split': trial.suggest_int('min_samples_split', 2, 20),
        'min_samples_leaf':  trial.suggest_int('min_samples_leaf', 1, 10),
        'max_features':      trial.suggest_categorical('max_features', ['sqrt', 'log2', None]),
        'ccp_alpha':         trial.suggest_float('ccp_alpha', 0.0, 0.005),
        'random_state': SEED,
    }
    return _cv_f1_weighted(GradientBoostingClassifier, params, X, y, le, feature_names)


OBJECTIVES = {
    'gradient_boosting': (objective_gb, GradientBoostingClassifier),
}


# ── Tuning runner ─────────────────────────────────────────────────────────────

def tune_model(name: str, X_train, X_test, y_train, y_test,
               le: LabelEncoder, feature_names: list, n_trials: int) -> dict:
    logger.info(f"\n{'='*60}\nTuning: {name}  ({n_trials} trials)\n{'='*60}")

    obj_fn, model_cls = OBJECTIVES[name]
    X_tr = X_train.values
    X_te = X_test.values

    study = optuna.create_study(
        direction='maximize',
        sampler=optuna.samplers.TPESampler(seed=SEED),
        pruner=optuna.pruners.MedianPruner(n_startup_trials=15, n_warmup_steps=5),
    )
    study.optimize(
        lambda t: obj_fn(t, X_tr, y_train, le, feature_names),
        n_trials=n_trials,
        show_progress_bar=True,
    )

    best_params = study.best_params
    best_cv_f1  = study.best_value
    logger.info(f"  Best CV F1:  {best_cv_f1:.4f}")
    logger.info(f"  Best params: {best_params}")

    # Retrain on full training set with eBPM-split weights + best params
    w = make_weights(y_train, X_tr, le, feature_names)
    model = model_cls(**{**best_params, 'random_state': SEED})
    model.fit(X_tr, y_train, sample_weight=w)

    # Evaluate on hold-out test set
    y_pred = model.predict(X_te)
    acc    = accuracy_score(y_test, y_pred)
    f1     = f1_score(y_test, y_pred, average='weighted')
    report = classification_report(
        le.inverse_transform(y_test),
        le.inverse_transform(y_pred),
        output_dict=True,
    )

    logger.info(f"  Test accuracy: {acc:.4f}  |  Test F1: {f1:.4f}")
    for cls in sorted(le.classes_):
        r = report.get(cls, {})
        logger.info(f"    {cls:<12} P={r.get('precision',0):.1%}  "
                    f"R={r.get('recall',0):.1%}  F1={r.get('f1-score',0):.1%}  "
                    f"n={int(r.get('support',0))}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, OUT_DIR / f'{name}.pkl')

    result = {
        'model':        name,
        'best_cv_f1':   best_cv_f1,
        'test_accuracy': acc,
        'test_f1':      f1,
        'best_params':  best_params,
        'classification_report': report,
        'n_trials':     n_trials,
    }
    (OUT_DIR / f'{name}_result.json').write_text(json.dumps(result, indent=2))
    return result


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--features', default='data/processed/js_features.csv')
    parser.add_argument('--models', nargs='+', default=['gradient_boosting'])
    parser.add_argument('--trials', type=int, default=200)
    args = parser.parse_args()

    logger.info(f"Loading features from {args.features}")
    X_train, X_test, y_train, y_test, le, imputer, scaler, cols = \
        load_data(Path(args.features))
    logger.info(f"Train: {len(X_train)}  Test: {len(X_test)}  Features: {len(cols)}")

    results = []
    for name in args.models:
        if name not in OBJECTIVES:
            logger.warning(f"Unknown model '{name}', skipping")
            continue
        r = tune_model(name, X_train, X_test, y_train, y_test, le, cols, args.trials)
        results.append(r)

    results.sort(key=lambda r: r['best_cv_f1'], reverse=True)
    logger.info(f"\n{'='*60}\nLeaderboard\n{'='*60}")
    for r in results:
        logger.info(f"  {r['model']:<22} CV F1={r['best_cv_f1']:.4f}  "
                    f"Test={r['test_accuracy']:.4f}  Test F1={r['test_f1']:.4f}")
    logger.info(f"\nBest params: {results[0]['best_params']}")


if __name__ == '__main__':
    main()
