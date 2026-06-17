# Feature Reference

The training data (`pattern_features_merged.csv`) contains ~225 columns. Features prefixed `js_` come from the Node.js annotator (`patterns.js`); all others come from the Python statistical parser (`map_parser.py`).

---

## Grid layout (Beat Saber reference)

Beat Saber's 4×3 note grid is indexed as follows:

```
Layers (y)
  2 (top)    [ ][ ][ ][ ]
  1 (mid)    [ ][ ][ ][ ]
  0 (bottom) [ ][ ][ ][ ]
              0  1  2  3   ← Lanes (x)
           far-L      far-R
```

**Cut directions** — the arrow printed on the block, indicating which way the saber must travel to cut it:

```
4 (↖)  0 (↑)  5 (↗)
2 (←)  8 (•)  3 (→)
6 (↙)  1 (↓)  7 (↘)
```

`8` is a dot note — no required direction, the saber can cut from any angle.

---

## Lane / layer histograms
Fraction of notes in each grid position. All values within an axis sum to 1.

| Feature | Description |
|---------|-------------|
| `lane_0_rate` | Fraction of notes in the far-left lane |
| `lane_1_rate` | Fraction of notes in the centre-left lane |
| `lane_2_rate` | Fraction of notes in the centre-right lane |
| `lane_3_rate` | Fraction of notes in the far-right lane |
| `layer_0_rate` | Fraction of notes on the bottom row |
| `layer_1_rate` | Fraction of notes on the middle row |
| `layer_2_rate` | Fraction of notes on the top row |
| `top_row_rate` | Fraction of notes on the top row (alias for `layer_2_rate`) |

Tech maps tend to have more top-row and far-lane notes; Speed maps cluster towards the centre lanes.

---

## Cut direction histograms
Fraction of notes requiring each cut direction. All 9 values sum to 1.

| Feature | Direction | Notes |
|---------|-----------|-------|
| `dir_0_rate` | ↑ Up | Saber must travel upward |
| `dir_1_rate` | ↓ Down | Saber must travel downward |
| `dir_2_rate` | ← Left | Saber must travel left |
| `dir_3_rate` | → Right | Saber must travel right |
| `dir_4_rate` | ↖ Up-Left | Diagonal upper-left |
| `dir_5_rate` | ↗ Up-Right | Diagonal upper-right |
| `dir_6_rate` | ↙ Down-Left | Diagonal lower-left |
| `dir_7_rate` | ↘ Down-Right | Diagonal lower-right |
| `dir_8_rate` | • Dot | Any direction — no constraint |
| `dot_note_rate` | • Dot | Same as `dir_8_rate`; kept as a standalone feature |

A high `dir_8_rate` / `dot_note_rate` is typical of Speed and Standard maps (dots allow faster streams without needing correct parity). Accuracy maps tend to have very low dot rates.

---

## Hand balance

| Feature | Description |
|---------|-------------|
| `left_note_rate` | Fraction of notes assigned to the left hand (blue saber). Well-balanced maps sit near 0.5; imbalanced tech maps can drift significantly. |
| `hand_imbalance` | `abs(left_note_rate − 0.5) × 2` — 0 means perfectly balanced, 1 means all notes on one hand. |

---

## Parity (double-directional breaks)
In normal play a hand alternates between upswing and downswing. A DD (double-directional) occurs when two consecutive notes on the same hand require the same swing direction, forcing the player to break parity with a wrist reset or reposition.

| Feature | Description |
|---------|-------------|
| `dd_rate_left` | Fraction of left-hand note transitions that are DDs |
| `dd_rate_right` | Fraction of right-hand note transitions that are DDs |
| `dd_rate_total` | Combined DD rate across both hands |

High DD rate is a strong Tech signal. Very low DD rate indicates a map that maintains clean parity throughout (Accuracy, Speed streams).

---

## eBPM (effective BPM per hand)
Measures how fast each hand is swinging independently. A 200 BPM song with 1/4 streams has an eBPM of 200; the same song with 1/8 streams (vibro) has an eBPM of 400.

Formula: `eBPM = bpm × 0.5 / per_hand_interval_beats`

| Feature | Description |
|---------|-------------|
| `ebpm_left_mean` | Average left-hand eBPM across the map |
| `ebpm_left_median` | Median left-hand eBPM (more robust to bursts) |
| `ebpm_left_max` | Peak left-hand eBPM anywhere in the map |
| `ebpm_left_p90` | 90th-percentile left-hand eBPM — captures sustained fast sections without single-note outliers |
| `ebpm_right_{mean,median,max,p90}` | Same statistics for the right hand |
| `ebpm_max_overall` | Maximum eBPM seen on either hand at any point |

---

## Timing variability
Measures how regular or irregular the rhythm is, per hand.

| Feature | Description |
|---------|-------------|
| `interval_cv_left` | Coefficient of variation (std / mean) of inter-note time intervals for the left hand. 0 = perfectly even rhythm (pure stream); high values indicate varied, syncopated, or tech-style rhythms. |
| `interval_cv_right` | Same for the right hand |

