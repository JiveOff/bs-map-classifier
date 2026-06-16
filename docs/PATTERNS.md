# Beat Saber Pattern Reference

Grid reference used throughout this document:
- **Lanes (x):** 0 = far-left, 1 = centre-left, 2 = centre-right, 3 = far-right
- **Layers (y):** 0 = bottom, 1 = middle, 2 = top
- **Cut directions:** 0 = Up, 1 = Down, 2 = Left, 3 = Right, 4 = UpLeft, 5 = UpRight, 6 = DownLeft, 7 = DownRight, 8 = Any (dot)
- **Color:** 0 = Red (left hand, canonical lanes 0–1), 1 = Blue (right hand, canonical lanes 2–3)

---

## arc

**Currently detected:** yes (counted as `arc_rate` in map_parser, not in pattern_annotator)
**Detection difficulty:** LOW
**Category signal:** Arc-heavy maps signal Accuracy; arcs are uncommon in Speed/Tech

### What it looks like
An arc is a curved, ribbon-like object that visually connects from one note's exit point, sweeps through space in a curve, and terminates. In the image the arc forms a tall arch shape starting from a down-arrow note at the bottom. The arc is a first-class object in v3/v4 format (`burstSliders` / arc JSON keys) and is distinct from a chain.

### Detection logic
Arcs are stored as separate objects in the beatmap (not as notes). In v3/v4 JSON they appear under the key `sliders` (formal arc objects with `headBeatPos`, `tailBeatPos`, head/tail cut directions, and midpoint anchors). In v2 they appear under `_sliders`.

- Parse arc objects separately from `colorNotes`.
- `arc_rate = n_arcs / total_notes` — simply count arc head objects.
- An arc is detected if any `sliders` (v3) or `_sliders` (v2) entries exist.
- No timing window is needed: each arc object is a single counted event.
- False-positive risk: none — arcs are their own object type and cannot be confused with notes.

Gap: `pattern_annotator.py` does not annotate individual arc occurrences for the viewer; only `map_parser.py` counts them as a rate feature.

---

## arm_circle

**Currently detected:** no
**Detection difficulty:** MED
**Category signal:** Tech, Extreme — indicates large, sweeping arm movements

### What it looks like
The arm_circle image shows a sequence of blue down-arrow notes with a green ellipse overlaid, indicating the circular path the arm travels. The notes progress through different lanes/layers such that successive swings require the arm to reposition perpendicular to the swing direction, tracing a circle. Typically involves vertical swings (up/down) paired with horizontal repositioning across lanes.

### Detection logic
Arm circles are a single-hand sequential pattern. For each hand (color), examine the sorted note list:

1. Collect sequences of 4+ consecutive same-color notes (intervals ≤ 0.5 beats each).
2. The pattern alternates between up/down directions (directions 0/1 or diagonal variants) while also shifting laterally (x changes by ±1–2 per step).
3. Specifically: track the (x, direction) pair across steps. An arm circle occurs when the x displacement between notes runs consistently in one horizontal direction (always increasing or always decreasing) while directions alternate up/down — the arm swings up while moving right, then swings down while continuing right, tracing an arc.
4. Minimum run length: 4 notes.
5. Quantitatively: in 4 consecutive same-color notes, if each step has |Δx| ≥ 1 (all in same direction) AND direction alternates between up-family (0,4,5) and down-family (1,6,7), flag as arm_circle.

Edge cases: crossover-heavy sections can look like arm circles; wrist rotation maps can mimic the pattern without the full arm motion.

---

## bomb_hold

**Currently detected:** no
**Detection difficulty:** LOW
**Category signal:** Tech, Extreme — deliberate use of bombs to constrain arm position

### What it looks like
The bomb_hold image shows a red note and a blue note far apart (outer lanes) at the same beat, followed by a dense corridor of bombs filling the central space in subsequent beats. The intent is to force the player to hold their sabers outward to avoid the bombs. The bombs are placed directly in the swing path the saber would travel after hitting the note.

### Detection logic
Bomb holds require analysing both notes and bomb (mine) objects together:

1. After each note at beat `B`, check the next 0.25–1.0 beats for bomb objects.
2. If ≥ 2 bombs appear within that window AND the bombs are placed in the same lane/layer as the expected post-swing path of that note, flag as bomb_hold.
3. Expected post-swing path: for a down note at lane x, layer y, the saber ends at approximately y=0 (bottom); bombs at (x, 0) or (x±1, 0) shortly after confirm the hold.
4. A simpler heuristic: if bombs appear in 3+ consecutive 1/16-beat slots immediately after a note, count it as bomb_hold.

False-positive risk: dense bomb sections used for visual effect may trigger this without intended hold mechanics.

---

## bomb_reset

**Currently detected:** no
**Detection difficulty:** LOW
**Category signal:** Tech — deliberate parity disruption using bombs

### What it looks like
The bomb_reset image shows two pairs of red+blue notes (one pair at the far ends, one pair closer together) with three bombs placed in a row between the two pairs. The bomb row is placed to force the player's arms to move through the bomb field, resetting their position. The notes before the bombs have a left-direction cut, the notes after have a left-direction cut as well — the bombs force a reset so the same direction can be hit again without a parity break.

### Detection logic
A bomb reset provides a parity reset for a single hand:

1. For each hand (color), find consecutive notes where the second note's direction would be a DD (double directional) relative to the first (angle diff < 90°).
2. Check if ≥ 1 bomb exists between the two notes in beats (between beat[n] and beat[n+1]).
3. If a bomb exists and the direction pair would otherwise be a DD, flag this as bomb_reset.
4. Timing: the bomb must appear at least 1/8 beat after the first note and at least 1/8 beat before the second note.

False-positive risk: decorative bombs placed near notes may trigger this. Additional heuristic: the bomb should be in a lane/layer that is in the path of the saber's return swing.

---

## bomb_spiral

**Currently detected:** no
**Detection difficulty:** LOW
**Category signal:** Tech, Extreme — forces large circular arm motion; rare but distinctive

### What it looks like
The bomb_spiral image shows a large field of bombs arranged in a spiral/helical pattern spreading across the grid — bombs appear at alternating lanes and layers in a rotating sequence. There are no notes visible; the spiral is purely a bomb formation. The player must move their arms in a circular path to avoid all bombs.

### Detection logic
Bomb spirals are sequences of bombs (not notes) forming a spiral:

1. Extract all bomb/mine objects sorted by beat.
2. Identify runs of ≥ 6 bombs within a short time window (e.g., ≤ 2 beats).
3. Within the run, check that the (x, y) positions rotate: e.g., (0,0) → (1,1) → (2,2) → (3,1) → (2,0) → (1,0) or similar circular traversal of the grid.
4. A simpler proxy: if ≥ 8 consecutive bombs span all 4 lanes and at least 2 layers, flag as bomb_spiral.

Counting: increment `n_bomb_spirals` per detected run. This is a map-level decorative element and has low frequency.

---

## chain

**Currently detected:** yes (counted as `chain_rate` in map_parser, not in pattern_annotator)
**Detection difficulty:** LOW
**Category signal:** Accuracy — chains are associated with tech-accuracy hybrid play

