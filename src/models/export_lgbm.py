#!/usr/bin/env python3
"""
Train LightGBM on pattern features and export for the browser extension.

Outputs:
  extension/lgbm_model.json     — tree structures (list of dicts)
  extension/classifier_meta.json — scaler params + feature names + classes

Usage:
    python src/models/export_lgbm.py
    python src/models/export_lgbm.py --features data/processed/pattern_features.csv
"""

import argparse
import json
import logging
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split, cross_val_score, StratifiedKFold
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, f1_score, classification_report
from lightgbm import LGBMClassifier

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DROP_COLS = ['category', 'map_id', 'key', 'map_name', 'hash',
             'upload_date', 'last_update_date', 'uploader_id', 'difficulty']

LGBM_PARAMS = {
    'n_estimators': 200,
    'max_depth': 6,
    'num_leaves': 31,
    'learning_rate': 0.08,
    'subsample': 0.8,
    'colsample_bytree': 0.8,
    'min_child_samples': 10,
    'reg_alpha': 0.1,
    'reg_lambda': 1.0,
    'class_weight': 'balanced',
    'random_state': 42,
    'n_jobs': -1,
    'verbose': -1,
}


def load_and_prepare(features_path: Path):
    df = pd.read_csv(features_path)
    logger.info(f"Loaded {len(df)} rows, {len(df.columns)} columns from {features_path}")

    df = df[df['category'] != 'Balanced'].copy()

    X = df.drop(columns=[c for c in DROP_COLS if c in df.columns])
    X = X.select_dtypes(include=[np.number])
    y = df['category']

    nan_cols = X.isna().sum()
    if (nan_cols > 0).any():
        logger.info(f"Imputing {(nan_cols > 0).sum()} columns with column median")

    logger.info(f"Features: {len(X.columns)}  |  Classes: {y.value_counts().to_dict()}")
    return X, y


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--features', default='data/processed/pattern_features.csv')
    parser.add_argument('--output_dir', default='extension')
    args = parser.parse_args()

    features_path = Path(args.features)
    output_dir    = Path(args.output_dir)

    if not features_path.exists():
        raise FileNotFoundError(f"Features file not found: {features_path}")

    X, y = load_and_prepare(features_path)
    feature_names = X.columns.tolist()

    le = LabelEncoder()
    y_enc = le.fit_transform(y)
    classes = le.classes_.tolist()
    logger.info(f"Classes (encoded order): {classes}")

    # Impute then scale — fit on full dataset for export (all data is training data here)
    imputer = SimpleImputer(strategy='median')
    X_imp = imputer.fit_transform(X)

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_imp)

    # Quick hold-out eval before final fit
    X_scaled_df = pd.DataFrame(X_scaled, columns=feature_names)
    X_tr, X_te, y_tr, y_te = train_test_split(
        X_scaled_df, y_enc, test_size=0.15, random_state=42, stratify=y_enc
    )
    model_eval = LGBMClassifier(**LGBM_PARAMS)
    model_eval.fit(X_tr, y_tr)
    y_pred = model_eval.predict(X_te)
    acc = accuracy_score(y_te, y_pred)
    f1  = f1_score(y_te, y_pred, average='weighted')
    logger.info(f"\nHold-out eval (85/15 split):")
    logger.info(f"  Accuracy: {acc:.4f}  |  F1 (weighted): {f1:.4f}")
    logger.info("\n" + classification_report(
        le.inverse_transform(y_te), le.inverse_transform(y_pred)
    ))

    # 5-fold CV
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_scores = cross_val_score(LGBMClassifier(**LGBM_PARAMS), X_scaled_df, y_enc,
                                cv=cv, scoring='f1_weighted')
    logger.info(f"5-fold CV F1: {[f'{s:.4f}' for s in cv_scores]}")
    logger.info(f"Mean CV F1:   {cv_scores.mean():.4f} ± {cv_scores.std():.4f}")

    # Final model: fit on ALL data for export
    logger.info("\nFitting final model on full dataset for export…")
    model_final = LGBMClassifier(**LGBM_PARAMS)
    model_final.fit(
        pd.DataFrame(X_scaled, columns=feature_names),
        y_enc
    )

    # ── Export lgbm_model.json ────────────────────────────────────────────
    tree_info = model_final.booster_.dump_model()['tree_info']
    model_path = output_dir / 'lgbm_model.json'
    with open(model_path, 'w') as f:
        json.dump(tree_info, f, separators=(',', ':'))
    logger.info(f"Saved {len(tree_info)} trees → {model_path}  ({model_path.stat().st_size/1024:.0f} KB)")

    # ── Export classifier_meta.json ───────────────────────────────────────
    meta = {
        'mean':      scaler.mean_.tolist(),
        'scale':     scaler.scale_.tolist(),
        'features':  feature_names,
        'classes':   classes,
        'num_class': len(classes),
        'num_tree_per_iter': len(classes),
        'eval': {
            'holdout_accuracy': round(acc, 4),
            'holdout_f1':       round(float(f1), 4),
            'cv_f1_mean':       round(float(cv_scores.mean()), 4),
            'cv_f1_std':        round(float(cv_scores.std()), 4),
            'n_samples':        len(X),
            'n_features':       len(feature_names),
        }
    }
    meta_path = output_dir / 'classifier_meta.json'
    with open(meta_path, 'w') as f:
        json.dump(meta, f)
    logger.info(f"Saved classifier meta → {meta_path}")
    logger.info(f"\nDone. Features: {len(feature_names)}  |  Classes: {classes}")


if __name__ == '__main__':
    main()
