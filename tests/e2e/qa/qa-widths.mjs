// Widths 1280 / 1024 / 500: search (⊘ placement, listed hidden, slot line fits) and watch (page control) for a listed
// and a not-listed channel, full loads. Badge must stay clear.
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { launchLocked, botWall, save, sleep, consent, OUT } from "./qa-lib.mjs";
import { reporter, closeWelcome, setList, finish, goSearch } from "../harness.mjs";

const { check } = reporter("qa-widths");
const SHOTS = join(OUT, "widths");
mkdirSync(SHOTS, { recursive: true });
const ctx = await launchLocked({ name: "qa-widths" });
await closeWelcome(ctx);
const LIST = { v: 1, channels: [{ handle: "@veritasium", name: "Veritasium", added: 2, source: "card" }, { handle: "@kurzgesagt", name: "Kurzgesagt – In a Nutshell", added: 1, source: "card" }], words: [] };
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
const badge = async () => {
  const id = await ctx.worker.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t?.id));
  return ctx.worker.evaluate((i) => chrome.action.getBadgeText({ tabId: i }), id);
};
await setList(ctx, { v: 1, channels: [], words: [] });
await goSearch(page, "veritasium");
const listedUrl = await page.evaluate(() => [...document.querySelectorAll("ytd-search ytd-video-renderer")].find((c) => c.querySelector('#channel-info a[href="/@veritasium"]'))?.querySelector("a#thumbnail")?.getAttribute("href"));
await goSearch(page, "how airplanes fly explained");
const otherUrl = await page.evaluate(() => [...document.querySelectorAll("ytd-search ytd-video-renderer")].find((c) => c.querySelector("#channel-info a[href^='/@']") && !c.querySelector('#channel-info a[href="/@veritasium"], #channel-info a[href="/@kurzgesagt"]'))?.querySelector("a#thumbnail")?.getAttribute("href"));
await setList(ctx, LIST);
const data = { listedUrl, otherUrl };
for (const width of [1280, 1024, 500]) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("https://www.youtube.com/results?search_query=black+holes+explained", { waitUntil: "domcontentloaded" });
  await consent(page);
  await page.waitForSelector("ytd-search ytd-video-renderer", { state: "attached", timeout: 25000 }).catch(() => {});
  await sleep(5000);
  if (await botWall(page)) {
    check(`search ${width}`, null, "bot page");
    continue;
  }
  const listedVisible = await page.evaluate(() => [...document.querySelectorAll("ytd-search ytd-video-renderer")].filter((c) => c.checkVisibility() && c.querySelector('#channel-info a[href="/@veritasium"], #channel-info a[href="/@kurzgesagt"]') && !c.closest("[data-shoo-slot]")).length);
  const marked = await page.evaluate(() => {
    const c = [...document.querySelectorAll("ytd-search ytd-video-renderer:not([data-shoo-hide])")].find((x) => x.checkVisibility() && x.querySelector("#channel-info a[href^='/@']") && x.getBoundingClientRect().height > 50);
    if (!c) return false;
    c.scrollIntoView({ block: "center" });
    c.setAttribute("data-qa-w", "1");
    return true;
  });
  await sleep(400);
  await page.mouse.move(1, 1);
  if (marked) await page.hover("[data-qa-w] #video-title", { timeout: 8000 }).catch((e) => console.log("hover", String(e).slice(0, 100)));
  await sleep(500);
  const btn = await page.evaluate(() => {
    const b = document.querySelector("[data-qa-w] .shoo-btn");
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const c = b.closest("ytd-video-renderer").getBoundingClientRect();
    const name = b.closest("ytd-video-renderer").querySelector("ytd-channel-name")?.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), inCard: r.left >= c.left - 1 && r.right <= c.right + 1, inViewport: r.left >= 0 && r.right <= innerWidth, opacity: getComputedStyle(b).opacity, overlapsName: name ? !(r.right <= name.left || name.right <= r.left || r.bottom <= name.top || name.bottom <= r.top) : null };
  });
  await page.screenshot({ path: join(SHOTS, `search-hover-${width}.png`) });
  let line = null;
  if (btn) {
    await page.click("[data-qa-w] .shoo-btn");
    await sleep(700);
    line = await page.evaluate(() => {
      const l = document.querySelector("[data-shoo-slot] > .shoo-line");
      if (!l) return null;
      const r = l.getBoundingClientRect();
      return { text: l.textContent, fits: r.left >= 0 && r.right <= innerWidth && l.scrollWidth <= l.clientWidth + 1, h: Math.round(r.height) };
    });
    await page.screenshot({ path: join(SHOTS, `search-line-${width}.png`) });
    await page.click("[data-shoo-slot] > .shoo-line button").catch(() => {});
    await sleep(600);
  }
  const b = await badge();
  data[`search ${width}`] = { listedVisible, btn, line, badge: b };
  check(`search ${width}px: listed hidden; ⊘ inside its card, in the viewport, not over the channel name; slot line fits; no '!'`, listedVisible === 0 && btn?.inCard && btn.inViewport && btn.opacity === "1" && !btn.overlapsName && line?.fits && b === "", data[`search ${width}`]);
  for (const [label, url] of [["listed", listedUrl], ["other", otherUrl]]) {
    if (!url) continue;
    await page.goto(`https://www.youtube.com${url.split("&")[0]}`, { waitUntil: "domcontentloaded" });
    await sleep(9000);
    if (await botWall(page)) {
      check(`watch ${label} ${width}`, null, "bot page");
      continue;
    }
    const ctl = await page.evaluate(() => {
      const b = document.getElementById("shoo-page");
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const sub = document.querySelector("ytd-watch-metadata #subscribe-button")?.getBoundingClientRect();
      const over = (a, s) => a && s && s.width && !(a.right <= s.left || s.right <= a.left || a.bottom <= s.top || s.bottom <= a.top);
      return { cls: b.className, text: b.textContent, visible: b.checkVisibility(), inViewport: r.left >= 0 && r.right <= innerWidth, overSub: over(r, sub), w: Math.round(r.width), h: Math.round(r.height), textFits: [...b.querySelectorAll("button, .shoo-text")].every((n) => n.scrollWidth <= n.clientWidth + 1) };
    });
    const b2 = await badge();
    await page.screenshot({ path: join(SHOTS, `watch-${label}-${width}.png`) });
    data[`watch ${label} ${width}`] = { ctl, badge: b2 };
    const want = label === "listed" ? ctx.msg("pageHidden") + ctx.msg("unhideChannel") : ctx.msg("pageHide");
    check(`watch (${label}) ${width}px: page control by the owner row, text fits, in viewport, not over Subscribe, no '!'`, ctl?.visible && ctl.text === want && ctl.inViewport && !ctl.overSub && ctl.textFits && b2 === "", data[`watch ${label} ${width}`]);
  }
}
save("widths", data);
await finish(ctx, check);
