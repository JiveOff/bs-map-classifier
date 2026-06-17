#!/usr/bin/env python3
"""
Baseline Models for Beat Saber Map Classification

Usage:
    python src/models/baseline.py --features data/processed/features_merged.csv --output models/baseline_models --cross_validate
    python src/models/baseline.py --features data/processed/features.csv --output models/baseline_models --cross_validate
"""

import argparse
import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional
import numpy as np
import pandas as pd
import joblib as _joblib
from joblib import Parallel, delayed
from sklearn.model_selection import train_test_split, cross_val_score, StratifiedKFold
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    classification_report, confusion_matrix
)
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.tree import DecisionTreeClassifier
from sklearn.svm import SVC
from sklearn.neighbors import KNeighborsClassifier
from xgboost import XGBClassifier
from lightgbm import LGBMClassifier
import joblib

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class BaselineModels:
    MODEL_CONFIGS = {
        'logistic_regression': {
            'class': LogisticRegression,
            'params': {
                'solver': 'lbfgs',
                'max_iter': 2000,
                'C': 0.5,
                'random_state': 42
            },
            'needs_scaling': True,
        },
        'random_forest': {
            'class': RandomForestClassifier,
            'params': {
                'n_estimators': 500,
                'max_depth': None,
                'min_samples_split': 3,
                'min_samples_leaf': 1,
                'max_features': 'sqrt',
                'class_weight': 'balanced',
                'random_state': 42,
                'n_jobs': -1
            },
            'needs_scaling': False,
        },
        'xgboost': {
            'class': XGBClassifier,
            'params': {
                'n_estimators': 500,
                'max_depth': 5,
                'learning_rate': 0.05,
                'subsample': 0.8,
                'colsample_bytree': 0.8,
                'min_child_weight': 2,
                'gamma': 0.1,
                'reg_alpha': 0.1,
                'reg_lambda': 1.0,
                'random_state': 42,
                'n_jobs': -1,
                'eval_metric': 'mlogloss',
                'verbosity': 0,
            },
            'needs_scaling': False,
        },
        'lightgbm': {
            'class': LGBMClassifier,
            'params': {
                'n_estimators': 500,
                'max_depth': 6,
                'num_leaves': 31,
                'learning_rate': 0.05,
                'subsample': 0.8,
                'colsample_bytree': 0.8,
                'min_child_samples': 10,
                'reg_alpha': 0.1,
                'reg_lambda': 1.0,
                'class_weight': 'balanced',
                'random_state': 42,
                'n_jobs': -1,
                'verbose': -1,
            },
            'needs_scaling': False,
        },
        'gradient_boosting': {
            'class': GradientBoostingClassifier,
            'params': {
                'n_estimators': 100,
                'max_depth': 4,
                'learning_rate': 0.05,
                'subsample': 0.8,
                'min_samples_split': 5,
                'random_state': 42,
            },
            'needs_scaling': False,
        },
        'svm': {
            'class': SVC,
            'params': {
                'kernel': 'rbf',
                'C': 10.0,
                'gamma': 'scale',
                'class_weight': 'balanced',
                'random_state': 42,
                'probability': True
            },
            'needs_scaling': True,
        },
        'knn': {
            'class': KNeighborsClassifier,
            'params': {
                'n_neighbors': 7,
                'weights': 'distance',
                'metric': 'euclidean',
                'n_jobs': -1
            },
            'needs_scaling': True,
        },
        'decision_tree': {
            'class': DecisionTreeClassifier,
            'params': {
                'max_depth': 12,
                'min_samples_split': 4,
                'min_samples_leaf': 2,
                'class_weight': 'balanced',
                'random_state': 42
            },
            'needs_scaling': False,
        },
    }

    def __init__(self, random_state: int = 42):
        self.random_state = random_state
        self.label_encoder = LabelEncoder()
        self.models = {}
        self.results = {}

    def load_features(self, features_path: Path) -> pd.DataFrame:
        logger.info(f"Loading features from: {features_path}")
        df = pd.read_csv(features_path)
        logger.info(f"Loaded {len(df)} samples with {len(df.columns)} columns")
        return df

    def preprocess_data(self, df: pd.DataFrame, test_size: float = 0.2) -> Dict[str, Any]:
        if 'category' not in df.columns:
            raise ValueError("No 'category' column found in features")

        df = df[df['category'] != 'Balanced'].copy()

        drop_cols = ['category', 'map_id', 'key', 'map_name', 'hash',
                     'upload_date', 'last_update_date', 'uploader_id', 'difficulty']
        X = df.drop(columns=[c for c in drop_cols if c in df.columns])
        X = X.select_dtypes(include=[np.number])
        y = df['category']

        nan_counts = X.isna().sum()
        cols_with_nan = nan_counts[nan_counts > 0]
        if len(cols_with_nan):
            logger.info(f"NaN columns ({len(cols_with_nan)}): imputing with column median")

        logger.info(f"Using {len(X.columns)} numeric features")
        logger.info(f"Class distribution:\n{y.value_counts().to_string()}")

        y_encoded = self.label_encoder.fit_transform(y)

        X_train, X_test, y_train, y_test = train_test_split(
            X, y_encoded,
            test_size=test_size,
            random_state=self.random_state,
            stratify=y_encoded
        )

        # Imputer fitted on train only
        imputer = SimpleImputer(strategy='median')
        X_train_imp = pd.DataFrame(imputer.fit_transform(X_train), columns=X_train.columns)
        X_test_imp = pd.DataFrame(imputer.transform(X_test), columns=X_test.columns)

        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train_imp)
        X_test_scaled = scaler.transform(X_test_imp)

        return {
            'X_train_raw': X_train_imp,
            'X_test_raw': X_test_imp,
            'X_train_scaled': X_train_scaled,
            'X_test_scaled': X_test_scaled,
            'y_train': y_train,
            'y_test': y_test,
            'feature_names': X.columns.tolist(),
            'label_encoder': self.label_encoder,
        }

    def train_model(self, model_name: str, X_train: np.ndarray, y_train: np.ndarray):
        config = self.MODEL_CONFIGS[model_name]
        params = config['params'].copy()
        try:
            model = config['class'](**params)
            model.fit(X_train, y_train)
            return model
        except Exception as e:
            logger.error(f"  Failed to train {model_name}: {e}")
            return None

    def evaluate_model(self, model, X_test: np.ndarray, y_test: np.ndarray,
                       label_encoder) -> Dict[str, Any]:
        y_pred = model.predict(X_test)
        accuracy  = accuracy_score(y_test, y_pred)
        precision = precision_score(y_test, y_pred, average='weighted', zero_division=0)
        recall    = recall_score(y_test, y_pred, average='weighted', zero_division=0)
        f1        = f1_score(y_test, y_pred, average='weighted', zero_division=0)

        y_test_labels = label_encoder.inverse_transform(y_test)
        y_pred_labels = label_encoder.inverse_transform(y_pred)
        report = classification_report(y_test_labels, y_pred_labels, output_dict=True)
        cm = confusion_matrix(y_test, y_pred)

        return {
            'accuracy': accuracy,
            'precision': precision,
            'recall': recall,
            'f1': f1,
            'classification_report': report,
            'confusion_matrix': cm.tolist(),
        }

    def _train_one(self, model_name: str, config: dict, data: Dict[str, Any]):
        if config['needs_scaling']:
            X_tr, X_te = data['X_train_scaled'], data['X_test_scaled']
        else:
            X_tr, X_te = data['X_train_raw'], data['X_test_raw']
        model = self.train_model(model_name, X_tr, data['y_train'])
        if model is None:
            return model_name, None, None
        metrics = self.evaluate_model(model, X_te, data['y_test'], data['label_encoder'])
        return model_name, model, metrics

    def train_and_evaluate_all(self, data: Dict[str, Any], output_dir: Path) -> None:
        output_dir.mkdir(parents=True, exist_ok=True)

        # Run all models in parallel; each model that uses n_jobs=-1 gets its own
        # threads, while GB/LR/DT/SVM (single-threaded) fill remaining cores.
        task_results = Parallel(n_jobs=-1, prefer='threads')(
            delayed(self._train_one)(name, cfg, data)
            for name, cfg in self.MODEL_CONFIGS.items()
        )

        for model_name, model, metrics in sorted(task_results, key=lambda r: r[0]):
            logger.info(f"\n{'='*60}\nModel: {model_name}\n{'='*60}")
            if model is None:
                continue

            self.models[model_name] = model
            self.results[model_name] = metrics

            logger.info(f"  Accuracy:  {metrics['accuracy']:.4f}")
            logger.info(f"  Precision: {metrics['precision']:.4f}")
            logger.info(f"  Recall:    {metrics['recall']:.4f}")
            logger.info(f"  F1:        {metrics['f1']:.4f}")

            _joblib.dump(model, output_dir / f"{model_name}.pkl")

            metrics_out = {k: v for k, v in metrics.items() if k != 'confusion_matrix'}
            metrics_out['confusion_matrix'] = metrics['confusion_matrix']
            with open(output_dir / f"{model_name}_metrics.json", 'w') as f:
                json.dump(metrics_out, f, indent=2)

    def get_best_model(self) -> Optional[str]:
        if not self.results:
            return None
        return max(self.results, key=lambda m: self.results[m]['f1'])

    def cross_validate_model(self, model_name: str, data: Dict[str, Any], n_folds: int = 5) -> Dict[str, Any]:
        config = self.MODEL_CONFIGS[model_name]
        if config['needs_scaling']:
            X = data['X_train_scaled']
        else:
            X = data['X_train_raw']
        y = data['y_train']

        model = config['class'](**config['params'].copy())
        cv = StratifiedKFold(n_splits=n_folds, shuffle=True, random_state=self.random_state)
        cv_scores = cross_val_score(model, X, y, cv=cv, scoring='f1_weighted')

        return {
            'model': model_name,
            'cv_f1_scores': cv_scores.tolist(),
            'mean_f1': float(cv_scores.mean()),
            'std_f1': float(cv_scores.std()),
        }

    def print_summary(self) -> None:
        if not self.results:
            return
        logger.info(f"\n{'='*60}")
        logger.info(f"{'SUMMARY':^60}")
        logger.info(f"{'='*60}")
        logger.info(f"{'Model':<25} {'Accuracy':>9} {'F1':>9}")
        logger.info(f"{'-'*45}")
        sorted_models = sorted(self.results.items(), key=lambda x: x[1]['f1'], reverse=True)
        for model_name, metrics in sorted_models:
            marker = '  ← best' if model_name == self.get_best_model() else ''
            logger.info(f"{model_name:<25} {metrics['accuracy']:>8.2%} {metrics['f1']:>8.2%}{marker}")


