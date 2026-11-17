// QA r2: short SPA churn (30+ navigations incl. playlist page, watch in a playlist, mix) with the rAF probe,
// then 2-minute dwells on a playlist page, a watch page inside a playlist and a mix: badge sampled every 5 s, real popup at the end.
// Run: OUT=<shoo>/.e2e-out/qa-r2 node tests/e2e/qa/qa-r2-churn.mjs
import { launchLocked, LIST500, LIB, botWall, masthead, scroll, ownUi, save, sleep, consent } from "./qa-lib.mjs";
import { probeWithLeftAlone, pageState } from "./qa-r2-playlist.mjs";
import { reporter, closeWelcome, setList, until, finish, openRealPopup } from "../harness.mjs";

const TARGET = Number(process.env.NAVS || 30);
const DWELL = Number(process.env.DWELL_MS || 120000);
const { check } = reporter("qa-r2-churn");
const ctx = await launchLocked({ name: "qa-r2-churn" });
const swErrors = [];
const hookWorker = (w) => w.on("console", (m) => ["error", "warning"].includes(m.type()) && swErrors.push(m.text().slice(0, 200)));
hookWorker(ctx.worker);
ctx.context.on("serviceworker", hookWorker);
await closeWelcome(ctx);
const LIST = { ...LIST500, channels: [...LIST500.channels, { handle: "@veritasium", name: "Veritasium", added: 9, source: "card" }, { handle: "@RickAstleyYT", name: "Rick Astley", added: 10, source: "card" }], words: [...LIST500.words, "minecraft"] };
await setList(ctx, LIST);
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
await page.addInitScript(`${LIB}\nwindow.__SHOO_LIST = ${JSON.stringify(LIST)};\n${probeWithLeftAlone()}`);
const pageErrs = [];
page.on("console", (m) => {
  const loc = m.location()?.url || "";
  if (m.type() === "error" && (loc.startsWith("chrome-extension://") || /shoo/i.test(m.text()))) pageErrs.push(m.text().slice(0, 200));
});
const tabId = async () => ctx.worker.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t?.id));
const health = async () => {
  const id = await tabId();
  const { health = {} } = await ctx.worker.evaluate(() => chrome.storage.session.get("health"));
  return { badge: await ctx.worker.evaluate((i) => chrome.action.getBadgeText({ tabId: i }), id), entry: health[id] ? { page: health[id].page, missing: health[id].missing } : null };
};
const harvest = [];
const take = async (label) => {
  const s = await page.evaluate(() => ({ flash: window.__flash ? JSON.parse(JSON.stringify(window.__flash)) : null, blank: window.__blank ? JSON.parse(JSON.stringify(window.__blank)) : null })).catch(() => null);
  if (s?.flash) harvest.push({ label, ...s });
};
const PL = "PLkahZjV5wKe_Yh-7VFrP1bxJOtkVzdqeB";
const VID = "IV3dnLzthDA";
const log = [];
const dupes = [];
let navs = 0;
let bot = 0;
const errs = [];
const badges = [];
async function nav(kind, fn, full = false) {
  if (full) await take(kind);
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
  const st = await pageState(page);
  const h = await health();
  badges.push({ kind, path: st.path, ...h });
  const entry = { n: navs, kind, ...st, btn: ui.btn, menu: ui.menu, pageCtl: ui.page, all: ui.all };
  log.push(entry);
  if (ui.btn > 1 || ui.page > 1 || ui.all > 1 || ui.menu > 0) dupes.push(entry);
  return true;
}
const click = async (sel, re) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  const l = page.locator(sel).filter({ visible: true }).first();
  await l.scrollIntoViewIfNeeded({ timeout: 5000 });
  await l.click({ timeout: 8000 });
  if (re) await page.waitForURL(re, { timeout: 15000 });
};
const back = (re) => async () => {
  await page.goBack({ waitUntil: "commit" });
  await page.waitForURL(re, { timeout: 10000 });
};
const Q = ["football highlights", "veritasium", "iphone review", "cooking pasta", "lofi music"];
await page.goto(`https://www.youtube.com/watch?v=${VID}&list=${PL}`, { waitUntil: "domcontentloaded" });
await consent(page);
await sleep(5000);
const t0 = Date.now();
for (let i = 0; navs < TARGET && i < 12; i++) {
  await nav("watch(pl)→playlist page", () => click('ytd-playlist-panel-renderer#playlist #header-description a[href^="/playlist?list="]', /\/playlist/));
  await nav("playlist→search", async () => {
    await masthead(page, Q[i % Q.length]);
    await scroll(page, 2, 1500, 500);
  });
  await nav("search→watch", () => click("ytd-search:not([hidden]) ytd-video-renderer:not([data-shoo-hide]) a#thumbnail[href^='/watch']:not([href*='list='])", /watch/));
  await nav("back→search", back(/results/));
  await nav("back→playlist", back(/playlist/));
  await nav("playlist→watch(pl) item", () => click(`ytd-browse[page-subtype="playlist"]:not([hidden]) a[href*="/watch?v="][href*="list="]`, /watch/));
  if (i % 2 === 0) {
    await nav("watch(pl)→next in panel", () => click("ytd-playlist-panel-renderer#playlist ytd-playlist-panel-video-renderer:nth-of-type(4) a#wc-endpoint", /watch/));
    await nav("mix (full)", async () => {
      await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ&start_radio=1", { waitUntil: "domcontentloaded" });
      await sleep(2000);
    }, true);
    await nav("mix→next in panel", () => click("ytd-playlist-panel-renderer#playlist ytd-playlist-panel-video-renderer:nth-of-type(3) a#wc-endpoint", /watch/));
    await nav("mix→hashtag via search", async () => {
      await masthead(page, "#minecraft");
      await click('ytd-search a[href^="/hashtag/"]', /hashtag/);
      await scroll(page, 2, 1500, 500);
    });
    await nav("hashtag→watch(pl) (full)", async () => {
      await page.goto(`https://www.youtube.com/watch?v=${VID}&list=${PL}`, { waitUntil: "domcontentloaded" });
      await sleep(2000);
    }, true);
  }
}
const churnMs = Date.now() - t0;
await take("churn end");

