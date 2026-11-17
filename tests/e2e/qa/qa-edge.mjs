// Edge pages: channel pages (/@, /channel/UC, /c/, /user/), playlist, watch with playlist, mix, Shorts, hashtag;
// widths 1280 / 1024 / 500 for search and watch. Health badge, errors, ⊘ and page-control placement.
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { launchLocked, botWall, ownUi, save, sleep, consent, OUT } from "./qa-lib.mjs";
import { reporter, closeWelcome, setList, getList, until, finish, goSearch } from "../harness.mjs";

const { check } = reporter("qa-edge");
const SHOTS = join(OUT, "edge");
mkdirSync(SHOTS, { recursive: true });
const ctx = await launchLocked({ name: "qa-edge" });
const swErrors = [];
ctx.worker.on("console", (m) => ["error", "warning"].includes(m.type()) && swErrors.push(m.text().slice(0, 200)));
await closeWelcome(ctx);
const LIST = { v: 1, channels: [{ handle: "@veritasium", name: "Veritasium", added: 2, source: "card" }, { handle: "@kurzgesagt", name: "Kurzgesagt – In a Nutshell", added: 1, source: "card" }], words: ["minecraft"] };
await setList(ctx, LIST);
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
const tabId = async () => ctx.worker.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t?.id));
const badge = async () => ctx.worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), await tabId());
const data = {};
const go = async (url, wait = 6000) => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await consent(page);
  await sleep(wait);
  return !(await botWall(page));
};
const pageCtl = () =>
  page.evaluate(() => {
    const b = document.getElementById("shoo-page");
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const sub = document.querySelector("ytd-watch-metadata #subscribe-button, yt-page-header-view-model yt-flexible-actions-view-model");
    const s = sub?.getBoundingClientRect();
    const overlap = s && b.className.includes("shoo-page") && !(r.right <= s.left || s.right <= r.left || r.bottom <= s.top || s.bottom <= r.top);
    return { cls: b.className, text: b.textContent.slice(0, 80), visible: b.checkVisibility(), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), inViewportX: r.left >= 0 && r.right <= innerWidth, overlapSubscribe: Boolean(overlap) };
  });

// ----- channel pages -----
const VER_UC = "UCHnyfMqiRRG1u-2MsSQLbXA";
for (const [label, url] of [["/@handle", "https://www.youtube.com/@veritasium/videos"], ["/channel/UC", `https://www.youtube.com/channel/${VER_UC}/videos`], ["/c/", "https://www.youtube.com/c/veritasium/videos"], ["/user/", "https://www.youtube.com/user/1veritasium/videos"]]) {
  const ok = await go(url, 7000);
  if (!ok) {
    check(`channel page ${label}`, null, "bot page");
    continue;
  }
  const s = await page.evaluate(() => ({
    url: location.pathname,
    cards: document.querySelectorAll("ytd-browse:not([hidden]) :is(ytd-rich-item-renderer, yt-lockup-view-model)").length,
    hidden: [...document.querySelectorAll("ytd-browse:not([hidden]) [data-shoo-hide]")].length,
    minecraftTitles: [...document.querySelectorAll("ytd-browse:not([hidden]) #video-title, ytd-browse:not([hidden]) h3")].filter((n) => /minecraft/i.test(n.textContent)).length,
  }));
  const ctl = await pageCtl();
  const b = await badge();
  await page.screenshot({ path: join(SHOTS, `channel-${label.replace(/\W+/g, "")}.png`) });
  data[`channel ${label}`] = { ...s, ctl, badge: b };
  check(`channel page ${label} of a listed channel: own videos not hidden, pageHidden + unhideChannel by the header, no '!'`, s.cards > 0 && s.hidden === 0 && ctl?.visible && ctl.text === ctx.msg("pageHidden") + ctx.msg("unhideChannel") && b === "", data[`channel ${label}`]);
}
// channel page of a not-listed channel: button present; block; Undo
if (await go("https://www.youtube.com/@minutephysics/videos", 7000)) {
  const ctl = await pageCtl();
  check("channel page of a not-listed channel: 'Hide this channel's videos' by Subscribe, not overlapping it", ctl?.visible && ctl.text === ctx.msg("pageHide") && !ctl.overlapSubscribe && ctl.inViewportX, ctl);
  await page.click("#shoo-page button.shoo-main");
  await sleep(1200);
  const after = await pageCtl();
  const l = await getList(ctx);
  const entry = l.channels.find((c) => /minutephysics/i.test(c.handle || ""));
  check("channel page block: stores handle + name + UC id; confirmation 'Hidden: … · Undo'; no 'Back to results' (came directly)", entry?.name && entry?.id?.startsWith("UC") && /Undo/.test(after?.text || "") && !/Back to results/.test(after?.text || ""), { entry, after });
  await page.screenshot({ path: join(SHOTS, "channel-blocked.png") });
  await page.click("#shoo-page button:last-of-type");
  await sleep(1200);
  const l2 = await getList(ctx);
  check("channel page Undo removes it", !l2.channels.some((c) => /minutephysics/i.test(c.handle || "")), l2.channels.map((c) => c.handle));
}

