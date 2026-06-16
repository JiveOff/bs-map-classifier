#!/usr/bin/env python3
"""
Feature Extraction for Beat Saber Map Classification

Usage:
    python features_v2.py --csv dataset_wc_pooling.csv --output data/processed/features.csv
    python features_v2.py --csv dataset_wc_pooling.csv --output data/processed/features.csv --analyze
    python features_v2.py --csv dataset_wc_pooling.csv --output data/processed/features.csv --test
"""

import argparse
import ast
import json
import logging
from pathlib import Path
from typing import Dict, Optional, Any
import numpy as np
import pandas as pd

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

EXCLUDED_CATEGORIES = {'Balanced'}


class FeatureExtractor:
    """Extracts features from Beat Saber map data."""

    def load_csv(self, csv_path: Path) -> pd.DataFrame:
        df = pd.read_csv(csv_path)
        before = len(df)
        df = df[~df['category_name'].isin(EXCLUDED_CATEGORIES)]
        dropped = before - len(df)
        if dropped:
            logger.info(f"Dropped {dropped} rows with excluded categories: {EXCLUDED_CATEGORIES}")
        return df

    def parse_json_metadata(self, json_str: str) -> Dict:
        if not json_str or not isinstance(json_str, str):
            return {}
        try:
            return json.loads(json_str)
        except json.JSONDecodeError:
            try:
                cleaned = json_str
                if cleaned.startswith('"') and cleaned.endswith('"'):
                    cleaned = cleaned[1:-1]
                cleaned = cleaned.replace('\\"', '"').replace('\\\\', '\\').replace('\\n', '\n')
                return json.loads(cleaned)
            except json.JSONDecodeError:
                try:
                    return ast.literal_eval(json_str)
                except Exception:
                    return {}

    def extract_features_from_row(self, row: pd.Series) -> Dict[str, Any]:
        features = {}

        features['map_id'] = str(row.get('map_id', ''))
        features['key'] = str(row.get('key', ''))
        features['map_name'] = str(row.get('songName', ''))
        features['category'] = str(row.get('category_name', 'Unknown')).strip()
        features['difficulty'] = str(row.get('difficulty', 'Unknown')).strip()

        features['bpm'] = self.safe_float(row.get('bpm', 0))
        features['max_score'] = self.safe_int(row.get('maxScore', 0))
        features['nps'] = self.safe_float(row.get('nps', 0))
        features['note_count'] = self.safe_int(row.get('length', 0))

        features['hash'] = str(row.get('hash', ''))
        features['upload_date'] = str(row.get('mapCreationDate', ''))
        features['last_update_date'] = str(row.get('mapUploadDate', ''))
        features['uploader_id'] = str(row.get('pooled_map_id', ''))

        features['is_public'] = str(row.get('is_public', '')).lower() == 'true'
        features['is_retired'] = str(row.get('is_retired', '')).lower() == 'true'

        json_data = self.parse_json_metadata(row.get('analysisMetadata', ''))
        features.update(self.extract_json_features(json_data))
        features.update(self.calculate_derived_features(features))

        return features

    def extract_json_features(self, json_data: Dict) -> Dict[str, Any]:
        features = {}
        if not json_data:
            return features

        bsmap = json_data.get('bsmap', {})
        if bsmap:
            features.update(self._extract_bsmap_features(bsmap))

        parity = json_data.get('beatSaverParity', {})
        if parity:
            features['parity_warns'] = self.safe_int(parity.get('warns', 0))
            features['parity_errors'] = self.safe_int(parity.get('errors', 0))
            features['parity_resets'] = self.safe_int(parity.get('resets', 0))

        return features

    def _extract_bsmap_features(self, bsmap: Dict) -> Dict[str, Any]:
        features = {}

        nps_data = bsmap.get('nps', {})
        if nps_data:
            features['nps_mapped'] = self.safe_float(nps_data.get('mapped', 0))
            peak = nps_data.get('peak', {})
            if peak:
                features['nps_peak_4'] = self.safe_float(peak.get('4', 0))
                features['nps_peak_8'] = self.safe_float(peak.get('8', 0))
                features['nps_peak_16'] = self.safe_float(peak.get('16', 0))

        sps_data = bsmap.get('sps', {})
        if sps_data:
            for color in ('red', 'blue', 'total'):
                sps = sps_data.get(color, {})
                if sps:
                    for stat in ('peak', 'total', 'median', 'average'):
                        features[f'sps_{color}_{stat}'] = self.safe_float(sps.get(stat, 0))

        note_count = bsmap.get('noteCount', {})
        if note_count:
            for group in ('total', 'red', 'blue'):
                g = note_count.get(group, {})
                if g:
                    for field in ('notes', 'arcs', 'chains', 'bombs'):
                        val = g.get(field)
                        if val is not None:
                            features[f'json_{group}_{field}'] = self.safe_int(val)

        obstacles = bsmap.get('obstacles', {})
        if obstacles:
            features['json_obstacle_total'] = self.safe_int(obstacles.get('total', 0))
            features['json_obstacle_chroma'] = self.safe_int(obstacles.get('chroma', 0))
            features['json_obstacle_interactive'] = self.safe_int(obstacles.get('interactive', 0))
            features['json_obstacle_noodle'] = self.safe_int(obstacles.get('noodleExtensions', 0))
            features['json_obstacle_mapping_ext'] = self.safe_int(obstacles.get('mappingExtensions', 0))

        map_settings = bsmap.get('mapSettings', {})
        if map_settings:
            features['njs'] = self.safe_float(map_settings.get('njs', 0))
            features['njs_offset'] = self.safe_float(map_settings.get('njsOffset', 0))
            features['jump_distance'] = self.safe_float(map_settings.get('jumpDistance', 0))
            features['reaction_time'] = self.safe_float(map_settings.get('reactionTime', 0))
            features['half_jump_distance'] = self.safe_float(map_settings.get('halfJumpDistance', 0))

        note_info = bsmap.get('noteInformation', {})
        if note_info:
            features['ebpm'] = self.safe_float(note_info.get('ebpm', 0))
            features['rb_ratio'] = self.safe_float(note_info.get('rbRatio', 0))
            features['json_max_score'] = self.safe_int(note_info.get('maxScore', 0))
            features['ebpm_swing'] = self.safe_float(note_info.get('ebpmSwing', 0))
            slider_speed = note_info.get('sliderSpeed', {})
            if slider_speed:
                if slider_speed.get('max') is not None:
                    features['slider_speed_max'] = self.safe_float(slider_speed['max'])
                if slider_speed.get('min') is not None:
                    features['slider_speed_min'] = self.safe_float(slider_speed['min'])

        return features

    def calculate_derived_features(self, features: Dict) -> Dict[str, Any]:
        derived = {}

        total_notes = features.get('json_total_notes', features.get('note_count', 0))
        total_bombs = features.get('json_total_bombs', 0)
        total_obstacles = features.get('json_obstacle_total', 0)

        derived['bomb_per_note'] = total_bombs / total_notes if total_notes > 0 else 0
        derived['obstacle_per_note'] = total_obstacles / total_notes if total_notes > 0 else 0

        red_notes = features.get('json_red_notes', 0)
        blue_notes = features.get('json_blue_notes', 0)
        total_hand = red_notes + blue_notes
        if total_hand > 0:
            derived['red_blue_balance'] = red_notes / total_hand
            derived['note_imbalance'] = abs(red_notes - blue_notes) / total_hand
        else:
            derived['red_blue_balance'] = 0.5
            derived['note_imbalance'] = 0

        sps_red = features.get('sps_red_total', 0)
        sps_blue = features.get('sps_blue_total', 0)
        sps_total = features.get('sps_total_total', 0)
        if sps_total > 0:
            derived['sps_red_ratio'] = sps_red / sps_total
            derived['sps_blue_ratio'] = sps_blue / sps_total
        else:
            derived['sps_red_ratio'] = 0.5
            derived['sps_blue_ratio'] = 0.5

        nps_peak_16 = features.get('nps_peak_16', 0)
        if nps_peak_16 > 0:
            derived['peak_nps_4_to_16_ratio'] = features.get('nps_peak_4', 0) / nps_peak_16
            derived['peak_nps_8_to_16_ratio'] = features.get('nps_peak_8', 0) / nps_peak_16
        else:
            derived['peak_nps_4_to_16_ratio'] = 0
            derived['peak_nps_8_to_16_ratio'] = 0

        derived['complexity_indicator'] = (
            features.get('nps_mapped', 0) * 0.3 +
            total_obstacles * 0.2 +
            total_bombs * 0.1 +
            features.get('parity_resets', 0) * 0.4
        )
        derived['speed_indicator'] = (
            features.get('nps_peak_16', 0) * 0.5 +
            features.get('nps_mapped', 0) * 0.3 +
            features.get('ebpm', features.get('bpm', 0)) * 0.2
        )
        derived['tech_indicator'] = (
            features.get('parity_resets', 0) * 0.4 +
            total_obstacles * 0.3 +
            total_bombs * 0.2 +
            derived.get('note_imbalance', 0) * 0.1
        )
        rb_ratio = features.get('rb_ratio', 0)
        derived['accuracy_indicator'] = (
            rb_ratio * 0.4 +
            (1 - derived.get('bomb_per_note', 0)) * 0.3 +
            (1 - derived.get('obstacle_per_note', 0)) * 0.3
        )

        return derived

    def safe_float(self, value: Any, default: float = 0.0) -> float:
        if value is None:
            return default
        try:
            return float(value)
        except (ValueError, TypeError):
            return default

    def safe_int(self, value: Any, default: int = 0) -> int:
        if value is None:
            return default
        try:
            return int(float(value))
        except (ValueError, TypeError):
            return default