// dwells: 2 minutes each, badge every 5 s
const dwells = {};
async function dwell(label, open) {
  await take(`before dwell ${label}`);
  await open();
  const id = await tabId();
  const samples = [];
  const start = Date.now();
  while (Date.now() - start < DWELL) {
    await sleep(5000);
    const h = await health();
    samples.push(h.badge);
    if (h.badge) samples.push(JSON.stringify(h.entry));
  }
  const st = await pageState(page);
  const pop = await openRealPopup(ctx, page);
  const p = await pop.eval(() => ({ health: !document.getElementById("health").hidden, status: document.getElementById("status")?.textContent || "", show: document.getElementById("showHidden")?.textContent || null }));
  await pop.close();
  dwells[label] = { samples: samples.length, bang: samples.filter((s) => s === "!").length, entries: samples.filter((s) => s.startsWith("{")).slice(0, 3), popup: p, state: st, tab: id };
  check(`dwell ${DWELL / 1000} s on ${label}: badge never '!', popup has no health box`, dwells[label].bang === 0 && !p.health, dwells[label]);
}
await dwell("playlist page (SPA from watch)", async () => {
  await page.goto(`https://www.youtube.com/watch?v=${VID}&list=${PL}`, { waitUntil: "domcontentloaded" });
  await sleep(4000);
  await click('ytd-playlist-panel-renderer#playlist #header-description a[href^="/playlist?list="]', /\/playlist/);
});
await dwell("watch inside the playlist (SPA from the playlist page)", async () => {
  await click('ytd-browse[page-subtype="playlist"]:not([hidden]) a[href*="/watch?v="][href*="list="]', /watch/);
  await sleep(2000);
  await page.evaluate(() => document.querySelector("#related")?.scrollIntoView());
  await sleep(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
});
await dwell("mix RD (full load)", async () => {
  await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ&start_radio=1", { waitUntil: "domcontentloaded" });
  await sleep(3000);
});
await dwell("watch inside the playlist (full load)", async () => {
  await page.goto(`https://www.youtube.com/watch?v=${VID}&list=${PL}`, { waitUntil: "domcontentloaded" });
  await sleep(3000);
});
await take("end");

let frames = 0, flash = 0, blankF = 0, maxGap = 0;
const events = [], blankEv = [];
const per = {};
for (const h of harvest) {
  frames += h.flash.frames;
  flash += h.flash.flashFrames;
  maxGap = Math.max(maxGap, h.flash.maxGap || 0);
  events.push(...h.flash.events);
  for (const [k, v] of Object.entries(h.flash.perScenario)) {
    per[k] = per[k] || { frames: 0, flashFrames: 0, hides: 0 };
    for (const f of ["frames", "flashFrames", "hides"]) per[k][f] += v[f];
  }
  if (h.blank) {
    blankF += h.blank.blankFrames;
    blankEv.push(...h.blank.events);
  }
}
const PLvisits = log.filter((s) => String(s.path).startsWith("/playlist"));
const falseBang = badges.filter((b) => b.badge === "!");
save("r2-churn", { navs, churnMs, bot, errs, frames, flash, blankF, maxGap, events, blankEv, per, dupes, log, badges, dwells, swErrors, pageErrs });
check(`churn: ${TARGET}+ navigations incl. playlist page, watch in a playlist and mix`, navs >= TARGET && log.some((l) => l.kind.startsWith("mix")) && PLvisits.length > 0, { navs, churnMs, failed: errs.length, errs: errs.slice(0, 6), bot });
check("churn: 0 frames with a listed card shown outside the playlist panel / page", flash === 0, { frames, flashFrames: flash, maxGapMs: Math.round(maxGap), events: events.slice(0, 6) });
check("churn: 0 frames with a Shoo-hidden box inside the playlist panel / page", blankF === 0, { blankFrames: blankF, events: blankEv.slice(0, 6) });
check("churn: after each navigation 0 listed cards shown outside LEFT_ALONE", log.every((s) => !s.listedOutsideShown), log.filter((s) => s.listedOutsideShown).map((s) => ({ k: s.kind, p: s.path, n: s.listedOutsideShown })));
check(`churn: playlist page visits (${PLvisits.length}) show every item`, PLvisits.every((s) => s.inLA > 0 && s.inLAhidden === 0 && s.inLAshown === s.inLA), PLvisits.map((s) => ({ items: s.inLA, shown: s.inLAshown, hidden: s.inLAhidden })));
check("churn: no duplicate ⊘ / page control / all-hidden line / stray menu", dupes.length === 0, dupes.slice(0, 4));
check("churn: badge never '!' at any navigation", falseBang.length === 0, falseBang.slice(0, 5));
check("no Shoo console errors in the page", pageErrs.length === 0, pageErrs.slice(0, 5));
check("no service-worker errors/warnings", swErrors.length === 0, swErrors.slice(0, 5));
console.log(JSON.stringify(per));
await finish(ctx, check);