// ----- search: get a watch URL of a listed channel and of another channel -----
await page.setViewportSize({ width: 1280, height: 900 });
await setList(ctx, { v: 1, channels: [], words: [] });
await goSearch(page, "veritasium");
const otherUrl = await (async () => {
  const p2 = await ctx.context.newPage();
  await goSearch(p2, "how airplanes fly explained");
  const v = await p2.evaluate(() => [...document.querySelectorAll("ytd-search ytd-video-renderer")].map((c) => ({ h: c.querySelector("#channel-info a[href^='/@']")?.getAttribute("href"), v: c.querySelector("a#thumbnail[href^='/watch']")?.getAttribute("href") })).find((x) => x.v && !x.v.includes("list=") && x.h && !/veritasium|kurzgesagt/i.test(x.h))?.v);
  await p2.close();
  return v;
})();
const urls = await page.evaluate(() => {
  const pick = (re) => [...document.querySelectorAll("ytd-search ytd-video-renderer")].map((c) => ({ h: c.querySelector("#channel-info a[href^='/@']")?.getAttribute("href"), v: c.querySelector("a#thumbnail[href^='/watch']")?.getAttribute("href") })).find((x) => x.v && !x.v.includes("list=") && re.test(x.h || ""));
  return { ver: pick(/veritasium/i)?.v, other: pick(/^\/@(?!veritasium)/i)?.v };
});
urls.other ||= otherUrl;
await setList(ctx, LIST);
data.urls = urls;

