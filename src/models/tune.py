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
             'upload_date', 'last_update_date', 'uploader_id', 'difficulty', 'map_key']

CV      = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
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


# ── Objective functions ───────────────────────────────────────────────────────

def _cv_f1(model, X, y) -> float:
    scores = cross_val_score(model, X, y, cv=CV, scoring='f1_weighted', n_jobs=-1)
    return float(scores.mean())


def objective_xgboost(trial, X, y):
    params = {
        'n_estimators':      trial.suggest_int('n_estimators', 100, 800),
        'max_depth':         trial.suggest_int('max_depth', 3, 8),
        'learning_rate':     trial.suggest_float('learning_rate', 0.01, 0.3, log=True),
        'subsample':         trial.suggest_float('subsample', 0.5, 1.0),
        'colsample_bytree':  trial.suggest_float('colsample_bytree', 0.4, 1.0),
        'min_child_weight':  trial.suggest_int('min_child_weight', 1, 10),
        'gamma':             trial.suggest_float('gamma', 0.0, 1.0),
        'reg_alpha':         trial.suggest_float('reg_alpha', 0.0, 2.0),
        'reg_lambda':        trial.suggest_float('reg_lambda', 0.0, 2.0),
        'random_state': SEED, 'n_jobs': -1, 'eval_metric': 'mlogloss', 'verbosity': 0,
    }
    return _cv_f1(XGBClassifier(**params), X, y)


def objective_lgbm(trial, X, y):
    params = {
        'n_estimators':      trial.suggest_int('n_estimators', 100, 800),
        'max_depth':         trial.suggest_int('max_depth', 3, 8),
        'num_leaves':        trial.suggest_int('num_leaves', 15, 127),
        'learning_rate':     trial.suggest_float('learning_rate', 0.01, 0.3, log=True),
        'subsample':         trial.suggest_float('subsample', 0.5, 1.0),
        'colsample_bytree':  trial.suggest_float('colsample_bytree', 0.4, 1.0),
        'min_child_samples': trial.suggest_int('min_child_samples', 5, 50),
        'reg_alpha':         trial.suggest_float('reg_alpha', 0.0, 2.0),
        'reg_lambda':        trial.suggest_float('reg_lambda', 0.0, 2.0),
        'class_weight': 'balanced',
        'random_state': SEED, 'n_jobs': -1, 'verbose': -1,
    }
    return _cv_f1(LGBMClassifier(**params), X, y)


def objective_gb(trial, X, y):
    params = {
        'n_estimators':    trial.suggest_int('n_estimators', 100, 600),
        'max_depth':       trial.suggest_int('max_depth', 2, 6),
        'learning_rate':   trial.suggest_float('learning_rate', 0.01, 0.2, log=True),
        'subsample':       trial.suggest_float('subsample', 0.5, 1.0),
        'min_samples_split': trial.suggest_int('min_samples_split', 2, 30),
        'min_samples_leaf':  trial.suggest_int('min_samples_leaf', 1, 15),
        'max_features':    trial.suggest_categorical('max_features', ['sqrt', 'log2', None]),
        'random_state': SEED,
    }
    return _cv_f1(GradientBoostingClassifier(**params), X, y)


def objective_rf(trial, X, y):
    params = {
        'n_estimators':    trial.suggest_int('n_estimators', 100, 800),
        'max_depth':       trial.suggest_categorical('max_depth', [None, 10, 15, 20, 30]),
        'min_samples_split': trial.suggest_int('min_samples_split', 2, 20),
        'min_samples_leaf':  trial.suggest_int('min_samples_leaf', 1, 10),
        'max_features':    trial.suggest_categorical('max_features', ['sqrt', 'log2']),
        'class_weight': 'balanced',
        'random_state': SEED, 'n_jobs': -1,
    }
    return _cv_f1(RandomForestClassifier(**params), X, y)


OBJECTIVES = {
    'xgboost':          (objective_xgboost,          XGBClassifier),
    'lgbm':             (objective_lgbm,              LGBMClassifier),
    'gradient_boosting': (objective_gb,               GradientBoostingClassifier),
    'random_forest':    (objective_rf,                RandomForestClassifier),
}


# ── Tuning runner ─────────────────────────────────────────────────────────────

def tune_model(name: str, X_train, X_test, y_train, y_test,
               le: LabelEncoder, n_trials: int) -> dict:
    logger.info(f"\n{'='*60}\nTuning: {name}  ({n_trials} trials)\n{'='*60}")

    obj_fn, model_cls = OBJECTIVES[name]

    study = optuna.create_study(
        direction='maximize',
        sampler=optuna.samplers.TPESampler(seed=SEED),
        pruner=optuna.pruners.MedianPruner(n_startup_trials=10, n_warmup_steps=5),
    )
    study.optimize(
        lambda t: obj_fn(t, X_train, y_train),
        n_trials=n_trials,
        show_progress_bar=True,
    )

    best_params = study.best_params
    best_cv_f1  = study.best_value
    logger.info(f"  Best CV F1:  {best_cv_f1:.4f}")
    logger.info(f"  Best params: {best_params}")

    # Retrain on full training set with best params
    extra = {}
    if name == 'xgboost':
        extra = {'random_state': SEED, 'n_jobs': -1, 'eval_metric': 'mlogloss', 'verbosity': 0}
    elif name == 'lgbm':
        extra = {'class_weight': 'balanced', 'random_state': SEED, 'n_jobs': -1, 'verbose': -1}
    elif name == 'gradient_boosting':
        extra = {'random_state': SEED}
    elif name == 'random_forest':
        extra = {'class_weight': 'balanced', 'random_state': SEED, 'n_jobs': -1}

    model = model_cls(**{**best_params, **extra})
    model.fit(X_train, y_train)

    # Evaluate on hold-out test set
    y_pred  = model.predict(X_test)
    acc     = accuracy_score(y_test, y_pred)
    f1      = f1_score(y_test, y_pred, average='weighted')
    report  = classification_report(
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

    # Save model and results
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
    parser.add_argument('--features', default='data/processed/features_merged.csv')
    parser.add_argument('--models', nargs='+',
                        default=['xgboost', 'lgbm', 'gradient_boosting', 'random_forest'])
    parser.add_argument('--trials', type=int, default=150)
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
        r = tune_model(name, X_train, X_test, y_train, y_test, le, args.trials)
        results.append(r)

    # Final leaderboard
    results.sort(key=lambda r: r['best_cv_f1'], reverse=True)
    logger.info(f"\n{'='*60}\nLeaderboard (ranked by CV F1)\n{'='*60}")
    logger.info(f"{'Model':<22} {'CV F1':>9} {'Test Acc':>10} {'Test F1':>9}")
    logger.info('-' * 54)
    for r in results:
        logger.info(f"{r['model']:<22} {r['best_cv_f1']:>9.4f} "
                    f"{r['test_accuracy']:>10.4f} {r['test_f1']:>9.4f}")

    best = results[0]
    logger.info(f"\nWinner: {best['model']}  CV F1={best['best_cv_f1']:.4f}  "
                f"Test={best['test_accuracy']:.4f}")


if __name__ == '__main__':
    main()
