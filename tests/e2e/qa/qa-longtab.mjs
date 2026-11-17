// Long-lived tab: one document, SPA-only navigation for MIN minutes, then IDLE minutes idle.
// ARM=shoo|none. Samples heap, DOM nodes, listeners, observers at the same page (search "minecraft").
import { launchLocked, LIST500, botWall, masthead, scroll, ownUi, observerCounts, listenerCounts, slope, save, sleep, consent } from "./qa-lib.mjs";
import { reporter, closeWelcome, setList, finish } from "../harness.mjs";

const ARM = process.env.ARM || "shoo";
const MIN = Number(process.env.MIN || 30);
const IDLE = Number(process.env.IDLE || 5);
const LIGHT = process.env.LIGHT === "1";
const EMPTY = process.env.EMPTY === "1";
const ext = ARM.startsWith("shoo");
const { check } = reporter(`qa-longtab-${ARM}`);
const ctx = await launchLocked({ name: `qa-longtab-${ARM}`, extension: ext });
if (ext) {
  await closeWelcome(ctx);
  await setList(ctx, EMPTY ? null : LIST500);
}
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
const cdp = await ctx.context.newCDPSession(page);
await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
await cdp.send("HeapProfiler.enable");
await cdp.send("DOM.enable");
const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));

await page.goto("https://www.youtube.com/results?search_query=minecraft", { waitUntil: "domcontentloaded" });
await consent(page);
await sleep(5000);
const origin0 = await page.evaluate(() => performance.timeOrigin);
const QUERIES = ["cooking pasta", "bitcoin news", "lofi music", "iphone review", "history documentary", "football highlights", "ai generated video", "minecraft"];
const samples = [];
const stepErrors = [];
let navs = 0;
let bot = 0;
const t0 = Date.now();
const mins = () => (Date.now() - t0) / 60000;

async function sample(cycle) {
  await cdp.send("HeapProfiler.collectGarbage");
  await sleep(500);
  const m = await metrics();
  const heavy = !LIGHT || cycle === 0 || cycle === "idle-end";
  const obs = heavy ? await observerCounts(cdp).catch((e) => ({ err: String(e).slice(0, 80) })) : {};
  const lis = heavy ? await listenerCounts(cdp).catch(() => ({})) : {};
  const cards = await page.evaluate(() => ({ cardsInDom: document.querySelectorAll("ytd-video-renderer, yt-lockup-view-model, ytd-rich-item-renderer").length, searchCards: document.querySelectorAll("ytd-search ytd-video-renderer").length, contItems: document.querySelectorAll("ytd-search ytd-item-section-renderer").length }));
  const ui = ext ? await ownUi(page) : null;
  const s = { cycle, min: +mins().toFixed(2), url: page.url().slice(24, 70), heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2), nodes: m.Nodes, listeners: m.JSEventListeners, docs: m.Documents, frames: m.Frames, script: +m.ScriptDuration.toFixed(2), task: +m.TaskDuration.toFixed(2), vis: await page.evaluate(() => document.visibilityState), ...obs, docL: lis.document, winL: lis.window, ...cards, ui };
  samples.push(s);
  console.log(JSON.stringify(s));
}

async function step(name, fn) {
  try {
    await fn();
    navs++;
  } catch (e) {
    stepErrors.push({ name, min: +mins().toFixed(1), err: String(e.message).split("\n")[0].slice(0, 100) });
  }
  if (await botWall(page)) bot++;
}

await sample(0);
let cycle = 0;
while (mins() < MIN) {
  cycle++;
  const q = QUERIES[cycle % QUERIES.length];
  await step("search", async () => {
    await masthead(page, q);
    await sleep(3500);
    await scroll(page, 4);
  });
  await step("watch", async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(400);
    await page.locator("ytd-search:not([hidden]) ytd-video-renderer:not([data-shoo-hide]) a#thumbnail[href^='/watch']:not([href*='list='])").first().click({ timeout: 8000 });
    await page.waitForURL(/watch/, { timeout: 15000 });
    await sleep(5000);
    await scroll(page, 3, 1200, 800);
  });
  await step("back", async () => {
    await page.goBack({ waitUntil: "commit" });
    await page.waitForURL(/results/, { timeout: 10000 });
    await sleep(2500);
  });
  await step("channel", async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("ytd-search:not([hidden]) ytd-video-renderer:not([data-shoo-hide]) #channel-info ytd-channel-name a[href^='/@']").first().click({ timeout: 8000 });
    await page.waitForURL(/\/@/, { timeout: 15000 });
    await sleep(4000);
    await scroll(page, 3);
  });
  await step("minecraft", async () => {
    await masthead(page, "minecraft");
    await sleep(5000);
  });
  if (cycle % 2 === 0 || mins() >= MIN) await sample(cycle);
}
const loopEnd = samples[samples.length - 1];
// idle on the search page, tab visible
const m0 = await metrics();
const idleStart = Date.now();
await sleep(IDLE * 60000);
const m1 = await metrics();
const idleMin = (Date.now() - idleStart) / 60000;
const idle = { min: +idleMin.toFixed(2), scriptMsPerMin: +(((m1.ScriptDuration - m0.ScriptDuration) * 1000) / idleMin).toFixed(1), taskMsPerMin: +(((m1.TaskDuration - m0.TaskDuration) * 1000) / idleMin).toFixed(1) };
await sample("idle-end");
const sameDoc = (await page.evaluate(() => performance.timeOrigin)) === origin0;
const pts = (k) => samples.filter((s) => typeof s.cycle === "number" && s.cycle > 0 && /results\?search_query=minecraft/.test(s.url)).map((s) => ({ x: s.min, y: s[k] }));
const summary = {
  arm: ARM,
  minutes: +mins().toFixed(1),
  cycles: cycle,
  navs,
  stepErrors,
  bot,
  sameDoc,
  slopes: { heapMBPerMin: slope(pts("heapMB")), nodesPerMin: slope(pts("nodes")), listenersPerMin: slope(pts("listeners")), shooMOPerMin: slope(pts("shooMO")), mainMOPerMin: slope(pts("mainMO")) },
  first: samples[1] || samples[0],
  last: loopEnd,
  totalCpu: { scriptS: loopEnd.script - samples[0].script, taskS: loopEnd.task - samples[0].task },
  idle,
  samples,
};
save(`longtab-${ARM}`, summary);
console.log(JSON.stringify({ ...summary, samples: undefined }, null, 1));
check(`long tab ${ARM}: one document for the whole run, SPA only`, sameDoc, { navs, cycles: cycle });
check(`long tab ${ARM}: ≥ 90% of steps ran`, stepErrors.length <= navs * 0.1 + 1, { navs, errors: stepErrors.length });
if (ext) {
  const u = samples.filter((s) => s.ui).map((s) => s.ui);
  check("long tab shoo: at most one ⊘ button, one page control, no stray menus at every sample", u.every((x) => x.btn <= 1 && x.page <= 1 && x.menu === 0 && x.all <= 1), u.slice(-3));
  const mo = samples.map((s) => s.shooMO).filter((x) => typeof x === "number");
  check("long tab shoo: Shoo's MutationObserver count does not grow", mo.length >= 2 && mo[mo.length - 1] <= mo[0] + 1, mo);
}
if (ext) await finish(ctx, check);
else await ctx.context.close();
