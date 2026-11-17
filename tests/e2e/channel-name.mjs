import { launch, reporter, closeWelcome, setList, getList, until, sleep, finish, consent } from "./harness.mjs";
import { serve } from "./fixtures.mjs";

const { check } = reporter("channel-name");
const ctx = await launch({ name: "channel-name" });
await closeWelcome(ctx);
const page = ctx.context.pages()[0] || (await ctx.context.newPage());

const header = (name, handle) => `<yt-page-header-view-model><div><h1><span role="text">${name}</span></h1>
  <yt-content-metadata-view-model><div role="group"><span role="text"><span>${handle}</span></span></div><div role="group"><span role="text">1K subscribers</span></div></yt-content-metadata-view-model>
  <yt-flexible-actions-view-model><div><button>Subscribe</button></div></yt-flexible-actions-view-model></div></yt-page-header-view-model>`;
const channelPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><ytd-app><ytd-page-manager><ytd-browse page-subtype="channels">${header("Chan A", "@shoo-chan-a")}<div id="contents"></div></ytd-browse></ytd-page-manager></ytd-app></body></html>`;
await serve(ctx.context, "https://www.youtube.com/@shoo-chan-a", channelPage);
const entryB = async () => (await getList(ctx))?.channels?.find((c) => c.handle === "@shoo-chan-b") ?? null;

await setList(ctx, { v: 1, channels: [{ handle: "@shoo-chan-b", name: "Chan B", added: 1, source: "card" }], words: [] });
await page.goto("https://www.youtube.com/@shoo-chan-a", { waitUntil: "domcontentloaded" });
await until(() => page.evaluate(() => document.querySelector("#shoo-page button")?.textContent || null), Boolean, 5000);
await page.evaluate(() => {
  history.pushState({}, "", "/@shoo-chan-b");
  document.dispatchEvent(new CustomEvent("yt-navigate-start", { bubbles: true }));
  document.dispatchEvent(new CustomEvent("yt-navigate-finish", { bubbles: true }));
});
const listed = await until(() => page.evaluate(() => document.getElementById("shoo-page")?.textContent || null), (t) => t?.startsWith(ctx.msg("pageHidden")), 3000);
await sleep(2500);
const held = await entryB();
check("channel→channel in-app move with the old header still on screen (held 2.5 s): the listed channel keeps its name, the old channel's name is not learned", listed.ok && held?.name === "Chan B", { control: listed.value, entry: held });

await page.evaluate(() => {
  document.querySelector("yt-page-header-view-model h1 span").textContent = "Chan B Renamed";
  document.querySelector("yt-page-header-view-model [role=group] span span").textContent = "@shoo-chan-b";
  document.querySelector("yt-page-header-view-model h1").append(document.createElement("span"));
});
const renamed = await until(entryB, (e) => e?.name === "Chan B Renamed", 5000);
check("once the header shows the page's own @handle, a rename is still learned", renamed.ok, renamed.value);
await ctx.context.unrouteAll({ behavior: "ignoreErrors" });

await setList(ctx, null);
await page.goto("https://www.youtube.com/@veritasium", { waitUntil: "domcontentloaded" });
await consent(page);
const ready = await until(() => page.evaluate(() => document.querySelector("#shoo-page button") && [...document.querySelectorAll('ytd-browse[page-subtype="channels"]:not([hidden]) a[href^="/@"]')].map((a) => a.getAttribute("href").split(/[/?]/)[1]).find((h) => h.toLowerCase() !== "@veritasium")), Boolean, 20000);
const target = ready.value;
if (!target) {
  check("live channel→channel move: no link to another channel on the page", null);
} else {
  await setList(ctx, { v: 1, channels: [{ handle: target, name: "Placeholder Name", added: 1, source: "card" }], words: [] });
  await sleep(500);
  const origin = await page.evaluate(() => performance.timeOrigin);
  const seen = [];
  const link = page.locator(`ytd-browse:not([hidden]) a[href^="/${target}"]`).first();
  await link.scrollIntoViewIfNeeded().catch(() => {});
  await link.click({ timeout: 8000 }).catch(() => {});
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    const e = (await getList(ctx))?.channels?.[0];
    if (e && !seen.includes(e.name)) seen.push(e.name);
    await sleep(100);
  }
  const after = await page.evaluate(() => ({ path: location.pathname, h1: document.querySelector('ytd-browse[page-subtype="channels"]:not([hidden]) yt-page-header-view-model h1')?.textContent.trim() }));
  const sameDoc = (await page.evaluate(() => performance.timeOrigin)) === origin;
  check("live channel→channel move (Veritasium → a linked channel, same document): the stored name never becomes 'Veritasium' and ends as the new header's name", sameDoc && !seen.includes("Veritasium") && seen.at(-1) === after.h1, { target, sameDoc, namesSeen: seen, after });
}

await finish(ctx, check);
