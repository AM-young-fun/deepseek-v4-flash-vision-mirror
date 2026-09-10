# deepseek-v4-flash-vision-mirror

A skill that lets a **text-only model run a real build → look → fix loop** by borrowing eyes
from an image-capable route.

The name is the point: the model doing the work has no vision. It doesn't need any — vision
capability belongs to the *route*, not to the model, and a subagent can be pinned to a
vision-capable route for a single call. What it must never do is substitute imagination for
a render.

## The problem this solves

A text-only agent asked to reproduce a design or check its own output has no ground truth.
It cannot see the reference, cannot see what it produced, and cannot tell whether a change
helped. The failure mode is not "it refuses" — it is **confident, plausible, unverifiable
output**. Every rule in this skill exists because that failure was observed and measured.

## Install

```bash
cp -r vision-loop ~/.agents/skills/     # user-level, all projects
# or
cp -r vision-loop <project>/.dsh/skills/  # project-level
```

DSH discovers skills from `~/.agents/skills`, `$DSH_HOME/skills`, and `<project>/.dsh/skills`.

## Core rules

**1. Eyes are borrowed, and the model must be pinned.**

A subagent that does not pin a model inherits the default route, which is text-only. Measured
on an unpinned subagent that had been told to inspect an image: its session log contained
`"model":"deepseek-v4-flash"` 22 times and the vision model id zero times. It had no eyes.

The plain `subagent` tool exposes only `description`/`prompt`/`run_in_background` — it has
**no model override and can never be given eyes**. Use the workflow tool:

```js
await agent("<inspect /abs/path.png>", {
  provider: "deepseek-official",
  model: "deepseek-v4-flash-vision-exp",
  schema: { /* ... */ },
});
```

An uncatalogued model id defaults to text-only, so a custom endpoint must be declared
image-capable first.

**2. Transport at 1:1 — two caps, both silent.**

| Cap | Default | If exceeded |
|---|---|---|
| `imagePixelBudget` | 640,000 px | image is **resized** |
| `imageMaxBytes` | 1 MiB | image is **re-encoded** |

Only an image under **both** is passed through byte-for-byte. A 2560×1440 screenshot reaches
the model as roughly 800×450. The byte cap is the one everyone misses: an 800×800 **PNG** crop
of a photograph measures ~997 KB — 27 KB under the cap, so a slightly noisier source trips it
silently. Use `tiles.mjs`, which checks both and falls back to JPEG.

**3. Ask for measurement, not opinion.**

Vision agents are good rulers and poor judges. Asking "does this look good?" returns
politeness; asking for hues, coordinates and pixel values returns defects. And verify their
claims — a passing remark about "red lines on the edges" is what exposed a real 7% coverage
bug that every numeric metric had missed.

**4. Never trust a single number.**

- **Transparent pixels scored as black.** `removeAlpha()` drops alpha and leaves RGB, so an
  uncovered pixel compares as if it were black. Always flatten onto white. Then keep the two
  alpha conditions apart, because they mean different things: `alpha==0` is genuinely
  unpainted, while `0<alpha<255` is normally correct edge antialiasing — and a hairline seam
  only where it falls on an internal region boundary. Conflating them produced a claim of
  "7.12% uncovered" when 0.13% was unpainted and 6.99% was antialiasing.
- **One number hides the binding constraint.** Error concentrates at edges — a single MAE
  concealed the fact that 7.4% of pixels carried 34% of the error. Split edge vs flat.
- **Absolute numbers are meaningless without a control.** Score an alternative so "is it
  good?" becomes "is it better?".

**5. Decide the artifact class before anything else.**

| Reference is | Renderer can reproduce? |
|---|---|
| UI, poster, chart, layout, text | Yes — extract tokens, write code, render, compare |
| Photograph, painting, illustration | **No** — use the file as-is, or generate a variant |