---

## Rotation
The angular difference (in degrees) between consecutive cut directions on the same hand. A 180° rotation means the hand reversed direction completely (e.g. up → down). A 0° rotation means two notes in the same direction (a DD).

| Feature | Description |
|---------|-------------|
| `rotation_mean_left` | Mean per-swing rotation on the left hand |
| `rotation_mean_right` | Mean per-swing rotation on the right hand |
| `rotation_mean_total` | Average across both hands |

High rotation (>90°) is typical of Tech maps with complex flow. Speed stream maps tend to have low, consistent rotation (~180° for alternating up/down).

---

## Arcs & chains
Arcs (sliders) connect two notes with a curved path, rewarding a smooth continuous arm motion. Chains (burst sliders) are a head note followed by a trail of small chain links.

| Feature | Description |
|---------|-------------|
| `arc_count` | Total number of arc notes in the map |
| `arc_rate` | Arcs per note — high values indicate an arc-heavy Accuracy-style map |
| `chain_count` | Total number of chain head notes |
| `chain_rate` | Chains per note |

---

## Obstacles (walls)
Obstacles are rectangular barriers the player must dodge or crouch under.

| Feature | Description |
|---------|-------------|
| `dodge_wall_count` | Walls placed in a single lane, requiring a left or right body dodge |
| `dodge_wall_rate` | Dodge walls per note |
| `crouch_wall_count` | Full-width or low-ceiling walls requiring a crouch |
| `crouch_wall_rate` | Crouch walls per note |
| `total_wall_count` | All walls combined |
| `wall_density` | Walls per beat — measures how densely walls are used across the map's duration |

High wall counts and density are associated with Tech and Extreme maps.

---

## Map-level summary

| Feature | Description |
|---------|-------------|
| `note_density` | Notes per beat across the full mapped duration. A 200 BPM map with 4 notes/beat is a dense 1/4 stream. |
| `map_duration_beats` | Total length of the map in beats |
| `double_rate` | Fraction of beats containing a simultaneous left+right note (both hands hit at exactly the same time). High in Standard and Extreme. |
| `crossover_rate` | Fraction of beats where one hand crosses over the other relative to their natural sides. A rough proxy for crossover density before the JS annotator runs. |

---

## NPS (notes per second)
Unlike eBPM (which measures per-hand swing speed), NPS counts all notes combined and is independent of BPM.

| Feature | Description |
|---------|-------------|
| `nps_mapped` | Average notes per second over the mapped section |
| `peak_nps_4beat` | Highest NPS achieved in any 4-beat window — captures short bursts |
| `peak_nps_8beat` | Highest NPS in any 8-beat window — medium-length sections |
| `peak_nps_16beat` | Highest NPS in any 16-beat window — sustained high-density sections |

---

## SPS (swings per second — ScoreSaber swing algorithm)
SPS counts how many scoring swings each hand makes per second, using ScoreSaber's canonical swing-detection algorithm (via bsmap). Unlike NPS it is not inflated by chains or arcs.

| Feature | Description |
|---------|-------------|
| `sps_total_avg` | Mean total SPS (both hands) across the map |
| `sps_total_median` | Median total SPS — less sensitive to quiet sections |
| `sps_total_peak` | Peak total SPS in any window |
| `sps_red_{avg,median,peak}` | Same three statistics for the right hand (red saber) |
| `sps_blue_{avg,median,peak}` | Same three statistics for the left hand (blue saber) |

---

## NJS / jump geometry
All values come from `Info.dat` via bsmap's `NoteJumpSpeed` class. They describe how notes approach the player, not the note patterns themselves.

| Feature | Description |
|---------|-------------|
| `njs` | Note Jump Speed in m/s — how fast blocks fly toward the player. Higher NJS = less time to react but blocks are further away when they spawn. |
| `njs_offset` | Mapper-set spawn offset that shifts the half-jump duration up or down |
| `jump_distance` | Total distance (in metres) a block travels before reaching the player. Affects how spread out or compressed notes appear. |
| `reaction_time` | Time in milliseconds between a note spawning and reaching the player. Low reaction time = harder to read. |
| `hjd` | Half-jump duration in beats — half the window in which notes are visible |
| `jd_optimal_low` / `jd_optimal_high` | The jump-distance range considered optimal for this NJS and BPM, per bsmap's heuristic |
| `jd_delta_low` / `jd_delta_high` | How far the actual JD sits above/below the optimal bounds — a proxy for how "standard" the mapper's NJS choice is |

---

## Windowed features (16-beat windows)
To capture how intensity varies across a map (buildup, drops, burst sections), each of the following base metrics is computed in overlapping 16-beat windows and then summarised with five statistics:

- `max` — highest value seen in any window
- `mean` — average across all windows
- `std` — variability between windows (high = map has very different dense and sparse sections)
- `p90` — 90th-percentile window value (captures sustained intensity without single-window outliers)
- `peak_ratio` — `max / mean` (how much the peak exceeds the average — high = one intense burst in an otherwise moderate map)

