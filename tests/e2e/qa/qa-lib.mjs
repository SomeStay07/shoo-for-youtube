// QA helpers for Shoo release QA (qa-tester). Run with OUT=<repo>/.e2e-out/qa.
// The AppleLanguages lock lives in Errand's harness: one locale at a time across both repos.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, ROOT, OUT, sleep, consent } from "../harness.mjs";
import { setLang, resetLang } from "../../../../errand-for-youtube/tests/e2e/harness.mjs";

export { setLang, resetLang };

// Take the lock, set the language, start Chrome, release (Chrome reads AppleLanguages at startup).
export async function launchLocked(opts, locale = "en-US", { hold = false } = {}) {
  setLang(locale);
  try {
    const ctx = await launch(opts);
    return ctx;
  } finally {
    if (!hold) resetLang();
  }
}

export const LIST500 = JSON.parse(readFileSync(join(ROOT, "tests/e2e/data/list-500.json"), "utf8"));
export const LIB = readFileSync(join(ROOT, "lib.js"), "utf8");
export const PROBE = readFileSync(join(ROOT, "tests/e2e/flash-probe.js"), "utf8");

export async function botWall(page) {
  return page
    .evaluate(() => /Sign in to confirm you.re not a bot|unusual traffic from your computer/i.test(document.body?.innerText || "") && !document.querySelector("ytd-app ytd-page-manager > *:not([hidden]) :is(ytd-video-renderer, yt-lockup-view-model, ytd-watch-metadata #title h1)"))
    .catch(() => false);
}

export async function masthead(page, q) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = page.locator('input[name="search_query"]').first();
  await box.click({ timeout: 6000 });
  await box.fill(q);
  await box.press("Enter");
  await page.waitForURL(/results/, { timeout: 15000 });
}

export async function scroll(page, n, dy = 1500, wait = 700) {
  await page.mouse.move(640, 500);
  for (let k = 0; k < n; k++) {
    await page.mouse.wheel(0, dy);
    await sleep(wait);
  }
}

export function ownUi(page) {
  return page.evaluate(() => ({
    btn: document.querySelectorAll(".shoo-btn").length,
    lines: document.querySelectorAll(".shoo-line").length,
    page: document.querySelectorAll("#shoo-page").length,
    all: document.querySelectorAll("#shoo-all").length,
    menu: document.querySelectorAll(".shoo-menu").length,
    reason: document.querySelectorAll(".shoo-reason").length,
    hidden: document.querySelectorAll("[data-shoo-hide]").length,
    slots: document.querySelectorAll("[data-shoo-slot]").length,
  }));
}

// Count MutationObserver objects in a given world (main or Shoo's isolated world) with Runtime.queryObjects.
export async function observerCounts(cdp, isolatedName = "Shoo for YouTube") {
  const contexts = [];
  const onCtx = (e) => contexts.push(e.context);
  cdp.on("Runtime.executionContextCreated", onCtx);
  await cdp.send("Runtime.enable");
  await sleep(300);
  cdp.off("Runtime.executionContextCreated", onCtx);
  await cdp.send("Runtime.disable").catch(() => {});
  const { frameTree } = await cdp.send("Page.getFrameTree");
  const top = frameTree.frame.id;
  const live = contexts.filter((c) => c.auxData?.frameId === top);
  const main = live.filter((c) => c.auxData.isDefault).pop();
  const iso = live.filter((c) => c.auxData.type === "isolated" && String(c.origin).startsWith("chrome-extension://") && c.name.startsWith(isolatedName)).pop();
  const count = async (ctx, proto) => {
    if (!ctx) return null;
    const r = await cdp.send("Runtime.evaluate", { expression: `${proto}.prototype`, contextId: ctx.id });
    if (!r.result?.objectId) return null;
    const q = await cdp.send("Runtime.queryObjects", { prototypeObjectId: r.result.objectId });
    const n = await cdp.send("Runtime.callFunctionOn", { objectId: q.objects.objectId, functionDeclaration: "function(){return this.length}", returnByValue: true });
    await cdp.send("Runtime.releaseObjectGroup", { objectGroup: "" }).catch(() => {});
    return n.result.value;
  };
  return {
    mainMO: await count(main, "MutationObserver"),
    shooMO: await count(iso, "MutationObserver"),
    shooRO: await count(iso, "ResizeObserver"),
    shooIO: await count(iso, "IntersectionObserver"),
    shooMap: await count(iso, "Map"),
    shooSet: await count(iso, "Set"),
    shooHTML: await count(iso, "HTMLElement"),
  };
}

export async function listenerCounts(cdp) {
  const out = {};
  for (const [label, expr] of [["document", "document"], ["window", "window"]]) {
    const r = await cdp.send("Runtime.evaluate", { expression: expr });
    const l = await cdp.send("DOMDebugger.getEventListeners", { objectId: r.result.objectId, depth: 0 });
    out[label] = l.listeners.length;
  }
  return out;
}

export function slope(points) {
  // least squares slope of y over x (minutes)
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  const num = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const den = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  return den ? num / den : null;
}

export function save(name, data) {
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(data, null, 2));
}

export { OUT, ROOT, sleep, consent };