def main():
    parser = argparse.ArgumentParser(description='Train and evaluate baseline ML models')
    parser.add_argument('--features', type=str, default='data/processed/pattern_features_merged.csv')
    parser.add_argument('--output', type=str, default='models/baseline_models')
    parser.add_argument('--test_size', type=float, default=0.2)
    parser.add_argument('--random_state', type=int, default=42)
    parser.add_argument('--cross_validate', action='store_true')
    parser.add_argument('--verbose', action='store_true')
    args = parser.parse_args()

    if args.verbose:
        logger.setLevel(logging.DEBUG)

    features_path = Path(args.features)
    output_dir = Path(args.output)

    if not features_path.exists():
        logger.error(f"Features file not found: {features_path}")
        return 1

    baseline = BaselineModels(random_state=args.random_state)
    df = baseline.load_features(features_path)
    data = baseline.preprocess_data(df, test_size=args.test_size)
    baseline.train_and_evaluate_all(data, output_dir)
    baseline.print_summary()

    best_model = baseline.get_best_model()
    if args.cross_validate and best_model:
        logger.info(f"\nCross-validating best model: {best_model}")
        cv_results = baseline.cross_validate_model(best_model, data, n_folds=5)
        logger.info(f"CV F1 scores: {[f'{s:.4f}' for s in cv_results['cv_f1_scores']]}")
        logger.info(f"Mean CV F1:   {cv_results['mean_f1']:.4f} ± {cv_results['std_f1']:.4f}")
        with open(output_dir / f"{best_model}_cv_results.json", 'w') as f:
            json.dump(cv_results, f, indent=2)

    return 0


if __name__ == '__main__':
    import sys
    sys.exit(main())
