"""
Pattern Annotator

Runs pattern detection on parsed beatmap data and returns every named
occurrence with its beat position and constituent notes. Output drives
the HTML viewer and is the ground-truth source for which patterns a map
contains.

Patterns without image/wiki references (parity_reference, slider as an
object type) are omitted; all 44 named patterns from docs/patterns/ that
can be detected from note data are implemented here.
"""

import bisect
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional

_DIR_ANGLES: Dict[int, float] = {
    0: 90.0,   # Up
    1: 270.0,  # Down
    2: 180.0,  # Left
    3: 0.0,    # Right
    4: 135.0,  # UpLeft
    5: 45.0,   # UpRight
    6: 225.0,  # DownLeft
    7: 315.0,  # DownRight
}

# Direction family sets (direction index → semantic group)
_UP_DIRS    = {0, 4, 5}
_DOWN_DIRS  = {1, 6, 7}
_LEFT_DIRS  = {2, 4, 6}
_RIGHT_DIRS = {3, 5, 7}
_LATERAL_DIRS = {2, 3, 4, 5, 6, 7}

BEAT_TOL            = 1 / 8   # 1/8 beat — "same beat" tolerance
STREAM_MAX_INTERVAL = 0.28    # beats — up to slightly above 1/4
VIBRO_MAX_INTERVAL  = 0.14    # beats — 1/8 precision or faster
STREAM_MIN_LEN      = 4

# Saber exit vector per cut direction: where the saber tip goes after the cut
_EXIT_DX = {0: 0, 1: 0, 2: -1, 3: 1, 4: -1, 5: 1, 6: -1, 7: 1, 8: 0}
_EXIT_DY = {0: 1, 1: -1, 2: 0, 3: 0, 4:  1, 5: 1, 6: -1, 7:-1, 8: 0}

PATTERN_COLORS = {
    # ── slot-based (simultaneous) ──────────────────────────────────────────
    "double":            "#f0b429",
    "scissor":           "#f85149",
    "handclap":          "#ff1744",
    "crossover":         "#a371f7",
    "crossover_scissor": "#ff7b72",
    "stack":             "#d29922",
    "tower":             "#db61a2",
    "loloppe":           "#e040fb",
    "window":            "#ff6d00",
    "flower":            "#ff80ab",
    "quad":              "#ff5252",
    # ── per-note ──────────────────────────────────────────────────────────
    "invert":            "#58a6ff",
    "face_note":         "#8b949e",
    "dot_note":          "#6e7681",
    "vision_block":      "#455a64",
    "arc":               "#4dd0e1",
    "chain":             "#81d4fa",
    # ── sequential (single-hand) ──────────────────────────────────────────
    "dd":                "#ffa657",
    "jump":              "#39d353",
    "inline":            "#ff4081",
    "flick":             "#00bcd4",
    "hook":              "#2979ff",
    "scoop":             "#1de9b6",
    "shrado":            "#ea80fc",
    "staircase":         "#00e676",
    "arm_circle":        "#ffab40",
    "triangle":          "#7c4dff",
    "paul":              "#40c4ff",
    "dot_spam":          "#78909c",
    # ── stream / multi-note ───────────────────────────────────────────────
    "stream":            "#3fb950",
    "vibro_stream":      "#c6ff00",
    "jump_stream":       "#69f0ae",
    "gallop":            "#ff7043",
    "piano_stream":      "#18ffff",
    "croissant":         "#f06292",
    # ── obstacle ──────────────────────────────────────────────────────────
    "groove_wall":       "#a5d6a7",
    # ── bomb ──────────────────────────────────────────────────────────────
    "bomb_reset":        "#d50000",
    "bomb_hold":         "#bf360c",
    "hammer_hit":        "#e65100",
}

