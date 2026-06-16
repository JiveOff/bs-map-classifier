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
# Pattern detection (explicit counts for each named pattern)
# ---------------------------------------------------------------------------
# Patterns reference: docs/patterns/ — images from wiki/wiki/mapping/glossary.md
# Detectability: HIGH = reliable from note data alone; MED = approximate

def count_patterns(notes: List[Note], bpm: float,
                   obstacles: Optional[List[Obstacle]] = None,
                   bombs: Optional[List[Note]] = None) -> Dict:
    """
    Count named patterns from the BSMG wiki glossary.

    All patterns are detected from note (beat, x, y, color, direction) data.
    See docs/patterns/<name>/ for the wiki reference image.

    Detectability key in comments:
      HIGH — deterministic from note positions/timings
      MED  — heuristic, may include false positives at edge cases
    """
    counts: Dict[str, int] = {}

    notes_s = sorted(notes, key=lambda n: n.beat)
    n_notes = len(notes_s)
    if n_notes == 0:
        return counts

    beat_tol = 1 / 8  # 1/8 beat quantisation tolerance for "same beat"
    stream_interval = 0.5 / max(bpm, 1) * 60 / (60 / max(bpm, 1))  # not used; use beat fractions
    # 1/4 beat stream: inter-note interval = 0.25 beats; per-hand = 0.5 beats
    # vibro (1/8 precision): inter-note = 0.125 beats; per-hand = 0.25 beats
    STREAM_MAX_INTERVAL = 0.28   # beats — up to slightly above 1/4 (accounts for BPM float)
    VIBRO_MAX_INTERVAL  = 0.14   # beats — 1/8 precision or faster

    # --- Group notes by quantised beat slot (1/8 beat) ---
    beat_slots: Dict[int, List[Note]] = {}
    for n in notes_s:
        slot = round(n.beat / beat_tol)
        beat_slots.setdefault(slot, []).append(n)

    # --- Doubles (HIGH): both colors at the same beat ---
    # docs/patterns/double/
    n_doubles = sum(
        1 for grp in beat_slots.values()
        if any(n.color == 0 for n in grp) and any(n.color == 1 for n in grp)
    )
    counts['n_doubles'] = n_doubles

    # --- Scissor (HIGH): double where the two notes point in opposite directions ---
    # docs/patterns/scissor/
    n_scissor = 0
    for grp in beat_slots.values():
        reds   = [n for n in grp if n.color == 0 and n.direction != 8]
        blues  = [n for n in grp if n.color == 1 and n.direction != 8]
        if reds and blues:
            # at least one pair pointing ≥150° apart = near-opposite
            for r in reds:
                for b in blues:
                    if _angle_diff(DIR_ANGLES[r.direction], DIR_ANGLES[b.direction]) >= 150:
                        n_scissor += 1
                        break
    counts['n_scissor'] = n_scissor

    # --- Stacks (HIGH): 2 same-color same-direction notes at same beat, stacked vertically ---
    # docs/patterns/stack/
    n_stacks = 0
    for grp in beat_slots.values():
        for color in (0, 1):
            hand = [n for n in grp if n.color == color]
            if len(hand) < 2:
                continue
            # group by (direction, x) — stacked vertically means same column

            cols: Dict = defaultdict(list)
            for n in hand:
                cols[(n.direction, n.x)].append(n)
            for notes_col in cols.values():
                if len(notes_col) == 2:
                    n_stacks += 1
    counts['n_stacks'] = n_stacks

    # --- Towers (HIGH): 3 same-color same-direction notes at same beat, same column ---
    # docs/patterns/tower/
    n_towers = 0
    for grp in beat_slots.values():
        for color in (0, 1):
            hand = [n for n in grp if n.color == color]
            if len(hand) < 3:
                continue

            cols: Dict = defaultdict(list)
            for n in hand:
                cols[(n.direction, n.x)].append(n)
            for notes_col in cols.values():
                if len(notes_col) >= 3:
                    n_towers += 1
    counts['n_towers'] = n_towers

    # --- Face notes (HIGH): notes in the two centre lanes (x=1 or x=2) ---
    # docs/patterns/face_note/
    counts['n_face_notes'] = sum(1 for n in notes_s if 1 <= n.x <= 2)

    # --- Dot notes (HIGH): direction = 8 (any direction) ---
    # docs/patterns/dot_note/
    counts['n_dot_notes'] = sum(1 for n in notes_s if n.direction == 8)

    # --- Top-row notes (HIGH): layer y=2 ---
    counts['n_top_row_notes'] = sum(1 for n in notes_s if n.y == 2)

    # --- Crossovers (HIGH): note on the opposite-handed lane ---
    # docs/patterns/crossover/  (red=color 0 in x≥2; blue=color 1 in x≤1)
    counts['n_crossovers'] = sum(
        1 for n in notes_s
        if (n.color == 0 and n.x >= 2) or (n.color == 1 and n.x <= 1)
    )

    # --- Crossover Scissor / Pickle (HIGH): crossover + near-opposite directions ---
    # docs/patterns/crossover_scissor/
    n_xscissor = 0
    for grp in beat_slots.values():
        reds  = [n for n in grp if n.color == 0 and n.x >= 2 and n.direction != 8]
        blues = [n for n in grp if n.color == 1 and n.x <= 1 and n.direction != 8]
        if reds and blues:
            n_xscissor += 1
    counts['n_crossover_scissor'] = n_xscissor

    # --- Inline (HIGH): consecutive same-hand notes at identical (x, y) ---
    # docs/patterns/inline/
    def _count_inline(hand_notes: List[Note]) -> int:
        return sum(
            1 for i in range(1, len(hand_notes))
            if hand_notes[i].x == hand_notes[i-1].x
            and hand_notes[i].y == hand_notes[i-1].y
        )
    left_n  = [n for n in notes_s if n.color == 0]
    right_n = [n for n in notes_s if n.color == 1]
    counts['n_inline'] = _count_inline(left_n) + _count_inline(right_n)

    # --- Double Directionals (HIGH): consecutive same-hand notes with <90° direction change ---
    # docs/patterns/double_directional/
    def _count_dd(hand_notes: List[Note]) -> int:
        directional = [n for n in hand_notes if n.direction != 8]
        return sum(
            1 for i in range(1, len(directional))
            if _angle_diff(DIR_ANGLES[directional[i-1].direction],
                           DIR_ANGLES[directional[i].direction]) < 90
        )
    counts['n_dd'] = _count_dd(left_n) + _count_dd(right_n)

    # --- Triangles (MED): 3 consecutive same-hand directional notes where rotation
    #     is in the same direction for all transitions (causes wrist reset) ---
    # docs/patterns/triangle/
    def _count_triangles(hand_notes: List[Note]) -> int:
        directional = [n for n in hand_notes if n.direction != 8]
        count = 0
        for i in range(2, len(directional)):
            a0 = DIR_ANGLES[directional[i-2].direction]
            a1 = DIR_ANGLES[directional[i-1].direction]
            a2 = DIR_ANGLES[directional[i].direction]
            # Clockwise vs counter-clockwise rotation, same sign for both transitions
            d1 = (a1 - a0 + 360) % 360
            d2 = (a2 - a1 + 360) % 360
            cw1  = d1 < 180
            cw2  = d2 < 180
            # Same rotation direction AND neither is 0° (not same direction) AND not 180° (normal flow)
            if cw1 == cw2 and 0 < d1 < 180 and 0 < d2 < 180:
                count += 1
        return count
    counts['n_triangles'] = _count_triangles(left_n) + _count_triangles(right_n)

    # --- Jumps (MED): consecutive same-hand notes with spatial distance ≥ 2, within 2 beats ---
    # docs/patterns/jump/
    def _count_jumps(hand_notes: List[Note]) -> int:
        return sum(
            1 for i in range(1, len(hand_notes))
            if (hand_notes[i].beat - hand_notes[i-1].beat) <= 2
            and math.sqrt((hand_notes[i].x - hand_notes[i-1].x)**2 +
                          (hand_notes[i].y - hand_notes[i-1].y)**2) >= 2
        )
    counts['n_jumps'] = _count_jumps(left_n) + _count_jumps(right_n)

    # --- Inverts (HIGH): notes where direction points inward from an outer lane ---
    # docs/patterns/invert/
    # Left saber pointing right (dir=3) in lane 0-1 = invert; pointing left (dir=2) in lane 2-3 = invert
    # Right saber pointing left (dir=2) in lane 2-3 = invert; pointing right (dir=3) in lane 0-1 = invert
    n_invert = 0
    for n in notes_s:
        if n.direction == 8:
            continue
        if n.color == 0:  # left saber
            if (n.direction in (3, 5, 7) and n.x <= 1) or \
               (n.direction in (2, 4, 6) and n.x >= 2):
                n_invert += 1
        else:  # right saber
            if (n.direction in (2, 4, 6) and n.x >= 2) or \
               (n.direction in (3, 5, 7) and n.x <= 1):
                n_invert += 1
    counts['n_inverts'] = n_invert

    # --- Streams (MED): runs of ≥4 alternating-color notes at ≤ STREAM_MAX_INTERVAL beats ---
    # docs/patterns/stream/
    stream_runs = 0
    stream_notes_total = 0
    longest_stream = 0
    run_len = 1
    for i in range(1, n_notes):
        interval = notes_s[i].beat - notes_s[i-1].beat
        alt_color = notes_s[i].color != notes_s[i-1].color
        if 0 < interval <= STREAM_MAX_INTERVAL and alt_color:
            run_len += 1
        else:
            if run_len >= 4:
                stream_runs += 1
                stream_notes_total += run_len
                longest_stream = max(longest_stream, run_len)
            run_len = 1
    if run_len >= 4:
        stream_runs += 1
        stream_notes_total += run_len
        longest_stream = max(longest_stream, run_len)
    counts['n_stream_runs'] = stream_runs
    counts['n_stream_notes'] = stream_notes_total
    counts['longest_stream'] = longest_stream

    # --- Vibro stream (MED): stream at 1/8 precision or faster ---
    # docs/patterns/vibro_stream/
    vibro_notes = 0
    for i in range(1, n_notes):
        interval = notes_s[i].beat - notes_s[i-1].beat
        if 0 < interval <= VIBRO_MAX_INTERVAL and notes_s[i].color != notes_s[i-1].color:
            vibro_notes += 1
    counts['n_vibro_notes'] = vibro_notes

    # --- Flicks (MED): 2 same-color consecutive notes within STREAM_MAX_INTERVAL beats ---
    # docs/patterns/flick/
    def _count_flicks(hand_notes: List[Note]) -> int:
        return sum(
            1 for i in range(1, len(hand_notes))
            if 0 < hand_notes[i].beat - hand_notes[i-1].beat <= STREAM_MAX_INTERVAL
        )
    counts['n_flicks'] = _count_flicks(left_n) + _count_flicks(right_n)

    # --- Gallops (MED): one hand plays twice while the other plays once in 1/4-beat window ---
    # Pattern: R-B-B or B-R-R (or mirror). Two notes of same color within 1/8 beat of each other,
    # sandwiching a note of the opposite color.
    # docs/patterns/gallop/
    n_gallop = 0
    for i in range(1, n_notes - 1):
        a, b, c = notes_s[i-1], notes_s[i], notes_s[i+1]
        span = c.beat - a.beat
        if span > STREAM_MAX_INTERVAL * 2:
            continue
        if a.color == c.color and a.color != b.color:
            n_gallop += 1
    counts['n_gallops'] = n_gallop

    # --- Paul (HIGH): same-direction inline same-color notes at very high precision (≤ 1/8 beat) ---
    # docs/patterns/paul/
    def _count_paul(hand_notes: List[Note]) -> int:
        return sum(
            1 for i in range(1, len(hand_notes))
            if hand_notes[i].x == hand_notes[i-1].x
            and hand_notes[i].y == hand_notes[i-1].y
            and hand_notes[i].direction == hand_notes[i-1].direction
            and 0 < hand_notes[i].beat - hand_notes[i-1].beat <= VIBRO_MAX_INTERVAL
        )
    counts['n_paul'] = _count_paul(left_n) + _count_paul(right_n)

    # --- Quad (HIGH): 4 same-color same-direction notes at the same beat across all lanes ---
    # docs/patterns/quad/
    n_quad = 0
    for grp in beat_slots.values():
        for color in (0, 1):
            hand = [n for n in grp if n.color == color]
            if len(hand) >= 4 and len({n.x for n in hand}) == 4:
                n_quad += 1
    counts['n_quads'] = n_quad

    # ── NEW PATTERNS ──────────────────────────────────────────────────────

    UP_DIRS    = {0, 4, 5}
    DOWN_DIRS  = {1, 6, 7}
    LEFT_DIRS  = {2, 4, 6}
    RIGHT_DIRS = {3, 5, 7}
    LATERAL_DIRS = {2, 3, 4, 5, 6, 7}

    # --- Loloppe (HIGH): same-color, same-direction, adjacent-lane pair at same beat ---
    # docs/patterns/loloppe/
    n_loloppe = 0
    for grp in beat_slots.values():
        for color in (0, 1):
            hand_d = [n for n in grp if n.color == color and n.direction != 8]
            for i in range(len(hand_d)):
                for j in range(i + 1, len(hand_d)):
                    a, b = hand_d[i], hand_d[j]
                    if (a.direction == b.direction and
                            abs(a.x - b.x) == 1 and
                            abs(a.y - b.y) <= 1):
                        n_loloppe += 1
    counts['n_loloppes'] = n_loloppe

    # --- Handclap (MED): red rightward + blue leftward simultaneously (both pointing inward) ---
    # docs/patterns/handclap/
    n_handclap = 0
    for grp in beat_slots.values():
        rd = [n for n in grp if n.color == 0 and n.direction != 8]
        bd = [n for n in grp if n.color == 1 and n.direction != 8]
        for r in rd:
            if r.direction in RIGHT_DIRS:
                for b in bd:
                    if b.direction in LEFT_DIRS:
                        n_handclap += 1
                        break
                break
    counts['n_handclaps'] = n_handclap

    # --- Window (MED): same-color notes in same lane with a layer gap (top+bottom, no middle) ---
    # docs/patterns/window/
    n_window = 0
    for grp in beat_slots.values():
        for color in (0, 1):
            hand = [n for n in grp if n.color == color]
            by_lane: Dict = defaultdict(list)
            for n in hand:
                by_lane[n.x].append(n)
            for lane_notes in by_lane.values():
                if len(lane_notes) >= 2:
                    ys = sorted(n.y for n in lane_notes)
                    if ys[-1] - ys[0] >= 2 and len(lane_notes) < (ys[-1] - ys[0] + 1):
                        n_window += 1
    counts['n_windows'] = n_window

    # --- Flower (LOW): ≥3 same-color notes at same beat with ≥2 distinct directions ---
    # docs/patterns/flower/
    n_flower = 0
    for grp in beat_slots.values():
        for color in (0, 1):
            hand = [n for n in grp if n.color == color]
            if len(hand) >= 3:
                dirs = {n.direction for n in hand if n.direction != 8}
                if len(dirs) >= 2:
                    n_flower += 1
    counts['n_flowers'] = n_flower

    # --- Inline (HIGH): alternating-color consecutive notes at the same (x, y) ---
    # docs/patterns/inline/  (fixed: must alternate color)
    counts['n_inline'] = sum(
        1 for i in range(1, n_notes)
        if notes_s[i].color != notes_s[i-1].color
        and notes_s[i].x == notes_s[i-1].x
        and notes_s[i].y == notes_s[i-1].y
        and 0 < notes_s[i].beat - notes_s[i-1].beat <= 0.5
    )

    # --- Hook (MED): same-hand up/down sequence with both lane and layer repositioning ---
    # docs/patterns/hook/
    def _count_hooks(hand_notes: List[Note]) -> int:
        dir_h = [n for n in hand_notes if n.direction != 8]
        count = 0
        for i in range(1, len(dir_h)):
            prev, curr = dir_h[i-1], dir_h[i]
            if curr.beat - prev.beat > 1.0:
                continue
            both_up   = prev.direction in UP_DIRS   and curr.direction in UP_DIRS
            both_down = prev.direction in DOWN_DIRS and curr.direction in DOWN_DIRS
            if (both_up or both_down) and \
               abs(curr.x - prev.x) >= 1 and abs(curr.y - prev.y) >= 1:
                count += 1
        return count
    counts['n_hooks'] = _count_hooks(left_n) + _count_hooks(right_n)

    # --- Scoop (MED): lateral note → upward note, same hand, bottom layer ---
    # docs/patterns/scoop/
    def _count_scoops(hand_notes: List[Note]) -> int:
        dir_h = [n for n in hand_notes if n.direction != 8]
        count = 0
        for i in range(1, len(dir_h)):
            prev, curr = dir_h[i-1], dir_h[i]
            if curr.beat - prev.beat > 1.0:
                continue
            if prev.direction in LATERAL_DIRS and prev.y == 0 and \
               curr.direction in UP_DIRS:
                count += 1
        return count
    counts['n_scoops'] = _count_scoops(left_n) + _count_scoops(right_n)

    # --- Shrado angle (MED): far-lane outward-diagonal-down → closer-lane upward, span ≥ 2 ---
    # docs/patterns/shrado_angle/
    def _count_shrados(hand_notes: List[Note]) -> int:
        dir_h = [n for n in hand_notes if n.direction != 8]
        count = 0
        for i in range(1, len(dir_h)):
            prev, curr = dir_h[i-1], dir_h[i]
            if curr.beat - prev.beat > 1.5:
                continue
            far_right_down = (prev.x == 3 and prev.direction == 7)
            far_left_down  = (prev.x == 0 and prev.direction == 6)
            if (far_right_down or far_left_down) and \
               curr.direction in UP_DIRS and abs(curr.x - prev.x) >= 2:
                count += 1
        return count
    counts['n_shrados'] = _count_shrados(left_n) + _count_shrados(right_n)

    # --- Arm circle (MED): 4-note same-hand run, x drifts one direction, dirs alternate up/down ---
    # docs/patterns/arm_circle/
    def _count_arm_circles(hand_notes: List[Note]) -> int:
        count = 0
        i = 0
        while i < len(hand_notes) - 3:
            w = hand_notes[i:i+4]
            if any(n.direction == 8 for n in w):
                i += 1
                continue
            if any(w[k+1].beat - w[k].beat > 0.5 for k in range(3)):
                i += 1
                continue
            dxs = [w[k+1].x - w[k].x for k in range(3)]
            if not (all(dx >= 1 for dx in dxs) or all(dx <= -1 for dx in dxs)):
                i += 1
                continue
            dirs = [n.direction for n in w]
            alternates = all(
                (dirs[k] in UP_DIRS) != (dirs[k+1] in UP_DIRS)
                for k in range(3)
            )
            if alternates:
                count += 1
                i += 4
            else:
                i += 1
        return count
    counts['n_arm_circles'] = _count_arm_circles(left_n) + _count_arm_circles(right_n)

    # --- Staircase (MED): ≥3 same-hand consecutive notes where direction points toward next ---
    # docs/patterns/staircase/
    def _count_staircases(hand_notes: List[Note]) -> int:
        count = 0
        run_len = 1
        for i in range(1, len(hand_notes)):
            prev, curr = hand_notes[i-1], hand_notes[i]
            if curr.beat - prev.beat > 1.5:
                if run_len >= 3:
                    count += 1
                run_len = 1
                continue
            dx, dy = curr.x - prev.x, curr.y - prev.y
            if dx == 0 and dy == 0:
                if run_len >= 3:
                    count += 1
                run_len = 1
                continue
            if prev.direction != 8:
                expected = math.degrees(math.atan2(dy, dx)) % 360
                actual   = DIR_ANGLES[prev.direction]
                if _angle_diff(actual, expected) <= 67.5:
                    run_len += 1
                else:
                    if run_len >= 3:
                        count += 1
                    run_len = 1
            else:
                run_len += 1
        if run_len >= 3:
            count += 1
        return count
    counts['n_staircases'] = _count_staircases(left_n) + _count_staircases(right_n)

    # --- Vision block (MED): face note (x∈{1,2}) followed within 0.5 beats by another note ---
    # docs/patterns/vision_block/
    n_vision_block = 0
    for i, n in enumerate(notes_s):
        if n.x not in (1, 2):
            continue
        for j in range(i + 1, n_notes):
            gap = notes_s[j].beat - n.beat
            if gap > 0.5:
                break
            if gap >= 0.0625:
                n_vision_block += 1
                break
    counts['n_vision_blocks'] = n_vision_block

    # --- Jump stream (MED): stream run containing ≥1 same-beat double ---
    # docs/patterns/jump_stream/
    n_js_runs = 0
    n_js_notes = 0
    js_run: list = [notes_s[0]]
    js_has_double = False
    for i in range(1, n_notes):
        prev, curr = notes_s[i-1], notes_s[i]
        iv = curr.beat - prev.beat
        same_slot  = iv <= beat_tol
        alt_single = 0 < iv <= STREAM_MAX_INTERVAL and curr.color != prev.color
        if same_slot or alt_single:
            js_run.append(curr)
            if same_slot and curr.color != prev.color:
                js_has_double = True
        else:
            if len(js_run) >= 4 and js_has_double:
                n_js_runs  += 1
                n_js_notes += len(js_run)
            js_run = [curr]
            js_has_double = False
    if len(js_run) >= 4 and js_has_double:
        n_js_runs  += 1
        n_js_notes += len(js_run)
    counts['n_jump_stream_runs']  = n_js_runs
    counts['n_jump_stream_notes'] = n_js_notes

    # --- Piano stream (MED): stream with monotonically progressing lanes + alternating up/down ---
    # docs/patterns/piano_stream/
    n_piano = 0
    stream_buf: list = [notes_s[0]]
    for i in range(1, n_notes):
        iv = notes_s[i].beat - notes_s[i-1].beat
        if 0 < iv <= STREAM_MAX_INTERVAL and notes_s[i].color != notes_s[i-1].color:
            stream_buf.append(notes_s[i])
        else:
            if len(stream_buf) >= 4:
                for s in range(len(stream_buf) - 3):
                    w = stream_buf[s:s+4]
                    xs = [n.x for n in w]
                    mono = (all(xs[k] < xs[k+1] for k in range(3)) or
                            all(xs[k] > xs[k+1] for k in range(3)))
                    if not mono:
                        continue
                    non_dot = [n.direction for n in w if n.direction != 8]
                    if len(non_dot) >= 3 and all(
                        (non_dot[k] in UP_DIRS) != (non_dot[k+1] in UP_DIRS)
                        for k in range(len(non_dot)-1)
                    ):
                        n_piano += 1
                        break
            stream_buf = [notes_s[i]]
    if len(stream_buf) >= 4:
        for s in range(len(stream_buf) - 3):
            w = stream_buf[s:s+4]
            xs = [n.x for n in w]
            mono = (all(xs[k] < xs[k+1] for k in range(3)) or
                    all(xs[k] > xs[k+1] for k in range(3)))
            if not mono:
                continue
            non_dot = [n.direction for n in w if n.direction != 8]
            if len(non_dot) >= 3 and all(
                (non_dot[k] in UP_DIRS) != (non_dot[k+1] in UP_DIRS)
                for k in range(len(non_dot)-1)
            ):
                n_piano += 1
                break
    counts['n_piano_streams'] = n_piano

    # --- Croissant (MED): 4-note stream where red/blue lane sequences cross (X pattern) ---
    # docs/patterns/croissant/
    n_croissant = 0
    for i in range(n_notes - 3):
        w = notes_s[i:i+4]
        if not all(w[k].color != w[k+1].color for k in range(3)):
            continue
        if not all(0 < w[k+1].beat - w[k].beat <= STREAM_MAX_INTERVAL for k in range(3)):
            continue
        c0xs = [n.x for n in w if n.color == w[0].color]
        c1xs = [n.x for n in w if n.color != w[0].color]
        if len(c0xs) == 2 and len(c1xs) == 2:
            cross = (
                (c0xs[0] > c0xs[1] and c1xs[0] < c1xs[1]) or
                (c0xs[0] < c0xs[1] and c1xs[0] > c1xs[1])
            )
            if cross:
                n_croissant += 1
    counts['n_croissants'] = n_croissant

    # --- Dot spam (MED): ≥4 same-hand dot notes at fixed (x,y), close timing ---
    # docs/patterns/dot_spam/
    n_dot_spam = 0
    for hand_notes in (left_n, right_n):
        dot_h = [n for n in hand_notes if n.direction == 8]
        run_l = 1
        for i in range(1, len(dot_h)):
            if (dot_h[i].x == dot_h[i-1].x and
                    dot_h[i].y == dot_h[i-1].y and
                    dot_h[i].beat - dot_h[i-1].beat <= 0.5):
                run_l += 1
            else:
                if run_l >= 4:
                    n_dot_spam += 1
                run_l = 1
        if run_l >= 4:
            n_dot_spam += 1
    counts['n_dot_spam_runs'] = n_dot_spam

    # --- Groove wall (MED): dodge wall with a note on the opposite side during its window ---
    # docs/patterns/groove_wall/
    n_groove_wall = 0
    if obstacles:
        for obs in obstacles:
            if obs.w > 2 or obs.duration <= 0:
                continue
            obs_end = obs.beat + obs.duration
            wall_notes = [n for n in notes_s
                          if obs.beat - 0.25 <= n.beat <= obs_end + 0.25]
            opposite = [n for n in wall_notes if n.x >= 2] if obs.x <= 1 \
                  else [n for n in wall_notes if n.x <= 1]
            if opposite:
                n_groove_wall += 1
    counts['n_groove_walls'] = n_groove_wall

    # ── BOMB PATTERNS ─────────────────────────────────────────────────────

    if bombs:
        import bisect
        bombs_s = sorted(bombs, key=lambda b: b.beat)
        bomb_beats = [b.beat for b in bombs_s]

        # Bomb reset: bomb exists between two same-hand DD notes
        n_bomb_reset = 0
        for hand_notes in (left_n, right_n):
            dir_h = [n for n in hand_notes if n.direction != 8]
            for i in range(1, len(dir_h)):
                prev, curr = dir_h[i-1], dir_h[i]
                if _angle_diff(DIR_ANGLES[prev.direction],
                               DIR_ANGLES[curr.direction]) < 90:
                    lo = bisect.bisect_right(bomb_beats, prev.beat + beat_tol)
                    hi = bisect.bisect_left(bomb_beats, curr.beat)
                    if lo < hi:
                        n_bomb_reset += 1
        counts['n_bomb_resets'] = n_bomb_reset

        # Bomb hold: ≥3 bombs within 1 beat after a note
        EXIT_DX = {0: 0, 1: 0, 2: -1, 3: 1, 4: -1, 5: 1, 6: -1, 7: 1, 8: 0}
        EXIT_DY = {0: 1, 1:-1,  2: 0,  3: 0,  4: 1,  5: 1,  6:-1,  7:-1, 8: 0}
        n_bomb_hold = 0
        for n in notes_s:
            lo = bisect.bisect_right(bomb_beats, n.beat + 0.0625)
            hi = bisect.bisect_right(bomb_beats, n.beat + 1.0)
            if hi - lo >= 3:
                n_bomb_hold += 1
        counts['n_bomb_holds'] = n_bomb_hold

        # Hammer hit: bomb in note's cut-exit path within 1/8 beat
        n_hammer = 0
        for n in notes_s:
            if n.direction == 8:
                continue
            ex = n.x + EXIT_DX[n.direction]
            ey = n.y + EXIT_DY[n.direction]
            lo = bisect.bisect_right(bomb_beats, n.beat)
            hi = bisect.bisect_right(bomb_beats, n.beat + beat_tol)
            for k in range(lo, hi):
                b = bombs_s[k]
                if abs(b.x - ex) <= 1 and b.y == ey:
                    n_hammer += 1
                    break
        counts['n_hammer_hits'] = n_hammer
    else:
        counts['n_bomb_resets'] = 0
        counts['n_bomb_holds']  = 0
        counts['n_hammer_hits'] = 0

    return counts


