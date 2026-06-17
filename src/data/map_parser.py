#!/usr/bin/env python3
"""
Beat Saber Map Parser

Parses the actual beatmap .dat files from downloaded map zips and extracts
note-level pattern features for classification. Run after downloader.py.

Grid (from wiki/wiki/mapping/map-format/beatmap.md):
  Lanes  (x): 0=far-left  1=center-left  2=center-right  3=far-right
  Layers (y): 0=bottom    1=middle        2=top
  Cut direction: 0=Up 1=Down 2=Left 3=Right 4=UpLeft 5=UpRight 6=DownLeft 7=DownRight 8=Any(dot)

Patterns mapped to features (from wiki/wiki/mapping/basic-mapping.md and intermediate-mapping.md):
  - Streams      : alternating colors at 1/4 precision → per-hand eBPM ≈ song BPM
  - Doubles      : both colors at the same beat → emphasis / intensity
  - Crossovers   : note on the opposite-handed lane (red in x≥2, blue in x≤1)
  - DD / parity  : consecutive same-hand notes with < 90° direction change (parity break)
  - Top-row usage: notes with y=2 → Tech/Extreme maps
  - Sliders/chains: rapid same-color notes in one sweep
  - Dodge walls  : single-column vertical walls → dance / body motion
  - Crouch walls : top-blocking walls → fitness / extreme maps

Output: data/processed/pattern_features.csv (one row per map)
Each row includes map_key, category, n_notes_parsed, and all computed features.

Usage:
    python map_parser.py --maps data/raw/maps --output data/processed/pattern_features.csv
    python map_parser.py --maps data/raw/maps --output data/processed/pattern_features.csv --verbose
"""

import argparse
import json
import logging
import math
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Cut direction → angle in degrees (Right=0°, Up=90°, Left=180°, Down=270°)
DIR_ANGLES: Dict[int, float] = {
    0: 90.0,   # Up
    1: 270.0,  # Down
    2: 180.0,  # Left
    3: 0.0,    # Right
    4: 135.0,  # UpLeft
    5: 45.0,   # UpRight
    6: 225.0,  # DownLeft
    7: 315.0,  # DownRight
    # 8 = Any/dot — no angle
}


@dataclass
class Note:
    beat: float
    x: int       # lane 0-3
    y: int       # layer 0-2
    color: int   # 0=left(red saber) 1=right(blue saber)
    direction: int  # 0-7 directional, 8=dot


@dataclass
class Obstacle:
    beat: float
    x: int        # starting lane
    y: int        # starting layer
    w: int        # width in lanes
    h: int        # height in layers (5=full-height, 3=crouch)
    duration: float


def _angle_diff(a1: float, a2: float) -> float:
    """Smallest angular difference in [0, 180] degrees."""
    diff = abs(a1 - a2) % 360
    return min(diff, 360 - diff)


# ---------------------------------------------------------------------------
# Info.dat parsing
# ---------------------------------------------------------------------------

def _parse_info(map_dir: Path) -> Optional[dict]:
    for name in ('Info.dat', 'info.dat', 'Info.json'):
        p = map_dir / name
        if p.exists():
            try:
                return json.loads(p.read_text(encoding='utf-8'))
            except Exception:
                pass
    return None


def find_beatmap_file(map_dir: Path, characteristic: str, difficulty: str) -> Optional[Path]:
    """
    Locate the correct difficulty .dat file by reading Info.dat.
    Handles both v2 format (_difficultyBeatmapSets) and v4 format (difficultyBeatmaps).
    Falls back to guessing the filename if Info.dat cannot be resolved.
    """
    info = _parse_info(map_dir)

    if info:
        # v2/v3: _difficultyBeatmapSets
        for s in info.get('_difficultyBeatmapSets', []):
            if s.get('_beatmapCharacteristicName', '').lower() != characteristic.lower():
                continue
            for d in s.get('_difficultyBeatmaps', []):
                if d.get('_difficulty', '').lower() == difficulty.lower():
                    fname = d.get('_beatmapFilename')
                    if fname:
                        p = map_dir / fname
                        if p.exists():
                            return p

        # v4: difficultyBeatmaps
        for d in info.get('difficultyBeatmaps', []):
            if (d.get('characteristic', '').lower() == characteristic.lower() and
                    d.get('difficulty', '').lower() == difficulty.lower()):
                fname = d.get('beatmapDataFilename')
                if fname:
                    p = map_dir / fname
                    if p.exists():
                        return p

    # Fallback: common naming conventions
    for candidate in (
        f"{difficulty}{characteristic}.dat",
        f"{difficulty}.dat",
        f"{difficulty}{characteristic}.beatmap.dat",
    ):
        p = map_dir / candidate
        if p.exists():
            return p

    return None


