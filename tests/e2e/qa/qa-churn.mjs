// SPA churn: 50+ navigations search <-> watch <-> channel <-> hashtag with the rAF flash probe,
// duplicate-UI checks after every navigation, a few blocks along the way, console errors from Shoo.
import { launchLocked, LIST500, LIB, PROBE, botWall, masthead, scroll, ownUi, save, sleep, consent } from "./qa-lib.mjs";
import { reporter, closeWelcome, setList, getList, finish } from "../harness.mjs";

const TARGET = Number(process.env.NAVS || 60);
const { check } = reporter("qa-churn");
const ctx = await launchLocked({ name: "qa-churn" });
const swErrors = [];
const hookWorker = (w) => w.on("console", (m) => ["error", "warning"].includes(m.type()) && swErrors.push(m.text().slice(0, 200)));
hookWorker(ctx.worker);
ctx.context.on("serviceworker", hookWorker);
const pageWarnings = [];
await closeWelcome(ctx);
await setList(ctx, LIST500);
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
page.on("console", (m) => {
  const loc = m.location()?.url || "";
  if (loc.startsWith("chrome-extension://") || /shoo/i.test(m.text())) pageWarnings.push({ type: m.type(), text: m.text().slice(0, 200), loc: loc.slice(0, 80) });
});
await page.addInitScript(`${LIB}\nwindow.__SHOO_LIST = ${JSON.stringify(LIST500)};\n${PROBE}`);

const harvest = [];
const take = async () => {
  const s = await page.evaluate(() => (window.__flash ? JSON.parse(JSON.stringify(window.__flash)) : null)).catch(() => null);
  if (s?.frames) harvest.push({ url: page.url(), ...s });
};
const log = [];
const dupes = [];
const staleLines = [];
let navs = 0;
let bot = 0;
const errs = [];
async function nav(kind, fn, full = false) {
  if (full) await take();
  await page.evaluate((x) => window.__setScenario?.(x), kind).catch(() => {});
  try {
    await fn();
    navs++;
  } catch (e) {
    errs.push({ kind, err: String(e.message).split("\n")[0].slice(0, 100) });
    return false;
  }
  await sleep(2500);
  if (await botWall(page)) bot++;
  const ui = await ownUi(page);
  const perBox = await page.evaluate(() => [...document.querySelectorAll("[data-shoo-slot], [data-shoo-hide]")].filter((b) => b.querySelectorAll(":scope > .shoo-line").length > 1).length);
  const btnInLink = await page.evaluate(() => [...document.querySelectorAll(".shoo-btn")].some((b) => b.closest("a")));
  const entry = { n: navs, kind, url: page.url().slice(24, 80), ...ui, perBox, btnInLink };
  log.push(entry);
  if (ui.btn > 1 || ui.page > 1 || ui.all > 1 || ui.menu > 0 || perBox > 0 || btnInLink) dupes.push(entry);
  return true;
}

