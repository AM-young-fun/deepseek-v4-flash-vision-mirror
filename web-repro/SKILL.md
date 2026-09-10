---
name: web-repro
description: Use when reproducing a web page or UI in code from a reference — a live site or a screenshot — so that it matches at a real viewport rather than only inside a crop, or when a front-end reproduction has stalled with metrics that will not move.
---

# Web Reproduction

**REQUIRED SUB-SKILL:** `vision-loop` — read its four invariants first. This skill is those same
invariants instantiated for a web page, plus the page-specific procedure. It deliberately does
not restate the principles.

## Invariant 1 — the reference is the archetypal unvalidated input

A captured page is something you produced, and it can be wrong in ways that make every later
measurement meaningless. Measured on one attempt: **MAE 1.37** against its own capture versus
**30.59** against the real site at a real viewport. The nav scored 3.68 (genuinely right) while
the hero copy scored **64.88** and vision agents were calling it a faithful match.

Validate before optimising:

- **Capture at the acceptance viewport.** Not one you invented. A `min-h-[92vh]` hero makes the
  page height a function of the window — measured: 2637px at a 900px window, 4235px at 2637,
  5706px at 4235. Such a page has **no single "full page"**.
- **Verify completeness** against the page's own `scrollHeight`. A silently truncated capture
  looks exactly like a shorter page. (This one was 4235px against a real 5706px.)
- **Fire reveals before capturing** (`shot-attach.mjs --scroll`). Sections animated in on scroll
  render as *blank*, and a blank band is indistinguishable from a designed flat band — a
  `<video>` player and an entire featured-episode card were reproduced as empty rectangles.
  Verified: a flat band (`min == max == 13`) became content (`0…255`) only with the reveal pass.
- **Build the structural model before touching pixels** (`probe-dom.mjs`): section boxes and
  computed heights, which elements are `fixed`, which are `vh`-sized, which are
  `<video>`/`<canvas>`/`<iframe>`, and the container width. Pixels cannot tell *"a video that did
  not load"* from *"a flat block by design"*; one DOM call can.

## Invariant 2 — what each page-level check is blind to

| Check | Catches | Blind to |
|---|---|---|
| **Global** — whole page at the acceptance viewport | missing/extra sections, total height, viewport dependence | detail |
| **Structural** — boxes and computed sizes vs the model above | wrong section heights, `fixed` vs static, `vh` dependence, unloaded media | visual character |
| **Local** — 1:1 region crops (`vision-loop`) | type, colour, spacing, detail | **framing, structure, and anything outside the crop, by construction** |

Identical crop coordinates on both sides guarantee you only ever see differences *inside* the
crop. That is what produced the 1.37-versus-30.59 result: the loop was measuring its distance to
its own mistake. Run all three.

Also: **check `scrollWidth` at a narrower viewport.** If the reference is 1440 and yours reports
`scrollWidth: 1440` at a 1280 window, you have overflow the real page does not — invisible at
the capture width.

## Invariant 3 — name the acceptance criterion, not the proxy

The criterion is *"a human comparing the real site and your page at a real viewport sees the
same thing"*. "Low MAE against my capture" is a different claim and a self-chosen proxy.

Then declare what is **not** reproduced, in the deliverable:

- **Artwork and photographs** — a bitmap is an asset, not code. That region is excluded from any
  fidelity claim (comparing it is comparing a file to itself).
- **Fonts** you do not have. Residual error in text regions is usually font substitution — but
  **verify it** (positions within 1–2px while glyphs differ?) rather than asserting it. That
  assertion is how a real 64.88 MAE was waved through as "just fonts".
- Video content, hover/focus states, animation, and other breakpoints.

## Invariant 4 — schedule the frame-breaks

Global and structural verification **are** the frame-breaks. They will not happen on their own,
because every region crop looks self-consistent while the page is wrong. Run them at the start
(right after capturing) and again before declaring done — not as a final polish.

## Tools

Mechanised so they cannot be forgotten — each is one command that enforces one invariant:

- `../tools/check-reference.mjs <url> <ref.png>` — **run this first.** Reports whether the
  capture is truncated or has more content than the page, whether the page height depends on
  the viewport (naming the elements that cause it), and whether the page overflows at a narrower
  width. Exits non-zero on an invalid capture, so it can gate a workflow. Verified against a
  known-bad reference: it reported `REFERENCE INVALID` with the exact 4235-vs-2637 truncation and
  named `div.grain` and `main.min-h-screen` as the viewport-dependent elements.
- `../tools/shot-attach.mjs` — render/screenshot over CDP through one long-lived Chrome
  (avoids per-render sandbox escalation); `--scroll` fires reveals first; `--full` for the page
- `../tools/probe-dom.mjs` — the structural model in one call: section boxes, computed sizes,
  fixed/`vh`/media elements, tokens