### What it looks like
A chain (also called "burst slider" in v3) is a note with a head block (directional arrow) followed by a series of link dots that the player sweeps through in one continuous motion. The image shows a chain of blue note segments cascading diagonally — head arrow at top, followed by dot-like links below it.

### Detection logic
Chains are first-class objects in v3/v4 format:

- In v3 JSON, chains appear under `burstSliders` with fields: head beat, head x/y, head direction, tail beat, tail x/y, and a `sliceCount`.
- In v2 JSON, they may appear under `_sliders` with a specific `_sliderType`.
- Count: `n_chains = len(chain_objects)`.
- `chain_rate = n_chains / total_notes`.
- Each chain object is one chain regardless of link count.

Gap: `pattern_annotator.py` does not annotate chain positions for the viewer.

---

## croissant

**Currently detected:** no
**Detection difficulty:** MED
**Category signal:** Speed, Tech — a specific stream sub-type

### What it looks like
The croissant image shows two pairs of notes arranged in an X shape: a red note pointing right in a far lane and a blue note pointing right in the centre, then a red note pointing left in the centre and a blue note pointing left in a far lane. The path of the saber traces an X or croissant shape. From the glossary: "A stream pattern that has the player swing in the shape of an X."

### Detection logic
Croissant is a stream sub-pattern for a two-hand alternating sequence:

1. Look at consecutive 4-note windows in a stream (alternating R/B, intervals ≤ STREAM_MAX_INTERVAL = 0.28 beats).
2. In a window [R, B, R, B] (or [B, R, B, R]):
   - Notes 1 and 3 (same color) should move left then right (or right then left) in x — crossing direction.
   - Notes 2 and 4 (other color) should mirror the movement.
3. Concretely: in 4 stream notes, if lane sequence goes [outer, inner, outer, inner] or vice versa, AND directions alternate such that consecutive swings cross the center, flag as croissant.
4. Simpler proxy: in a 4-note stream window, if the red notes go from lane 0/1 to lane 2/3 (or vice versa) and the blue notes go in the opposite direction, count as croissant.

False-positive risk: any lateral movement in a stream may partially match; require direction change too (right then left or vice versa).

---

## crossover

**Currently detected:** yes (in pattern_annotator.py)
**Detection difficulty:** HIGH
**Category signal:** Tech — signature Tech pattern

### What it looks like
The crossover image shows a blue note (right hand) placed in lane 0 or 1 (left side), and a red note (left hand) placed in lane 2 or 3 (right side). Each note is on the "wrong" side, forcing the corresponding arm to cross the body's midline. The stagger shows crossovers at different beats, not simultaneous.

### Detection logic
Current implementation in `pattern_annotator.py` (line 139–141):

```python
if (n.color == 0 and n.x >= 2) or (n.color == 1 and n.x <= 1):
    add("crossover", n.beat, [n])
```

This is the correct single-note condition. Every note where a red note is in lanes 2–3 or a blue note is in lanes 0–1 is flagged.

Improvements / gaps:
- The current detector fires on every individual crossover note. To count "crossover runs" (consecutive crossover notes), group consecutive crossover notes within 0.25 beats into a single event.
- Simultaneous crossovers (both hands crossed at the same beat) are more impactful than single crossovers; could distinguish `crossover_single` vs `crossover_double`.
- Crossovers inside a stream warrant a separate sub-type.

---

## crossover_scissor

**Currently detected:** yes (in pattern_annotator.py)
**Detection difficulty:** HIGH
**Category signal:** Tech — extreme Tech variant

### What it looks like
The crossover_scissor image shows a blue note on the left side (lanes 0–1) pointing down and a red note on the right side (lanes 2–3) also pointing down — or both pointing in opposite directions that are nearly opposite (≥150° apart). Both notes are hit simultaneously and both hands are crossed. This is essentially a scissor where both notes are also on the wrong side.

### Detection logic
Current implementation in `pattern_annotator.py` (lines 124–129):

```python
rc = [n for n in rd if n.x >= 2]   # red notes crossed to right side
bc = [n for n in bd if n.x <= 1]   # blue notes crossed to left side
if rc and bc and _angle_diff(_DIR_ANGLES[rc[0].direction],
                             _DIR_ANGLES[bc[0].direction]) >= 150:
    add("crossover_scissor", beat, [rc[0], bc[0]])
    continue
```

Conditions:
- Same timing slot (within 1/8 beat).
- Red note in lanes 2–3 AND blue note in lanes 0–1 (both crossed).
- Both notes have non-dot directions.
- Angle between directions ≥ 150°.

Improvements: the `continue` causes crossover_scissor to skip scissor/double classification for the same beat, which is correct. However dot notes in the crossed positions are excluded (direction != 8); crossed dot notes could be a separate sub-type.

---

## crouch_wall

**Currently detected:** yes (as `crouch_wall_count` in map_parser)
**Detection difficulty:** HIGH
**Category signal:** Tech, Extreme — physical body engagement

### What it looks like
The crouch_wall image shows a very wide, flat red wall that spans across all or most lanes but only occupies the top portion (y = top layer, approximately y ≥ 1.5 in obstacle height terms). The wall forces the player to duck under it.

### Detection logic
In the beatmap format, walls (obstacles) have: `x` (start lane), `w` (width), `y` (start layer), `h` (height, in layers), and duration (beats).

A crouch wall is detected when:
- The obstacle's `y + h > 2` (occupies the top row, y ≥ 2 in 0-indexed layers, or height reaches above middle).
- The obstacle's `w ≥ 2` (wide enough to require ducking, typically spanning ≥ 2 lanes).
- Duration > 0 (not a thin wall).
- Commonly: `y = 2` (top layer) and `h ≥ 1`, or `y = 1, h = 2` (middle+top).

In practice, `map_parser.py` uses: `is_crouch = (obs.y + obs.h) > 1.5` (i.e., the wall extends into the upper half of the play space).

---

## dodge_wall

**Currently detected:** yes (as `dodge_wall_count` in map_parser)
**Detection difficulty:** HIGH
**Category signal:** Tech, Extreme — physical body engagement

### What it looks like
Three images show dodge walls. The dodge_wall.jpg shows a tall vertical wall occupying lanes 2–3 (right side), extending from floor to top, forcing the player to lean left. The facewall.jpg shows a similar wall in lanes 1–2 (center), which is also called a face wall (forces a dodge even from center). The wall.png shows a single-column-wide red wall in the rightmost lane.

### Detection logic
A dodge wall is a wall that forces lateral body movement:

- `x` in {0, 1, 2, 3} and `w` = 1 or 2.
- The wall does NOT extend above the mid-point into crouch territory alone (y = 0 or 1, h = 2 or 3 covering bottom through top).
- Typically: `y = 0` or `y = 1`, and the wall height covers at least the middle layer where arms travel.
- Occupies ≤ 3 lanes but ≥ 1 lane, positioned such that the player cannot stand at center.

In `map_parser.py`: `is_dodge = (obs.y + obs.h) <= 1.5 or obs.h < 2` after excluding crouch walls — essentially any wall that is not a crouch wall is treated as a dodge wall for counting purposes.

Face walls (center lanes 1–2) are a subtype that additionally create vision blocks.