// ----- widths: search + watch -----
for (const width of [1280, 1024, 500]) {
  await page.setViewportSize({ width, height: 900 });
  if (!(await go("https://www.youtube.com/results?search_query=veritasium+kurzgesagt", 5000))) {
    check(`search at ${width}px`, null, "bot page");
    continue;
  }
  const vis = await page.evaluate(() => [...document.querySelectorAll("ytd-search ytd-video-renderer")].filter((c) => c.checkVisibility() && c.querySelector('#channel-info a[href="/@veritasium"], #channel-info a[href="/@kurzgesagt"]') && !c.closest("[data-shoo-slot]")).length);
  const card = page.locator("ytd-search ytd-video-renderer:not([data-shoo-hide]):has(#channel-info a[href^='/@'])").first();
  await card.scrollIntoViewIfNeeded().catch(() => {});
  await page.mouse.move(1, 1);
  await card.locator("h3").first().hover().catch((e) => console.log("hover", String(e).slice(0, 120)));
  await sleep(500);
  const btn = await page.evaluate(() => {
    const b = document.querySelector("ytd-search .shoo-btn");
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const c = b.closest("ytd-video-renderer")?.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), inCard: c ? r.left >= c.left - 1 && r.right <= c.right + 1 : false, inViewport: r.left >= 0 && r.right <= innerWidth, opacity: getComputedStyle(b).opacity };
  });
  const b = await badge();
  await page.screenshot({ path: join(SHOTS, `search-${width}.png`) });
  data[`search ${width}`] = { listedVisible: vis, btn, badge: b };
  check(`search at ${width}px: listed channels hidden, ⊘ inside its card and the viewport, no '!'`, vis === 0 && btn?.inCard && btn.inViewport && btn.opacity === "1" && b === "", data[`search ${width}`]);
  for (const [label, url] of [["listed", urls.ver], ["other", urls.other]]) {
    if (!url) continue;
    if (!(await go(`https://www.youtube.com${url.split("&")[0]}`, 8000))) {
      check(`watch ${label} at ${width}px`, null, "bot page");
      continue;
    }
    const ctl = await pageCtl();
    const b2 = await badge();
    await page.screenshot({ path: join(SHOTS, `watch-${label}-${width}.png`) });
    data[`watch ${label} ${width}`] = { ctl, badge: b2 };
    const want = label === "listed" ? ctx.msg("pageHidden") + ctx.msg("unhideChannel") : ctx.msg("pageHide");
    check(`watch (${label} channel) at ${width}px: page control by the owner row, in the viewport, not over Subscribe, no '!'`, ctl?.visible && ctl.text === want && ctl.inViewportX && !ctl.overlapSubscribe && b2 === "", data[`watch ${label} ${width}`]);
  }
}
await page.setViewportSize({ width: 1280, height: 900 });

// ----- hashtag -----
if (await go("https://www.youtube.com/hashtag/minecraft", 6000)) {
  const s = await page.evaluate(() => ({
    cards: document.querySelectorAll("ytd-browse:not([hidden]) :is(ytd-rich-item-renderer)").length,
    hidden: document.querySelectorAll("ytd-browse:not([hidden]) [data-shoo-hide]").length,
    shownMinecraft: [...document.querySelectorAll("ytd-browse:not([hidden]) ytd-rich-item-renderer")].filter((c) => c.checkVisibility() && /minecraft/i.test(c.querySelector("#video-title, h3")?.textContent || "")).length,
  }));
  const b = await badge();
  await page.screenshot({ path: join(SHOTS, "hashtag-minecraft.png") });
  data.hashtag = { ...s, badge: b };
  check("hashtag page with word 'minecraft': matching titles hidden, no '!'", s.hidden > 0 && s.shownMinecraft === 0 && b === "", data.hashtag);
}