# ---------------------------------------------------------------------------
# Beatmap .dat parsing (v2, v3, v4)
# ---------------------------------------------------------------------------

def parse_beatmap(dat_path: Path) -> Tuple[List[Note], List[Obstacle], List[dict], List[dict], List[Note]]:
    """
    Parse a beatmap .dat file.
    Returns (notes, obstacles, arcs, chains, bombs).
    Handles beatmap format v2 (underscore-prefixed keys), v3, and v4.
    """
    data = json.loads(dat_path.read_text(encoding='utf-8'))

    notes: List[Note] = []
    obstacles: List[Obstacle] = []
    arcs: List[dict] = []
    chains: List[dict] = []
    bombs: List[Note] = []

    is_v2 = '_notes' in data or data.get('_version', '').startswith('2')

    if is_v2:
        for n in data.get('_notes', []):
            ntype = int(n.get('_type', 0))
            if ntype == 3:  # bomb
                bombs.append(Note(
                    beat=float(n.get('_time', 0)),
                    x=int(n.get('_lineIndex', 0)),
                    y=int(n.get('_lineLayer', 0)),
                    color=-1,
                    direction=8,
                ))
                continue
            notes.append(Note(
                beat=float(n.get('_time', 0)),
                x=int(n.get('_lineIndex', 0)),
                y=int(n.get('_lineLayer', 0)),
                color=ntype,
                direction=int(n.get('_cutDirection', 8)),
            ))
        for o in data.get('_obstacles', []):
            otype = int(o.get('_type', 0))
            # type 0 = full-height (y=0, h=5), type 1 = crouch (y=2, h=3)
            obstacles.append(Obstacle(
                beat=float(o.get('_time', 0)),
                x=int(o.get('_lineIndex', 0)),
                y=0 if otype == 0 else 2,
                w=int(o.get('_width', 1)),
                h=5 if otype == 0 else 3,
                duration=float(o.get('_duration', 0)),
            ))
        arcs = data.get('_sliders', [])

    else:
        # v3 colorNotes
        for n in data.get('colorNotes', []):
            notes.append(Note(
                beat=float(n.get('b', 0)),
                x=int(n.get('x', 0)),
                y=int(n.get('y', 0)),
                color=int(n.get('c', 0)),
                direction=int(n.get('d', 8)),
            ))
        # v4 colorNotes + colorNotesData (template structure)
        if not notes and 'colorNotesData' in data:
            note_events = data.get('colorNotes', [])
            note_data = data.get('colorNotesData', [])
            for ev in note_events:
                idx = int(ev.get('i', 0))
                if idx < len(note_data):
                    nd = note_data[idx]
                    notes.append(Note(
                        beat=float(ev.get('b', 0)),
                        x=int(nd.get('x', 0)),
                        y=int(nd.get('y', 0)),
                        color=int(nd.get('c', 0)),
                        direction=int(nd.get('d', 8)),
                    ))
        # v3/v4 bombs
        for n in data.get('bombNotes', []):
            bombs.append(Note(
                beat=float(n.get('b', 0)),
                x=int(n.get('x', 0)),
                y=int(n.get('y', 0)),
                color=-1,
                direction=8,
            ))
        for o in data.get('obstacles', []):
            # v4 uses obstaclesData template
            obstacles.append(Obstacle(
                beat=float(o.get('b', 0)),
                x=int(o.get('x', 0)),
                y=int(o.get('y', 0)),
                w=int(o.get('w', 1)),
                h=int(o.get('h', 5)),
                duration=float(o.get('d', 0)),
            ))
        if not obstacles and 'obstaclesData' in data:
            obs_events = data.get('obstacles', [])
            obs_data = data.get('obstaclesData', [])
            for ev in obs_events:
                idx = int(ev.get('i', 0))
                if idx < len(obs_data):
                    od = obs_data[idx]
                    obstacles.append(Obstacle(
                        beat=float(ev.get('b', 0)),
                        x=int(od.get('x', 0)),
                        y=int(od.get('y', 0)),
                        w=int(od.get('w', 1)),
                        h=int(od.get('h', 5)),
                        duration=float(od.get('d', 0)),
                    ))
        arcs = data.get('sliders', [])
        chains = data.get('burstSliders', data.get('chains', []))

    return notes, obstacles, arcs, chains, bombs


