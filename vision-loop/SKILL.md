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

## 0. Validate the reference before you optimize against it

**The reference is an input you produced, not ground truth you were given.** A loop that only
ever asks "does mine match my reference?" converges confidently on that reference's errors. This
step is first because skipping it invalidates every later measurement, and no amount of
iteration recovers from it.

- **Capture at the viewport the acceptance test will actually use.** Not one you invented. A
  page whose hero is `min-h-[92vh]` has a *different total height at every viewport height* —
  measured here: 2637px at a 900px-tall window, 4235px at 2637, 5706px at 4235. There is no
  single "full page" for such a site, so the capture must be pinned to a real window size.
- **Verify the capture is complete.** Ask the page for its own `scrollHeight` at that viewport
  and confirm the image is that tall. A capture that silently truncates looks exactly like a
  shorter page.
- **Reveal scroll-animated content.** Sites that fade sections in on scroll render
  below-the-fold content as *blank* in a plain headless capture. A blank band looks exactly like
  a designed flat band. Walk the page once (see `--scroll`), or you will reproduce an
  un-animated skeleton as if it were the design.
- **Get a structural model before touching pixels.** Element boxes, section list, computed
  heights, which elements are `fixed`, which are `vh`-sized, which are `<video>`. Pixels cannot
  distinguish "a video that did not load" from "a flat block by design"; the DOM can.
  `probe-dom.mjs` does this in one call.
- **Then verify globally.** Only after the frame is right does region-level comparison mean
  anything.

### A local comparison cannot detect a framing error

Cropping both sides at identical coordinates guarantees you can only ever see differences
*inside* the crop. Page structure, a missing section, a wrong section height, viewport
dependence and a truncated reference are all invisible to it **by construction** — the crop
looks self-consistent because it is.

Run **global, structural and local** checks as separate steps:

| Check | Catches | Blind to |
|---|---|---|
| Whole-page diff at a real viewport | missing/extra sections, total height, gross layout | detail |
| Structural diff (boxes and computed sizes) | viewport dependence, `fixed` vs static, wrong section heights, an unloaded `<video>` | visual character |
| Region 1:1 crops | type, colour, spacing, detail | framing, structure, anything outside the crop |

### Do not hand your framing to the checker

If you choose the crop coordinates and write the questions, you only get answers to questions you
already knew to ask. Include an open-ended ask — *"what is on the reference that is missing from
this?"* — and let the checker look outside your frame.

### A plateau is not convergence

A metric that stops moving means **your edits stopped moving that number**, not that the output
is right. MAE sat at 1.37 here while an entire section was missing and the page was 60% too tall.
Before concluding you are done, re-validate the **target**, not just the distance to it.

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

Vision agents are **reliable about character and terrible about coordinates**. They correctly
identify continuous-tone vs quantized, list which features are lost, and measure colour and
texture statistics. They localize badly: a reported "dark streak" measured 6 px, and a
reported "speck at row 255" did not exist. Trust the qualitative read; recompute every
location and severity yourself.

- Ask for direct observation and forbid inference from filenames
- Force an explicit failure channel (`canSee:false` + the exact error)
- Demand "no text" be verified, not assumed
- **Verify their claims yourself.** A throwaway remark about "red lines on the edges"
  once exposed a real coverage defect that every numeric metric had missed.
- **Never put coloured scaffolding in a comparison image.** A red divider bar made agents
  report "red hairlines along the edges"; a `#1e1e22` separator gutter made two agents report
  a phantom 14th fill colour. Both times the artifact belonged to the experimenter, not the
  candidate. Use a neutral border, and tell the agent what is scaffolding.

## 5. Evaluating: never trust one number

Use `render-eval.mjs`, which encodes three failures this loop keeps producing:

1. **Transparent pixels scored as black.** `removeAlpha()` drops alpha and leaves RGB, so an
   uncovered pixel is compared as if it were black. Always flatten onto white. Then keep the
   two alpha conditions apart, because they mean different things: `alpha==0` is genuinely
   unpainted, while `0<alpha<255` is usually correct edge antialiasing — except at an internal
   region boundary, where it is a hairline seam. Conflating them produced a published claim of
   "7.12% uncovered" when only 0.13% was unpainted and 6.99% was ordinary antialiasing.
2. **A single number hides the binding constraint.** Error is usually concentrated at
   edges; the tool splits edge vs flat error so you can see which one caps you.