# ---------------------------------------------------------------------------
# Feature computation
# ---------------------------------------------------------------------------

def compute_pattern_features(
    notes: List[Note],
    obstacles: List[Obstacle],
    arcs: List[dict],
    chains: List[dict],
    bpm: float,
    bombs: Optional[List[Note]] = None,
) -> Dict:
    """
    Compute all pattern features from a parsed beatmap.
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

    # --- Named pattern counts (see docs/patterns/ for reference images) ---
    pattern_counts = count_patterns(notes, bpm, obstacles=obstacles, bombs=bombs)
    features.update(pattern_counts)

    # Derived pattern rates (normalised by note count for comparability across map lengths)
    for key in (
        'n_doubles', 'n_scissor', 'n_stacks', 'n_towers', 'n_face_notes',
        'n_crossovers', 'n_crossover_scissor', 'n_inline', 'n_dd',
        'n_triangles', 'n_jumps', 'n_inverts', 'n_stream_notes',
        'n_vibro_notes', 'n_flicks', 'n_gallops', 'n_paul', 'n_quads',
        # New patterns
        'n_loloppes', 'n_handclaps', 'n_windows', 'n_flowers',
        'n_hooks', 'n_scoops', 'n_shrados', 'n_arm_circles', 'n_staircases',
        'n_vision_blocks', 'n_jump_stream_notes', 'n_piano_streams',
        'n_croissants', 'n_dot_spam_runs', 'n_groove_walls',
        'n_bomb_resets', 'n_bomb_holds', 'n_hammer_hits',
    ):
        if key in features:
            features[f'{key}_rate'] = features[key] / n_notes

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
