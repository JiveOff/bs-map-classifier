#!/usr/bin/env python3
"""
Beat Saber Map Downloader

Downloads maps from the BeatSaver API using the CSV dataset and saves them to
  data/raw/maps/<category_name>/<key>/
alongside two sidecar files:
  _beatsaver.json  — full BeatSaver API response
  _dataset.json    — the relevant CSV row (difficulty, characteristic, bpm, hash)
                     so map_parser.py knows which .dat file to analyse

The BeatSaver API uses the short hex 'key' (e.g. "2b120"), not the internal map_id.
Each map zip contains ALL difficulties; the correct one is identified at parse time
from _dataset.json.

Usage:
    python downloader.py --csv dataset_wc_pooling.csv --output data/raw/maps
    python downloader.py --csv dataset_wc_pooling.csv --output data/raw/maps --limit 50
    python downloader.py --csv dataset_wc_pooling.csv --output data/raw/maps --category Speed
"""

import argparse
import io
import json
import logging
import time
import zipfile
from pathlib import Path

import pandas as pd
import requests

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

BEATSAVER_API = "https://beatsaver.com/api/maps/id/{key}"
HEADERS = {"User-Agent": "BSMapClassifier/1.0 (research project)"}
EXCLUDED_CATEGORIES = {'Balanced'}


class BeatSaverDownloader:
    def __init__(self, rate_limit_delay: float = 0.5):
        self.delay = rate_limit_delay
        self.session = requests.Session()
        self.session.headers.update(HEADERS)

    def get_map_info(self, key: str) -> dict | None:
        url = BEATSAVER_API.format(key=key)
        try:
            r = self.session.get(url, timeout=10)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            logger.error(f"API fetch failed for {key}: {e}")
            return None

    def download_map(self, key: str, category: str, output_dir: Path,
                     dataset_row: dict) -> bool:
        map_dir = output_dir / category / key
        if map_dir.exists() and (map_dir / '_dataset.json').exists():
            logger.debug(f"Already downloaded: {key}")
            return True

        info = self.get_map_info(key)
        if not info:
            return False

        versions = info.get('versions', [])
        if not versions:
            logger.error(f"No versions in API response for {key}")
            return False

        # Use the latest published version
        download_url = versions[-1].get('downloadURL')
        if not download_url:
            logger.error(f"No downloadURL for {key}")
            return False

        try:
            logger.info(f"Downloading {key} ({category})…")
            r = self.session.get(download_url, timeout=60)
            r.raise_for_status()

            map_dir.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
                zf.extractall(map_dir)

            (map_dir / '_beatsaver.json').write_text(
                json.dumps(info, indent=2), encoding='utf-8')
            (map_dir / '_dataset.json').write_text(
                json.dumps(dataset_row, indent=2), encoding='utf-8')

            time.sleep(self.delay)
            return True
        except zipfile.BadZipFile:
            logger.error(f"Bad zip for {key}")
            return False
        except Exception as e:
            logger.error(f"Download failed for {key}: {e}")
            return False

    def close(self):
        self.session.close()


def download_maps(csv_path: Path, output_dir: Path,
                  limit: int | None = None,
                  category: str | None = None) -> dict:
    df = pd.read_csv(csv_path)
    df = df[~df['category_name'].isin(EXCLUDED_CATEGORIES)]

    if category:
        df = df[df['category_name'] == category]

    if limit:
        df = df.head(limit)

    output_dir.mkdir(parents=True, exist_ok=True)
    downloader = BeatSaverDownloader()
    stats = {'total': len(df), 'success': 0, 'failed': 0, 'skipped': 0}

    for i, (_, row) in enumerate(df.iterrows(), 1):
        key = str(row['key'])
        cat = str(row['category_name'])
        map_dir = output_dir / cat / key

        if map_dir.exists() and (map_dir / '_dataset.json').exists():
            stats['skipped'] += 1
            continue

        # Persist only the fields map_parser needs
        dataset_row = {
            'key': key,
            'map_id': str(row['map_id']),
            'hash': str(row['hash']),
            'characteristic': str(row['characteristic']),
            'difficulty': str(row['difficulty']),
            'category_name': cat,
            'bpm': float(row['bpm']) if pd.notna(row.get('bpm')) else 120.0,
        }

        if downloader.download_map(key, cat, output_dir, dataset_row):
            stats['success'] += 1
        else:
            stats['failed'] += 1

        if i % 10 == 0:
            logger.info(
                f"Progress: {i}/{stats['total']} — "
                f"success={stats['success']} failed={stats['failed']} "
                f"skipped={stats['skipped']}"
            )

    downloader.close()
    logger.info(f"Done: {stats}")
    return stats


def main():
    parser = argparse.ArgumentParser(
        description='Download Beat Saber maps from BeatSaver')
    parser.add_argument('--csv', type=str, default='dataset_wc_pooling.csv')
    parser.add_argument('--output', type=str, default='data/raw/maps')
    parser.add_argument('--limit', type=int, default=None,
                        help='Maximum number of maps to download')
    parser.add_argument('--category', type=str, default=None,
                        choices=['Tech', 'Speed', 'Accuracy', 'Standard', 'Extreme'],
                        help='Download only this category')
    parser.add_argument('--verbose', action='store_true')
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    csv_path = Path(args.csv)
    if not csv_path.exists():
        logger.error(f"CSV not found: {csv_path}")
        return 1

    download_maps(csv_path, Path(args.output), args.limit, args.category)
    return 0


if __name__ == '__main__':
    import sys
    sys.exit(main())