// ----- playlist page, watch with playlist, mix, Shorts -----
await setList(ctx, LIST);
if (await go("https://www.youtube.com/results?search_query=veritasium+playlist&sp=EgIQAw%253D%253D", 5000)) {
  const pl = await page.evaluate(() => {
    const a = [...document.querySelectorAll("ytd-search a[href*='list=PL']")].map((x) => x.getAttribute("href"))[0];
    return a ? new URL(a, location.href).searchParams.get("list") : null;
  });
  data.playlistId = pl;
  if (pl && (await go(`https://www.youtube.com/playlist?list=${pl}`, 6000))) {
    const s = await page.evaluate(() => {
      const items = [...document.querySelectorAll("ytd-browse:not([hidden]) :is(ytd-playlist-video-renderer, ytd-playlist-video-list-renderer yt-lockup-view-model, ytd-item-section-renderer yt-lockup-view-model)")];
      return { items: items.length, visible: items.filter((c) => c.checkVisibility()).length, hidden: document.querySelectorAll("ytd-browse:not([hidden]) [data-shoo-hide]").length, tags: [...new Set([...document.querySelectorAll("ytd-browse:not([hidden]) [data-shoo-hide]")].map((n) => n.tagName.toLowerCase()))], firstVideo: document.querySelector("ytd-browse:not([hidden]) a[href*='/watch?v='][href*='list=']")?.getAttribute("href") || null, shooLabel: [...document.querySelectorAll(".shoo-all, .shoo-line, #shoo-page")].map((n) => n.textContent).join(" | ") };
    });
    const b = await badge();
    await page.screenshot({ path: join(SHOTS, "playlist.png") });
    data.playlist = { ...s, badge: b };
    check("playlist page of a listed channel (opened on purpose): its videos still listed, or Shoo says why they're gone", s.visible > 0 || s.shooLabel.length > 0, data.playlist);
    if (s.firstVideo && (await go(`https://www.youtube.com${s.firstVideo}`, 9000))) {
      const s2 = await page.evaluate(() => ({ panel: document.querySelectorAll("ytd-playlist-panel-video-renderer").length, panelVisible: [...document.querySelectorAll("ytd-playlist-panel-video-renderer")].filter((c) => c.checkVisibility()).length, panelHidden: document.querySelectorAll("ytd-playlist-panel-renderer [data-shoo-hide]").length }));
      const ctl = await pageCtl();
      const b2 = await badge();
      await page.screenshot({ path: join(SHOTS, "watch-playlist.png") });
      data.watchPlaylist = { ...s2, ctl, badge: b2 };
      check("watch in that playlist: playlist panel entries not hidden, page control present, no '!'", s2.panel > 0 && s2.panelHidden === 0 && ctl?.visible && b2 === "", data.watchPlaylist);
    }
  } else check("playlist page", null, "no playlist found in search or bot page");
}
if (urls.other) {
  const v = new URL(`https://www.youtube.com${urls.other}`).searchParams.get("v");
  if (await go(`https://www.youtube.com/watch?v=${v}&list=RD${v}&start_radio=1`, 8000)) {
    const s = await page.evaluate(() => ({ panel: document.querySelectorAll("ytd-playlist-panel-video-renderer").length, panelHidden: document.querySelectorAll("ytd-playlist-panel-video-renderer[data-shoo-hide]").length, listedInPanel: [...document.querySelectorAll("ytd-playlist-panel-video-renderer")].filter((c) => /Veritasium|Kurzgesagt/i.test(c.textContent)).length }));
    const b = await badge();
    await page.screenshot({ path: join(SHOTS, "mix.png") });
    data.mix = { ...s, badge: b };
    check("mix (list=RD…): panel intact, no '!'", s.panel > 0 && b === "", data.mix);
  }
}
if (await go("https://www.youtube.com/results?search_query=minecraft+shorts", 4000)) {
  const sh = await page.evaluate(() => document.querySelector("a[href^='/shorts/']")?.getAttribute("href"));
  if (sh && (await go(`https://www.youtube.com${sh}`, 7000))) {
    const s = await page.evaluate(() => ({ url: location.pathname, ui: document.querySelectorAll(".shoo-btn, #shoo-page, .shoo-line").length, hiddenReel: document.querySelectorAll("ytd-reel-video-renderer[data-shoo-hide], ytd-shorts [data-shoo-hide]").length }));
    await page.mouse.move(640, 400);
    await page.keyboard.press("ArrowDown");
    await sleep(3000);
    s.afterScroll = await page.evaluate(() => ({ url: location.pathname, ui: document.querySelectorAll(".shoo-btn, #shoo-page, .shoo-line").length }));
    const b = await badge();
    await page.screenshot({ path: join(SHOTS, "shorts.png") });
    data.shorts = { ...s, badge: b };
    check("Shorts player: Shoo adds nothing and hides nothing in the player (not in v0.1), no '!'", s.ui === 0 && s.hiddenReel === 0 && s.afterScroll.ui === 0 && b === "", data.shorts);
  } else check("Shorts player", null, "no Shorts link or bot page");
}

save("edge", { data, swErrors });
check("edge: no service-worker errors", swErrors.length === 0, swErrors.slice(0, 5));
await finish(ctx, check);
