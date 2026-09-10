---
name: vision-loop
description: Use when a task requires actually seeing an image — judging whether a render matches a reference, reproducing a design or screenshot, measuring visual fidelity, or verifying your own visual output — especially when the current model route cannot read images itself, or when image reads fail with "does not declare image input".
---

# Vision Loop

## Overview

**You do not need to be a vision model to have eyes.** Image capability belongs to the *route*,
not to the model: a subagent can be pinned to an image-capable target for a single call. A
text-only model can therefore run a real build → look → fix loop.

The whole method is four invariants. Everything else is procedure or tooling.

## The four invariants

**1. Validate every input, including the ones you produced.**
At each stage you consume something you did not make and cannot see: a reference you captured, a
render you produced, a metric you wrote. Every serious failure in this loop has been an
unvalidated input, not a bad edit. A loop that only asks *"does mine match my reference?"*
converges confidently on that reference's errors, and no amount of iteration recovers.

**2. Name what a check is blind to before you trust it.**
A check can only see what its own frame admits. A metric cannot see a missing element. A crop
cannot see a framing error. A mean cannot see a distribution. State the blind spot, then cover
it with a *different* check — not a bigger version of the same one.

**3. Name the acceptance criterion before you build the measurement.**
Then ask whether the measurement is a faithful proxy for it. A proxy you chose yourself will
drift toward what you can measure. "Matches the design" and "low MAE" are different claims.

**4. Iteration refines within a frame; it cannot detect a wrong frame.**
Schedule the frame-breaks explicitly (rule 0 below, plus a global and a structural pass). They
will not happen on their own, because everything inside the loop looks self-consistent.

## Procedure

**0. Validate the reference — before optimising against it.**

- Capture at the viewport the acceptance test will use, not one you invented. If the layout is
  `vh`-dependent the page height changes with the window and there is no single "full page".
- Verify completeness against the source's own report of its size.
- Fire any reveal-on-scroll or lazy-load before capturing: un-revealed content looks exactly
  like designed empty space.
- Get a structural model before touching pixels — pixels cannot distinguish *"a video that did
  not load"* from *"a flat block by design"*.
- State the artifact class (below). If it is continuous-tone, stop here.

**1. Confirm the route can see.** `read_image` gates on the *calling* route declaring `image`
input; a text-only route fails with `does not declare image input`. An uncatalogued model id
defaults to text-only.

**2. Borrow eyes.** Pin the model explicitly on every call that needs to look:

```js
await agent("<inspect /abs/path.png>", {
  provider: "deepseek-official", model: "deepseek-v4-flash-vision-exp", schema: {...},
});
```

The plain `subagent` tool has **no model override**, so it can never be given eyes. An unpinned
subagent inherits the default route, which is text-only.

**3. Transport at 1:1.** Two silent caps — `imagePixelBudget` (640,000 px, else resized) and
`imageMaxBytes` (1 MiB, else re-encoded). Only an image under **both** is passed through
byte-for-byte. Use `tiles.mjs`; a 2560×1440 screenshot otherwise arrives as roughly 800×450.

**4. Look: ask for measurement, not opinion.** Vision agents are reliable about *character* and
unreliable about *coordinates* — a reported "dark streak" measured 6px, a reported "speck" did
not exist. Trust the qualitative read; recompute every location and severity yourself. Never put
coloured scaffolding in a comparison image: a red divider and a grey gutter were both reported
as defects in the candidate.

**5. Evaluate.**
- Flatten onto white; never `removeAlpha()` (it scores uncovered pixels as black). Keep
  `alpha==0` (unpainted) separate from `0<alpha<255` (antialiasing).
- Split error into edge and flat regions — one number hides which constraint binds.
- Always score a **control**. An absolute number alone cannot tell you if it is good.
- Before calling a score a ceiling, build the best-possible control for its own parameters.

**6. Verify in three ways, not one:** global, structural, local. Each is blind to what the
others catch. A local pass alone is a false sense of security.

## When NOT to use — decide the artifact class first

| Reference is | Reproducible by a renderer? | Do instead |
|---|---|---|
| UI, page, poster, chart, layout, icon | Yes | Extract structure, write code, render, compare |
| Photograph, painting, illustration | **No** | Use the file as-is, or generate a variant |

Continuous-tone targets have no structure to recover. Tracing one yields a lossy stylization:
measured, an SVG trace of a 964×1340 illustration reached PSNR 24.65 dB at **4.2× the source
file size**, still visibly lossy. Decide this class first — it invalidates everything below it.

## Red Flags — STOP

- You have not validated that your reference is what you think it is
- Your only check is the one you already have — you have not named its blind spot
- Your metric has plateaued and you are about to call it done
- You are about to describe an image you have not read
- You are about to ask a subagent to look at an image without pinning an image-capable route
- You are about to accept an explanation (yours or an agent's) without measuring it

## Bundled Tools

Mechanised so they cannot be forgotten: `tiles.mjs` (dual-cap 1:1 tiling), `render-eval.mjs`
(flattening, coverage split, edge/flat split, control-ready). Page-level tooling lives in
[`web-repro`](../web-repro/SKILL.md), which this skill requires for front-end work.

Evidence for every claim above — the measurements, and the failures that produced them — is in
the repository README, not here.