Column naming: `win_<metric>_<stat>`, e.g. `win_ebpm_left_p90`.

Base metrics windowed:

| Metric | What it measures per window |
|--------|-----------------------------|
| `note_density` | Notes per beat in that window |
| `ebpm_left` / `ebpm_right` | Per-hand swing speed |
| `dd_rate_left` / `dd_rate_right` | Parity break rate per hand |
| `rotation_left` / `rotation_right` | Average cut-direction change per hand |
| `crossover_rate` | Crossover frequency |
| `top_row_rate` | Top-row note frequency |
| `dot_note_rate` | Dot note frequency |

---

## JS pattern counts (`js_n_*` and `js_n_*_rate`)
Named pattern counts from the JS annotator (`patterns.js`). Each pattern has a raw count (`js_n_<pattern>`) and a rate normalised by total note count (`js_n_<pattern>_rate`).

> **Note:** The JS pattern detector is work-in-progress and not yet fully accurate. Treat these features as approximate signals rather than ground truth.

| Pattern | Description |
|---------|-------------|
| `stream` | Consecutive single-hand alternating notes at stream tempo (typically 1/4 or 1/6 intervals) |
| `vibro_stream` | Extremely fast stream (1/8 or faster) beyond comfortable wrist speed |
| `jump_stream` | Pattern alternating between a double (jump) and a stream note |
| `piano_stream` | Multi-note rapid sequence resembling piano finger rolls |
| `double` | One note per hand hitting simultaneously (both sabers swing at the same time) |
| `stack` | Two or more notes for the same hand in the same beat/column, requiring a wide swing to cover both |
| `tower` | Three or more notes stacked in the same lane/column |
| `quad` | All four grid columns occupied simultaneously (two per hand) |
| `scissor` | Two notes with cuts directed toward each other, so the sabers close like scissor blades |
| `crossover` | A note placed on the opposite side of centre from its natural hand, requiring the arms to cross |
| `crossover_scissor` | A crossover note that is also a scissor cut |
| `dd` | Double-directional — two consecutive notes on the same hand requiring the same cut direction, breaking parity |
| `triangle` | Three same-hand notes whose cut directions form a triangular path (e.g. up → upper-right → right) |
| `inline` | A note landing in the same horizontal lane as the immediately preceding note on that hand |
| `jump` | A wide simultaneous hit where both notes are far apart (e.g. far-left and far-right), requiring a full-body jump motion |
| `invert` | A note whose cut direction is the opposite of what natural parity would expect |
| `flick` | A very fast direction reversal, typically a downswing immediately followed by an upswing with minimal time gap |
| `gallop` | An uneven rhythmic group — one short interval followed by one long, or vice versa (e.g. 1/8 + 1/4) |
| `hook` | A note whose cut direction curves relative to the previous, creating an arc-shaped arm motion |
| `window` | Two notes placed to frame a gap in the centre, through which the opposite hand passes |
| `handclap` | Notes from both hands directed toward each other in the centre of the grid |
| `vision_block` | A note placed directly in front of (and obscuring) another note the player must also hit |
| `face_note` | A note with a cut direction pointing directly at the player (toward the camera) |
| `dot_note` | A note with no required direction (dot) — the saber can hit it from any angle |
| `top_row_note` | A note placed on the top layer of the grid (layer 2), requiring an elevated swing |
| `loloppe` | Two same-hand notes at the same beat with the same cut direction in adjacent lanes (and at most one layer apart) — the hand must cover both blocks in a single wide swing |
| `scoop` | A lateral-direction note on the bottom row immediately followed (within 1 beat) by an upswing — the arm scoops up from the side |
| `shrado` | A far-corner diagonal-down note (↘ at lane 3, or ↙ at lane 0) followed within 1.5 beats by an upswing at least 2 lanes away — a large sweeping motion across the grid |
| `arm_circle` | Four consecutive same-hand notes all moving in the same horizontal direction (all left or all right) while alternating up/down cut direction — the arm traces a circular arc |
| `staircase` | A run of 3+ same-hand notes that each step consistently in the same direction across lanes and/or layers |
| `croissant` | Two same-beat notes (across both hands) whose cut directions point toward each other at an angle of ≤90° — a curved, converging shape |
| `paul` | Two consecutive same-hand notes at the exact same grid position and same cut direction within vibro interval — the hand hits the same spot twice in very quick succession |
| `dot_spam` | A dense cluster of dot notes in quick succession |
| `groove_wall` | A wall timed to the groove/rhythm of the song rather than as an obstacle challenge |
| `bomb_reset` | A bomb placed to force the player to pull their saber away, resetting parity |
| `bomb_hold` | A note followed by 3 or more bombs within 1 beat — the player must hit the note then immediately avoid the surrounding bombs |
| `hammer_hit` | A directional note where a bomb sits adjacent to the saber's exit path at the same beat — the saber would strike the bomb on the follow-through, forcing a controlled stop |