def process_csv(csv_path: Path, output_path: Path, test: bool = False) -> pd.DataFrame:
    extractor = FeatureExtractor()
    df = extractor.load_csv(csv_path)

    if test:
        df = df.head(100)
        logger.info("Running in test mode (first 100 rows)")

    logger.info(f"Processing {len(df)} maps...")

    features_list = []
    errors = 0

    for i, (_, row) in enumerate(df.iterrows()):
        try:
            features_list.append(extractor.extract_features_from_row(row))
            if (i + 1) % 100 == 0:
                logger.info(f"Processed {i + 1}/{len(df)} maps")
        except Exception as e:
            errors += 1
            logger.warning(f"Error processing row {i}: {e}")

    features_df = pd.DataFrame(features_list)
    features_df.to_csv(output_path, index=False)
    logger.info(f"Saved {len(features_df)} feature vectors to {output_path}")

    if errors:
        logger.warning(f"Encountered {errors} errors during processing")

    return features_df


def analyze_feature_distribution(features_df: pd.DataFrame, output_dir: Path):
    logger.info("Analyzing feature distributions...")
    output_dir.mkdir(parents=True, exist_ok=True)

    if 'category' in features_df.columns:
        category_counts = features_df['category'].value_counts()
        logger.info("\nCategory Distribution:")
        for cat, count in category_counts.items():
            logger.info(f"  {cat}: {count} ({count/len(features_df)*100:.1f}%)")
        category_counts.to_csv(output_dir / 'category_distribution.csv')

    numeric_features = features_df.select_dtypes(include=[np.number]).columns.tolist()

    if 'category' in features_df.columns:
        stats_by_category = {}
        for cat in features_df['category'].unique():
            cat_df = features_df[features_df['category'] == cat]
            stats_by_category[cat] = {}
            for feature in numeric_features:
                try:
                    stats_by_category[cat][feature] = {
                        'mean': float(cat_df[feature].mean()),
                        'std': float(cat_df[feature].std()),
                        'min': float(cat_df[feature].min()),
                        'max': float(cat_df[feature].max()),
                        'count': int(len(cat_df))
                    }
                except Exception:
                    pass

        with open(output_dir / 'feature_stats_by_category.json', 'w') as f:
            json.dump(stats_by_category, f, indent=2)

    logger.info(f"Analysis saved to {output_dir}")


def main():
    parser = argparse.ArgumentParser(description='Extract features from Beat Saber map dataset')
    parser.add_argument('--csv', type=str, default='dataset_wc_pooling.csv')
    parser.add_argument('--output', type=str, default='data/processed/features.csv')
    parser.add_argument('--test', action='store_true', help='Process first 100 rows only')
    parser.add_argument('--analyze', action='store_true', help='Generate feature distribution analysis')
    parser.add_argument('--verbose', action='store_true')
    args = parser.parse_args()

    if args.verbose:
        logger.setLevel(logging.DEBUG)

    csv_path = Path(args.csv)
    output_path = Path(args.output)

    if not csv_path.exists():
        logger.error(f"CSV file not found: {csv_path}")
        return 1

    features_df = process_csv(csv_path, output_path, args.test)

    if args.analyze:
        analyze_feature_distribution(features_df, output_path.parent)

    return 0


if __name__ == '__main__':
    import sys
    sys.exit(main())
