import { consent, sleep } from "./harness.mjs";

export const QUERIES = ["minecraft", "cooking pasta", "bitcoin news", "lofi music", "iphone review", "history documentary", "football highlights", "ai generated video"];
const url = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
const scroll = async (page, n, dy = 1500, wait = 800) => {
  await page.mouse.move(640, 500);
  for (let k = 0; k < n; k++) {
    await page.mouse.wheel(0, dy);
    await sleep(wait);
  }
};

export async function cycle(page, i, { mark = async () => {}, beforeFullNav = async () => {}, all = false } = {}) {
  const q = QUERIES[i % QUERIES.length];
  const done = [];
  let watchUrl = null;
  const step = async (name, full, fn) => {
    if (full) await beforeFullNav(name);
    await mark(name);
    try {
      await fn();
      done.push(name);
    } catch (e) {
      done.push(`${name}:ERR ${String(e.message).split("\n")[0].slice(0, 60)}`);
    }
  };
  await step("load", true, async () => {
    await page.goto(url(q), { waitUntil: "domcontentloaded" });
    await consent(page);
    await sleep(4000);
  });
  await step("scroll-x4", false, () => scroll(page, 8));
  await step("masthead", false, async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const box = page.locator('input[name="search_query"]').first();
    await box.click({ timeout: 5000 });
    await box.fill(QUERIES[(i + 3) % QUERIES.length]);
    await box.press("Enter");
    await page.waitForURL(/results/, { timeout: 15000 });
    await sleep(3500);
    await scroll(page, 4);
  });
  await step("results-to-watch", false, async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);
    await page.locator("ytd-search ytd-video-renderer:not([data-shoo-hide]) a#thumbnail[href^='/watch']:not([href*='list='])").first().click({ timeout: 8000 });
    await page.waitForURL(/watch/, { timeout: 15000 });
    await sleep(4000);
    watchUrl = page.url().split("&")[0];
  });
  await step("back", false, async () => {
    await page.goBack({ waitUntil: "commit" });
    await sleep(3000);
    await scroll(page, 2);
  });
  await step("forward", false, async () => {
    await page.goForward({ waitUntil: "commit" });
    await sleep(3000);
  });
  await step("back2", false, async () => {
    await page.goBack({ waitUntil: "commit" });
    await sleep(3000);
  });
  await step("watch-load", true, async () => {
    await page.goto(watchUrl || "https://www.youtube.com/watch?v=HZ47tCgfXrI", { waitUntil: "domcontentloaded" });
    await sleep(6000);
    await scroll(page, 5, 2000, 1200);
  });
  await step("back-doc", true, async () => {
    await page.goBack({ waitUntil: "domcontentloaded" });
    await sleep(3000);
    await scroll(page, 2);
  });
  await step("forward-doc", true, async () => {
    await page.goForward({ waitUntil: "domcontentloaded" });
    await sleep(5000);
    await scroll(page, 3, 2000, 1000);
  });
  if (all || i % 2 === 1)
    await step("reload-watch", true, async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await sleep(5000);
      await scroll(page, 3, 2000, 1000);
    });
  if (all || i % 3 === 2)
    await step("hashtag", true, async () => {
      await page.goto(`https://www.youtube.com/hashtag/${["minecraft", "cooking", "football"][i % 3]}`, { waitUntil: "domcontentloaded" });
      await sleep(4000);
      await scroll(page, 6, 1500, 900);
    });
  if (all || i % 4 === 3)
    await step("reload-search", true, async () => {
      await page.goto(url(q), { waitUntil: "domcontentloaded" });
      await sleep(2000);
      await page.reload({ waitUntil: "domcontentloaded" });
      await sleep(4000);
      await scroll(page, 3);
    });
  return done;
}
