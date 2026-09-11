# The failed attempt

The first reproduction of this page reported **MAE 1.37** as its fidelity. That number compared
the output against **the capture the process itself had produced**, not against the site. Measured
against the real site at a real viewport:

| Compared against | MAE |
|---|---|
| Its own capture | **1.37** ← what was reported as success |
| The real site, first 900px at a 1440×900 window | **30.59** |
| The real site, full page | **47.35** |

Region by region, against the real site:

| Region | MAE |
|---|---|
| navigation bar | 3.68 — genuinely right |
| hero copy | **64.88** — while vision agents were calling it a faithful match |
| hero artwork | 34.08 |
| lower hero | 69.56 |

**The loop was measuring its distance to its own mistake, and reporting it as fidelity.**

## Four failures, each invisible to a region crop

**1. The capture used a viewport as tall as the page.** The capture was taken at 1440×4235. A page
whose hero is `min-h-[92vh]` has a *different total height at every window height* — measured
2637px at a 900px window, 4235px at 2637, 5706px at 4235. So the reference was **1598px taller
than the real page** at a normal window, and the hero was built to 2581px instead of 828px.

**2. The capture was truncated.** The page reports `scrollHeight` 5706 at that viewport; the image
was 4235px. Nothing checked.

**3. Below-the-fold content rendered as blank bands.** The site reveals sections on scroll, and a
plain headless full-page capture never fires those animations. **A blank band is visually identical
to a designed flat band**, so:

- a real `<video>` player was reproduced as an empty `#0a0d13` rectangle
- an entire featured-episode section (`NOW STREAMING / EP01 橱窗里的雨`) was not reproduced at all

Verified later: without the reveal pass those bands measured `min == max == 13` (flat); with
`shot-attach.mjs --scroll` they measured `0…255` (full content).

**4. Pixels could not distinguish an unloaded `<video>` from a flat block by design.** One
`probe-dom.mjs` call would have shown the element list, the `fixed` header, the `92vh` hero and
the media elements. It was never run.

## What the structural model showed, once it was taken

```
div.grain    fixed   1440x900   100vh texture overlay     <- not reproduced at all
header       fixed   1440x57    border-b                  <- built static and borderless
main                 1440x2458  min-h-screen pt-14        <- 56px offset, omitted
  section.hero       1440x828   min-h-[92vh]
  section.trailer    1152x916   wrap py-24, video 1110x624
  section.ep01       1152x363   wrap pb-24
  section.platforms  1440x295   border-t, 80px padding
footer               1440x179
```

## Why nothing in the loop caught any of it

Every iteration asked *"what is different inside this crop?"* — and cropping both sides at identical
coordinates guarantees you can only see differences **inside the crop**. Page structure, a missing
section, a wrong section height, viewport dependence and a truncated reference are all invisible to
it **by construction**: the crop looks self-consistent because it is.

The metric plateaued at 1.37–1.41 across several revisions and was read as convergence. A plateau
means the edits stopped moving that number, not that the output is right.

The reference was never validated. The loop verified against an input it had produced itself, and
had no step that asked whether that input was real.

## Where this ended up

Both failures became rules: `vision-loop` invariant 1 and Rule 0, and the
[`web-repro`](../../web-repro/SKILL.md) procedure — plus `tools/check-reference.mjs`, which now
rejects exactly this capture automatically.

The rebuild in [`README.md`](README.md) is the same page done with those rules in place. Its
score against the real site is **2.20**, and its structure matches to within 1.4px.
