#!/usr/bin/env node
/**
 * Render a candidate (SVG or raster) and score it against a reference image.
 *
 * WHY THIS EXISTS — three failures this tool is built to make impossible:
 *
 *  1. Transparent pixels scored as black. `removeAlpha()` drops the alpha channel and
 *     leaves RGB untouched, so any uncovered pixel is then compared as if it were black.
 *     A traced SVG with 7% uncovered area scored ~1 dB worse than reality and, worse, the
 *     number looked plausible. This tool flattens onto white and separately REPORTS alpha
 *     coverage, flagging any uncovered pixel as a defect in the candidate.
 *
 *  2. Metrics that cannot see the defect that matters. A single MAE/PSNR number hid the
 *     fact that 7.4% of pixels (the edges) carried 34% of the total error. This tool always
 *     splits the error into edge and flat regions so the binding constraint is visible.
 *
 *  3. Absolute numbers mistaken for a comparison. Always report a CONTROL alongside the
 *     candidate, so "is this good?" becomes "is this better than the alternative?".
 *
 * Usage:
 *   node render-eval.mjs <reference> <candidate.svg|png> [label]
 *        [--render=out.png] [--side=out.png] [--alpha-threshold=0.5]
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, extname } from "node:path";

const require = createRequire("/Applications/DSH Desktop.app/Contents/Resources/app/package.json");
const sharp = require("sharp");

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const opt = (n) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit === undefined ? undefined : hit.split("=")[1];
};
const [refPath, candPath, label = "candidate"] = positional;
if (!refPath || !candPath) {
  console.error("usage: node render-eval.mjs <reference> <candidate.svg|png> [label] [--render=out] [--side=out]");
  process.exit(2);
}

const refMeta = await sharp(resolve(refPath)).metadata();
const W = refMeta.width, H = refMeta.height;

/* ---------- render the candidate if it is a vector ---------- */
const isVector = [".svg"].includes(extname(candPath).toLowerCase());
const renderPath = opt("render") ?? resolve(candPath.replace(/\.svg$/i, "") + "_render.png");
if (isVector) {
  await sharp(readFileSync(resolve(candPath))).resize(W, H).png().toFile(renderPath);
}
const rasterPath = isVector ? renderPath : resolve(candPath);

/* ---------- alpha coverage: catch the uncovered-pixel bug at the source ---------- */
// alpha==0 means genuinely unpainted. 0<alpha<255 is usually ordinary edge antialiasing,
// which is CORRECT — but at an internal region boundary it means two adjacent polygons each
// cover ~50% of a shared edge pixel, i.e. a hairline seam. The two cannot be told apart from
// the alpha channel alone, so report them separately instead of conflating them.
const candMeta = await sharp(rasterPath).metadata();
let unpainted = 0, partialAlpha = 0;
if (candMeta.hasAlpha) {
  const { data, info } = await sharp(rasterPath).raw().toBuffer({ resolveWithObject: true });
  const C = info.channels;
  for (let i = 3; i < data.length; i += C) {
    if (data[i] === 0) unpainted++;
    else if (data[i] < 255) partialAlpha++;
  }
}
const px = W * H;
const unpaintedPct = (unpainted / px) * 100;
const partialAlphaPct = (partialAlpha / px) * 100;

/* ---------- flatten onto white, never drop alpha ---------- */
const a = await sharp(resolve(refPath)).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer();
const b = await sharp(rasterPath).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer();
const C = 3;

/* ---------- score, split by edge vs flat ---------- */
let se = 0, ae = 0, n = 0, maxErr = 0;
let edgeN = 0, edgeS = 0, flatN = 0, flatS = 0;
let sqErrEdge = 0, sqErrFlat = 0;

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * C;
    // gradient of the REFERENCE decides whether this pixel is an edge
    let g = 0;
    if (x + 1 < W) { const p = o + C; g += Math.abs(a[o] - a[p]) + Math.abs(a[o + 1] - a[p + 1]) + Math.abs(a[o + 2] - a[p + 2]); }
    if (y + 1 < H) { const p = o + W * C; g += Math.abs(a[o] - a[p]) + Math.abs(a[o + 1] - a[p + 1]) + Math.abs(a[o + 2] - a[p + 2]); }
    let e = 0, esq = 0;
    for (let k = 0; k < 3; k++) { const d = a[o + k] - b[o + k]; e += Math.abs(d); esq += d * d; if (Math.abs(d) > maxErr) maxErr = Math.abs(d); }
    e /= 3; esq /= 3;
    se += esq * 3; ae += e; n++;
    if (g > 60) { edgeN++; edgeS += e; sqErrEdge += esq; } else { flatN++; flatS += e; sqErrFlat += esq; }
  }
}

const mse = se / (n * 3);
const out = {
  label,
  reference: resolve(refPath),
  candidate: resolve(candPath),
  rendered: isVector ? renderPath : undefined,
  size: `${W}x${H}`,
  MAE: +(ae / n).toFixed(3),
  RMSE: +Math.sqrt(mse).toFixed(3),
  PSNR_dB: +(10 * Math.log10((255 * 255) / mse)).toFixed(2),
  maxChannelError: maxErr,
  candidateUnpaintedPct: +unpaintedPct.toFixed(3),
  candidatePartialAlphaPct: +partialAlphaPct.toFixed(3),
  coverageWarning: unpaintedPct > 0.01
    ? `candidate leaves ${unpaintedPct.toFixed(2)}% of pixels fully unpainted (alpha==0) — fix coverage before trusting these numbers`
    : null,
  antialiasNote: partialAlphaPct > 1
    ? `${partialAlphaPct.toFixed(2)}% of pixels are partially covered. Normal at outer silhouettes; at an internal region boundary it means hairline seams between adjacent polygons. Not a defect by itself — inspect where they fall.`
    : null,
  edgePixelsPct: +((edgeN / n) * 100).toFixed(2),
  edgeMAE: +(edgeS / Math.max(1, edgeN)).toFixed(2),
  flatMAE: +(flatS / Math.max(1, flatN)).toFixed(2),
  pctOfAbsErrorFromEdges: +((edgeS / Math.max(1e-9, edgeS + flatS)) * 100).toFixed(1),
  pctOfSqErrorFromEdges: +((sqErrEdge / Math.max(1e-9, sqErrEdge + sqErrFlat)) * 100).toFixed(1),
};
if (!isVector) out.bytes = readFileSync(resolve(candPath)).length;
else out.svgBytes = readFileSync(resolve(candPath)).length;

if (opt("side")) {
  const left = await sharp(resolve(refPath)).resize(W, H).png().toBuffer();
  const right = await sharp(rasterPath).resize(W, H).png().toBuffer();
  await sharp({ create: { width: W * 2 + 8, height: H, channels: 3, background: { r: 20, g: 20, b: 22 } } })
    .composite([{ input: left, left: 0, top: 0 }, { input: right, left: W + 8, top: 0 }])
    .png().toFile(resolve(opt("side")));
}

console.log(JSON.stringify(out, null, 2));