TYPE_LABELS = {
    "double":            "Double",
    "scissor":           "Scissor",
    "handclap":          "Handclap",
    "crossover":         "Crossover",
    "crossover_scissor": "Crossover Scissor",
    "stack":             "Stack",
    "tower":             "Tower",
    "loloppe":           "Loloppe",
    "window":            "Window",
    "flower":            "Flower",
    "quad":              "Quad",
    "invert":            "Invert",
    "face_note":         "Face Note",
    "dot_note":          "Dot Note",
    "vision_block":      "Vision Block",
    "arc":               "Arc",
    "chain":             "Chain",
    "dd":                "Double Directional",
    "jump":              "Jump",
    "inline":            "Inline",
    "flick":             "Flick",
    "hook":              "Hook",
    "scoop":             "Scoop",
    "shrado":            "Shrado Angle",
    "staircase":         "Staircase",
    "arm_circle":        "Arm Circle",
    "triangle":          "Triangle",
    "paul":              "Paul",
    "dot_spam":          "Dot Spam",
    "stream":            "Stream",
    "vibro_stream":      "Vibro Stream",
    "jump_stream":       "Jump Stream",
    "gallop":            "Gallop",
    "piano_stream":      "Piano Stream",
    "croissant":         "Croissant",
    "groove_wall":       "Groove Wall",
    "bomb_reset":        "Bomb Reset",
    "bomb_hold":         "Bomb Hold",
    "hammer_hit":        "Hammer Hit",
}


def _angle_diff(a1: float, a2: float) -> float:
    diff = abs(a1 - a2) % 360
    return min(diff, 360 - diff)


def _nd(n) -> dict:
    return {"beat": round(n.beat, 4), "x": n.x, "y": n.y,
            "color": n.color, "direction": n.direction}


