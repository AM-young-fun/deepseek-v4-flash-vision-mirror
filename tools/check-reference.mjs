#!/usr/bin/env node
/**
 * Validate a page reference BEFORE you build anything against it.
 *
 * This is invariant 1 of the vision-loop turned into a command, because it is the failure that
 * costs the most and the one nothing inside the loop can see. A reference capture can be
 * truncated, taken at a viewport no user has, or missing content that only appears on scroll —
 * and in every case it looks exactly like a normal, complete screenshot.
 *
 * Reports, for the page and the candidate reference image:
 *   - whether the page height depends on the viewport (a `vh`-sized section means there is no
 *     single "full page", so a capture must be pinned to a real window)
 *   - whether the image height matches the page height at that viewport (truncated / extra)
 *   - whether the page overflows horizontally at a narrower width
 *
 * Usage:
 *   node check-reference.mjs <url> <reference.png> [--w=1440] [--h=900] [--port=9222] [--json]
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire("/Applications/DSH Desktop.app/Contents/Resources/app/package.json");
const sharp = require("sharp");

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit === undefined ? d : hit.split("=")[1];
};
const positional = argv.filter((a) => !a.startsWith("--"));
const [url, refPath] = positional;
if (!url || !refPath) {
  console.error("usage: node check-reference.mjs <url> <reference.png> [--w=1440] [--h=900] [--port=9222]");
  process.exit(2);
}
const PORT = Number(flag("port", 9222));
const W = Number(flag("w", 1440));
const H = Number(flag("h", 900));
const asJson = argv.includes("--json");

let wsUrl;
try {
  wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
} catch {
  console.error(`no Chrome on 127.0.0.1:${PORT}. Start one long-lived instance first (see web-repro).`);
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

/** Measure the page at one viewport size. */
async function measure(width, height, scroll) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  try {
    await send("Page.enable", {}, sessionId);
    await send("Emulation.setDeviceMetricsOverride",
      { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    const loaded = once("Page.loadEventFired", sessionId);
    await send("Page.navigate", { url }, sessionId);
    await loaded;
    await send("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true }, sessionId).catch(() => {});

    if (scroll) {
      await send("Runtime.evaluate", {
        expression: `(async () => {
          const step = window.innerHeight * 0.8;
          const total = document.documentElement.scrollHeight;
          for (let y = 0; y < total; y += step) {
            window.scrollTo(0, y);
            await new Promise(r => requestAnimationFrame(() => setTimeout(r, 240)));
          }
          window.scrollTo(0, total);
          await new Promise(r => setTimeout(r, 400));
          window.scrollTo(0, 0);
          await new Promise(r => setTimeout(r, 400));
        })()`,
        awaitPromise: true,
      }, sessionId).catch(() => {});
    } else {
      await new Promise((r) => setTimeout(r, 500));
    }

    const { result } = await send("Runtime.evaluate", {
      expression: `JSON.stringify({
        scrollW: document.documentElement.scrollWidth,
        scrollH: document.documentElement.scrollHeight,
        // Counting elements whose computed style mentions "vh" does not work: getComputedStyle
        // returns the resolved used value in px. The robust detector is comparing section
        // heights across two viewport heights, which is what the caller does.
        sections: [...document.body.children].map(e => ({
          tag: e.tagName.toLowerCase(),
          cls: (typeof e.className === 'string' ? e.className : '').slice(0, 40),
          h: Math.round(e.getBoundingClientRect().height * 100) / 100
        })),
        media: [...document.querySelectorAll('video,canvas,iframe')].length
      })`,
      returnByValue: true,
    }, sessionId);
    return JSON.parse(result.value);
  } finally {
    await send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

const reference = await sharp(resolve(refPath)).metadata();
const base = await measure(W, H, false);
const taller = await measure(W, Math.round(H * 1.6), false);
const narrow = await measure(Math.round(W * 0.85), H, false);

ws.close();

const heightDelta = Math.abs(base.scrollH - reference.height);
const viewportDependent = Math.abs(taller.scrollH - base.scrollH) > 4;
const overflow = narrow.scrollW > Math.round(W * 0.85);

const problems = [];   // the capture does not represent the page -> do not build on it
const caveats = [];    // the capture is usable, but only under a stated condition
if (heightDelta > 4) {
  problems.push(
    `reference is ${reference.height}px but the page reports scrollHeight ${base.scrollH}px at ${W}x${H} `
    + `(${reference.height < base.scrollH ? "TRUNCATED" : "MORE CONTENT THAN THE PAGE"})`,
  );
}
if (viewportDependent) {
  // Name the culprit: whichever top-level section changed height between the two measurements.
  const culprits = [];
  const n = Math.min(base.sections.length, taller.sections.length);
  for (let i = 0; i < n; i++) {
    const a = base.sections[i], b = taller.sections[i];
    if (Math.abs(a.h - b.h) > 4) {
      culprits.push(`${a.tag}${a.cls ? "." + a.cls.split(/\s+/)[0] : ""} ${Math.round(a.h)}px -> ${Math.round(b.h)}px`);
    }
  }
  caveats.push(
    `the page height depends on viewport height (${base.scrollH}px at h=${H}, ${taller.scrollH}px at h=${Math.round(H * 1.6)}), so `
    + `this capture is only valid AT ${W}x${H}. Record the viewport with the reference and judge at it. `
    + (culprits.length ? `Viewport-dependent: ${culprits.join("; ")}` : ""),
  );
}
if (overflow) problems.push(`page overflows horizontally at ${Math.round(W * 0.85)}px wide (scrollW ${narrow.scrollW})`);

const out = {
  url,
  reference: { path: resolve(refPath), size: `${reference.width}x${reference.height}` },
  measuredAt: `${W}x${H}`,
  pageAtAcceptanceViewport: `${base.scrollW}x${base.scrollH}`,
  pageAtTallerViewport: `${taller.scrollW}x${taller.scrollH}`,
  pageAtNarrowerViewport: `${narrow.scrollW}x${narrow.scrollH}`,
  topLevelSections: base.sections,
  mediaElements: base.media,
  viewportDependent,
  referenceMatchesPage: heightDelta <= 4,
  verdict: problems.length
    ? "REFERENCE INVALID"
    : caveats.length ? "reference matches the page at this viewport" : "reference looks valid",
  problems,
  caveats,
};

if (asJson) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`${out.verdict}\n`);
  console.log(`  page at ${out.measuredAt}      : ${out.pageAtAcceptanceViewport}`);
  console.log(`  reference image       : ${out.reference.size}`);
  console.log(`  media elements        : ${base.media}   top-level sections: ${base.sections.length}`);
  console.log("");
  for (const p of problems) console.log(`  ! ${p}`);
  for (const c of caveats) console.log(`  ~ ${c}`);
  if (!problems.length && !caveats.length) console.log("  the capture matches the page at this viewport");
}
process.exit(problems.length ? 1 : 0);
