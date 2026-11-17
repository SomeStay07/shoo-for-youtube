import { launch, reporter, closeWelcome, setList, until, sleep, finish, consent } from "./harness.mjs";
import { lockup, serve } from "./fixtures.mjs";

const { check } = reporter("playlist");
const ctx = await launch({ name: "playlist" });
await closeWelcome(ctx);
const WAIT = 20000;

const STYLE = `<style>yt-lockup-view-model,ytd-playlist-panel-renderer{display:block;min-height:90px;margin:8px;border:1px solid #888;font:14px Roboto,Arial}</style>`;
const side = (i, name) => lockup({ vid: `s${String(i).padStart(10, "0")}`, title: `Side ${i}`, spans: [name] });
const related = [side(0, "Other One"), side(1, "Other Two"), side(2, "Other Three"), side(3, "Other Four"), side(4, "Other Five"), side(5, "Listed PL")];
const panel = `<ytd-playlist-panel-renderer id="playlist"><div id="container"><div><div id="header-contents"><div id="header-top-row"><div id="header-description"><h3>Listed playlist</h3><div id="publisher-container"><yt-formatted-string><a class="yt-simple-endpoint" href="/@listedpl">Listed PL</a></yt-formatted-string></div></div></div></div>
  <div id="items">${lockup({ vid: "p000000000a", title: "In the panel", spans: ["Listed PL"] })}</div></div></div></ytd-playlist-panel-renderer>`;
const watch = (secondary) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8">${STYLE}</head><body><ytd-app><ytd-page-manager><ytd-watch-flexy><div id="columns"><div id="primary"><div id="player">player</div></div><div id="secondary"><div id="secondary-inner">${secondary}</div></div></div></ytd-watch-flexy></ytd-page-manager></ytd-app></body></html>`;
const playlistPage = (cards) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8">${STYLE}</head><body><ytd-app><ytd-page-manager><ytd-browse page-subtype="playlist"><ytd-two-column-browse-results-renderer><div id="primary"><yt-section-list-renderer><div><yt-item-section-renderer><div id="contents">${cards.join("\n")}</div></yt-item-section-renderer></div></yt-section-list-renderer></div></ytd-two-column-browse-results-renderer></ytd-browse></ytd-page-manager></ytd-app></body></html>`;

const FX_PANEL = "https://www.youtube.com/watch?v=shooPlPanel&list=PLshoofixture";
const FX_LEAK = "https://www.youtube.com/watch?v=shooPlLeak&list=PLshoofixture";
const FX_PAGE = "https://www.youtube.com/playlist?list=PLshoofixture";
await serve(ctx.context, FX_PANEL, watch(`${panel}<div id="related">${related.join("\n")}</div>`));
await serve(ctx.context, FX_LEAK, watch(`<div id="related">${related.join("\n")}<p><a class="yt-simple-endpoint" href="/@listedpl">Listed PL</a></p></div>`));
await serve(ctx.context, FX_PAGE, playlistPage([lockup({ vid: "l000000000a", title: "Playlist item a", spans: ["Listed PL"] }), lockup({ vid: "l000000000b", title: "Playlist item b", spans: ["Listed PL"] }), lockup({ vid: "l000000000c", title: "Playlist item c", spans: ["Other One"] })]));

const page = ctx.context.pages()[0] || (await ctx.context.newPage());
const tabOf = async () => {
  await page.bringToFront();
  return ctx.worker.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t?.id));
};
const health = async (tabId) => {
  const { health = {} } = await ctx.worker.evaluate(() => chrome.storage.session.get("health"));
  return { entry: health[tabId] || null, badge: await ctx.worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId) };
};
const qa = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-qa]")].map((c) => [c.dataset.qa, { hidden: c.hasAttribute("data-shoo-hide"), shown: c.checkVisibility() }])));
await setList(ctx, { v: 1, channels: [{ handle: "@listedpl", name: "Listed PL", added: 1, source: "card" }], words: [] });

await page.goto(FX_PANEL, { waitUntil: "domcontentloaded" });
const tab = await tabOf();
const sideHidden = await until(qa, (s) => s.s0000000005?.hidden, 3000);
await sleep(WAIT);
const calm = await health(tab);
const after = await qa();
check(
  "fixture: a listed channel's link and card inside the playlist panel (an area Shoo leaves alone) raise no '!'; the listed sidebar card is still hidden",
  sideHidden.ok && calm.entry && calm.entry.missing.length === 0 && calm.badge === "" && after.p000000000a?.shown && !after.p000000000a.hidden,
  { ...calm, panelCard: after.p000000000a, sideCard: after.s0000000005 },
);
await page.locator('[data-qa="s0000000000"]').hover();
await sleep(400);
const sideBtn = await page.evaluate(() => document.querySelectorAll('[data-qa="s0000000000"] .shoo-btn').length);
check("control: hovering a sidebar card of this fixture shows ⊘", sideBtn === 1, { sideBtn });