# ---------------------------------------------------------------------------
# Feature computation
# ---------------------------------------------------------------------------
# Named pattern counts (n_doubles, n_hooks, etc.) come from the JS annotator
# via src/data/pattern_features_js.py. This module computes only statistical
# signal-level features: eBPM, rotation, lane/layer histograms, timing CV,
# windowed temporal features, obstacle density, and arc/chain density.

def compute_pattern_features(
    notes: List[Note],
    obstacles: List[Obstacle],
    arcs: List[dict],
    chains: List[dict],
    bpm: float,
    bombs: Optional[List[Note]] = None,
) -> Dict:
    """
    Compute statistical signal-level features from a parsed beatmap.
    Does NOT compute named pattern counts — those come from the JS annotator
    (src/data/pattern_features_js.py) and are merged in separately.

    eBPM formula: ebpm = bpm * 0.5 / per_hand_interval_beats
    (at 1/4 stream, interval=0.5 beats, eBPM = BPM — matches BSMG wiki definition)
    """
    features: Dict = {}
    n_notes = len(notes)
    if n_notes == 0:
        return features

    notes_sorted = sorted(notes, key=lambda n: n.beat)
    first_beat = notes_sorted[0].beat
    last_beat = notes_sorted[-1].beat
    map_duration = max(last_beat - first_beat, 1.0)

    # --- Lane and layer histograms ---
    for i in range(4):
        features[f'lane_{i}_rate'] = sum(1 for n in notes_sorted if n.x == i) / n_notes
    for i in range(3):
        features[f'layer_{i}_rate'] = sum(1 for n in notes_sorted if n.y == i) / n_notes
    features['top_row_rate'] = features['layer_2_rate']

    # --- Direction histogram ---
    for i in range(9):
        features[f'dir_{i}_rate'] = sum(1 for n in notes_sorted if n.direction == i) / n_notes
    features['dot_note_rate'] = features['dir_8_rate']

    # --- Hand balance ---
    left_notes = [n for n in notes_sorted if n.color == 0]
    right_notes = [n for n in notes_sorted if n.color == 1]
    features['left_note_rate'] = len(left_notes) / n_notes
    features['hand_imbalance'] = abs(len(left_notes) - len(right_notes)) / n_notes

    # --- Doubles: beats where both hands play simultaneously (within 1/8 beat tolerance) ---
    beat_groups: Dict[int, List[Note]] = {}
    for n in notes_sorted:
        key = round(n.beat * 8)  # 1/8 beat quantization
        beat_groups.setdefault(key, []).append(n)
    n_beat_slots = len(beat_groups)
    double_slots = sum(
        1 for grp in beat_groups.values()
        if any(n.color == 0 for n in grp) and any(n.color == 1 for n in grp)
    )
    features['double_rate'] = double_slots / n_beat_slots if n_beat_slots else 0

    # --- Crossovers ---
    # Red (left saber, color=0) in lanes 2-3 = crossover
    # Blue (right saber, color=1) in lanes 0-1 = crossover
    crossovers = sum(
        1 for n in notes_sorted
        if (n.color == 0 and n.x >= 2) or (n.color == 1 and n.x <= 1)
    )
    features['crossover_rate'] = crossovers / n_notes

    # --- Double Directionals / parity breaks ---
    # A DD is when two consecutive same-hand directional notes have < 90° angular difference.
    # Proper parity means the next note is ~180° from the previous.
    def _dd_rate(hand_notes: List[Note]) -> float:
        directional = [n for n in hand_notes if n.direction != 8]
        if len(directional) < 2:
            return 0.0
        breaks = sum(
            1 for i in range(1, len(directional))
            if _angle_diff(
                DIR_ANGLES[directional[i - 1].direction],
                DIR_ANGLES[directional[i].direction]
            ) < 90
        )
        return breaks / (len(directional) - 1)

    features['dd_rate_left'] = _dd_rate(left_notes)
    features['dd_rate_right'] = _dd_rate(right_notes)
    features['dd_rate_total'] = (_dd_rate(left_notes) + _dd_rate(right_notes)) / 2

    # --- eBPM per hand ---
    def _ebpm_stats(hand_notes: List[Note]) -> Dict[str, float]:
        if len(hand_notes) < 2:
            return {'mean': 0.0, 'median': 0.0, 'max': 0.0, 'p90': 0.0}
        # Minimum 0.05 beats (~1/20) to exclude stacked same-color notes
        intervals = [
            hand_notes[i].beat - hand_notes[i - 1].beat
            for i in range(1, len(hand_notes))
            if hand_notes[i].beat - hand_notes[i - 1].beat >= 0.05
        ]
        if not intervals:
            return {'mean': 0.0, 'median': 0.0, 'max': 0.0, 'p90': 0.0}
        ebpms = [bpm * 0.5 / iv for iv in intervals]
        return {
            'mean': float(np.mean(ebpms)),
            'median': float(np.median(ebpms)),
            'max': float(np.max(ebpms)),
            'p90': float(np.percentile(ebpms, 90)),
        }

    left_ebpm = _ebpm_stats(left_notes)
    right_ebpm = _ebpm_stats(right_notes)
    for stat, val in left_ebpm.items():
        features[f'ebpm_left_{stat}'] = val
    for stat, val in right_ebpm.items():
        features[f'ebpm_right_{stat}'] = val
    features['ebpm_max_overall'] = max(left_ebpm['max'], right_ebpm['max'])
    features['ebpm_p90_overall'] = max(left_ebpm['p90'], right_ebpm['p90'])

    # --- Timing variability (CV = std/mean of inter-note intervals) ---
    def _interval_cv(hand_notes: List[Note]) -> float:
        if len(hand_notes) < 3:
            return 0.0
        intervals = [
            hand_notes[i].beat - hand_notes[i - 1].beat
            for i in range(1, len(hand_notes))
            if hand_notes[i].beat - hand_notes[i - 1].beat >= 0.05
        ]
        mean = np.mean(intervals) if intervals else 0
        return float(np.std(intervals) / mean) if mean > 0 else 0.0

    features['interval_cv_left'] = _interval_cv(left_notes)
    features['interval_cv_right'] = _interval_cv(right_notes)

    # --- Mean rotation between consecutive same-hand swings ---
    # High mean rotation → tech/complex patterns. Low → linear/speed streams.
    def _mean_rotation(hand_notes: List[Note]) -> float:
        directional = [n for n in hand_notes if n.direction != 8]
        if len(directional) < 2:
            return 0.0
        rotations = [
            _angle_diff(
                DIR_ANGLES[directional[i - 1].direction],
                DIR_ANGLES[directional[i].direction]
            )
            for i in range(1, len(directional))
        ]
        return float(np.mean(rotations))

    features['rotation_mean_left'] = _mean_rotation(left_notes)
    features['rotation_mean_right'] = _mean_rotation(right_notes)
    features['rotation_mean_total'] = (
        features['rotation_mean_left'] + features['rotation_mean_right']
    ) / 2

    # --- Arcs and chains density ---
    features['arc_count'] = len(arcs)
    features['chain_count'] = len(chains)
    features['arc_rate'] = len(arcs) / n_notes
    features['chain_rate'] = len(chains) / n_notes

    # --- Obstacle analysis ---
    def _is_crouch(o: Obstacle) -> bool:
        # Crouch walls block the top: y>=2 or explicitly crouch height (h≤3 and not bottom)
        return o.y >= 2 or (o.h <= 3 and o.y > 0)

    def _is_dodge(o: Obstacle) -> bool:
        # Single-column vertical wall in the playable area = dodge wall
        return o.w == 1 and not _is_crouch(o)

    dodge_walls = [o for o in obstacles if _is_dodge(o)]
    crouch_walls = [o for o in obstacles if _is_crouch(o)]
    features['dodge_wall_count'] = len(dodge_walls)
    features['crouch_wall_count'] = len(crouch_walls)
    features['total_wall_count'] = len(obstacles)
    features['dodge_wall_rate'] = len(dodge_walls) / map_duration
    features['crouch_wall_rate'] = len(crouch_walls) / map_duration
    features['wall_density'] = len(obstacles) / map_duration

    # --- Map duration and density ---
    features['map_duration_beats'] = map_duration
    features['note_density'] = n_notes / map_duration  # notes per beat

    # Pattern counts (n_doubles, n_hooks, etc.) are not computed here.
    # They come from the JS annotator via src/data/pattern_features_js.py
    # and are merged into the final training CSV separately.

    # --- Windowed / temporal features ---
    features.update(compute_windowed_features(notes_sorted, obstacles, bpm))

    return features