---

## dot_note

**Currently detected:** yes (as `dot_note_rate` in map_parser)
**Detection difficulty:** HIGH
**Category signal:** Speed/Standard — dot-heavy maps allow faster streams; low dot rate signals Accuracy

### What it looks like
A dot note (direction = 8) appears as a cube with a circular dot instead of an arrow. It can be hit from any direction. The bndot.png shows a single blue dot block.

### Detection logic
Simply: `n.direction == 8`.

- `n_dot_notes = sum(1 for n in notes if n.direction == 8)`
- `dot_note_rate = n_dot_notes / total_notes`

This is already fully implemented in `map_parser.py`. No edge cases.

---

## dot_spam

**Currently detected:** no
**Detection difficulty:** MED
**Category signal:** Speed/Standard (when present, signals beginner/lower-quality mapping); note: this is a negative quality pattern

### What it looks like
The dot_spam image shows a long horizontal row of same-color dot notes all at the same layer, filling an entire lane row for multiple consecutive beats. It looks like a dense wall of blue dot cubes lined up in the same position for many beats.

### Detection logic
Dot spam is overuse of dot notes in a fixed position:

1. Collect all dot notes (direction = 8) sorted by beat.
2. Look for runs of ≥ 4 consecutive dot notes of the same color where each note is in the same (x, y) position and intervals ≤ 0.5 beats.
3. A run of dot notes in the exact same lane AND layer for ≥ 4 beats = dot_spam.
4. Alternatively, a broader definition: if dot_note_rate > 0.6 AND most dot notes share only 1–2 (x, y) positions, flag as dot_spam map.

False-positive risk: intentional dot streams are valid; true dot_spam is specifically fixed-position dot notes. The key discriminator is positional fixedness (same x, y across consecutive beats).

---

## double

**Currently detected:** yes (in pattern_annotator.py)
**Detection difficulty:** HIGH
**Category signal:** Standard, Extreme — fundamental pattern in most maps

### What it looks like
The doubles image shows a red note (left, pointing down-left) and a blue note (right, pointing down-right) at the same beat. Both hands hit simultaneously. Two configurations are shown: outer lanes (0 and 3) and inner lanes (1 and 2).

### Detection logic
Current implementation (pattern_annotator.py lines 136):

```python
add("scissor" if is_scissor else "double", beat, reds[:1] + blues[:1])
```

A double is: one red and one blue note within the same 1/8-beat slot, where the directions are NOT scissor (angle diff < 150°). Dot notes on either hand are included in doubles (only excluded from scissor direction check).

Conditions:
- Same timing slot: `|beat_A - beat_B| < BEAT_TOL` (1/8 beat).
- `n.color == 0` (red) and `n.color == 1` (blue) both present.
- Does not qualify as crossover_scissor.
- Directions are not nearly opposite (or either note is a dot).

No improvements needed; the logic is clean.

---

## double_directional

**Currently detected:** yes (as "dd" in pattern_annotator.py)
**Detection difficulty:** HIGH
**Category signal:** Tech (DDs are the defining parity-break pattern); many DDs → Tech

### What it looks like
The double-directionals image shows three blue down-arrow notes in sequence, with red arrows drawn between them indicating the same hand hits consecutive down-cuts. A wrist reset is required between each to avoid playing them as a double-directional.

### Detection logic
Current implementation (pattern_annotator.py lines 168–173):

```python
dh = [n for n in hand if n.direction != 8]
for i in range(1, len(dh)):
    if _angle_diff(_DIR_ANGLES[dh[i-1].direction],
                   _DIR_ANGLES[dh[i].direction]) < 90:
        add("dd", dh[i].beat, [dh[i-1], dh[i]])
```

A DD is: two consecutive non-dot notes of the same color where the angle between their directions is < 90°. The glossary says DDs are "within 45 degree angles of each other" but the implementation uses 90°, which is a slight widening. The 90° threshold may catch wider DDs that the glossary would not count.

Improvements:
- Add a timing filter: DDs within 1.5 beats are most problematic; DDs with > 2 beats gap are often intentional and less bad. Could distinguish `dd_tight` (< 1.5 beats) from `dd_loose`.
- Currently counts every consecutive DD pair, including in multi-DD runs. Could count "DD runs" (≥ 3 consecutive same-direction notes) separately.
- Dot notes are excluded from DD detection, which is correct.

---

## face_note

**Currently detected:** yes (as `n_face_notes` in map_parser)
**Detection difficulty:** HIGH
**Category signal:** Tech, Extreme — also a readability risk

### What it looks like
The face_note image shows a red note (up direction) and a blue note (up direction) both placed in the center two lanes (lanes 1 and 2) at middle layer (y=1) — exactly at face height. Two center notes pointing up appear side by side.

### Detection logic
Face notes are notes in center lanes at face height:

- `n.x in (1, 2)` AND `n.y == 1` (middle layer) — these are in the center two positions at eye level.
- Alternatively, any note in `n.x in (1, 2)` at any layer can be considered a face note in some definitions, but the canonical definition is specifically x ∈ {1,2}, y = 1.

Current implementation in `map_parser.py` likely uses: `n.x in (1, 2)` regardless of y, which is the broader definition.

`n_face_notes_rate = n_face_notes / total_notes`

No edge case issues — this is a pure position check.

---

## flick

**Currently detected:** no
**Detection difficulty:** MED
**Category signal:** Speed — rapid same-hand notes; also appears in Standard

### What it looks like
The flick image shows two red notes and two blue notes in rapid alternation (all pointing right), with the notes at slightly different layers. From the glossary: "A pattern of two or more notes of the same color, typically at 1/4 precision." A flick is essentially a very short same-hand burst requiring a quick wrist motion.

### Detection logic
A flick is a same-color double tap at close timing:

1. For each hand (color), look for ≥ 2 consecutive notes with interval ≤ 0.5 beats (1/4 precision at typical BPM).
2. The notes should NOT be the same direction back-to-back (that would be a DD), OR if they are the same direction, the interval is tight enough that only a flick is possible.
3. Minimum: exactly 2 consecutive same-color notes with interval in [0.125, 0.5] beats.
4. A flick run of 3+ notes is a more severe flick.

The key distinction from a stream: a flick is same-color notes close together, whereas a stream alternates colors. The minimum interval distinguishes flick (≥ 1/16 beat) from vibro (< 1/8 beat per hand).

False-positive risk: gallops (one fast + one slow) can overlap. Require that both notes in the flick have similar intervals (ratio of longer to shorter interval < 2).

---

## flower

**Currently detected:** no
**Detection difficulty:** LOW
**Category signal:** Rare; decorative/accuracy hybrid

### What it looks like
The flower image shows a single red note with 4 other red notes surrounding it at cardinal positions — forming a flower-like arrangement. From the glossary: "A combination of two or more notes that are different directions at the same time, creating a flower-like shape." This is essentially a multi-directional simultaneous note cluster of the same color.

### Detection logic
A flower is a simultaneous multi-directional same-color cluster:

