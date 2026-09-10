#!/usr/bin/env node
/**
 * Slice an image into tiles that survive transport to a vision model at 1:1.
 *
 * WHY THIS EXISTS
 * A vision route enforces TWO independent limits before sending an image:
 *   - `imagePixelBudget` (640000 px by default): above it the image is RESIZED down.
 *   - `imageMaxBytes`    (1 MiB by default):    above it the image is RE-ENCODED.
 * Either one silently degrades the pixels the model actually sees. Only an image that
 * satisfies both is passed through byte-for-byte, and only then is "pixel-level" work
 * possible at all.
 *
 * The byte cap is the one people miss: an 800x800 PNG crop of a photograph measures
 * ~997 KB — 27 KB under the cap — so a slightly noisier source silently trips it. This
 * tool checks both caps per tile and, in `auto` mode, re-encodes any oversized PNG tile
 * as JPEG so the output is always transport-safe.
 *
 * Usage:
 *   node tiles.mjs <input> <outdir> [--budget=640000] [--byte-cap=1048576]
 *                                   [--max-side=8192] [--overlap=0]
 *                                   [--format=png|jpeg|auto] [--quality=92]
 *
 * Coordinates: sourceX = tileX + tile.x, sourceY = tileY + tile.y.
 */
import { createRequire } from "node:module";
import { mkdirSync, statSync, rmSync } from "node:fs";
import { resolve, join, basename } from "node:path";

const require = createRequire("/Applications/DSH Desktop.app/Contents/Resources/app/package.json");
const sharp = require("sharp");

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const opt = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit === undefined ? d : hit.split("=")[1];
};
const num = (n, d) => Number(opt(n, d));

const [input, outDir] = positional;
if (!input || !outDir) {
  console.error("usage: node tiles.mjs <input> <outdir> [--budget=640000] [--byte-cap=1048576] [--format=auto]");
  process.exit(2);
}

const BUDGET = num("budget", 640000);
const BYTE_CAP = num("byte-cap", 1048576);
const MAX_SIDE = num("max-side", 8192);
const OVERLAP = num("overlap", 0);
const FORMAT = opt("format", "auto");
const QUALITY = num("quality", 92);

mkdirSync(resolve(outDir), { recursive: true });

const meta = await sharp(resolve(input)).metadata();
const W = meta.width, H = meta.height;

if (W > MAX_SIDE || H > MAX_SIDE) {
  console.error(`refusing: ${W}x${H} exceeds maxSide ${MAX_SIDE}; downscale first (the attachment service rejects it anyway)`);
  process.exit(3);
}

const side = Math.min(Math.floor(Math.sqrt(BUDGET)), W, H, MAX_SIDE);
if (side < 2) {
  console.error(`refusing: budget ${BUDGET} too small to produce a usable tile`);
  process.exit(4);
}

const step = Math.max(1, side - OVERLAP);
const stem = basename(input).replace(/\.[^.]+$/, "");
const tiles = [];

for (let y = 0; y < H; y += step) {
  for (let x = 0; x < W; x += step) {
    const w = Math.min(side, W - x);
    const h = Math.min(side, H - y);
    if (w < 2 || h < 2) continue;

    const crop = sharp(resolve(input)).extract({ left: x, top: y, width: w, height: h });
    let ext = FORMAT === "jpeg" ? "jpg" : "png";
    let out = join(resolve(outDir), `${stem}_x${x}_y${y}.${ext}`);
    let note = null;

    if (FORMAT === "jpeg") {
      await crop.jpeg({ quality: QUALITY }).toFile(out);
    } else {
      await crop.png().toFile(out);
      if (FORMAT === "auto" && statSync(out).size > BYTE_CAP) {
        const jpgPath = join(resolve(outDir), `${stem}_x${x}_y${y}.jpg`);
        await sharp(resolve(input)).extract({ left: x, top: y, width: w, height: h })
          .jpeg({ quality: QUALITY }).toFile(jpgPath);
        // Remove the oversized PNG: leaving it behind means a later glob picks up a file that
        // the harness would reject and silently resize.
        rmSync(out, { force: true });
        note = `png exceeded byte cap; re-encoded as jpeg`;
        out = jpgPath;
      }
    }

    const bytes = statSync(out).size;
    const px = w * h;
    tiles.push({
      name: basename(out), x, y, w, h, px, bytes,
      pixelsOverBudget: px > BUDGET,
      bytesOverCap: bytes > BYTE_CAP,
      transportSafe: px <= BUDGET && bytes <= BYTE_CAP,
      ...(note ? { note } : {}),
    });
  }
}

const unsafe = tiles.filter((t) => !t.transportSafe);
console.log(JSON.stringify({
  input: resolve(input),
  source: `${W}x${H}`,
  sourcePixels: W * H,
  sourceOverPixelBudgetBy: +((W * H) / BUDGET).toFixed(2),
  budgetPixels: BUDGET,
  byteCap: BYTE_CAP,
  format: FORMAT,
  tileSide: side,
  overlap: OVERLAP,
  tileCount: tiles.length,
  allTransportSafe: unsafe.length === 0,
  unsafeTiles: unsafe.map((t) => t.name),
  // sourceX = tileX + tile.x
  tiles,
}, null, 2));