const Q = ["football highlights", "bitcoin news", "iphone review", "cooking pasta", "minecraft", "lofi music", "history documentary"];
const TAGS = ["minecraft", "cooking", "football", "music"];
await page.goto("https://www.youtube.com/results?search_query=minecraft", { waitUntil: "domcontentloaded" });
await consent(page);
await sleep(4000);
let blocks = 0;
for (let i = 0; navs < TARGET && i < 40; i++) {
  await nav("search", async () => {
    await masthead(page, Q[i % Q.length]);
    await sleep(1500);
    await scroll(page, 2);
  });
  if (i % 3 === 1) {
    // block a channel from a visible card, then leave: the slot line must not survive into the next page
    const r = await page.evaluate(() => {
      const c = [...document.querySelectorAll("ytd-search:not([hidden]) ytd-video-renderer:not([data-shoo-hide])")].find((x) => x.checkVisibility() && x.querySelector("#channel-info a[href^='/@']"));
      if (!c) return null;
      c.scrollIntoView({ block: "center" });
      c.setAttribute("data-qa-churn", "1");
      return c.querySelector("#channel-info a[href^='/@']").getAttribute("href");
    });
    if (r) {
      await sleep(300);
      await page.hover("[data-qa-churn] h3").catch(() => {});
      await sleep(350);
      const clicked = await page.click("[data-qa-churn] .shoo-btn", { timeout: 3000 }).then(() => true).catch(() => false);
      if (clicked) {
        blocks++;
        await sleep(600);
        log.push({ block: r, line: await page.evaluate(() => document.querySelector("[data-shoo-slot] > .shoo-line .shoo-text")?.textContent || null) });
      }
      await page.evaluate(() => document.querySelector("[data-qa-churn]")?.removeAttribute("data-qa-churn"));
    }
  }
  const okWatch = await nav("watch", async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("ytd-search:not([hidden]) ytd-video-renderer:not([data-shoo-hide]) a#thumbnail[href^='/watch']:not([href*='list='])").first().click({ timeout: 8000 });
    await page.waitForURL(/watch/, { timeout: 15000 });
    await sleep(1500);
    await scroll(page, 2, 1000, 600);
  });
  if (okWatch && blocks) {
    const s = await page.evaluate(() => [...document.querySelectorAll(".shoo-line")].filter((l) => l.checkVisibility() && !l.closest("#shoo-page")).length);
    if (s) staleLines.push({ at: "watch", n: s, nav: navs });
  }
  await nav("back", async () => {
    await page.goBack({ waitUntil: "commit" });
    await page.waitForURL(/results/, { timeout: 10000 });
  });
  await nav("channel", async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("ytd-search:not([hidden]) ytd-video-renderer:not([data-shoo-hide]) #channel-info ytd-channel-name a[href^='/@']").first().click({ timeout: 8000 });
    await page.waitForURL(/\/@/, { timeout: 15000 });
    await sleep(1000);
    await scroll(page, 2);
  });
  await nav("channel→watch", async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("ytd-browse:not([hidden]) a[href^='/watch?v=']:not([href*='list='])").first().click({ timeout: 8000 });
    await page.waitForURL(/watch/, { timeout: 15000 });
    await sleep(1500);
  });
  if (i % 2 === 0) {
    await nav("hashtag (full)", async () => {
      await page.goto(`https://www.youtube.com/hashtag/${TAGS[i % TAGS.length]}`, { waitUntil: "domcontentloaded" });
      await sleep(2500);
      await scroll(page, 3);
    }, true);
    await nav("hashtag→watch", async () => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator("ytd-browse:not([hidden]) a[href^='/watch?v=']:not([href*='list='])").first().click({ timeout: 8000 });
      await page.waitForURL(/watch/, { timeout: 15000 });
    });
    await nav("back→hashtag", async () => {
      await page.goBack({ waitUntil: "commit" });
      await page.waitForURL(/hashtag/, { timeout: 10000 });
    });
  }
}
await take();
let frames = 0;
let flash = 0;
let hides = 0;
const events = [];
const per = {};
for (const h of harvest) {
  frames += h.frames;
  flash += h.flashFrames;
  hides += h.hides;
  events.push(...h.events);
  for (const [k, v] of Object.entries(h.perScenario)) {
    per[k] = per[k] || { frames: 0, flashFrames: 0, hides: 0 };
    for (const f of ["frames", "flashFrames", "hides"]) per[k][f] += v[f];
  }
}
const list = await getList(ctx);
save("churn", { navs, blocks, bot, errs, frames, flash, hides, events, per, dupes, staleLines, log, swErrors, pageWarnings, listChannels: list?.channels?.length });
check(`churn: ${TARGET}+ navigations done (search, watch, back, channel, hashtag)`, navs >= 50, { navs, failedSteps: errs.length, bot, errs: errs.slice(0, 5) });
check("churn: probe saw hiding happen", hides > 0, { hides, blocks });
check("churn: 0 frames with a listed card visible", flash === 0, { frames, flashFrames: flash, events: events.slice(0, 6) });
check("churn: no duplicate ⊘, page control, all-hidden line, stray menu, or 2 lines in one slot after any navigation", dupes.length === 0, dupes.slice(0, 5));
check("churn: 'Hidden: X · Undo' slot lines don't follow to the next page", staleLines.length === 0, staleLines.slice(0, 5));
check("churn: no service-worker errors or warnings", swErrors.length === 0, swErrors.slice(0, 5));
check("churn: no console errors/warnings from Shoo in the page", pageWarnings.filter((w) => w.type === "error").length === 0, pageWarnings.slice(0, 5));
console.log(JSON.stringify(per));
await finish(ctx, check);
