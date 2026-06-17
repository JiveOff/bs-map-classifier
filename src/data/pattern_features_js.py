#!/usr/bin/env python3
"""
JS Pattern Features Extractor

Calls js/lib/scripts/annotate_batch.js via Node.js to run the canonical JS
pattern annotator on all downloaded maps, then merges the resulting per-type
pattern counts with the existing pattern_features.csv from map_parser.py.

The JS annotator is the single source of truth for pattern detection logic.
This script bridges it into the Python training pipeline.

Usage:
    # Run JS annotator and write merged features:
    python src/data/pattern_features_js.py \\
        --maps data/raw/maps \\
        --base-features data/processed/pattern_features.csv \\
        --output data/processed/pattern_features_merged.csv

    # JS-only output (no merge):
    python src/data/pattern_features_js.py \\
        --maps data/raw/maps \\
        --output data/processed/js_pattern_counts.csv \\
        --no-merge
"""

import argparse
import json
import logging
import shutil
import subprocess
import sys
from pathlib import Path

import pandas as pd

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

SCRIPT_DIR  = Path(__file__).resolve().parent
REPO_ROOT   = SCRIPT_DIR.parent.parent
JS_SCRIPT   = REPO_ROOT / 'js' / 'lib' / 'scripts' / 'annotate_batch.js'


def run_js_annotator(maps_dir: Path) -> list[dict]:
    """Run annotate_batch.js and return the parsed JSON results."""
    node = shutil.which('node')
    if not node:
        logger.error('node not found in PATH. Install Node.js ≥18.')
        sys.exit(1)

    if not JS_SCRIPT.exists():
        logger.error(f'JS script not found: {JS_SCRIPT}')
        sys.exit(1)

    cmd = [node, str(JS_SCRIPT), '--maps', str(maps_dir)]
    logger.info(f'Running JS annotator: {" ".join(cmd)}')

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=str(REPO_ROOT),
    )

    if result.stderr:
        for line in result.stderr.strip().splitlines():
            logger.info(f'[node] {line}')

    if result.returncode != 0:
        logger.error(f'JS annotator exited with code {result.returncode}')
        sys.exit(1)

    return json.loads(result.stdout)


def js_records_to_df(records: list[dict]) -> pd.DataFrame:
    """
    Convert JS annotator output to a DataFrame with normalised rate columns.

    Pattern types from annotatePatterns() include: double, scissor, handclap,
    crossover, crossover_scissor, stack, tower, loloppe, window, flower, quad,
    invert, face_note, dot_note, vision_block, arc, chain, dd, jump, inline,
    flick, hook, scoop, shrado, staircase, arm_circle, triangle, paul,
    dot_spam, stream, vibro_stream, jump_stream, gallop, piano_stream,
    croissant, groove_wall, bomb_reset, bomb_hold, hammer_hit.
    """
    df = pd.DataFrame(records).fillna(0)

    # Add rate columns (normalised by note count) for every n_* column
    count_cols = [c for c in df.columns if c.startswith('n_') and c not in ('n_notes',)]
    for col in count_cols:
        rate_col = col + '_rate'
        df[rate_col] = df[col].div(df['n_notes'].replace(0, 1))

    return df


def merge_with_base(js_df: pd.DataFrame, base_path: Path) -> pd.DataFrame:
    """
    Merge JS pattern counts into the existing pattern_features.csv produced
    by map_parser.py. The JS columns are prefixed with 'js_' to distinguish
    them from the Python-computed equivalents.
    """
    base_df = pd.read_csv(base_path)
    logger.info(f'Base features: {len(base_df)} rows, {len(base_df.columns)} cols')
    logger.info(f'JS features:   {len(js_df)} rows, {len(js_df.columns)} cols')

    # Prefix JS columns (except the join keys)
    join_keys = {'map_key', 'category'}
    js_rename = {
        c: f'js_{c}' for c in js_df.columns
        if c not in join_keys
    }
    js_df_prefixed = js_df.rename(columns=js_rename)

    merged = base_df.merge(js_df_prefixed, on=['map_key', 'category'], how='left')
    logger.info(f'Merged: {len(merged)} rows, {len(merged.columns)} cols')
    return merged


def main():
    parser = argparse.ArgumentParser(
        description='Run JS pattern annotator and merge into training features')
    parser.add_argument('--maps', default='data/raw/maps',
                        help='Root dir of downloaded maps')
    parser.add_argument('--base-features', default='data/processed/pattern_features.csv',
                        help='Existing pattern_features.csv from map_parser.py')
    parser.add_argument('--output', default='data/processed/pattern_features_merged.csv',
                        help='Output CSV path')
    parser.add_argument('--no-merge', action='store_true',
                        help='Write JS counts only, do not merge with base features')
    parser.add_argument('--verbose', action='store_true')
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    maps_dir = Path(args.maps)
    if not maps_dir.exists():
        logger.error(f'Maps directory not found: {maps_dir}')
        return 1

    records = run_js_annotator(maps_dir)
    logger.info(f'JS annotator returned {len(records)} records')

    js_df = js_records_to_df(records)

    if args.no_merge:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        js_df.to_csv(out, index=False)
        logger.info(f'Wrote {len(js_df)} rows to {out}')
        return 0

    base_path = Path(args.base_features)
    if not base_path.exists():
        logger.warning(
            f'Base features not found at {base_path}. '
            'Run map_parser.py first, or use --no-merge to write JS counts only.'
        )
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        js_df.to_csv(out, index=False)
        logger.info(f'Wrote JS-only features to {out}')
        return 0

    merged = merge_with_base(js_df, base_path)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    merged.to_csv(out, index=False)
    logger.info(f'Wrote merged features ({len(merged)} rows, {len(merged.columns)} cols) to {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