await page.goto(FX_LEAK, { waitUntil: "domcontentloaded" });
const leak = await until(() => health(tab), (h) => h.badge === "!" && h.entry?.page === "watch", 30000);
check("control: the same listed link loose in the sidebar outside the panel still raises '!'", leak.ok && JSON.stringify(leak.value.entry?.missing) === '["sidebar"]', leak.value);

await page.goto(FX_PAGE, { waitUntil: "domcontentloaded" });
await sleep(1500);
const pl = await qa();
await page.locator('[data-qa="l000000000a"]').hover({ timeout: 3000 }).catch(() => {});
await sleep(400);
const btn = await page.evaluate(() => document.querySelectorAll(".shoo-btn").length);
check("fixture playlist page: no item hidden (the listed channel's included), no ⊘ on hover", Object.values(pl).every((c) => !c.hidden && c.shown) && btn === 0, { pl, btn });

await ctx.context.unrouteAll({ behavior: "ignoreErrors" });
await setList(ctx, { v: 1, channels: [{ handle: "@veritasium", name: "Veritasium", added: 1, source: "card" }], words: [] });
await page.goto("https://www.youtube.com/playlist?list=PLkahZjV5wKe_Yh-7VFrP1bxJOtkVzdqeB", { waitUntil: "domcontentloaded" });
await consent(page);
const live = await until(() => page.evaluate(() => ({ items: document.querySelectorAll('ytd-browse[page-subtype="playlist"]:not([hidden]) yt-lockup-view-model').length, hidden: document.querySelectorAll('ytd-browse[page-subtype="playlist"] [data-shoo-hide]').length })), (v) => v.items >= 10, 20000);
await sleep(2000);
const liveNow = await page.evaluate(() => ({ items: document.querySelectorAll('ytd-browse[page-subtype="playlist"]:not([hidden]) yt-lockup-view-model').length, hidden: document.querySelectorAll('ytd-browse[page-subtype="playlist"] [data-shoo-hide]').length }));
check("live: Veritasium's playlist page with Veritasium listed shows every item", live.ok ? liveNow.hidden === 0 && liveNow.items >= 10 : null, liveNow);

await page.goto("https://www.youtube.com/watch?v=IV3dnLzthDA&list=PLkahZjV5wKe_Yh-7VFrP1bxJOtkVzdqeB", { waitUntil: "domcontentloaded" });
await consent(page);
const liveTab = await tabOf();
const panelUp = await until(() => page.evaluate(() => document.querySelectorAll("ytd-playlist-panel-renderer#playlist ytd-playlist-panel-video-renderer").length), (n) => n > 0, 20000);
await sleep(WAIT);
const liveHealth = await health(liveTab);
check("live: watch page inside that playlist raises no '!'", panelUp.ok ? liveHealth.badge === "" && (liveHealth.entry === null || liveHealth.entry.missing.length === 0) : null, { panel: panelUp.value, ...liveHealth });
const titleLink = page.locator('ytd-playlist-panel-renderer#playlist #header-description a[href^="/playlist?list="]').first();
const canClick = await titleLink.isVisible().catch(() => false);
const doc0 = await page.evaluate(() => performance.timeOrigin);
if (canClick) await titleLink.click();
const spa = canClick ? await until(() => page.evaluate(() => ({ path: location.pathname, items: document.querySelectorAll('ytd-browse[page-subtype="playlist"]:not([hidden]) yt-lockup-view-model').length, hidden: document.querySelectorAll('ytd-browse[page-subtype="playlist"] [data-shoo-hide]').length })), (v) => v.path === "/playlist" && v.items >= 10, 20000) : null;
if (spa) await sleep(1500);
const spaNow = spa && { ...(await page.evaluate(() => ({ path: location.pathname, items: document.querySelectorAll('ytd-browse[page-subtype="playlist"]:not([hidden]) yt-lockup-view-model').length, hidden: document.querySelectorAll('ytd-browse[page-subtype="playlist"] [data-shoo-hide]').length }))), sameDoc: (await page.evaluate(() => performance.timeOrigin)) === doc0 };
check("live: from the watch page to the playlist page without a reload (playlist title in the panel), every item shows", spa?.ok ? spaNow.hidden === 0 && spaNow.sameDoc : null, spaNow || { canClick });
await finish(ctx, check);
