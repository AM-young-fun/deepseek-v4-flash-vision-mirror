#!/usr/bin/env node
/**
 * Extract the STRUCTURAL truth of a rendered page over CDP: element boxes, computed styles,
 * and the resolved design tokens.
 *
 * Why this matters for reproducing a design: a pixel metric (MAE/PSNR) is the wrong objective
 * for web work. Sub-pixel font rasterisation, hinting and platform smoothing produce large
 * pixel differences between a correct implementation and its reference, while a 4px spacing
 * error that a human would notice immediately barely moves MAE at all.
 *
 * The browser already knows the answer exactly. This reads it back:
 *   - boxes in fractional CSS px, so spacing is measurable to sub-pixel precision
 *   - computed colours, font stacks, sizes, weights, radii, shadows
 *   - the resolved palette with per-colour usage, and the type scale
 *
 * Use it to build a token spec from a reference, then to verify the implementation against
 * that spec. Reserve the vision route for "does it read as the same design / what is missing",
 * which is what it is actually good at.
 *
 * Usage:
 *   node probe-dom.mjs <file-or-url> [--port=9222] [--w=1440] [--h=900] [--sel="*"]
 *        [--out=spec.json]
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit === undefined ? d : hit.split("=")[1];
};
const target = argv.find((a) => !a.startsWith("--"));
if (!target) {
  console.error('usage: node probe-dom.mjs <file-or-url> [--port=9222] [--w=1440] [--h=900] [--sel="*"] [--out=spec.json]');
  process.exit(2);
}
const PORT = Number(flag("port", 9222));
const W = Number(flag("w", 1440));
const H = Number(flag("h", 900));
const SEL = flag("sel", "*");
const url = /^[a-z]+:\/\//i.test(target) ? target : pathToFileURL(resolve(target)).href;

let wsUrl;
try {
  wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
} catch {
  console.error(`no Chrome on 127.0.0.1:${PORT}. Start one once with a wider sandbox, then this needs none.`);
  process.exit(4);
}

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("cdp ws failed")); });

let id = 0;
const pending = new Map();
const handlers = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id !== undefined && pending.has(m.id)) {
    const { resolve: r, reject: j } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? j(new Error(m.error.message)) : r(m.result);
  } else if (m.method && handlers.has(m.method)) handlers.get(m.method)(m.params, m.sessionId);
};
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
const once = (method, sessionId) =>
  new Promise((res) => {
    handlers.set(method, (p, sid) => {
      if (sid === undefined || sid === sessionId) { handlers.delete(method); res(p); }
    });
  });

const EXPR = `(() => {
  const sel = ${JSON.stringify(SEL)};
  const nodes = [...document.querySelectorAll(sel)];
  const px = (v) => Math.round(parseFloat(v) * 100) / 100;
  const boxes = nodes.map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      cls: el.className && typeof el.className === 'string' ? el.className : '',
      text: (el.textContent || '').trim().slice(0, 60),
      x: px(r.x), y: px(r.y), w: px(r.width), h: px(r.height),
      color: cs.color, bg: cs.backgroundColor,
      font: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
      fontSize: px(cs.fontSize), weight: cs.fontWeight, lineHeight: cs.lineHeight,
      radius: px(cs.borderTopLeftRadius),
      pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px).join('/'),
      shadow: cs.boxShadow === 'none' ? '' : cs.boxShadow.slice(0, 60)
    };
  }).filter((b) => b.w > 0 || b.h > 0);

  // resolved palette by painted area of the box, and the type scale actually in use
  const palette = {};
  for (const b of boxes) {
    if (b.bg && b.bg !== 'rgba(0, 0, 0, 0)') palette[b.bg] = (palette[b.bg] || 0) + b.w * b.h;
  }
  const typeScale = [...new Set(boxes.filter(b => b.text).map(b => b.fontSize))].sort((a, b) => b - a);

  return JSON.stringify({
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    document: {
      title: document.title,
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight
    },
    count: boxes.length,
    boxes,
    paletteByArea: Object.entries(palette).sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([c, a]) => ({ color: c, areaPx: Math.round(a) })),
    typeScalePx: typeScale
  });
})()`;

try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sessionId);

  const loaded = once("Page.loadEventFired", sessionId);
  await send("Page.navigate", { url }, sessionId);
  await loaded;
  await send("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true }, sessionId).catch(() => {});
  await new Promise((r) => setTimeout(r, 200));

  const { result } = await send("Runtime.evaluate", { expression: EXPR, returnByValue: true }, sessionId);
  const spec = JSON.parse(result.value);

  const out = flag("out");
  if (out) writeFileSync(resolve(out), JSON.stringify(spec, null, 2));
  console.log(JSON.stringify({
    document: spec.document,
    viewport: spec.viewport,
    elements: spec.count,
    typeScalePx: spec.typeScalePx,
    paletteByArea: spec.paletteByArea.slice(0, 6),
    ...(out ? { written: resolve(out) } : {}),
  }, null, 2));
} finally {
  ws.close();
}
