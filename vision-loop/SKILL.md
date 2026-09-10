---
name: vision-loop
description: Use when a task requires actually seeing an image — judging whether a render matches a reference, reproducing a design or screenshot, measuring visual fidelity, or verifying your own visual output — especially when the current model route cannot read images itself, or when image reads fail with "does not declare image input".
---

# Vision Loop

## Overview

**You do not need to be a vision model to have eyes.** Image capability belongs to the
*route*, not to you: a subagent can be pinned to an image-capable model for a single call.
A text-only model can therefore run a real build → look → fix loop.

**The standard must come from outside you.** A deterministic renderer produces the
pixels; a vision route reports what is there. You only edit the code. Never substitute
your imagination for a render — an image you "believe" you produced is not evidence.

## When to Use

- Reproducing a UI, poster, chart, page, or diagram from a reference image
- Checking whether your output matches a reference, or whether a change improved it
- Diagnosing "it looks wrong" when you cannot see the screen
- Any `read_image` failure naming a model that "does not declare image input"

**When NOT to use — decide the artifact class first:**

| Reference is | Reproducible by a renderer? | Do instead |
|---|---|---|
| UI, poster, chart, layout, text | Yes | Extract tokens, write code, render, compare |
| Photograph, painting, illustration | **No** | Use the file as-is, or generate a variant with a generative model |

Continuous-tone targets have no structure to recover. Tracing them yields a lossy
stylization, not a reproduction — measure before promising fidelity (`render-eval.mjs`).
Decide this class first; it invalidates the rest of the workflow when it comes back "photo".

## 1. Confirm the route can see

`read_image` gates on the *calling route* declaring `image` in `inputModalities`. A
text-only route fails with `model "X" does not declare image input`. An uncatalogued model
id defaults to text-only, so custom endpoints must be declared image-capable explicitly.
The GUI composer rejects pasted/dropped images the same way (`MODEL_DOES_NOT_SUPPORT_IMAGES`);
there is no attach button — images enter only by drop or paste.

## 2. Borrow eyes

Dispatch a subagent with an **explicit** image-capable target, e.g. via the workflow tool:

```js
await agent("<inspect this file: /abs/path.png>", {
  provider: "deepseek-official", model: "deepseek-v4-flash-vision-exp", schema: {...},
});
```

**Pin the model on every call that needs eyes.** A subagent that does not pin a model
inherits the default route (`deepseek-v4-flash`), which is **text-only** — it has no eyes
and cannot read the file you hand it.

| Role | Route | Why |
|---|---|---|
| Inspector (looks at pixels) | `deepseek-official` / `deepseek-v4-flash-vision-exp` | The route that declares `image` input |
| Builder (writes code, renders, measures) | the default route | Never needs to see; cheaper and faster |
| Anything asked to "look" or judge an image | **must be pinned** | Unpinned defaults to text-only and will fail or bluff |

**Constraint:** the plain `subagent` tool takes only `description` / `prompt` /
`run_in_background` — it has **no model override**, so it can never be given eyes. Use the
`workflow` tool's `agent(prompt, opts)` (or `subagent` only for non-visual work).

Do not assume the id exists: an uncatalogued id defaults to text-only, so a custom
endpoint must be declared image-capable in the Models page first.

## 3. Transport at 1:1 — two caps, both silent

A vision route enforces **two independent limits**; exceeding either degrades the pixels
the model sees, with no error:

| Cap | Default | If exceeded |
|---|---|---|
| `imagePixelBudget` | 640,000 px | image is **resized** |
| `imageMaxBytes` | 1 MiB | image is **re-encoded** |

Only an image under **both** is passed through byte-for-byte. The byte cap is the one
people miss: an 800×800 PNG crop of a photograph is ~997 KB, 27 KB under the cap.

A 2560×1440 screenshot reaches the model as roughly 800×450 of mush. **Generated images
must be tiled**: use `tiles.mjs` (sourceX = tileX + tile.x). A 964×1340 source needs
4 tiles; feeding it whole loses 2× the detail.

## 4. Looking: ask for measurement, not opinion

Vision agents are **good rulers and poor judges**. Precise measurement asks return exact
hues, coordinates, and pixel values — and catch real defects. Asking "does this look
good?" returns politeness.

- Ask for direct observation and forbid inference from filenames
- Force an explicit failure channel (`canSee:false` + the exact error)
- Demand "no text" be verified, not assumed
- **Verify their claims yourself.** A throwaway remark about "red lines on the edges"
  once exposed a real 7% coverage bug that every metric had missed.

## 5. Evaluating: never trust one number

Use `render-eval.mjs`, which encodes three failures this loop keeps producing:

1. **Transparent pixels scored as black.** `removeAlpha()` drops alpha and leaves RGB, so
   uncovered pixels compare as black — 7% uncovered area cost a full dB while looking
   plausible. Always flatten onto white, and always report coverage.
2. **A single number hides the binding constraint.** Error is usually concentrated at
   edges; the tool splits edge vs flat error so you can see which one caps you.
3. **Absolute numbers are meaningless alone.** Always score a **control** so "is it good?"
   becomes "is it better than the alternative?"

Scored fidelity that did not improve across a technique change is a signal the metric is
blind, not that the technique failed. Prefer a **controlled A/B** over an absolute number.

## 6. Rendering

- **SVG → PNG**: `sharp` (librsvg) renders in-sandbox with no browser and no escalation.
  Prefer this for the whole loop.
- **HTML → PNG**: needs Chrome. `chrome --screenshot` **hangs** on macOS; drive
  `Page.captureScreenshot` over CDP instead. Chrome also writes outside the workspace, so
  it needs a wider sandbox every run — which breaks unattended loops. Prefer SVG.

## Common Mistakes

| Mistake | Reality |
|---|---|
| "It's close enough" — skipping the look | The look is the only step that finds what metrics cannot see |
| Trusting your own metric without checking coverage | Uncovered pixels silently read as black |
| Reporting one MAE/PSNR as the verdict | Report a control; split edge vs flat |
| Assuming a fix worked because it sounds right | Test it, controlled. A perceptual colour space fixed hue yet barely moved PSNR; Bezier fitting did **not** remove pixel-level staircase edges |
| Blaming a step without a controlled test | Despeckle looked harmful; disabling it cost 4.5 dB |
| Promising pixel-accurate reproduction of a photo | No renderer can; say so before starting |
| Feeding a full-size image and wondering about detail | Check both caps, then tile |

## Red Flags — STOP

- You are about to describe an image you have not read
- You are about to ask a subagent to look at an image **without pinning an image-capable route**
- You are about to report a fidelity number without checking coverage
- You are about to claim "improved" with no control and no measurement
- The reference is a photo and you are still writing layout code
- You are about to escalate for Chrome when SVG + sharp would run in-sandbox

## Bundled Tools

- `tiles.mjs` — slice any image into transport-safe 1:1 tiles (checks both caps)
- `render-eval.mjs` — render a candidate and score it: coverage check, edge/flat split, control-ready