A continuous-tone target has no recoverable structure. Tracing one yields a lossy stylization,
not a reproduction: the SVG grew to **6–8× the size of the source JPEG** and still lost the
detail that matters. Say so before starting.

Then do not mistake a poor score for the method's ceiling. That trace scored 25.33 dB, while a
**realizable** flat-region rendering built from its own 13-colour palette reaches **29.25 dB**
and its per-pixel oracle **30.60 dB** — roughly 4 dB of headroom that was the tracer's
geometry, not a limit of the approach.

## What's here

```
vision-loop/
  SKILL.md          the skill
  tiles.mjs         slice any image into transport-safe 1:1 tiles (both caps)
  render-eval.mjs   render a candidate and score it: coverage check, edge/flat split, control-ready
examples/
  trace.mjs         worked example: raster -> vector (k-means in OKLab + boundary tracing + Bezier)
```

`examples/trace.mjs` is not part of the skill. It is the tool the rules above were derived
from — a complete application of the loop, including the two bugs the loop caught in it
(transparent gaps from `fill-rule="evenodd"`, and an MAE that reported a sum instead of a mean).

## Evidence

Numbers quoted above were measured on a 964×1340 source:

| Version | MAE | PSNR | `alpha==0` | SVG |
|---|---|---|---|---|
| 14 colours, `evenodd`, no background | 7.287 | 25.33 | 0.126% | 345 KB |
| 14 colours, `nonzero` + background rect | 7.221 | **26.37** | 0.000% | 1001 KB |
| 48 colours, `nonzero` + background rect | **6.127** | 24.69 | 0.000% | 1383 KB |

Ceilings for the first row's **own 13-colour palette**, measured independently of the trace:

| Control | PSNR |
|---|---|
| The trace as delivered | 25.33 dB |
| **Realizable** — per-pixel nearest, then a 3×3 majority filter (contiguous flat regions) | **29.25 dB** |
| **Oracle** — per-pixel nearest (not reachable by flat regions) | **30.60 dB** |

The trace therefore sits **3.92 dB below what its own palette can realize**. Colour count was
never the binding constraint; boundary geometry was — of disagreeing pixels, 99.4% lie within
2 px of a true boundary.

Three further measurements that changed this skill's design:

- **More colours lowers MAE while lowering PSNR** — they trade flat-region accuracy for edge
  error, so neither number alone describes the result.
- **Disabling despeckling cost 4.5 dB.** The intuition that it was injecting error was wrong,
  and only a controlled test showed it.
- **Coloured scaffolding in a comparison image becomes a finding.** A red divider made vision
  agents report "red hairlines along the edges"; a `#1e1e22` separator gutter made two of them
  report a phantom 14th fill colour. Both artifacts belonged to the experimenter.

### On borrowed eyes

The fidelity numbers above were independently reproduced by a separate agent working only from
this skill (MAE 7.287, PSNR 25.33, alpha gap 7.1203%), and that agent then corrected the skill:
the 7.12% it was warned about was 6.99% antialiasing plus 0.13% unpainted.

Twelve pinned vision agents unanimously and correctly distinguished continuous-tone reference
from quantized render, and correctly identified the lost features. Their **coordinates and
severity estimates were unreliable** — one reported "dark streak" measured 6 px, another
reported "speck at row 255" did not exist. Use them for character, not for locating.

## Requirements

- `sharp` for SVG rasterization and image analysis. It ships inside the DSH app bundle:
  ```js
  const { createRequire } = require("node:module");
  const require2 = createRequire("/Applications/DSH Desktop.app/Contents/Resources/app/package.json");
  const sharp = require2("sharp");
  ```
- SVG → PNG via `sharp` (librsvg) runs in-sandbox with no browser and no escalation. Prefer it.
  HTML → PNG needs Chrome, where `chrome --screenshot` **hangs** on macOS and must be driven
  over CDP instead — and Chrome writes outside the workspace, so it needs a wider sandbox on
  every run. That breaks unattended loops.
