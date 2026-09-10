#!/usr/bin/env node
/**
 * Screenshot HTML through an ALREADY-RUNNING Chrome, so the render step needs no sandbox
 * escalation.
 *
 * Why this exists: Chrome writes its profile and crash data outside the workspace, so under a
 * workspace-write sandbox it must be started with wider permissions — and `chrome --screenshot`
 * also hangs on macOS. But the DevTools protocol port is reachable from ordinary in-sandbox
 * commands, so the cost can be paid ONCE per session:
 *
 *   # once, with escalation — a long-lived render server
 *   "<chrome>" --headless --no-sandbox --disable-gpu --disable-breakpad \
 *     --remote-debugging-port=9222 --user-data-dir=/tmp/dsh-chrome about:blank
 *
 *   # every render after that, no escalation
 *   node shot-attach.mjs page.html out.png 1440 900
 *
 * Usage:
 *   node shot-attach.mjs <file-or-url> <out.png> [width=1440] [height=900] [scale=1]
 *        [--port=9222] [--full] [--wait=250]
 */
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const full = argv.includes("--full");
const flag = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit === undefined ? d : hit.split("=")[1];
};
const positional = argv.filter((a) => !a.startsWith("--"));
const [target, out, wArg, hArg, sArg] = positional;
if (!target || !out) {
  console.error("usage: node shot-attach.mjs <file-or-url> <out.png> [w] [h] [scale] [--port=9222] [--full]");
  process.exit(2);
}
if (!existsSync(resolve(target)) && !/^[a-z]+:\/\//i.test(target)) {
  console.error(`no such file: ${resolve(target)}`);
  process.exit(3);
}

const PORT = Number(flag("port", 9222));
const width = Number(wArg ?? 1440);
const height = Number(hArg ?? 900);
const scale = Number(sArg ?? 1);
const settleMs = Number(flag("wait", 250));
const outPath = resolve(out);
const url = /^[a-z]+:\/\//i.test(target) ? target : pathToFileURL(resolve(target)).href;

/* ---------- find the running browser ---------- */
let wsUrl;
try {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
  wsUrl = (await res.json()).webSocketDebuggerUrl;
} catch {
  console.error(
    `no Chrome listening on 127.0.0.1:${PORT}.\n` +
    `Start one once (this is the only step that needs a wider sandbox):\n` +
    `  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --no-sandbox \\\n` +
    `    --disable-gpu --disable-breakpad --remote-debugging-port=${PORT} \\\n` +
    `    --user-data-dir=/tmp/dsh-chrome about:blank`,
  );
  process.exit(4);
}

/* ---------- minimal flatten-mode CDP client ---------- */
class Cdp {
  #ws; #id = 0; #pending = new Map(); #handlers = new Map();
  constructor(ws) {
    this.#ws = ws;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.#pending.has(msg.id)) {
        const { resolve: res, reject: rej } = this.#pending.get(msg.id);
        this.#pending.delete(msg.id);
        msg.error ? rej(new Error(`${msg.error.message} (${msg.error.code})`)) : res(msg.result);
      } else if (msg.method) {
        const h = this.#handlers.get(msg.method);
        if (h) h(msg.params, msg.sessionId);
      }
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.#id;
    return new Promise((res, rej) => {
      this.#pending.set(id, { resolve: res, reject: rej });
      this.#ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  once(method, sessionId) {
    return new Promise((res) => {
      const prev = this.#handlers.get(method);
      this.#handlers.set(method, (params, sid) => {
        if (sid === undefined || sid === sessionId) {
          this.#handlers.set(method, prev ?? (() => {}));
          res(params);
        } else if (prev) prev(params, sid);
      });
    });
  }
}

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("cdp websocket failed")); });
const cdp = new Cdp(ws);

let targetId;
try {
  ({ targetId } = await cdp.send("Target.createTarget", { url: "about:blank" }));
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width, height, deviceScaleFactor: scale, mobile: false },
    sessionId,
  );

  const loaded = cdp.once("Page.loadEventFired", sessionId);
  await cdp.send("Page.navigate", { url }, sessionId);
  await loaded;

  // fonts must be resolved before capture or text metrics shift between runs
  await cdp.send("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true }, sessionId).catch(() => {});

  // Scroll-reveal pass. Sites that animate content in on scroll render below-the-fold
  // sections as blank in a plain headless capture, because the reveal never fires — and a
  // blank band looks exactly like a design decision. Walking the page once and returning to
  // the top makes the capture show what a human actually sees.
  if (argv.includes("--scroll")) {
    const step = Number(flag("scroll-step", 0.8));
    await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const step = window.innerHeight * ${step};
        const total = document.documentElement.scrollHeight;
        for (let y = 0; y < total; y += step) {
          window.scrollTo(0, y);
          await new Promise(r => requestAnimationFrame(() => setTimeout(r, 260)));
        }
        window.scrollTo(0, total);
        await new Promise(r => setTimeout(r, 400));
        window.scrollTo(0, 0);
        await new Promise(r => setTimeout(r, 500));
      })()`,
      awaitPromise: true,
    }, sessionId).catch(() => {});
  }

  await new Promise((r) => setTimeout(r, settleMs));

  // report what actually got laid out — useful for structural checks
  const probe = await cdp.send("Runtime.evaluate", {
    expression: `JSON.stringify({
      title: document.title,
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
      bodyH: document.body.getBoundingClientRect().height,
      elements: document.querySelectorAll('*').length
    })`,
    returnByValue: true,
  }, sessionId).catch(() => null);

  const shot = await cdp.send(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: full, fromSurface: true },
    sessionId,
  );
  writeFileSync(outPath, Buffer.from(shot.data, "base64"));

  const info = probe?.result?.value ? JSON.parse(probe.result.value) : {};
  console.log(JSON.stringify({
    ok: true,
    out: outPath,
    viewport: `${width * scale}x${height * scale}`,
    ...(full ? { fullPage: true } : {}),
    ...info,
  }));
} finally {
  if (targetId) await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
  ws.close();
}