1. In a single timing slot (within 1/8 beat), find ≥ 3 notes of the same color.
2. These notes must have at least 2 different directions (all-dot doesn't count as a flower).
3. The directions should span ≥ 180° arc (e.g., up + down, or left + right, or multiple diagonal directions).
4. A tower/stack is same direction; a flower is different directions at the same time.

Alternatively, the strictest definition: ≥ 4 notes of the same color in one slot with ≥ 3 distinct directions arranged in a radial/flower pattern.

False-positive risk: rarely appears in practice; stacks/towers may be confused if direction check is skipped.

---

## gallop

**Currently detected:** no
**Detection difficulty:** MED
**Category signal:** Standard, Extreme — rhythmic burst pattern

### What it looks like
The gallop image shows: far-left a small red note (right direction) and a small blue note (right direction), then in the centre two larger red and blue notes (down direction) — a rapid pair of singles followed by a double. From the glossary: "A rapid pattern of two single notes followed by a double." Timing is typically [short interval, short interval, longer gap] or two fast singles + a double.

### Detection logic
A gallop is: two single alternating-color notes followed closely by a simultaneous double.

1. Look for a two-note alternating sequence (red then blue, or blue then red) with interval `t1` ≤ 0.25 beats.
2. Immediately after (within `t2` ≤ 0.25 beats), a double (both colors in same slot).
3. The total pattern spans ≤ 0.75 beats.
4. The key timing ratio: `t1 / t2 < 1` (the singles are faster than the gap before the double) OR both t1 and t2 are ≤ 1/4 beat.

Alternatively, a gallop can be:
- Single → Single → Double, where singles are ≤ 1/4 beat apart and the double follows within 1/4 beat.

Count each occurrence of this 3-event pattern as one gallop.

False-positive risk: any fast triple could match; require the third event to actually be a double (both colors in the same slot).

---

## groove_wall

**Currently detected:** no
**Detection difficulty:** LOW
**Category signal:** Tech, Extreme — wall + note combination demanding full-body movement

### What it looks like
The groove_wall image shows a single tall dodge wall (left-center lanes) alongside a blue note (right direction) in the right side. From the glossary: "A wall that is paired with a note that creates a motion involving both arms and body." The player must dodge the wall while simultaneously hitting the note.

### Detection logic
A groove wall is a wall + note occurring at overlapping beats:

1. For each wall (obstacle) at beat `B_wall`, check if any note exists with beat in `[B_wall - 0.25, B_wall + wall_duration + 0.25]`.
2. Additionally, the note must be on the opposite side from the wall: if the wall is in lanes 0–1, the note should be in lanes 2–3, or vice versa.
3. Count each such pair as one groove_wall occurrence.

Simpler implementation: for each dodge wall, if any note's beat overlaps with the wall's time range, flag as groove_wall. The rate = groove_walls / total_walls.

False-positive risk: any note near a wall qualifies; this is a broad pattern.

---

## hammer_hit

**Currently detected:** no
**Detection difficulty:** LOW
**Category signal:** Extreme/Tech — a discouraged pattern; signals aggressive design

### What it looks like
The hammer_hit image shows a blue note (right direction, middle layer) and a red note (down-left direction, bottom layer) near a wall, and immediately after each note (within the same beat) a cluster of bombs occupies the positions directly in the expected follow-through path. From the glossary: "A pattern composed of an arrow block pointing at a bomb, forcing the player to swing their saber at the arrow block but stopping short to avoid the bomb."

### Detection logic
A hammer hit is a note with a bomb immediately in its cut-through path:

1. For a note at beat `B`, direction `d`, lane `x`, layer `y`:
   - Compute the expected exit lane/layer after the cut (the direction the saber moves through after hitting).
   - For direction 0 (Up): saber exits at (x, y+1); for direction 1 (Down): (x, y-1); for direction 3 (Right): (x+1, y); etc.
2. Check if a bomb exists at approximately beat `B` to `B + 1/8` in the exit position.
3. If a bomb is in the direct exit path within 1/8 beat, flag as hammer_hit.

False-positive risk: bombs legitimately placed near notes for visual effect. Require the bomb to be within 1 lane AND same layer as the exit position.

---

## handclap

**Currently detected:** no
**Detection difficulty:** MED
**Category signal:** Standard/Extreme (discouraged pattern, signals aggressive/inconsiderate mapping)

### What it looks like
The handclap image shows a red note (right direction, left side) and a blue note (left direction, right side) at the same beat — both notes point inward toward each other. Both hands are directed toward the centre simultaneously. Also visible is a red note (left direction) and a blue note (right direction) at the same beat in a later variation.

### Detection logic
A handclap is: both hands are directed inward toward each other at the same beat.

For a simultaneous red+blue note pair (within 1/8 beat):
- Red note direction is "rightward" (directions 3, 5, 7) AND blue note direction is "leftward" (directions 2, 4, 6). OR
- Red note is in a right lane (x ≥ 2) pointing left AND blue note is in a left lane (x ≤ 1) pointing right — crossover variant.

More precisely: the red note's angle and the blue note's angle should both point toward the center (approximately opposite outward directions):
- `_DIR_ANGLES[red.direction]` is in [315, 0, 45] (rightward) AND `_DIR_ANGLES[blue.direction]` is in [135, 180, 225] (leftward), OR
- `_angle_diff(red_angle, blue_angle) < 90` with both aimed inward.

Distinction from scissor: in a scissor, notes point AWAY from each other (outward). In a handclap, notes point TOWARD each other (inward).

---

## hitbox_abuse

**Currently detected:** no
**Detection difficulty:** MED
**Category signal:** Tech, Extreme — intentional hitbox exploitation; discouraged but used in tech/extreme

### What it looks like
The hitbox_abuse image shows red and blue notes interleaved closely in lanes 1–2, with the positions clearly overlapping the effective hitbox zones of the opposite color notes. From the glossary: "Notes placed in the pre- or post-swing path of an opposite color note."

### Detection logic
Hitbox abuse occurs when a note is placed where the opposite hand's saber naturally passes:

1. For each note N1 at beat `B1`, direction `d1`, color `c1`, position `(x1, y1)`:
2. For each note N2 at beat `B2` (close in time: `|B2 - B1| ≤ 0.125` beats), different color `c2 ≠ c1`, position `(x2, y2)`:
3. Compute the pre-swing path of N2 (where the saber must come from to hit N2):
   - For direction 0 (Up): saber approaches from y2-1 → y2.
   - For direction 1 (Down): saber approaches from y2+1 → y2.
4. If N1's position (x1, y1) is on this pre- or post-swing path and is within 1 lane of N2's position, flag as hitbox abuse.

Simpler heuristic: two notes of different colors in adjacent lanes (|x1-x2| ≤ 1) within 1/8 beat, where the swing directions would cause the sabers to physically intersect.

False-positive risk: many coincidental placements qualify; this pattern is hard to detect cleanly without full physics simulation. Use as a rate feature rather than precise count.

---

## hook

**Currently detected:** no
**Detection difficulty:** MED
**Category signal:** Standard, Tech — common intermediate pattern

### What it looks like
The hook image shows two blue notes: one at the top row (y=2) and one at the bottom row (y=0), both at similar lanes, both with down arrows. The notes are sequentially hit with the same hand, moving from top to bottom. From the glossary: "A pattern of two sequential up/down blocks of the same color with usually one lane in between. The player's arm makes a hook motion."

### Detection logic
A hook is a same-color two-note sequence with vertical repositioning:

1. For consecutive same-color notes (i, i+1):
2. Both must have direction 0 (Up) or 1 (Down) (or up/down diagonal variants: 4, 5 for up-diag; 6, 7 for down-diag).
3. |x[i] - x[i+1]| ≥ 1 (at least 1 lane apart horizontally).
4. |y[i] - y[i+1]| ≥ 1 (at least 1 layer apart vertically, typically y changes from 0 to 2 or vice versa).
5. Interval ≤ 1.0 beats (close enough for the hook motion to be intended).
6. The two notes have directions in the same "family" (both up or both down).

Count each qualifying pair as one hook.

False-positive risk: any two up-notes with lane difference ≥ 1 would qualify. The "hook" specifically involves the arm making a U/hook shape — require the y change to be ≥ 1 layer.

---

## inline

**Currently detected:** yes (as `n_inline` in map_parser; partially in annotator via pattern logic)
**Detection difficulty:** HIGH
**Category signal:** Tech — same-lane same-layer alternating, forces small precise wrist movement

### What it looks like
The inline image shows three notes in sequence — red, blue, red — all in the exact same lane (x=1) and layer (y=0), hit in alternation. The notes are all down-arrows or similar, and they occupy the same grid position.

### Detection logic
Inline notes are two or more consecutive alternating-color notes in the same (x, y) position:

1. For consecutive pairs (i, i+1) where notes alternate color (color[i] ≠ color[i+1]):
2. Check `x[i] == x[i+1]` AND `y[i] == y[i+1]` (same exact grid cell).
3. Interval ≤ 0.5 beats (close enough to be an intentional inline).
4. Count runs of ≥ 2 qualifying pairs as one inline occurrence.

Inline can also be same-color (two of the same hand in the same position), but the standard definition is alternating colors.

False-positive risk: notes that happen to share a position by coincidence. Require at least 2 consecutive inline pairs to count as an inline run.

---

## invert

**Currently detected:** yes (in pattern_annotator.py)
**Detection difficulty:** HIGH
**Category signal:** Accuracy, Tech — forces large pre-swing and post-swing

### What it looks like
The invert image shows a single red note on the left side and a single blue note pointing leftward (inward/toward center). From the glossary: "Blocks pointing inwards from the outside requiring a larger pre-swing to hit." An invert is a note on the outer lanes pointing toward the center, which requires the arm to first move outward (pre-swing) before swinging inward to hit.

### Detection logic
Current implementation (pattern_annotator.py lines 143–151):

```python
if n.direction != 8:
    if n.color == 0:
        inv = (n.direction in (3, 5, 7) and n.x <= 1) or \
              (n.direction in (2, 4, 6) and n.x >= 2)
    else:
        inv = (n.direction in (2, 4, 6) and n.x >= 2) or \
              (n.direction in (3, 5, 7) and n.x <= 1)
    if inv:
        add("invert", n.beat, [n])
```

Logic:
- Red (left hand), in left lanes (x ≤ 1): pointing RIGHT (direction 3, 5, 7) = invert (pointing away from center toward right).
- Red (left hand), in right lanes (x ≥ 2): pointing LEFT (direction 2, 4, 6) = invert (pointing back toward left across body).
- Blue (right hand): symmetric.

The invert logic for blue appears inverted in the code — blue in x ≥ 2 pointing left (direction 2,4,6) is an invert pointing inward. This seems correct for the blue-hand canonical position (lanes 2–3 pointing inward = left directions). Let me verify: blue canonical position is right side (x 2–3). An invert means it points toward center = leftward directions (2, 4, 6). The condition `n.direction in (2,4,6) and n.x >= 2` is correct for blue invert.

Improvements: the current code counts every invert note individually, which may over-count in invert-heavy sections. Consider counting invert runs.

---

## jump

**Currently detected:** yes (in pattern_annotator.py)
**Detection difficulty:** MED
**Category signal:** Speed, Extreme — large physical movement for one hand

### What it looks like
The jump image shows two blue notes: one in the bottom-left area and one in the top-right area, for the same hand (color) — a single note that requires the arm to travel a large distance to reach the second note. From the glossary: "A pattern that moves across multiple columns horizontally or rows vertically in rapid succession."

### Detection logic
Current implementation (pattern_annotator.py lines 175–179):

```python
for i in range(1, len(hand)):
    dist = math.sqrt((hand[i].x - hand[i-1].x) ** 2 +
                     (hand[i].y - hand[i-1].y) ** 2)
    if dist >= 2:
        add("jump", hand[i].beat, [hand[i-1], hand[i]])
```

A jump is: consecutive same-color notes with Euclidean grid distance ≥ 2. This captures horizontal jumps (Δx ≥ 2), vertical jumps (Δy ≥ 2), and diagonal jumps (e.g., Δx=1, Δy=1 → dist = √2 < 2, so NOT captured — requires larger movement).

Improvements:
- A distance threshold of 2 means only jumps spanning 2+ full lanes/layers are counted. A Δx=2 (e.g., lane 0 to lane 2) gives dist=2, which qualifies. Δx=1 alone (dist=1) does not qualify.
- No timing filter: jumps within 0.5 beats are more demanding than jumps with 2+ beats gap. Could add interval filter `≤ 1.0 beat` to exclude non-demanding far notes.
- Dot notes are included; direction doesn't affect jump detection.

---

## jump_stream

**Currently detected:** no
**Detection difficulty:** MED
**Category signal:** Speed, Extreme — combines stream density with jumps

### What it looks like
The jump_stream image shows alternating red and blue notes in a regular stream pattern (1/4 beat intervals), but with pairs of notes at the same beat interspersed — mixing doubles and singles in the stream. From the glossary: "A pattern that includes jumps within a stream."

### Detection logic
Jump stream is a stream containing jumps (doubles/simultaneous notes):

1. Identify stream segments (alternating color, interval ≤ STREAM_MAX_INTERVAL per pair).
2. Within a stream segment, check if any note pair includes two notes at the same timing slot (a double) rather than alternating singles.
3. A jump stream segment is a stream (≥ 4 notes) where ≥ 1 beat has two notes simultaneously.

Alternative: look for patterns where the interval halves temporarily within a stream — a "jump" in a stream shows as a brief dip to 1/8-beat interval within an otherwise 1/4-beat stream.

Count: `n_jump_stream_runs`, `n_jump_stream_notes`.

False-positive risk: streams near doubles may partially match. Require the double to fall within the stream's timing window (not immediately before/after the stream).

---

## loloppe

**Currently detected:** no
**Detection difficulty:** MED
**Category signal:** Tech, Extreme — hitbox abuse pattern named after mapper Loloppe

### What it looks like
The loloppe image shows four notes in a row: two red notes side by side (lanes 0 and 1) with the same direction (down), followed by two blue notes side by side (lanes 2 and 3) with the same direction (down). All four are at the same beat (or very close), same direction, adjacent lanes. From the glossary: "Two same-direction blocks placed side-by-side such that hitting both blocks requires abusing the block hitbox."

### Detection logic
A loloppe is two same-direction, same-color notes in adjacent lanes at the same beat:

1. In a timing slot (within 1/8 beat), find pairs of same-color notes.
2. Both notes must have the same direction (not dot).
3. The lanes must be adjacent: `|x[a] - x[b]| == 1`.
4. Same layer (y[a] == y[b]) or one layer apart.

This is distinct from a stack (same lane, different layers, same direction) and from a tower (same lane, ≥ 3 notes).

Per the glossary, the key is that both blocks are side-by-side in adjacent lanes with the same direction — the hitbox extends enough that a single swing can hit both, but it requires precise alignment. Count each such pair as one loloppe.

False-positive risk: any adjacent same-direction pair qualifies. This may be more common than the name suggests in some maps. Require the interval to be < 1/8 beat (true simultaneous or nearly so).

---

## parity_reference

**Currently detected:** no (this is a reference/educational folder, not a detectable pattern)
**Detection difficulty:** N/A
**Category signal:** N/A — this folder contains reference images for parity angles

### What it looks like
Five images show the same two blue notes (sequential, same color) at different relative orientations: 0°, 45°, 90°, 135°, 180°. These illustrate the angle between consecutive note directions, used to understand parity and double-directional detection. At 0° both notes point the same way; at 180° they are opposite directions (correct parity flow).

### Detection logic
This is not a standalone pattern but rather the underlying concept behind DD detection. The angle between consecutive same-color note directions determines:
- < 45°: severe DD (same direction)
- 45–89°: mild DD (still parity-breaking)
- 90°: perpendicular (neutral / boundary)
- > 90°: parity-respecting (backhand→forehand or vice versa)
- 180°: perfect parity flow (e.g., up→down)

The `_angle_diff` function in `pattern_annotator.py` implements this. This folder exists purely for documentation of the parity concept.

---

## paul

**Currently detected:** no
**Detection difficulty:** MED
**Category signal:** Tech — extreme accuracy challenge; rare

### What it looks like
The paul image shows a single blue note with a very faint "ghost" cloud of repeated images around it at the same position, representing the same note hit many times in quick succession — or a blurred note that must be cut precisely. From the glossary: "A sequence of inline blocks of the same direction placed at very high precision. This forces the player to hit the sequence with a slow continuous swing."

### Detection logic
A paul is same-color, same-direction, same-position notes at very high precision (very close beats):

1. For same-color notes, find runs where:
   - All notes in the run have the same direction (not dot, direction == d for fixed d).
   - All notes share the same or very close (x, y) position (inline).
   - Intervals between consecutive notes ≤ 1/16 beat (very high precision — this is what forces a slow continuous swing).
2. Minimum run length: 3 notes.

Key distinction from inline: inline allows alternating colors; paul is same-color. Key distinction from flick: paul has the same direction for all notes; a flick may vary direction.

Count: `n_paul_runs`, `n_paul_notes`. Rate: `n_paul_notes / total_notes`.

---

## piano_stream

**Currently detected:** no
**Detection difficulty:** MED
**Category signal:** Speed, Tech — horizontal movement during a stream

### What it looks like
The piano_stream image shows: red note (down), blue note (up), red note (down), blue note (up) — the notes alternate color, alternate direction, AND each note is in a different lane, progressing horizontally across the track like piano keys (left to right or right to left). From the glossary: "A sequence of alternating color and direction blocks that progresses horizontally across lanes on the track."

### Detection logic
A piano stream is an alternating-color stream that additionally moves progressively across lanes:

1. Identify stream segments (alternating color, intervals ≤ STREAM_MAX_INTERVAL).
2. Within the stream, check that the lanes progress monotonically (always increasing x or always decreasing x) for ≥ 4 consecutive notes.
3. Additional check: directions should alternate up/down (or similar alternation) rather than staying constant.
4. Minimum: 4 notes with x[i+1] = x[i] ± 1 for each step.

Count each such run as one piano_stream occurrence.

False-positive risk: any stream with incrementing x positions qualifies, but true piano streams have the directional alternation too. Require BOTH x-progression AND direction-alternation.

---

## quad

**Currently detected:** yes (as `n_quads` in map_parser)
**Detection difficulty:** HIGH
**Category signal:** Extreme — 4-note same-color horizontal cluster

### What it looks like
The quad image shows four blue notes in a row filling all four lanes (0, 1, 2, 3) at the same beat, all pointing left. A quad is four same-color notes across all lanes simultaneously. From the glossary: "A horizontal pattern of four horizontal blocks of the same color across the track."

### Detection logic
A quad is 4 same-color notes in all 4 lanes within the same timing slot:

1. In a timing slot (within 1/8 beat), find all same-color notes.
2. If there are exactly 4 notes of the same color AND they span all 4 lanes (x ∈ {0,1,2,3}), flag as quad.
3. A quad with slightly staggered timing (within 1/8 beat) also counts.

In `map_parser.py`, `n_quads` is counted in `count_patterns()`. The current implementation likely uses slot grouping similar to pattern_annotator.

---

## scissor

**Currently detected:** yes (in pattern_annotator.py)
**Detection difficulty:** HIGH
**Category signal:** Accuracy, Tech — forces precise opposite-direction hits

### What it looks like
The scissor image shows two configurations (OR): red note pointing up + blue note pointing down (or vice versa) at the same beat in their canonical lanes. From the glossary: "When a red and blue note are on the same timing, and are hit simultaneously in opposite directions." Also known as cucumber.

### Detection logic
Current implementation (pattern_annotator.py lines 131–136):

```python
is_scissor = any(
    _angle_diff(_DIR_ANGLES[r.direction], _DIR_ANGLES[b.direction]) >= 150
    for r in rd for b in bd
)
add("scissor" if is_scissor else "double", beat, reds[:1] + blues[:1])
```

A scissor is: simultaneous red+blue notes (within 1/8 beat) where the angle between their directions is ≥ 150°. Dot notes are excluded from direction checks (only non-dot notes are checked: `rd` and `bd`). If all red or all blue notes are dots, the pair is classified as a double instead.

Distinction from crossover_scissor: a scissor has both notes in their canonical side lanes. Crossover_scissor has both notes on the wrong side (checked first, takes priority).

Improvements: the current code handles the multiple-note case by checking any combination of rd and bd pairs, which is correct.

---

## scoop

**Currently detected:** no
**Detection difficulty:** MED
**Category signal:** Standard, Accuracy — fluid scooping motion

### What it looks like
The scoop image shows a red note (right direction, bottom layer) followed by a blue note (up direction, bottom layer) — the hand moves right then curves upward. From the glossary: "A pattern where the player makes a scooping motion. Typically a left or right note followed by an up note in the bottom row."

### Detection logic
A scoop is a two-note sequence (same OR different colors) where:

1. First note: direction is Left (2) or Right (3) or a left/right diagonal, at bottom layer (y=0).
2. Second note: direction is Up (0) or UpLeft (4) or UpRight (5), at bottom layer (y=0).
3. The second note is for the same color as the first, OR both are different colors close in time.
4. Interval between notes: ≤ 1.0 beat.
5. The lane of the up note should be near the exit lane of the left/right note.

Concretely for same-color scoop:
- Note 1: direction in (2, 3, 4, 5, 6, 7) (any lateral direction), y = 0.
- Note 2 (same color, interval ≤ 0.5 beats): direction in (0, 4, 5) (upward direction), y = 0 or y = 1.
- The change in x from note 1 to note 2 should match the expected movement after the lateral cut.

Count each qualifying two-note sequence as one scoop.

---

## shrado_angle

**Currently detected:** no
**Detection difficulty:** MED
**Category signal:** Tech, Extreme — accuracy problem pattern; named after mapper Shrado

### What it looks like
The shrado_angle image (three frames of the same pattern at different approach distances) shows a small blue note in the far lane (x=0 or x=3) with an outward diagonal-down direction, followed by a blue note in a closer lane pointing up. From the glossary: "A pattern consisting of an outward-facing diagonal down block in a far lane followed by an up block of the same color in a closer lane, spanning 3 lanes or more."

### Detection logic
A shrado angle is a same-color two-note sequence:

1. Note 1 (color c): in a far lane (x=0 or x=3), direction is outward diagonal-down:
   - For x=3 (rightmost): direction 7 (DownRight) — pointing away from center and down.
   - For x=0 (leftmost): direction 6 (DownLeft) — pointing away from center and down.
2. Note 2 (same color c, interval ≤ 1.0 beat): direction is Up (0) or UpLeft (4) or UpRight (5), AND lane is at least 2 lanes closer to center from note 1.
   - If note 1 is at x=3, note 2 should be at x ≤ 1 (3+ lane span).
   - If note 1 is at x=0, note 2 should be at x ≥ 2 (3+ lane span).
3. The spanning condition: `|x[2] - x[1]| ≥ 2`.

Count each qualifying pair as one shrado_angle. Rate: `n_shrado_angles / total_notes`.

---

## slider

**Currently detected:** yes (partially — arcs/chains counted; slider notes counted in map_parser as slider-pattern heuristic)
**Detection difficulty:** MED
**Category signal:** Speed, Standard — common technique for note density; distinguishes Accuracy from Speed

### What it looks like
The sliders.png shows three blue notes in a vertical column: a down-arrow note at top, a dot note in the middle, and a dot note at bottom — these are hit in one downward sweep (a slider). The stagger.jpg shows three blue dot notes progressing diagonally at too-wide spacing to be hit in one motion (a stagger/mismap). A proper slider has notes close enough to sweep in one motion.

### Detection logic
A slider (as a note pattern, distinct from the arc/chain object type) is a same-color sequence of same-direction or dot notes at very high precision (close enough to hit in one sweep):

1. Same color, consecutive notes with intervals ≤ 1/8 beat (or ≤ 1/16 beat for high-BPM maps).
2. All notes in the slider are either dots or the same direction.
3. The notes progress in the same lane or adjacent lanes in the direction of the cut.
4. Minimum: 2 notes.

A stagger is a slider with spacing > 1/8 beat (too slow to hit in one motion) — this is a mismap.

In `map_parser.py`, sliders are detected as part of the arc/chain count using the v3/v4 object format. Legacy (v2) sliders are pattern-detected from note timing clusters.

---

## stack

**Currently detected:** yes (in pattern_annotator.py)
**Detection difficulty:** HIGH
**Category signal:** Standard, Extreme — increases swing speed requirement

### What it looks like
The stacks image shows two sets of two notes each: on the left, two blue notes vertically stacked (same lane, layers 0 and 1, both pointing up); on the right, two more blue notes vertically stacked (both pointing down). A stack is exactly 2 same-color, same-lane, same-direction notes at the same beat.

### Detection logic
Current implementation (pattern_annotator.py lines 104–115):

```python
for color in (0, 1):
    hand = [n for n in grp if n.color == color]
    if len(hand) < 2:
        continue
    by_lane: Dict = defaultdict(list)
    for n in hand:
        by_lane[n.x].append(n)
    for col in by_lane.values():
        if len(col) >= 3:
            add("tower", beat, col)
        elif len(col) == 2:
            add("stack", beat, col)
```

A stack is exactly 2 same-color notes in the same lane (x) in the same timing slot (1/8 beat). ≥ 3 notes in the same lane is a tower.

Note: direction is NOT checked — two notes in the same lane regardless of direction are counted as a stack. The glossary says "same-direction" but the implementation allows any direction. This may over-count stacks where notes have opposing directions (which would be a window, not a stack).

Improvement: add a direction check — if the two notes have the same direction, it's a pure stack. If they have different/opposing directions, it may be a window or a different pattern.

---

## staircase

**Currently detected:** no
**Detection difficulty:** MED
**Category signal:** Standard, Tech — natural flow pattern with positional chaining

### What it looks like
The staircase image (two panels) shows notes where each note's direction visually "points toward" the next note's position. For example, a blue note at bottom-left pointing right is followed by a blue note at bottom-right pointing right-up, which points toward the next note at middle-right, etc. Each note's direction indicates the path to the next note.

### Detection logic
A staircase is a same-color sequence where each note's cut direction approximately points toward the next note's position:

1. For consecutive same-color notes (i, i+1), interval ≤ 1.0 beat:
2. Compute the vector from note i's position to note i+1's position: `dx = x[i+1] - x[i]`, `dy = y[i+1] - y[i]`.
3. Compute the expected angle of this vector: `expected_angle = atan2(dy, dx)` (converted to 0–360°).
4. Compare to note i's actual cut direction angle `_DIR_ANGLES[d[i]]`.
5. If `_angle_diff(actual_angle, expected_angle) < 45°`, the note is "pointing toward" the next note.
6. A staircase run is ≥ 3 consecutive notes where each step satisfies this condition.

False-positive risk: any flow-oriented mapping will partially match. To be a true staircase, the positions must actually progress spatially (not stay in one lane), requiring both direction-alignment AND position change.

---

## stream

**Currently detected:** yes (in pattern_annotator.py)
**Detection difficulty:** MED
**Category signal:** Speed — the defining pattern of Speed maps

### What it looks like
Multiple stream images show alternating red/blue notes in rapid succession. The stream.png shows a long alternating sequence with notes in slightly varying lanes but consistent timing. The standard-flow.jpg shows single red and blue notes alternating beat by beat. The lefty-stream and righty-stream images show streams where the starting hand is the left or right respectively — circled pair shows which hand leads.

### Detection logic
Current implementation (pattern_annotator.py lines 153–164):

```python
run = [notes_s[0]]
for i in range(1, n_notes):
    iv = notes_s[i].beat - notes_s[i - 1].beat
    if 0 < iv <= STREAM_MAX_INTERVAL and notes_s[i].color != notes_s[i - 1].color:
        run.append(notes_s[i])
    else:
        if len(run) >= STREAM_MIN_LEN:
            add("stream", run[0].beat, run, f"Stream ×{len(run)}")
        run = [notes_s[i]]
if len(run) >= STREAM_MIN_LEN:
    add("stream", run[0].beat, run, f"Stream ×{len(run)}")
```

A stream is: a run of ≥ 4 notes (STREAM_MIN_LEN=4) where each consecutive pair:
- Has a non-zero interval ≤ 0.28 beats (STREAM_MAX_INTERVAL).
- Alternates color (red→blue→red→blue...).

At 200 BPM, 1/4 beat = 0.075s = 0.075 beats interval. At 0.28 beats max, this covers up to about 1/4 note at 107 BPM — so at higher BPM songs, 1/4 streams are well within the limit.

Improvements:
- Lefty vs righty stream is not currently distinguished. A lefty stream starts with a red note at the bottom (first note of the alternating pair going the same direction is red). Detect by checking which color hits each down-beat.
- "Vibro stream" is a sub-type (see below).
- The current implementation does not reset when two notes of the same color appear; it terminates the stream run.

---

## tower

**Currently detected:** yes (in pattern_annotator.py)
**Detection difficulty:** HIGH
**Category signal:** Extreme, Standard — 3-note vertical cluster

### What it looks like
The tower image shows three red notes at the same lane (x=0) filling all three layers (y=0, 1, 2), all pointing up, on the same beat. On the right side, three blue notes similarly stacked all pointing down. From the glossary: "Three same-colored, same-direction blocks placed in a line on the same beat."

### Detection logic
Current implementation (pattern_annotator.py line 113):

```python
if len(col) >= 3:
    add("tower", beat, col)
```

A tower is ≥ 3 same-color notes in the same lane (x) within the same timing slot (1/8 beat). Direction is not checked in the current implementation (see stack note above).

Improvement: direction check — a tower should have all notes pointing the same direction (or all dots). If notes in the same lane have different directions, this is a window (see `window` pattern below).

---

## triangle

**Currently detected:** no
**Detection difficulty:** MED
**Category signal:** Tech — wrist reset pattern

### What it looks like
The triangle.png shows a 4x3 grid diagram with blue notes connected by red lines forming a triangular path: one note top-center, one note middle-left, one note bottom-center, with lines connecting them in a triangle shape. The label reads "Over time at high precision." The right-triangle.jpg shows a similar arrangement but with a 90° angle in the path.

From the glossary: "Three or more notes forming a triangle pattern with position and orientation, causing a wrist reset due to excessive rotation in one direction."

### Detection logic
A triangle is a same-color 3-note sequence where the saber traces a triangular path (excessive rotational movement in one direction):

1. For 3 consecutive same-color notes (i, i+1, i+2):
2. Compute the "turn angle" from note i to i+1 to i+2:
   - Vector A: from position[i] to position[i+1].
   - Vector B: from position[i+1] to position[i+2].
   - Compute the signed angle between A and B.
3. If the turn is consistently in the same rotational direction (all clockwise or all counter-clockwise) AND the total accumulated rotation ≥ 180°, flag as triangle.
4. A right triangle has a 90° turn in the sequence.

Alternative simpler heuristic:
- Three same-color notes where the positions form a shape with no collinear arrangement (Δx and Δy both non-zero for at least one step).
- Each note direction points roughly toward the next note (staircase property).
- The turns involved total ≥ 180° of rotation — specifically, one of the transitions requires a direction change of ≥ 135°.

False-positive risk: any 3-note curve qualifies. Require minimum rotation accumulation to distinguish from normal flow patterns.

---

## vibro_stream

**Currently detected:** yes (as `n_vibro_notes` in map_parser)
**Detection difficulty:** MED
**Category signal:** Speed, Extreme — extremely fast streams requiring pure wrist motion

### What it looks like
The vibro image shows a long side-by-side block of blue notes and red notes, all jammed together with almost no visible gaps — they are at 1/8 beat spacing or faster, so densely packed that the block looks solid. From the glossary: "An extremely high speed stream of a pace requiring small wrist motions to hit, typically at 1/8 precision."

### Detection logic
A vibro stream is a stream at very high eBPM (≥ 2x song BPM typically):

1. Detect the same as a stream but with interval ≤ 1/8 beat (instead of the 1/4 beat standard stream interval).
2. In practice: alternating-color notes with interval ≤ 0.5 / (BPM / 60 * 2) beats — this corresponds to 1/8 beat at song BPM.
3. A simpler threshold: interval ≤ STREAM_MAX_INTERVAL / 2 (≤ 0.14 beats) for 4+ consecutive notes.
4. Minimum run length: 4 notes.

From `map_parser.py`, vibro is detected using: interval per hand ≤ threshold corresponding to eBPM > 2x song BPM.

Note: vibro specifically applies to arrow notes; dot-note fast sequences are a different pattern (dot spam at high speed).

---

## vision_block

**Currently detected:** no
**Detection difficulty:** MED
**Category signal:** Tech, Extreme — readability/difficulty amplifier

### What it looks like
The vision_block image (vb_example.png) shows red and blue notes in the center lanes (x=1, x=2) at the middle layer, visually blocking the view of other notes behind them. A highlighted note (circled in red) is positioned right behind/above the blocking notes. From the glossary: "A sequence of notes, typically using the middle row, that block the player's vision of the following notes."

### Detection logic
A vision block occurs when a note (or set of notes) in the center of the grid occludes a following note:

1. For each note N at beat B in lane x ∈ {1,2} and layer y ∈ {0,1,2}:
2. Check if any note N' exists at beat B' > B (within 0.25–1.0 beats ahead) that is "behind" N from the player's perspective — i.e., N' is in the same or adjacent lane/layer.
3. A vision block is specifically when a face note (x ∈ {1,2}, y=1) precedes another note by 0.125–0.5 beats.
4. Broader definition: any note at (x ∈ {1,2}, any y) that occludes a following note.

Simpler heuristic: count notes in face-note positions (x ∈ {1,2}) — any cluster of ≥ 2 face notes within 0.25 beats of each other constitutes a potential vision block. Rate: `vb_rate = n_vb_notes / total_notes`.

False-positive risk: face notes in isolation don't necessarily cause vision blocks; the blocking only occurs if another note follows within the reaction window. For feature engineering, using the face-note rate as a proxy for vision block potential is sufficient.

---

## window

**Currently detected:** no
**Detection difficulty:** MED
**Category signal:** Standard, Extreme — visual variety in stacked notes

### What it looks like
The window image shows a configuration similar to a tower but with a gap: two blue notes at the top and bottom of a lane (y=0 and y=2) with an empty space at y=1 — or a three-note stack with the middle note replaced by a note of the opposite color or absent. From the glossary: "A 3-block or larger tower containing a gap allowing for vision through the tower."

### Detection logic
A window is a same-color vertical grouping in a lane that has a gap (missing note in the middle):

1. In a timing slot, for a given color and lane, check all notes present across layers y ∈ {0,1,2}.
2. If notes exist at y=0 and y=2 but NOT y=1 → window (gap in the middle).
3. Alternatively, for larger windows: notes exist at multiple non-consecutive layers with a gap.
4. The key: `max(y) - min(y) ≥ 2` with fewer notes than layers spanned.

Concretely:
- Notes at y=0 and y=2 (layers 0 and 2) in same lane, same timing slot, same color = window.
- The y=1 position is either empty or has the OPPOSITE color note (the latter makes it a face-note + window combination).

A window slider is the same concept applied to a slider: a 3-dot slider with the middle dot removed.

Count: `n_windows`. Rate: `n_windows / total_notes`.

---

*End of pattern reference. Total patterns documented: 45.*
