// QA r2: playlist / mix / hashtag / channel regressions around LEFT_ALONE, and SPA chains through the playlist page
// with a rAF probe (listed card visible outside LEFT_ALONE = flash; any Shoo-hidden box inside LEFT_ALONE = blank frame).
// Run: OUT=<shoo>/.e2e-out/qa-r2 node tests/e2e/qa/qa-r2-playlist.mjs
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { launchLocked, LIB, PROBE, botWall, masthead, scroll, save, sleep, consent, OUT } from "./qa-lib.mjs";
import { reporter, closeWelcome, setList, until, finish } from "../harness.mjs";

export const LA = 'ytd-playlist-panel-renderer, ytd-browse[page-subtype="playlist"]';
export function probeWithLeftAlone() {
  return PROBE.replace(
    "if (c.parentElement?.closest(CARD)) continue;",
    `if (c.parentElement?.closest(CARD)) continue;
        if (c.closest(${JSON.stringify(LA)})) continue;
        { const m = /^\\/(@[^/]+)/.exec(location.pathname); if (m && c.closest('ytd-browse[page-subtype="channels"]') && H.has(L.normHandle(m[1]))) continue; }`,
  ).replace("const S = (window.__flash", "window.__qaBlocked = blocked; const S = (window.__flash")
    + `
;(() => {
  const B = (window.__blank = { frames: 0, blankFrames: 0, events: [] });
  const tick = () => {
    B.frames++;
    const pg = document.querySelector("ytd-page-manager > :not([hidden])");
    const hid = pg ? [...pg.querySelectorAll(${JSON.stringify(LA.split(", ").map((s) => s + " [data-shoo-hide]").join(", "))})].filter((n) => n.getClientRects().length || n.hasAttribute("data-shoo-hide")) : [];
    if (hid.length) {
      B.blankFrames++;
      if (B.events.length < 20) B.events.push({ url: location.pathname + location.search.slice(0, 30), n: hid.length, tag: hid[0].tagName.toLowerCase() });
    }
    requestAnimationFrame(tick);
  };
  const go = () => requestAnimationFrame(tick);
  if (document.documentElement) go(); else document.addEventListener("readystatechange", go, { once: true });
})();`;
}

