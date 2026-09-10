---
name: web-repro
description: Use when reproducing a web page or UI in code from a reference — a live site or a screenshot — so that it matches at a real viewport rather than only inside a crop, or when a front-end reproduction has stalled with metrics that will not move.
---

# Web Reproduction

**REQUIRED SUB-SKILL:** `vision-loop` — the looking protocol (pinned image-capable routes, 1:1
transport caps, evaluation discipline). This skill covers only what that protocol cannot: the
page-level procedure.

## Overview

**A page is not a picture.** Every rule here exists because region-by-region comparison — the
core of `vision-loop` — is structurally blind to the failures that actually broke a real
reproduction.

Measured on one attempt: MAE **1.37** against the reference capture that attempt had produced,
versus **30.59** against the real site at a real viewport. The loop was measuring its distance
to its own mistake and reporting it as fidelity. The navigation bar scored 3.68 (genuinely
right); the hero copy scored 64.88 while vision agents were calling it a faithful match.

## 0. Capture the reference from reality, not from a convenient viewport

- **Pin the viewport to the acceptance viewport.** Not one you invented. A page with a
  `min-h-[92vh]` hero has a *different total height at every window height* — measured: 2637px
  at a 900px window, 4235px at 2637, 5706px at 4235. Such a page has no single "full page";
  the capture must be tied to a real window size, and the reproduction must be judged at it.
- **Verify completeness.** Ask the page for its own `scrollHeight` and confirm the image is that
  tall. A capture that silently truncates looks exactly like a shorter page.
- **Fire scroll-reveal animations before capturing.** Sections that fade in on scroll render as
  *blank* in a plain headless capture, and **a blank band looks exactly like a designed flat
  band**. Measured: a trailer region and a whole featured-episode section were flat
  (`min == max`) without the reveal pass and full of content (`0…255`) with it. Without this you
  will faithfully reproduce an un-animated skeleton and never know.
- **Capture the fold separately** from the full page; the fold is what the acceptance judgement
  actually looks at.

## 1. Build a structural model before touching pixels

Pixels cannot distinguish "a `<video>` that has not loaded" from "a flat block by design". The
DOM can, in one call (`probe-dom.mjs`). Get, at the acceptance viewport:

- the section list with each section's box and computed height
- which elements are `fixed` (a fixed header is a different element from a static one)
- which are sized in `vh` (these are what make the page viewport-dependent)
- which are `<video>`, `<canvas>`, `<iframe>` — media that will be blank in a static capture
- the container width, so you reproduce the right box rather than a width measured off text

A reproduction built without this will match the pixels of one band and get the page wrong.

## 2. Verify in three ways, not one

| Check | Catches | Blind to |
|---|---|---|
| **Global** — whole page at the acceptance viewport | missing/extra sections, total height, gross layout, viewport dependence | detail |
| **Structural** — boxes and computed sizes vs the model from step 1 | wrong section heights, `fixed` vs static, `vh` dependence, unloaded media | visual character |
| **Local** — 1:1 region crops (`vision-loop`) | type, colour, spacing, detail | framing, structure, anything outside the crop |

Run all three. A local pass alone is what produced the 1.37-vs-30.59 result above.

## 3. Responsive reality

Check `scrollWidth` at a narrower viewport. If the reference is 1440 and yours reports
`scrollWidth: 1440` at a 1280 window, **you have horizontal overflow and the real page does not**
— a defect invisible at the capture width. One viewport reproduced is not the design reproduced;
either reproduce the breakpoints or declare that you reproduced one width.

## 4. Declare what is not reproduced

Say it in the deliverable, not just in your head:

- **Artwork and photographs** — a bitmap is an asset, not code. Placing it means that region is
  excluded from any fidelity claim (comparing it is comparing a file to itself).
- **Fonts** you do not have. Residual error in text regions is usually font substitution, not
  layout — but **verify that claim** (are positions within 1–2px while glyphs differ?) rather
  than asserting it, which is how a real 64.88 MAE got waved through.
- **Video content, hover/focus states, animation, other breakpoints.**

## Common Mistakes

| Mistake | Reality |
|---|---|
| **Accepting your own capture as ground truth** | It is an input you produced. Measure against the real thing at a real viewport |
| **Optimising region crops only** | Guarantees you cannot see a framing error; produced 1.37 vs 30.59 |
| **Capturing at a viewport you invented** | `vh`-sized sections make the page height a function of the window |
| **Reading a blank band as a design decision** | It is usually un-revealed scroll animation or unloaded media |
| **Trusting a metric that stopped moving** | A plateau means your edits stopped moving it, not that the output is right |
| **Attributing a text-region residual to "fonts" without checking** | Verify positions are right and glyphs differ; otherwise it is a layout error |
| **Judging at the capture width only** | Overflow at other widths is invisible there |

## Red Flags — STOP

- You have not verified the capture is complete, at a real viewport, with reveals fired
- Your only comparison is region crops
- You built the page before probing its structure
- A metric has plateaued and you are about to call it done
- You are about to write "the residual is font substitution" without measuring positions
- You reproduced one breakpoint and are about to call it a reproduction

## Bundled Tools

- `../tools/shot-attach.mjs` — render/screenshot over CDP through one long-lived Chrome;
  `--scroll` fires reveal animations first; `--full` for the whole page
- `../tools/probe-dom.mjs` — the structural model in one call: boxes, computed styles, tokens
- `vision-loop/tiles.mjs`, `vision-loop/render-eval.mjs` — via the required sub-skill
