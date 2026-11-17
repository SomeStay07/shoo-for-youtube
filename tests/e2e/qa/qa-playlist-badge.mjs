// "!" on a watch page inside a playlist / mix: is it a false alarm, and which element raises it?
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { launchLocked, save, sleep, consent, OUT } from "./qa-lib.mjs";
import { reporter, closeWelcome, setList, finish } from "../harness.mjs";

const { check } = reporter("qa-playlist-badge");
const SHOTS = join(OUT, "edge");
mkdirSync(SHOTS, { recursive: true });
const ctx = await launchLocked({ name: "qa-playlist-badge" });
await closeWelcome(ctx);
const VER = { handle: "@veritasium", name: "Veritasium", added: 1, source: "card" };
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
const tabId = async () => ctx.worker.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t?.id));
const state = async () => {
  const id = await tabId();
  const badge = await ctx.worker.evaluate((i) => chrome.action.getBadgeText({ tabId: i }), id);
  const { health = {} } = await ctx.worker.evaluate(() => chrome.storage.session.get("health"));
  return { badge, health: health[id] || null };
};
const offenders = () =>
  page.evaluate(() => {
    const area = document.querySelector(":is(ytd-watch-flexy, ytd-watch-grid):not([hidden]) :is(#secondary, #related)");
    if (!area) return { area: false };
    const out = [];
    for (const a of area.querySelectorAll('a[href^="/@veritasium"], a[href^="/channel/UCHnyfMqiRRG1u-2MsSQLbXA"]')) {
      if (!(a.getClientRects().length && a.checkVisibility({ opacityProperty: true, visibilityProperty: true }))) continue;
      const chain = [];
      for (let n = a; n && n !== area && chain.length < 8; n = n.parentElement) chain.push(n.tagName.toLowerCase() + (n.id ? "#" + n.id : ""));
      out.push({ href: a.getAttribute("href"), text: a.textContent.trim().slice(0, 40), chain: chain.join(" < ") });
    }
    const names = [...area.querySelectorAll("yt-content-metadata-view-model [role=group]:first-child > [role=text]:first-child")].filter((n) => n.textContent.trim() === "Veritasium" && n.checkVisibility()).length;
    return { area: true, links: out.slice(0, 6), visibleLinks: out.length, nameRows: names, panel: document.querySelectorAll("ytd-playlist-panel-video-renderer").length };
  });
const cases = {
  "playlist of a listed channel": "https://www.youtube.com/watch?v=IV3dnLzthDA&list=PLkahZjV5wKe_Yh-7VFrP1bxJOtkVzdqeB",
  "mix (RD) seeded by a listed channel's video": "https://www.youtube.com/watch?v=IV3dnLzthDA&list=RDIV3dnLzthDA&start_radio=1",
  "same video, no playlist (control)": "https://www.youtube.com/watch?v=IV3dnLzthDA",
};
const data = {};
for (const [label, url] of Object.entries(cases)) {
  for (const listed of [true, false]) {
    await setList(ctx, { v: 1, channels: listed ? [VER] : [{ handle: "@someoneelse", name: "Someone Else", added: 1, source: "card" }], words: [] });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await consent(page);
    await sleep(22000);
    const s = { ...(await state()), ...(await offenders()) };
    const key = `${label} · ${listed ? "Veritasium listed" : "not listed"}`;
    data[key] = s;
    await page.screenshot({ path: join(SHOTS, `badge-${label.replace(/\W+/g, "-")}-${listed ? "listed" : "unlisted"}.png`) });
    console.log(key, JSON.stringify(s).slice(0, 700));
    check(`${key}: no '!'`, s.badge === "", s);
  }
}
save("playlist-badge", data);
await finish(ctx, check);