export async function pageState(page) {
  return page.evaluate((LA) => {
    const pg = document.querySelector("ytd-page-manager > :not([hidden])");
    const CARD = "ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-rich-grid-media, yt-lockup-view-model, ytd-channel-renderer";
    const out = { path: location.pathname + (location.search.includes("list=") ? "?list=" + new URLSearchParams(location.search).get("list").slice(0, 6) : ""), tag: pg?.tagName.toLowerCase() || null, subtype: pg?.getAttribute("page-subtype") || null, browseCount: document.querySelectorAll("ytd-browse").length };
    if (!pg) return out;
    const cards = [...pg.querySelectorAll(CARD)].filter((c) => !c.parentElement?.closest(CARD));
    const inLA = cards.filter((c) => c.closest(LA));
    const outLA = cards.filter((c) => !c.closest(LA));
    const shown = (c) => c.checkVisibility() && !(c.closest("ytd-rich-item-renderer") || c).hasAttribute("data-shoo-slot");
    const m = /^\/(@[^/]+)/.exec(location.pathname);
    const exemptPage = Boolean(m && pg.getAttribute("page-subtype") === "channels");
    const listed = outLA.filter((c) => window.__qaBlocked?.(c));
    out.cards = cards.length;
    out.inLA = inLA.length;
    out.inLAshown = inLA.filter((c) => c.checkVisibility()).length;
    out.inLAhidden = pg.querySelectorAll(LA.split(", ").map((s) => s + " [data-shoo-hide]").join(", ")).length;
    out.listedOutside = listed.length;
    out.listedOutsideShown = exemptPage ? null : listed.filter(shown).length;
    out.hidden = pg.querySelectorAll("[data-shoo-hide]").length;
    out.panel = pg.querySelectorAll("ytd-playlist-panel-renderer#playlist ytd-playlist-panel-video-renderer").length;
    out.panelShown = [...pg.querySelectorAll("ytd-playlist-panel-renderer#playlist ytd-playlist-panel-video-renderer")].filter((c) => c.checkVisibility()).length;
    out.plItems = pg.matches('[page-subtype="playlist"]') ? pg.querySelectorAll("yt-lockup-view-model, ytd-playlist-video-renderer").length : null;
    out.shooUi = [...document.querySelectorAll(".shoo-all, #shoo-page")].filter((n) => n.checkVisibility()).map((n) => n.textContent.trim().slice(0, 70));
    out.btnInLA = document.querySelectorAll(LA.split(", ").map((s) => s + " .shoo-btn").join(", ")).length;
    return out;
  }, LA);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { check } = reporter("qa-r2-playlist");
  const ctx = await launchLocked({ name: "qa-r2-playlist" });
  const swErrors = [];
  ctx.worker.on("console", (m) => ["error", "warning"].includes(m.type()) && swErrors.push(m.text().slice(0, 200)));
  await closeWelcome(ctx);
  const LIST = {
    v: 1,
    channels: [
      { handle: "@veritasium", name: "Veritasium", added: 1, source: "card" },
      { handle: "@kurzgesagt", name: "Kurzgesagt – In a Nutshell", added: 2, source: "card" },
      { handle: "@RickAstleyYT", name: "Rick Astley", added: 3, source: "card" },
    ],
    words: ["minecraft"],
  };
  await setList(ctx, LIST);
  const SHOTS = join(OUT, "playlist");
  mkdirSync(SHOTS, { recursive: true });
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
  const steps = [];
  let bot = 0;
  const step = async (label, fn, { full = false, settle = 3000, wantPath = null } = {}) => {
    if (full) await take(`before ${label}`);
    await page.evaluate((x) => window.__setScenario?.(x), label).catch(() => {});
    let err = null;
    try {
      await fn();
    } catch (e) {
      err = String(e.message).split("\n")[0].slice(0, 120);
    }
    await sleep(settle);
    if (await botWall(page)) bot++;
    const s = await pageState(page);
    const sameDoc = await page.evaluate(() => performance.timeOrigin).catch(() => null);
    const row = { label, err, ...s, timeOrigin: sameDoc };
    steps.push(row);
    console.log("STEP", JSON.stringify(row).slice(0, 400));
    if (wantPath && !String(s.path).startsWith(wantPath)) row.err = row.err || `ended on ${s.path}`;
    return row;
  };
  const clickSel = async (sel, waitRe) => {
    const loc = page.locator(sel).filter({ visible: true }).first();
    await loc.scrollIntoViewIfNeeded({ timeout: 5000 });
    await loc.click({ timeout: 8000 });
    if (waitRe) await page.waitForURL(waitRe, { timeout: 15000 });
  };
  const PL = "PLkahZjV5wKe_Yh-7VFrP1bxJOtkVzdqeB";
  const VID = "IV3dnLzthDA";

  // 1. watch inside a listed channel's playlist (full load): panel left alone, #related outside the panel hidden, no "!"
  const s1 = await step("watch(playlist) full", async () => {
    await page.goto(`https://www.youtube.com/watch?v=${VID}&list=${PL}`, { waitUntil: "domcontentloaded" });
    await consent(page);
    await until(() => page.evaluate(() => document.querySelectorAll("ytd-playlist-panel-video-renderer").length), (n) => n > 0, 20000);
    await page.evaluate(() => document.querySelector("#related")?.scrollIntoView());
    await sleep(2000);
    await page.evaluate(() => window.scrollTo(0, 0));
  }, { full: true, settle: 4000 });
  const doc1 = s1.timeOrigin;
  await sleep(18000);
  const h1 = await health();
  const s1b = await pageState(page);
  await page.screenshot({ path: join(SHOTS, "watch-playlist.png") });
  check("watch inside a listed channel's playlist: panel entries all shown, 0 hidden in the panel, no ⊘ in the panel", s1b.panel > 0 && s1b.panelShown === s1b.panel && s1b.inLAhidden === 0 && s1b.btnInLA === 0, s1b);
  check("same page: #related cards outside the panel from listed channels are hidden (0 shown)", s1b.listedOutside > 0 ? s1b.listedOutsideShown === 0 : null, { listedOutside: s1b.listedOutside, shown: s1b.listedOutsideShown, hidden: s1b.hidden, cards: s1b.cards });
  check("same page after 22 s: no '!' (r1 CRITICAL repro)", h1.badge === "" && (!h1.entry || h1.entry.missing.length === 0), h1);

  // 2. SPA chain: watch(playlist) -> playlist page -> search -> back -> back -> forward
  await step("watch→playlist page (panel title)", () => clickSel('ytd-playlist-panel-renderer#playlist #header-description a[href^="/playlist?list="]', /\/playlist/), { wantPath: "/playlist" });
  await step("playlist→search 'veritasium'", async () => {
    await masthead(page, "veritasium");
    await sleep(1500);
    await scroll(page, 2);
  }, { wantPath: "/results" });
  await step("back→playlist page", async () => {
    await page.goBack({ waitUntil: "commit" });
    await page.waitForURL(/\/playlist/, { timeout: 10000 });
  }, { wantPath: "/playlist" });
  await step("back→watch(playlist)", async () => {
    await page.goBack({ waitUntil: "commit" });
    await page.waitForURL(/\/watch/, { timeout: 10000 });
    await page.evaluate(() => document.querySelector("#related")?.scrollIntoView());
    await sleep(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
  }, { wantPath: "/watch" });
  await step("forward→playlist page", async () => {
    await page.goForward({ waitUntil: "commit" });
    await page.waitForURL(/\/playlist/, { timeout: 10000 });
  }, { wantPath: "/playlist" });
  await step("playlist page→owner (Veritasium channel, SPA)", () => clickSel('ytd-browse[page-subtype="playlist"]:not([hidden]) a[href^="/@veritasium"]', /\/@veritasium/i), { wantPath: "/@" });
  await step("channel→back→playlist page", async () => {
    await page.goBack({ waitUntil: "commit" });
    await page.waitForURL(/\/playlist/, { timeout: 10000 });
  }, { wantPath: "/playlist" });
  await step("playlist page→first item (watch with list, SPA)", () => clickSel('ytd-browse[page-subtype="playlist"]:not([hidden]) a[href*="/watch?v="][href*="list="]', /\/watch/), { wantPath: "/watch" });

  // 3. hashtag <-> playlist through shared ytd-browse
  await step("watch→search '#minecraft'", () => masthead(page, "#minecraft"), { wantPath: "/results" });
  const tagLink = await page.evaluate(() => [...document.querySelectorAll('ytd-search a[href^="/hashtag/"]')].some((a) => a.checkVisibility()));
  if (tagLink) await step("search→hashtag page (SPA)", async () => {
    await clickSel('ytd-search a[href^="/hashtag/"]', /\/hashtag\//);
    await scroll(page, 2);
  }, { wantPath: "/hashtag" });
  else await step("hashtag page (full load; no hashtag link in results)", async () => {
    await page.goto("https://www.youtube.com/hashtag/minecraft", { waitUntil: "domcontentloaded" });
    await scroll(page, 2);
  }, { full: true, wantPath: "/hashtag" });
  const hashtagRow = steps.at(-1);
  await step("hashtag→search 'veritasium playlist'", () => masthead(page, "veritasium full playlist"), { wantPath: "/results" });
  const plLink = await page.evaluate(() => [...document.querySelectorAll('ytd-search a[href^="/playlist?list="]')].filter((a) => a.checkVisibility()).length);
  if (plLink) await step("search→playlist page via 'View full playlist' (SPA)", () => clickSel('ytd-search a[href^="/playlist?list="]', /\/playlist/), { wantPath: "/playlist" });
  else await step("search→playlist page (no View full playlist link; full load)", () => page.goto(`https://www.youtube.com/playlist?list=${PL}`, { waitUntil: "domcontentloaded" }), { full: true, wantPath: "/playlist" });
  await step("back→search", async () => {
    await page.goBack({ waitUntil: "commit" });
    await page.waitForURL(/results/, { timeout: 10000 });
  }, { wantPath: "/results" });
  await step("back→hashtag", async () => {
    await page.goBack({ waitUntil: "commit" });
    await page.waitForURL(/hashtag|results/, { timeout: 10000 });
    await scroll(page, 2);
  });
  await step("forward→search", async () => {
    await page.goForward({ waitUntil: "commit" });
    await page.waitForURL(/results/, { timeout: 10000 });
  });
  await step("forward→playlist page", async () => {
    await page.goForward({ waitUntil: "commit" });
    await page.waitForURL(/playlist/, { timeout: 10000 });
  });
  // full load of the playlist page, then SPA to the hashtag page through the search box
  await step("playlist page (full load)", () => page.goto(`https://www.youtube.com/playlist?list=${PL}`, { waitUntil: "domcontentloaded" }), { full: true, wantPath: "/playlist" });
  await step("playlist→search '#minecraft'", () => masthead(page, "#minecraft"), { wantPath: "/results" });
  if (await page.evaluate(() => [...document.querySelectorAll('ytd-search a[href^="/hashtag/"]')].some((a) => a.checkVisibility())))
    await step("search→hashtag (SPA, after a playlist page in this document)", async () => {
      await clickSel('ytd-search a[href^="/hashtag/"]', /\/hashtag\//);
      await scroll(page, 3);
    }, { wantPath: "/hashtag" });
  await page.screenshot({ path: join(SHOTS, "hashtag-after-playlist.png") });

  // 4. mix (RD) seeded by a listed channel's video (Rick Astley listed)
  const sMix = await step("mix RD dQw4w9WgXcQ (full load)", async () => {
    await page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ&start_radio=1", { waitUntil: "domcontentloaded" });
    await until(() => page.evaluate(() => document.querySelectorAll("ytd-playlist-panel-video-renderer").length), (n) => n > 0, 20000);
    await page.evaluate(() => document.querySelector("#related")?.scrollIntoView());
    await sleep(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
  }, { full: true, settle: 4000 });
  await sleep(18000);
  const hMix = await health();
  const sMix2 = await pageState(page);
  const mixListed = await page.evaluate(() => [...document.querySelectorAll("ytd-playlist-panel-renderer#playlist ytd-playlist-panel-video-renderer")].filter((c) => /Rick Astley|Veritasium|Kurzgesagt/i.test(c.querySelector("#byline, .byline-item, #channel-name")?.textContent || c.textContent) && c.checkVisibility()).length);
  await page.screenshot({ path: join(SHOTS, "mix.png") });
  check("mix (RD…) seeded by a listed channel: panel renders and is left alone; listed cards outside the panel 0 shown; no '!' after 22 s", sMix2.panel > 0 ? sMix2.inLAhidden === 0 && (sMix2.listedOutsideShown ?? 0) === 0 && hMix.badge === "" : null, { ...sMix2, mixPanelEntriesFromListedChannels: mixListed, health: hMix });
  const sMixSpa = await step("mix → next entry in the panel (SPA)", () => clickSel("ytd-playlist-panel-renderer#playlist ytd-playlist-panel-video-renderer:nth-of-type(3) a#wc-endpoint", /\/watch/));
  // 5. channel pages: listed (exempt, shows its videos) and not listed
  const ch1 = await step("/@veritasium/videos (listed, full)", async () => {
    await page.goto("https://www.youtube.com/@veritasium/videos", { waitUntil: "domcontentloaded" });
    await scroll(page, 1);
  }, { full: true });
  check("listed channel's own page: videos shown (0 hidden), Shoo line by the header", ch1.cards > 0 && ch1.hidden === 0 && ch1.shooUi.length > 0, ch1);
  const ch2 = await step("/@minutephysics/videos (not listed, full)", async () => {
    await page.goto("https://www.youtube.com/@minutephysics/videos", { waitUntil: "domcontentloaded" });
    await scroll(page, 1);
  }, { full: true });
  check("not-listed channel page: videos shown, 0 hidden", ch2.cards > 0 && ch2.hidden === 0, ch2);
  await step("channel page→Playlists tab (SPA)", () => clickSel('yt-tab-shape[tab-title="Playlists"], tp-yt-paper-tab:has-text("Playlists"), yt-tab-shape:has-text("Playlists")', /playlists/));
  await step("Playlists tab→a playlist page (SPA)", () => clickSel('ytd-browse:not([hidden]) a[href^="/playlist?list="], ytd-browse:not([hidden]) a[href*="&list=PL"]', /playlist|watch/));
  await step("→ back to channel playlists tab", async () => {
    await page.goBack({ waitUntil: "commit" });
    await sleep(500);
  });
  await take("end");

  // evaluate the step table
  const PLs = steps.filter((s) => String(s.path).startsWith("/playlist"));
  check(`playlist page visits (${PLs.length}): every item shown, 0 Shoo-hidden inside, no ⊘`, PLs.length > 0 && PLs.every((s) => s.inLAhidden === 0 && s.inLAshown === s.inLA && s.btnInLA === 0 && s.inLA > 0), PLs.map((s) => ({ l: s.label, items: s.inLA, shown: s.inLAshown, hidden: s.inLAhidden, err: s.err })));
  const outside = steps.filter((s) => s.listedOutsideShown !== null && s.listedOutsideShown !== undefined);
  check(`every step (${outside.length}): 0 listed cards shown outside LEFT_ALONE after settle`, outside.every((s) => s.listedOutsideShown === 0), outside.filter((s) => s.listedOutsideShown).map((s) => ({ l: s.label, path: s.path, n: s.listedOutsideShown, of: s.listedOutside })));
  const hashtags = steps.filter((s) => String(s.path).startsWith("/hashtag"));
  check(`hashtag visits (${hashtags.length}): word-matching cards hidden`, hashtags.length ? hashtags.every((s) => s.hidden > 0 && s.listedOutsideShown === 0) : null, hashtags.map((s) => ({ l: s.label, hidden: s.hidden, shown: s.listedOutsideShown, subtype: s.subtype, browse: s.browseCount })));
  const searches = steps.filter((s) => String(s.path).startsWith("/results") && /veritasium/.test(s.label));
  check("search 'veritasium' right after a playlist page: Veritasium cards hidden", searches.length ? searches.every((s) => s.hidden > 0 && s.listedOutsideShown === 0) : null, searches.map((s) => ({ l: s.label, hidden: s.hidden, listed: s.listedOutside, shown: s.listedOutsideShown })));
  let frames = 0, flash = 0, blankF = 0, bFrames = 0;
  const events = [], blankEv = [];
  for (const h of harvest) {
    frames += h.flash.frames;
    flash += h.flash.flashFrames;
    events.push(...h.flash.events);
    if (h.blank) {
      bFrames += h.blank.frames;
      blankF += h.blank.blankFrames;
      blankEv.push(...h.blank.events);
    }
  }
  check("rAF probe across the whole run: 0 frames with a listed card shown outside LEFT_ALONE", flash === 0, { frames, flashFrames: flash, events: events.slice(0, 8) });
  check("rAF probe: 0 frames with a Shoo-hidden box inside the playlist panel or playlist page", blankF === 0, { frames: bFrames, blankFrames: blankF, events: blankEv.slice(0, 8) });
  const failed = steps.filter((s) => s.err);
  check("SPA steps completed", failed.length <= 2, { steps: steps.length, failed: failed.map((s) => ({ l: s.label, err: s.err })), bot });
  save("r2-playlist", { steps, harvest, swErrors, pageErrs, h1, hMix, mixListed });
  check("no Shoo console errors in the page", pageErrs.length === 0, pageErrs.slice(0, 5));
  check("no service-worker errors/warnings", swErrors.length === 0, swErrors.slice(0, 5));
  await finish(ctx, check);
}
