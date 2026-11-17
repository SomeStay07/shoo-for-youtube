// QA r2 control: does #related render on a watch page reached by SPA in Chrome for Testing, with and without Shoo?
// Run: OUT=<shoo>/.e2e-out/qa-r2 node tests/e2e/qa/qa-r2-spa-related.mjs
import { launchLocked, save, sleep, consent, masthead } from "./qa-lib.mjs";
import { reporter, closeWelcome, setList, until } from "../harness.mjs";

const { check } = reporter("qa-r2-spa-related");
const out = {};
for (const extension of [false, true]) {
  const ctx = await launchLocked({ name: `qa-r2-spa-related-${extension}`, extension });
  if (extension) {
    await closeWelcome(ctx);
    await setList(ctx, { v: 1, channels: [{ handle: "@veritasium", name: "Veritasium", added: 1, source: "card" }], words: [] });
  }
  const page = ctx.context.pages()[0] || (await ctx.context.newPage());
  const related = () => page.evaluate(() => ({ path: location.pathname, cards: document.querySelectorAll(":is(ytd-watch-flexy,ytd-watch-grid):not([hidden]) #related :is(yt-lockup-view-model, ytd-compact-video-renderer)").length, hidden: document.querySelectorAll("#related [data-shoo-hide]").length, related: Boolean(document.querySelector(":is(ytd-watch-flexy,ytd-watch-grid):not([hidden]) #related")) }));
  const rows = [];
  for (let rep = 0; rep < 2; rep++) {
  await page.goto("https://www.youtube.com/results?search_query=minutephysics", { waitUntil: "domcontentloaded" });
  await consent(page);
  await sleep(4000);
  await page.locator("ytd-search ytd-video-renderer a#thumbnail[href^='/watch']:not([href*='list='])").filter({ visible: true }).first().click();
  await page.waitForURL(/watch/);
  rows.push({ step: "search→watch (SPA)", ...(await until(related, (r) => r.cards > 0, 20000)).value });
  await page.goto("https://www.youtube.com/watch?v=IV3dnLzthDA&list=PLkahZjV5wKe_Yh-7VFrP1bxJOtkVzdqeB", { waitUntil: "domcontentloaded" });
  rows.push({ step: "watch(pl) full", ...(await until(related, (r) => r.cards > 0, 20000)).value });
  await page.locator('ytd-playlist-panel-renderer#playlist ytd-playlist-panel-video-renderer a#wc-endpoint').nth(3).click();
  await sleep(1000);
  rows.push({ step: "watch(pl)→next in panel (SPA)", ...(await until(related, (r) => r.cards > 0, 20000)).value });
  }
  out[extension ? "shoo" : "none"] = rows;
  console.log(extension ? "shoo" : "none", JSON.stringify(rows));
  await ctx.context.close();
}
save("r2-spa-related", out);
const spa = (k) => out[k].filter((r) => r.step.includes("SPA")).map((r) => r.cards);
check("control: related cards after SPA render the same with and without Shoo", JSON.stringify(spa("none").map((n) => n > 0)) === JSON.stringify(spa("shoo").map((n) => n > 0)), out);
