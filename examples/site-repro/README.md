# Example: reproducing a live website in HTML/CSS

A worked run of `web-repro` on the **structural** artifact class — the case the loop is for. The
reference is [ayasemai.com/zh/](https://ayasemai.com/zh/) (original artwork by the repository
author); the output is hand-written HTML/CSS, not a trace.

This directory previously held a *failed* attempt whose headline score was self-referential and
whose page structure was wrong. That attempt is documented in
[`FAILED-ATTEMPT.md`](FAILED-ATTEMPT.md); this README describes the rebuild.

## Result

Measured against **the real site at the acceptance viewport** — not against a capture of itself:

| Region | MAE |
|---|---|
| header | 3.68 |
| hero | 3.95 |
| trailer band | 0.74 |
| video player | 0.63 |
| featured-episode card | 2.66 |
| platforms band | 1.15 |
| footer | 1.92 |
| **whole page** | **2.20** |

Structure, from `probe-dom.mjs` against the live site, matched to within 1.4px on every section
(header 57, hero 828 = `92vh`, trailer 916, player 624, card section 363, platforms 295, footer
179; total 2636 vs 2637).

Final vision verdicts, from pinned image-capable agents comparing 1:1 pairs:
**hero = faithful match**; player, card and header = close, with the remaining error dominated by
font-file substitution.

![real site left, reproduction right](compare-vs-reference.jpg)

*Left: the real site at 1440×900. Right: the reproduction.*

## Method — what the corrected procedure actually caught

The four invariants of [`vision-loop`](../../vision-loop/SKILL.md), instantiated per
[`web-repro`](../../web-repro/SKILL.md). In order, with what each step caught:

**1. `check-reference.mjs` first.** The first capture was **rejected**: 4235px against a page that
reports 2637px, and viewport-dependent (2637 at h=900, 3134 at h=1440), naming `div.grain` and
`main.min-h-screen` as the causes. Re-captured at 1440×900 with `--scroll`, it passes.

**2. `probe-dom.mjs` before touching pixels.** This is what made the rebuild possible. The real
structure is nothing like what pixels alone suggested:

```
div.grain    fixed   1440x900   100vh texture overlay      <- invisible in a capture
header       fixed   1440x57    border-b                   <- had been built static
main                 1440x2458  min-h-screen pt-14         <- the 56px offset that clears the header
  section.hero       1440x828   min-h-[92vh] overflow-hidden
  section.trailer    1152x916   wrap py-24, contains video 1110x624
  section.ep01       1152x363   wrap pb-24
  section.platforms  1440x295   border-t, 80px padding
footer               1440x179   border-t
```

**3. Three-way verification.** The structural pass immediately caught that the whole page was
56px high — the `pt-14` that clears the fixed header, which a region crop could never reveal.

**4. Region 1:1 pairs for detail.** These found the defects the metrics could not:

- the H1's `20XX` rendering as one merged smear — the reference's Latin is a **Didone**, and
  swapping the span to `Didot` (macOS-supplied) separated all four glyphs to within 5px
- the letterspaced subtitle 31px too wide — the reference's advance sequence is exactly
  `21,21,15,21,21,15,16,16` = 14px font + 7px tracking over nine glyphs with **no spaces**; the
  reproduction had two spaces around the dash
- the featured-episode marker being a filled disc where the reference has a dim soft ring
- the card's text column ~14px too narrow, wrapping one glyph early
- the seek bar reading 55/255 too bright over the video — the frame asset had the reference's own
  seek bar baked into it, so a CSS track drawn on top doubled it

**5. Measure, never take the explanation on trust.** In the same run the comparator claimed the
body text was "printed twice"; direct pixel measurement showed the line-1 ink extent was identical
in both (both ending at x1181), and the claim was a misreading. Conversely my own `--wrap`
statistic was too coarse to see a ring-versus-disc on the nav pill, which the agent's luminance
profile got right.

## What is not reproduced

- **Three bitmaps** (`assets/`): the hero illustration, the portrait video frame, and the
  featured-episode still. A painting is an asset, not code; **those regions are excluded from the
  fidelity claim** — comparing them is comparing a file against itself.
- **Fonts.** The residual in the header (3.68) and hero (3.95) is font-file substitution. Verified
  rather than asserted: every glyph run lands within 1–5px of the reference while the glyph shapes
  differ. Where the reference's *face* was identifiable — the H1's Didone Latin — it was matched
  with an installed font instead of excused.
- **The actual trailer video**, which is a `<video>` on the live site; a still is placed in the
  player and the chrome (controls, seek bar) is rebuilt in CSS.
- Hover/focus states, other breakpoints, and the animation that drives the grain and rain layers
  (both are approximated with CSS gradients).

## Reproduce

```bash
# once: a long-lived render server
B="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$B" --headless --no-sandbox --disable-gpu --disable-breakpad --no-crash-reporter \
     --hide-scrollbars --force-color-profile=srgb --remote-debugging-port=9222 \
     --user-data-dir=/tmp/dsh-chrome about:blank &

# 1. capture at the acceptance viewport, reveals fired
node ../../tools/shot-attach.mjs "https://ayasemai.com/zh/" reference-1440x900.png \
     1440 900 1 --wait=1500 --full --scroll

# 2. GATE: refuse to build on an invalid reference
node ../../tools/check-reference.mjs "https://ayasemai.com/zh/" reference-1440x900.png

# 3. the structural model
node ../../tools/probe-dom.mjs "https://ayasemai.com/zh/" --w=1440 --h=900 \
     --sel="body > *, header, main section, video, footer"

# 4. render and verify globally, structurally, then locally
node ../../tools/shot-attach.mjs index.html mine.png 1440 900 1 --full --scroll
node ../../tools/probe-dom.mjs index.html --w=1440 --h=900 --sel="header, main > section, footer"
```