def compute_windowed_features(
    notes_sorted: List[Note],
    obstacles: List[Obstacle],
    bpm: float,
    window_beats: float = 16.0,
) -> Dict:
    """
    Split the map into fixed-size windows and compute pattern densities per window,
    then aggregate with max/mean/std/p90/peak_ratio across all windows.

    Aggregate features can't distinguish a map with crossovers throughout from one
    with a single crossover section. These features capture that distribution.
    Window size of 16 beats ≈ one musical phrase at typical BPM values.
    """
    feats: Dict = {}
    n = len(notes_sorted)
    if n == 0:
        return feats

    first_beat = notes_sorted[0].beat
    last_beat  = notes_sorted[-1].beat
    duration   = max(last_beat - first_beat, window_beats)
    n_windows  = max(2, int(duration / window_beats))

    STREAM_MAX = 0.28
    BEAT_TOL   = 1 / 8

    window_stats: List[Dict] = []

    for w in range(n_windows):
        w_start = first_beat + w * window_beats
        w_end   = w_start + window_beats
        wn      = [n for n in notes_sorted if w_start <= n.beat < w_end]
        if not wn:
            continue

        nw    = len(wn)
        left  = [n for n in wn if n.color == 0]
        right = [n for n in wn if n.color == 1]

        # Note density (notes per beat)
        note_density = nw / window_beats

        # Crossover rate
        crossovers = sum(
            1 for n in wn
            if (n.color == 0 and n.x >= 2) or (n.color == 1 and n.x <= 1)
        )

        # Double rate (beats with both colors)
        slots: Dict[int, list] = defaultdict(list)
        for n in wn:
            slots[round(n.beat / BEAT_TOL)].append(n)
        doubles = sum(
            1 for grp in slots.values()
            if any(n.color == 0 for n in grp) and any(n.color == 1 for n in grp)
        )

        # DD rate (same-hand parity breaks)
        def _dd(hand: List[Note]) -> int:
            dh = [n for n in hand if n.direction != 8]
            return sum(
                1 for i in range(1, len(dh))
                if _angle_diff(DIR_ANGLES[dh[i-1].direction],
                               DIR_ANGLES[dh[i].direction]) < 90
            )
        dds = _dd(left) + _dd(right)
        dd_denom = max(sum(1 for n in wn if n.direction != 8), 1)

        # Stream note rate
        stream_notes = 0
        run = 1
        for i in range(1, len(wn)):
            iv = wn[i].beat - wn[i-1].beat
            if 0 < iv <= STREAM_MAX and wn[i].color != wn[i-1].color:
                run += 1
            else:
                if run >= 4:
                    stream_notes += run
                run = 1
        if run >= 4:
            stream_notes += run

        # Vibro note rate (1/8-beat stream)
        VIBRO_MAX = 0.14
        vibro_notes = sum(
            1 for i in range(1, len(wn))
            if 0 < wn[i].beat - wn[i-1].beat <= VIBRO_MAX
            and wn[i].color != wn[i-1].color
        )

        # Per-hand peak eBPM in window
        def _peak_ebpm(hand: List[Note]) -> float:
            if len(hand) < 2:
                return 0.0
            ivs = [hand[i].beat - hand[i-1].beat
                   for i in range(1, len(hand))
                   if hand[i].beat - hand[i-1].beat >= 0.05]
            return max((bpm * 0.5 / iv for iv in ivs), default=0.0)
        peak_ebpm = max(_peak_ebpm(left), _peak_ebpm(right))

        # Jump rate
        def _jumps(hand: List[Note]) -> int:
            return sum(
                1 for i in range(1, len(hand))
                if math.sqrt((hand[i].x - hand[i-1].x)**2 +
                             (hand[i].y - hand[i-1].y)**2) >= 2
            )
        jumps = _jumps(left) + _jumps(right)

        # Loloppe rate
        loloppes = 0
        for grp in slots.values():
            for color in (0, 1):
                hd = [n for n in grp if n.color == color and n.direction != 8]
                for i in range(len(hd)):
                    for j in range(i + 1, len(hd)):
                        a, b = hd[i], hd[j]
                        if (a.direction == b.direction and
                                abs(a.x - b.x) == 1 and abs(a.y - b.y) <= 1):
                            loloppes += 1

        # Top-row rate
        top_row = sum(1 for n in wn if n.y == 2)

        # Hand imbalance (|left - right| / total)
        hand_imbalance = abs(len(left) - len(right)) / nw

        # Wall density in window
        if obstacles:
            w_walls = sum(1 for o in obstacles if w_start <= o.beat < w_end)
        else:
            w_walls = 0

        window_stats.append({
            'note_density':     note_density,
            'crossover_rate':   crossovers / nw,
            'double_rate':      doubles / nw,
            'dd_rate':          dds / dd_denom,
            'stream_rate':      stream_notes / nw,
            'vibro_rate':       vibro_notes / nw,
            'peak_ebpm':        peak_ebpm,
            'jump_rate':        jumps / nw,
            'loloppe_rate':     loloppes / nw,
            'top_row_rate':     top_row / nw,
            'hand_imbalance':   hand_imbalance,
            'wall_density':     w_walls / window_beats,
        })

    if not window_stats:
        return feats

    feats['n_windows'] = len(window_stats)

    for metric in window_stats[0]:
        vals = np.array([w[metric] for w in window_stats])
        p   = f'win_{metric}'
        feats[f'{p}_max']        = float(np.max(vals))
        feats[f'{p}_mean']       = float(np.mean(vals))
        feats[f'{p}_std']        = float(np.std(vals))
        feats[f'{p}_p90']        = float(np.percentile(vals, 90))
        feats[f'{p}_p10']        = float(np.percentile(vals, 10))
        # peak_ratio: how "bursty" vs sustained the metric is (1.0 = perfectly uniform)
        mean_v = feats[f'{p}_mean']
        feats[f'{p}_peak_ratio'] = (feats[f'{p}_max'] / mean_v) if mean_v > 0 else 1.0

    return feats


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def process_maps(maps_dir: Path, output_path: Path) -> pd.DataFrame:
    """
    Walk maps_dir/<category>/<key>/ and extract pattern features from each map.
    Reads _dataset.json for difficulty, characteristic, and bpm.
    """
    records = []

    for category_dir in sorted(maps_dir.iterdir()):
        if not category_dir.is_dir():
            continue
        category = category_dir.name

        for map_dir in sorted(category_dir.iterdir()):
            if not map_dir.is_dir():
                continue
            key = map_dir.name

            dataset_path = map_dir / '_dataset.json'
            if not dataset_path.exists():
                logger.warning(f"No _dataset.json in {map_dir}, skipping")
                continue

            dataset = json.loads(dataset_path.read_text(encoding='utf-8'))
            characteristic = dataset.get('characteristic', 'Standard')
            difficulty = dataset.get('difficulty', 'ExpertPlus')
            bpm = float(dataset.get('bpm') or 120)

            dat_path = find_beatmap_file(map_dir, characteristic, difficulty)
            if not dat_path:
                logger.warning(
                    f"Could not find {characteristic}/{difficulty}.dat in {map_dir}")
                continue

            try:
                notes, obstacles, arcs, chains, bombs = parse_beatmap(dat_path)
                feats = compute_pattern_features(notes, obstacles, arcs, chains, bpm, bombs=bombs)
                feats['map_key'] = key
                feats['category'] = category
                feats['n_notes_parsed'] = len(notes)
                records.append(feats)
                logger.debug(f"Parsed {key} ({category}): {len(notes)} notes")
            except Exception as e:
                logger.warning(f"Failed to parse {dat_path}: {e}")

    if not records:
        logger.warning("No maps parsed successfully")
        return pd.DataFrame()

    df = pd.DataFrame(records)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False)
    logger.info(f"Saved {len(df)} pattern feature vectors to {output_path}")
    return df


def main():
    parser = argparse.ArgumentParser(
        description='Extract pattern features from downloaded Beat Saber maps')
    parser.add_argument(
        '--maps', type=str, default='data/raw/maps',
        help='Root dir of downloaded maps (output of downloader.py)')
    parser.add_argument(
        '--output', type=str, default='data/processed/pattern_features.csv')
    parser.add_argument('--verbose', action='store_true')
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    maps_dir = Path(args.maps)
    if not maps_dir.exists():
        logger.error(f"Maps directory not found: {maps_dir}")
        return 1

    process_maps(maps_dir, Path(args.output))
    return 0


if __name__ == '__main__':
    import sys
    sys.exit(main())
