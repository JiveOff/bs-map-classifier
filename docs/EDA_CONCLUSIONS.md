# EDA Conclusions

What actually separates these five categories in the data? We trained on 493 maps from the BSWC pooling database and looked at which features pull each category apart. The numbers below are medians across all maps in that category. See [`notebooks/category_eda.ipynb`](../notebooks/category_eda.ipynb) for the full analysis.

---

## Tech

The clearest signal for Tech is **crossover rate** — on average, 36% of beats involve a crossover, compared to 14% for Speed and 11% for Accuracy. No other category comes close. Tech maps also use a lot of **lateral cuts** (left and right directions, ~7% each), which makes sense given how much the hands need to move sideways for crossovers. Speed and Accuracy maps have almost none.

One thing that might seem surprising: Tech maps have the **lowest average rotation** (138°) of all five categories. Intuitively you'd expect complex patterns to require lots of direction changes, but crossovers and DDs tend to repeat or reverse directions in a constrained way — the hand doesn't sweep as wide as it does in a clean alternating pattern.

**DDs are frequent** (~9% of transitions), second only to Extreme. **Walls are dense** (0.73 per beat), almost as high as Extreme.

The key takeaway: **Tech is not fast**. Its eBPM and NPS are basically the same as Standard. The difficulty is spatial and directional, not about how quickly you're swinging.

| Metric | Tech | Comparison |
|--------|------|------------|
| Crossover rate | **36%** | Speed 14%, Accuracy 11% |
| DD rate | 9% | Only Extreme is higher |
| Wall density | 0.73/beat | Close to Extreme |
| eBPM (right hand, mean) | 124 | Same as Standard |
| Mean rotation | **138°** | Lowest of all categories |
| Lateral cuts (left+right) | ~14% | Speed and Accuracy: near 0% |

---

## Speed

Speed is what you'd expect — every pace metric is at its peak. **eBPM** (252 right-hand mean, 340 at the 90th percentile), **NPS** (21.8 over 16-beat windows), **SPS** (9.0 peak), and **NJS** (21.5) are all the highest of any category. It's the fastest category across the board.

The movement pattern is almost entirely **linear** — up, down, and diagonals, with virtually no lateral cuts and the lowest crossover rate outside of Accuracy. Speed maps don't make your body move sideways; they make your arms move fast.

Something counterintuitive: Speed maps have the **most rhythmic variability** (highest interval CV) of all categories. That sounds wrong for "stream maps," but it makes sense once you think about it — Speed maps typically alternate between extremely dense stream sections and wide jump intervals. That contrast is what drives the variability, not irregular rhythm within the streams themselves.

**NJS is the highest** of all categories (21.5), which means the **reaction time is the lowest** (0.44 s) — notes come in fast and leave little time to read.

| Metric | Speed | Comparison |
|--------|-------|------------|
| eBPM (right hand, mean) | **252** | Highest of all categories |
| Peak NPS (16-beat window) | **21.8** | Highest of all categories |
| NJS | **21.5** | Highest of all categories |
| Reaction time | **0.44 s** | Lowest — least time to read |
| Lateral cuts | ≈ 0% | Near-absent |
| Crossover rate | 14% | Low |

---

## Accuracy

Accuracy is the easiest category to spot in the data: it's **the lowest on almost everything** — eBPM (59), NPS (4.4 over 16 beats), NJS (13.0), and note count (518). Less notes, slower notes, more time to react (reaction time 0.70 s, the highest of all categories because of the low NJS).

**Parity is extremely clean**: barely any DDs (0.8% of transitions vs 9% for Tech and 10.6% for Extreme). Almost no inverts. The **mean rotation is the highest** of all categories (161°), which reflects exactly what you'd expect from an Accuracy map — the hand cleanly alternates between full upswings and downswings every time.

No lateral cuts, almost no crossovers. The movement is predictable and controlled by design.

One assumption that **doesn't hold** in this dataset: arcs aren't a useful signal for Accuracy. Arc rates are near zero across all five categories — arcs are just rare in this pool, so they don't help separate anything.

| Metric | Accuracy | Comparison |
|--------|----------|------------|
| eBPM (right hand, mean) | **59** | Lowest of all categories |
| Peak NPS (16-beat window) | **4.4** | Lowest of all categories |
| NJS | **13.0** | Lowest of all categories |
| Reaction time | **0.70 s** | Most time to read — highest of all |
| DD rate | **0.8%** | Near-zero — cleanest parity |
| Mean rotation | **161°** | Highest — cleanest alternating swings |

---

## Standard

Standard is the hardest category to pin down because **it doesn't stand out on anything**. Every metric sits somewhere in the middle: crossover rate between Accuracy and Tech, DD rate between Accuracy and Tech, eBPM about the same as Tech, NJS between Accuracy and Speed. Nothing is distinctively high or low.

That means Standard is essentially identified by **not being anything else** — not fast enough for Speed, not complex enough for Tech, not clean enough for Accuracy, not intense enough for Extreme. It's the most versatile category to map for, and the hardest for the classifier to distinguish with confidence.

---

## Extreme

Extreme is best described as **Tech at Speed intensity**. It inherits traits from both:

- From Tech: high crossover rate (32%), high wall density (0.75/beat — the highest of all categories)
- From Speed: high eBPM p90 (320), high NPS, low reaction time (0.44 s)

But it goes beyond both in some respects: the **highest DD rate** (10.6%) and the **highest invert count**. Extreme maps break parity more aggressively than Tech while also being faster than Tech.

Like Speed, it has high rhythmic variability — the same pattern of intense bursts and gaps.

NJS is high (20.5) but just below Speed (21.5). The difference is that Extreme maps layer complexity on top of pace — they're not purely about raw speed.

| Metric | Extreme | Comparison |
|--------|---------|------------|
| DD rate | **10.6%** | Highest of all categories |
| Wall density | **0.75/beat** | Highest of all categories |
| Crossover rate | 32% | High — close to Tech |
| eBPM right p90 | 320 | High — close to Speed |
| NJS | 20.5 | High, slightly below Speed |
| Reaction time | 0.44 s | Low — same as Speed |

---

## Summary

| | Tech | Speed | Accuracy | Standard | Extreme |
|---|---|---|---|---|---|
| **Pace (eBPM / NPS)** | Average | ★ Highest | ★ Lowest | Average | High |
| **Crossover rate** | ★ Highest | Low | Lowest | Medium | High |
| **DD / parity breaks** | High | Medium | ★ Lowest | Low | ★ Highest |
| **Wall density** | High | Low | Low | Low | ★ Highest |
| **NJS** | Average | ★ Highest | ★ Lowest | Average | High |
| **Mean rotation** | ★ Lowest | Medium | ★ Highest | Medium | Low |
| **Lateral cuts** | High | None | None | Low | High |
| **How distinctive** | Strong | Strong | Strong | Weak | Strong |

---

## Things that weren't what we expected

- **Speed has more rhythmic variability than Tech** — stream maps alternate between very dense and very sparse sections, which creates more timing variation than tech patterns do.
- **Tech is not fast** — its eBPM matches Standard. If you removed all the crossovers and walls and just looked at swing speed, Tech would be indistinguishable from a Standard map.
- **Standard has no clear identity in the data** — it's defined by exclusion, not by any feature being notably high or low. This makes it the most frequently confused category.