3. **Absolute numbers are meaningless alone.** Always score a **control** so "is it good?"
   becomes "is it better than the alternative?"

Scored fidelity that did not improve across a technique change is a signal the metric is
blind, not that the technique failed. Prefer a **controlled A/B** over an absolute number.

**A disappointing absolute number is usually your execution, not the method's ceiling.**
One trace scored 25.33 dB while a realizable flat-region rendering built from its *own*
palette reached **29.23 dB**, and its per-pixel oracle **30.60 dB** — so ~4 dB of headroom
existed the whole time and the geometry, not the representation, was at fault. Before
concluding "this approach cannot do better", build the oracle and the realizable control for
its own parameters.

## 6. Rendering

- **SVG → PNG**: `sharp` (librsvg) renders in-sandbox with no browser and no escalation.
  Prefer this for the whole loop.
- **HTML → PNG**: needs Chrome. `chrome --screenshot` **hangs** on macOS; drive
  `Page.captureScreenshot` over CDP instead. Chrome also writes outside the workspace, so
  it needs a wider sandbox every run — which breaks unattended loops. Prefer SVG.
- **Gotcha:** chaining `.resize(a).resize(b)` in one `sharp` pipeline silently no-ops — three
  "blur" controls returned MAE **0.000** (byte-identical to the reference). Split them into
  separate pipelines. Any control that exactly clones the reference is this bug, not a result.
- Supersampling does not rescue a bad trace: rendering at 8× and downsampling bought **+0.38 dB**.
  Rasterization quality is rarely the binding constraint.

## Common Mistakes

| Mistake | Reality |
|---|---|
| **Treating your own reference capture as ground truth** | It is an input you produced. Validate it first or every later measurement inherits its errors |
| **Capturing at a viewport you invented** | If the layout is `vh`-dependent the page height changes with the window; there is no single "full page" |
| **Comparing only region-by-region** | Identical crops can only reveal differences inside the crop. Structure, framing and truncation are invisible by construction |
| **Writing the checker's questions** | You get answers only to questions you already had. Include an open-ended ask |
| **Reading a plateau as convergence** | MAE sat at 1.37 here while a whole section was missing and the page was 60% too tall |
| "It's close enough" — skipping the look | The look is the only step that finds what metrics cannot see |
| Trusting your own metric without checking coverage | Uncovered pixels silently read as black |
| Reporting one MAE/PSNR as the verdict | Report a control; split edge vs flat |
| Reading "uncovered" off a partial-alpha count | `alpha==0` is unpainted; `0<alpha<255` is usually antialiasing |
| Assuming "25 dB is this method's ceiling" | Build its oracle and realizable control first — the gap was ~4 dB of fixable geometry |
| Putting a coloured divider between A and B | Agents report your scaffolding as a defect in the candidate |
| Assuming a fix worked because it sounds right | Test it, controlled. A perceptual colour space fixed hue yet barely moved PSNR; Bezier fitting did **not** remove pixel-level staircase edges |
| Blaming a step without a controlled test | Despeckle looked harmful; disabling it cost 4.5 dB |
| Promising pixel-accurate reproduction of a photo | No renderer can; say so before starting |
| Feeding a full-size image and wondering about detail | Check both caps, then tile |

## Red Flags — STOP

- You have not verified that your reference capture is complete, at a real viewport, with scroll reveals fired
- Your only comparison is region crops — nothing global, nothing structural
- You wrote the checker's questions and crop coordinates
- Your metric has plateaued and you are about to call it done
- You are about to describe an image you have not read
- You are about to ask a subagent to look at an image **without pinning an image-capable route**
- You are about to report a fidelity number without separating unpainted from antialiased
- You are about to claim "improved" with no control and no measurement
- You are about to call an absolute score a ceiling without an oracle to compare it to
- The reference is a photo and you are still writing layout code
- You are about to escalate for Chrome when SVG + sharp would run in-sandbox

## Bundled Tools

- `tiles.mjs` — slice any image into transport-safe 1:1 tiles (checks both caps)
- `render-eval.mjs` — render a candidate and score it: coverage check, edge/flat split, control-ready
- `../tools/shot-attach.mjs` — render HTML over CDP; `--scroll` fires scroll-reveal animations before capture
- `../tools/probe-dom.mjs` — the structural model: element boxes, computed sizes, tokens