def annotate_patterns(
    notes,
    obstacles,
    arcs,
    chains,
    bpm: float,
    meta: Optional[dict] = None,
    bombs=None,
) -> dict:
    """
    Detect every named pattern occurrence and return beat position + notes.

    Returns:
      meta       — map metadata
      all_notes  — every parsed note for context rendering
      patterns   — [{type, label, beat, time, notes}] sorted by beat
      colors     — pattern type → CSS hex colour
    """
    notes_s = sorted(notes, key=lambda n: n.beat)
    n_notes = len(notes_s)
    events: List[dict] = []

    def ts(beat: float) -> float:
        return round(beat / bpm * 60, 3)

    def add(ptype: str, beat: float, pnotes, label: str = ""):
        events.append({
            "type":  ptype,
            "label": label or TYPE_LABELS.get(ptype, ptype),
            "beat":  round(beat, 4),
            "time":  ts(beat),
            "notes": [_nd(n) for n in pnotes],
        })

    if n_notes == 0:
        return {"meta": meta or {}, "all_notes": [],
                "patterns": [], "colors": PATTERN_COLORS}

    # ── Group notes into 1/8-beat slots ───────────────────────────────────
    slots: Dict[int, list] = defaultdict(list)
    for n in notes_s:
        slots[round(n.beat / BEAT_TOL)].append(n)

    left_notes  = [n for n in notes_s if n.color == 0]
    right_notes = [n for n in notes_s if n.color == 1]

    # ── 1. SLOT-BASED PATTERNS ────────────────────────────────────────────
    stacks_for_vb: list = []  # (beat, lane) collected for vision_block pass

    for _, grp in sorted(slots.items()):
        beat = min(n.beat for n in grp)
        reds  = [n for n in grp if n.color == 0]
        blues = [n for n in grp if n.color == 1]
        rd    = [n for n in reds  if n.direction != 8]
        bd    = [n for n in blues if n.direction != 8]

        # Stacks / Towers / Flowers (same-color groups)
        for color in (0, 1):
            hand = [n for n in grp if n.color == color]
            if len(hand) < 2:
                continue

            by_lane: Dict = defaultdict(list)
            for n in hand:
                by_lane[n.x].append(n)

            for lane, lane_notes in by_lane.items():
                if len(lane_notes) >= 3:
                    add("tower", beat, lane_notes)
                    stacks_for_vb.append((beat, lane))
                elif len(lane_notes) == 2:
                    add("stack", beat, lane_notes)
                    stacks_for_vb.append((beat, lane))

            # Flower: ≥2 same-color notes at same (x,y) with different directions ≤90° apart
            by_pos: Dict = defaultdict(list)
            for n in hand:
                by_pos[(n.x, n.y)].append(n)
            for pos_notes in by_pos.values():
                dir_pos = [n for n in pos_notes if n.direction != 8]
                if len(dir_pos) >= 2:
                    for pi in range(len(dir_pos)):
                        for pj in range(pi + 1, len(dir_pos)):
                            a, b_n = dir_pos[pi], dir_pos[pj]
                            if _angle_diff(_DIR_ANGLES[a.direction],
                                           _DIR_ANGLES[b_n.direction]) <= 90:
                                add("flower", beat, [a, b_n])

            # Quad: ≥4 same-color notes spanning all 4 lanes
            if len(hand) >= 4 and len({n.x for n in hand}) == 4:
                add("quad", beat, hand)

        # Window: any note at y=0 AND y=2 with no note at y=1 in the slot
        all_ys = {n.y for n in grp}
        if 0 in all_ys and 2 in all_ys and 1 not in all_ys:
            add("window", beat, grp)

        # Loloppe: same-color, same-direction, adjacent-lane pair
        for color in (0, 1):
            hand_d = [n for n in grp if n.color == color and n.direction != 8]
            seen = set()
            for i in range(len(hand_d)):
                for j in range(i + 1, len(hand_d)):
                    a, b = hand_d[i], hand_d[j]
                    if (a.direction == b.direction and
                            abs(a.x - b.x) == 1 and
                            abs(a.y - b.y) <= 1 and
                            (i, j) not in seen):
                        add("loloppe", beat, [a, b])
                        seen.add((i, j))

        if not (reds and blues):
            continue

        # Crossover scissor — most specific, checked first
        rc = [n for n in rd if n.x >= 2]
        bc = [n for n in bd if n.x <= 1]
        if rc and bc and _angle_diff(_DIR_ANGLES[rc[0].direction],
                                     _DIR_ANGLES[bc[0].direction]) >= 150:
            add("crossover_scissor", beat, [rc[0], bc[0]])
            continue

        # Handclap: red rightward + blue leftward, notes adjacent (|Δx| ≤ 1)
        for r in rd:
            for b in bd:
                if (r.direction in _RIGHT_DIRS and b.direction in _LEFT_DIRS
                        and abs(r.x - b.x) <= 1):
                    add("handclap", beat, [r, b])
                    break
            else:
                continue
            break

        # Scissor or Double
        is_scissor = any(
            _angle_diff(_DIR_ANGLES[r.direction], _DIR_ANGLES[b.direction]) >= 150
            for r in rd for b in bd
        )
        add("scissor" if is_scissor else "double", beat, reds[:1] + blues[:1])

    # ── 2. PER-NOTE PATTERNS ──────────────────────────────────────────────
    for n in notes_s:
        # Crossover
        if (n.color == 0 and n.x >= 2) or (n.color == 1 and n.x <= 1):
            add("crossover", n.beat, [n])

        # Invert
        if n.direction != 8:
            if n.color == 0:
                inv = (n.direction in _RIGHT_DIRS and n.x <= 1) or \
                      (n.direction in _LEFT_DIRS  and n.x >= 2)
            else:
                inv = (n.direction in _LEFT_DIRS  and n.x >= 2) or \
                      (n.direction in _RIGHT_DIRS and n.x <= 1)
            if inv:
                add("invert", n.beat, [n])

        # Face note
        if n.x in (1, 2):
            add("face_note", n.beat, [n])

        # Dot note
        if n.direction == 8:
            add("dot_note", n.beat, [n])

    # Vision block: stack/tower hiding a following note in same/adjacent lane
    _note_beats = [n.beat for n in notes_s]
    for stack_beat, stack_lane in stacks_for_vb:
        lo = bisect.bisect_right(_note_beats, stack_beat + 0.0624)
        hi = bisect.bisect_right(_note_beats, stack_beat + 0.5)
        for k in range(lo, hi):
            if abs(notes_s[k].x - stack_lane) <= 1:
                add("vision_block", stack_beat, [notes_s[k]])
                break

    # Arcs
    for arc in (arcs or []):
        beat = float(arc.get('b', arc.get('_time', arc.get('headBeatPos', 0))))
        events.append({
            "type": "arc", "label": "Arc",
            "beat": round(beat, 4), "time": ts(beat), "notes": [],
        })

    # Chains
    for ch in (chains or []):
        beat = float(ch.get('b', ch.get('_time', 0)))
        events.append({
            "type": "chain", "label": "Chain",
            "beat": round(beat, 4), "time": ts(beat), "notes": [],
        })

    # ── 3. SEQUENTIAL SINGLE-HAND PATTERNS ───────────────────────────────
    for hand, hand_notes in ((0, left_notes), (1, right_notes)):
        dir_notes = [n for n in hand_notes if n.direction != 8]

        # DD (double directional / parity break)
        for i in range(1, len(dir_notes)):
            if _angle_diff(_DIR_ANGLES[dir_notes[i-1].direction],
                           _DIR_ANGLES[dir_notes[i].direction]) < 90:
                add("dd", dir_notes[i].beat, [dir_notes[i-1], dir_notes[i]])

        # Jump: same-hand spatial jump ≥2 grid units
        for i in range(1, len(hand_notes)):
            dist = math.sqrt((hand_notes[i].x - hand_notes[i-1].x) ** 2 +
                             (hand_notes[i].y - hand_notes[i-1].y) ** 2)
            if dist >= 2:
                add("jump", hand_notes[i].beat, [hand_notes[i-1], hand_notes[i]])

        # Inline: alternating-color consecutive notes at same (x, y)
        # (detected below in the full-note loop, not per-hand)

        # Flick: same-hand consecutive notes within stream interval
        for i in range(1, len(hand_notes)):
            iv = hand_notes[i].beat - hand_notes[i-1].beat
            if 0 < iv <= STREAM_MAX_INTERVAL:
                add("flick", hand_notes[i].beat, [hand_notes[i-1], hand_notes[i]])

        # Paul: same-position, same-direction, ultra-close same-hand notes
        for i in range(1, len(hand_notes)):
            iv = hand_notes[i].beat - hand_notes[i-1].beat
            if (hand_notes[i].x == hand_notes[i-1].x and
                    hand_notes[i].y == hand_notes[i-1].y and
                    hand_notes[i].direction == hand_notes[i-1].direction and
                    hand_notes[i].direction != 8 and
                    0 < iv <= VIBRO_MAX_INTERVAL):
                add("paul", hand_notes[i].beat, [hand_notes[i-1], hand_notes[i]])

        # Hook: direction reversal (down→up or up→down), same layer, adjacent lanes
        for i in range(1, len(dir_notes)):
            prev, curr = dir_notes[i-1], dir_notes[i]
            if curr.beat - prev.beat > 1.0:
                continue
            reversal = (prev.direction in _DOWN_DIRS and curr.direction in _UP_DIRS) or \
                       (prev.direction in _UP_DIRS   and curr.direction in _DOWN_DIRS)
            if reversal and abs(curr.x - prev.x) <= 1 and curr.y == prev.y:
                add("hook", curr.beat, [prev, curr])

        # Scoop: lateral note → upward note
        for i in range(1, len(dir_notes)):
            prev, curr = dir_notes[i-1], dir_notes[i]
            if curr.beat - prev.beat > 1.0:
                continue
            if prev.direction in _LATERAL_DIRS and prev.y == 0 and \
               curr.direction in _UP_DIRS:
                add("scoop", curr.beat, [prev, curr])

        # Shrado angle: far-lane outward-diagonal-down → closer-lane up (span ≥ 2 lanes)
        for i in range(1, len(dir_notes)):
            prev, curr = dir_notes[i-1], dir_notes[i]
            if curr.beat - prev.beat > 1.5:
                continue
            is_far_right_down = (prev.x == 3 and prev.direction == 7)
            is_far_left_down  = (prev.x == 0 and prev.direction == 6)
            if (is_far_right_down or is_far_left_down) and \
               curr.direction in _UP_DIRS and \
               abs(curr.x - prev.x) >= 2:
                add("shrado", curr.beat, [prev, curr])

        # Arm circle: 4-note run, x drifts one direction, directions alternate up/down
        for i in range(len(hand_notes) - 3):
            w = hand_notes[i:i+4]
            if any(n.direction == 8 for n in w):
                continue
            if any(w[k+1].beat - w[k].beat > 0.5 for k in range(3)):
                continue
            dxs = [w[k+1].x - w[k].x for k in range(3)]
            if not (all(dx >= 1 for dx in dxs) or all(dx <= -1 for dx in dxs)):
                continue
            dirs = [n.direction for n in w]
            alternates = all(
                (dirs[k] in _UP_DIRS) != (dirs[k+1] in _UP_DIRS)
                for k in range(3)
            )
            if alternates:
                add("arm_circle", w[0].beat, w, "Arm Circle")

        # Staircase: ≥3 consecutive same-hand notes where direction points toward next
        run_start = 0
        run_len   = 1
        for i in range(1, len(hand_notes)):
            prev, curr = hand_notes[i-1], hand_notes[i]
            if curr.beat - prev.beat > 1.5:
                if run_len >= 3:
                    add("staircase", hand_notes[run_start].beat,
                        hand_notes[run_start:i], f"Staircase ×{run_len}")
                run_start = i
                run_len   = 1
                continue
            dx = curr.x - prev.x
            dy = curr.y - prev.y
            if dx == 0 and dy == 0:
                if run_len >= 3:
                    add("staircase", hand_notes[run_start].beat,
                        hand_notes[run_start:i], f"Staircase ×{run_len}")
                run_start = i
                run_len   = 1
                continue
            if prev.direction != 8:
                expected  = math.degrees(math.atan2(dy, dx)) % 360
                actual    = _DIR_ANGLES[prev.direction]
                if _angle_diff(actual, expected) <= 67.5:
                    run_len += 1
                else:
                    if run_len >= 3:
                        add("staircase", hand_notes[run_start].beat,
                            hand_notes[run_start:i], f"Staircase ×{run_len}")
                    run_start = i
                    run_len   = 1
            else:
                run_len += 1
        if run_len >= 3:
            add("staircase", hand_notes[run_start].beat,
                hand_notes[run_start:], f"Staircase ×{run_len}")

        # Triangle: ≥3 same-hand notes with consistent CW/CCW rotation ≥ 180° total
        for i in range(2, len(dir_notes)):
            a0 = _DIR_ANGLES[dir_notes[i-2].direction]
            a1 = _DIR_ANGLES[dir_notes[i-1].direction]
            a2 = _DIR_ANGLES[dir_notes[i].direction]
            d1 = (a1 - a0 + 360) % 360
            d2 = (a2 - a1 + 360) % 360
            cw1 = d1 < 180
            cw2 = d2 < 180
            if cw1 == cw2 and 0 < d1 < 180 and 0 < d2 < 180 and d1 + d2 >= 180:
                add("triangle", dir_notes[i-2].beat,
                    [dir_notes[i-2], dir_notes[i-1], dir_notes[i]])

        # Dot spam: ≥4 consecutive same-hand dot notes at fixed (x, y)
        dot_h = [n for n in hand_notes if n.direction == 8]
        run_s, run_l = 0, 1
        for i in range(1, len(dot_h)):
            if (dot_h[i].x == dot_h[i-1].x and
                    dot_h[i].y == dot_h[i-1].y and
                    dot_h[i].beat - dot_h[i-1].beat <= 0.5):
                run_l += 1
            else:
                if run_l >= 4:
                    add("dot_spam", dot_h[run_s].beat, dot_h[run_s:i],
                        f"Dot Spam ×{run_l}")
                run_s, run_l = i, 1
        if run_l >= 4:
            add("dot_spam", dot_h[run_s].beat, dot_h[run_s:], f"Dot Spam ×{run_l}")

    # Inline: alternating-color consecutive notes at same (x, y) with parity
    for i in range(1, n_notes):
        prev, curr = notes_s[i-1], notes_s[i]
        if not (curr.color != prev.color and
                curr.x == prev.x and curr.y == prev.y and
                0 < curr.beat - prev.beat <= 0.5):
            continue
        # Parity check: if both have directions, they must be in opposite families
        if prev.direction != 8 and curr.direction != 8:
            if (prev.direction in _UP_DIRS) == (curr.direction in _UP_DIRS):
                continue
        add("inline", curr.beat, [prev, curr])

    # ── 4. STREAM AND MULTI-NOTE PATTERNS ────────────────────────────────

    # Standard stream
    run = [notes_s[0]]
    for i in range(1, n_notes):
        iv = notes_s[i].beat - notes_s[i-1].beat
        if 0 < iv <= STREAM_MAX_INTERVAL and notes_s[i].color != notes_s[i-1].color:
            run.append(notes_s[i])
        else:
            if len(run) >= STREAM_MIN_LEN:
                add("stream", run[0].beat, run, f"Stream ×{len(run)}")
            run = [notes_s[i]]
    if len(run) >= STREAM_MIN_LEN:
        add("stream", run[0].beat, run, f"Stream ×{len(run)}")

    # Vibro stream (≤ VIBRO_MAX_INTERVAL, ≥4 alternating notes)
    vrun = [notes_s[0]]
    for i in range(1, n_notes):
        iv = notes_s[i].beat - notes_s[i-1].beat
        if 0 < iv <= VIBRO_MAX_INTERVAL and notes_s[i].color != notes_s[i-1].color:
            vrun.append(notes_s[i])
        else:
            if len(vrun) >= STREAM_MIN_LEN:
                add("vibro_stream", vrun[0].beat, vrun, f"Vibro ×{len(vrun)}")
            vrun = [notes_s[i]]
    if len(vrun) >= STREAM_MIN_LEN:
        add("vibro_stream", vrun[0].beat, vrun, f"Vibro ×{len(vrun)}")

    # Jump stream: stream-like sequence that includes same-beat doubles
    js_run: list = [notes_s[0]]
    js_has_double = False
    for i in range(1, n_notes):
        prev, curr = notes_s[i-1], notes_s[i]
        iv = curr.beat - prev.beat
        same_slot = iv <= BEAT_TOL
        alt_single = 0 < iv <= STREAM_MAX_INTERVAL and curr.color != prev.color
        if same_slot or alt_single:
            js_run.append(curr)
            if same_slot and curr.color != prev.color:
                js_has_double = True
        else:
            if len(js_run) >= STREAM_MIN_LEN and js_has_double:
                add("jump_stream", js_run[0].beat, js_run,
                    f"Jump Stream ×{len(js_run)}")
            js_run = [curr]
            js_has_double = False
    if len(js_run) >= STREAM_MIN_LEN and js_has_double:
        add("jump_stream", js_run[0].beat, js_run, f"Jump Stream ×{len(js_run)}")

    # Gallop: R-B-B or B-R-R within tight window (same-color sandwich)
    for i in range(1, n_notes - 1):
        a, b, c = notes_s[i-1], notes_s[i], notes_s[i+1]
        span = c.beat - a.beat
        if span > STREAM_MAX_INTERVAL * 2:
            continue
        if a.color == c.color and a.color != b.color:
            add("gallop", a.beat, [a, b, c])

    # Piano stream: alternating-color stream with monotonically progressing lanes
    prun: list = [notes_s[0]]
    for i in range(1, n_notes):
        iv = notes_s[i].beat - notes_s[i-1].beat
        if 0 < iv <= STREAM_MAX_INTERVAL and notes_s[i].color != notes_s[i-1].color:
            prun.append(notes_s[i])
        else:
            if len(prun) >= 4:
                # Scan for 4-note windows with monotone x AND alternating up/down
                for s in range(len(prun) - 3):
                    w = prun[s:s+4]
                    xs = [n.x for n in w]
                    inc = all(xs[k] < xs[k+1] for k in range(3))
                    dec = all(xs[k] > xs[k+1] for k in range(3))
                    if not (inc or dec):
                        continue
                    dirs = [n.direction for n in w]
                    non_dot = [(k, d) for k, d in enumerate(dirs) if d != 8]
                    if len(non_dot) >= 3:
                        alt = all(
                            (non_dot[k][1] in _UP_DIRS) != (non_dot[k+1][1] in _UP_DIRS)
                            for k in range(len(non_dot) - 1)
                        )
                        if alt:
                            add("piano_stream", w[0].beat, w, "Piano Stream")
                            break
            prun = [notes_s[i]]
    if len(prun) >= 4:
        for s in range(len(prun) - 3):
            w = prun[s:s+4]
            xs = [n.x for n in w]
            if not (all(xs[k] < xs[k+1] for k in range(3)) or
                    all(xs[k] > xs[k+1] for k in range(3))):
                continue
            dirs = [n.direction for n in w]
            non_dot = [(k, d) for k, d in enumerate(dirs) if d != 8]
            if len(non_dot) >= 3:
                alt = all(
                    (non_dot[k][1] in _UP_DIRS) != (non_dot[k+1][1] in _UP_DIRS)
                    for k in range(len(non_dot) - 1)
                )
                if alt:
                    add("piano_stream", w[0].beat, w, "Piano Stream")
                    break

    # Croissant: 4-note stream where red and blue lane sequences cross (X pattern)
    for i in range(n_notes - 3):
        w = notes_s[i:i+4]
        if not all(w[k].color != w[k+1].color for k in range(3)):
            continue
        if not all(0 < w[k+1].beat - w[k].beat <= STREAM_MAX_INTERVAL for k in range(3)):
            continue
        c0_xs = [n.x for n in w if n.color == w[0].color]
        c1_xs = [n.x for n in w if n.color != w[0].color]
        if len(c0_xs) == 2 and len(c1_xs) == 2:
            cross = (
                (c0_xs[0] > c0_xs[1] and c1_xs[0] < c1_xs[1]) or
                (c0_xs[0] < c0_xs[1] and c1_xs[0] > c1_xs[1])
            )
            if cross:
                add("croissant", w[0].beat, w)

    # ── 5. OBSTACLE PATTERNS ─────────────────────────────────────────────

    # Groove wall: dodge wall with a note on the opposite side during its window
    for obs in (obstacles or []):
        if obs.w > 2 or obs.duration <= 0:
            continue
        obs_end = obs.beat + obs.duration
        wall_notes = [n for n in notes_s
                      if obs.beat - 0.25 <= n.beat <= obs_end + 0.25]
        if obs.x <= 1:
            opposite = [n for n in wall_notes if n.x >= 2]
        else:
            opposite = [n for n in wall_notes if n.x <= 1]
        if opposite:
            add("groove_wall", obs.beat, opposite[:2], "Groove Wall")

    # ── 6. BOMB PATTERNS ─────────────────────────────────────────────────

    if bombs:
        bombs_s = sorted(bombs, key=lambda b: b.beat)
        bomb_beats = [b.beat for b in bombs_s]

        # Bomb reset: bomb between two same-hand DD notes
        for hand_notes in (left_notes, right_notes):
            dir_h = [n for n in hand_notes if n.direction != 8]
            for i in range(1, len(dir_h)):
                prev, curr = dir_h[i-1], dir_h[i]
                if _angle_diff(_DIR_ANGLES[prev.direction],
                               _DIR_ANGLES[curr.direction]) < 90:
                    lo = bisect.bisect_right(bomb_beats, prev.beat + BEAT_TOL)
                    hi = bisect.bisect_left(bomb_beats, curr.beat)
                    if lo < hi:
                        add("bomb_reset", prev.beat, [prev, curr])

        # Bomb hold: ≥3 bombs within 1 beat after a note
        for n in notes_s:
            lo = bisect.bisect_right(bomb_beats, n.beat + 0.0625)
            hi = bisect.bisect_right(bomb_beats, n.beat + 1.0)
            if hi - lo >= 3:
                add("bomb_hold", n.beat, [n])

        # Hammer hit: bomb in cut-exit path within 1/8 beat
        for n in notes_s:
            if n.direction == 8:
                continue
            ex = n.x + _EXIT_DX[n.direction]
            ey = n.y + _EXIT_DY[n.direction]
            lo = bisect.bisect_right(bomb_beats, n.beat)
            hi = bisect.bisect_right(bomb_beats, n.beat + BEAT_TOL)
            for k in range(lo, hi):
                b = bombs_s[k]
                if abs(b.x - ex) <= 1 and b.y == ey:
                    add("hammer_hit", n.beat, [n])
                    break

    events.sort(key=lambda e: e["beat"])

    return {
        "meta":      meta or {},
        "all_notes": [_nd(n) for n in notes_s],
        "patterns":  events,
        "colors":    PATTERN_COLORS,
    }


def generate_viewer_html(data: dict, template_path: Optional[Path] = None) -> str:
    """Embed annotation data into the viewer HTML template."""
    if template_path is None:
        template_path = Path(__file__).parent.parent.parent / "viewer" / "index.html"
    template = template_path.read_text(encoding="utf-8")
    return template.replace("%%MAP_DATA%%", json.dumps(data, separators=(",", ":")))
