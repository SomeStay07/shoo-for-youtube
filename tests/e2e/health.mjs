import { launch, reporter, closeWelcome, setList, goSearch, until, sleep, finish, openRealPopup, consent } from "./harness.mjs";
import { searchCard, searchPage, serve } from "./fixtures.mjs";

const { check } = reporter("health");
const ctx = await launch({ name: "health" });
await closeWelcome(ctx);
const RUNS = Number(process.env.HEALTH_RUNS || 10);
const WAIT = 14000;

const tabOf = async (page) => {
  await page.bringToFront();
  return ctx.worker.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t?.id));
};
const health = async (tabId) => {
  const { health = {} } = await ctx.worker.evaluate(() => chrome.storage.session.get("health"));
  return { entry: health[tabId] || null, badge: await ctx.worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId) };
};

const cards = (n, opts) => Array.from({ length: n }, (_, i) => searchCard({ vid: `h${String(i).padStart(10, "0")}`, title: `Video ${i}`, handle: `@chan${i}`, name: `Chan ${i}`, ...opts(i) }));
await serve(ctx.context, "https://www.youtube.com/results?search_query=shoo-stripped", searchPage(cards(8, () => ({ linkless: true, noName: true }))));
await serve(ctx.context, "https://www.youtube.com/results?search_query=shoo-healthy", searchPage(cards(8, () => ({}))));
await serve(ctx.context, "https://www.youtube.com/results?search_query=shoo-leak", searchPage(cards(8, () => ({}))));

const page = ctx.context.pages()[0] || (await ctx.context.newPage());
await setList(ctx, { v: 1, channels: [{ handle: "@chan3", name: "Chan 3", added: 1, source: "card" }], words: [] });

await page.goto("https://www.youtube.com/results?search_query=shoo-stripped", { waitUntil: "domcontentloaded" });
const tab = await tabOf(page);
const once = await until(() => health(tab), (h) => h.entry !== null || h.badge === "!", 8000);
check("stripped fixture: no '!' after a single check", once.value.badge !== "!", once.value);
const two = await until(() => health(tab), (h) => h.badge === "!" && h.entry?.missing?.length > 0, WAIT);
check("stripped fixture (no links, no name rows): '!' after two checks", two.ok && JSON.stringify(two.value.entry?.missing) === '["search"]', two.value);
const popup = await openRealPopup(ctx, page);
const line = await popup.eval(() => {
  const box = document.querySelector("#health a#reportHere");
  const foot = document.getElementById("report");
  return { text: document.querySelector("#health p")?.textContent, hidden: document.getElementById("health").hidden, footer: foot.hidden ? null : { text: foot.textContent, href: foot.href }, inBox: box ? { text: box.textContent, href: box.href } : null, known: Boolean(document.getElementById("known")) };
});
check("popup names the surface", !line.hidden && line.text === ctx.msg("popupBroken", ctx.msg("surfaceSearch")), line);
const form = (href) => {
  try {
    const u = new URL(href);
    return u.hostname === "docs.google.com" && u.searchParams.get("entry.820481797") === "search" && u.searchParams.get("entry.593235433") === "search" && u.searchParams.get("entry.1038899811") === chrome_version;
  } catch {
    return false;
  }
};
const chrome_version = await ctx.worker.evaluate(() => chrome.runtime.getManifest().version);
check("while the '!' box shows, 'Report a problem' is only inside it (footer link hidden), prefilled with version, page and surface; 'Known issues' stays hidden while the Shoo breakage rows don't exist (GBRK)", line.footer === null && line.inBox?.text === ctx.msg("report") && form(line.inBox.href) && !line.known, line);
await popup.close();

await page.goto("https://www.youtube.com/results?search_query=shoo-leak", { waitUntil: "domcontentloaded" });
const hid = await until(() => page.evaluate(() => document.querySelector('[data-qa="h0000000003"]')?.hasAttribute("data-shoo-hide")), Boolean, 3000);
await page.evaluate(() => {
  const style = document.createElement("style");
  style.textContent = 'html body ytd-app [data-qa="h0000000003"][data-shoo-hide][data-shoo-hide][data-shoo-hide][data-shoo-hide] { display: block !important; }';
  document.head.append(style);
});
const forced = await page.evaluate(() => document.querySelector('[data-qa="h0000000003"]').checkVisibility());
const leak = await until(() => health(tab), (h) => h.badge === "!" && h.entry?.page === "search", 30000);
check("fixture with a listed card forced visible by page CSS: '!'", hid.ok && forced && leak.ok && JSON.stringify(leak.value.entry?.missing) === '["search"]', { forced, ...leak.value });

await page.goto("https://www.youtube.com/results?search_query=shoo-healthy", { waitUntil: "domcontentloaded" });
await sleep(WAIT);
const ok = await health(tab);
check("healthy fixture: no '!' (and the badge clears)", ok.badge !== "!" && ok.entry && ok.entry.missing.length === 0, ok);
const calm = await openRealPopup(ctx, page);
const foot = await calm.eval(() => {
  const f = document.getElementById("report");
  return { health: !document.getElementById("health").hidden, footer: f.hidden ? null : { text: f.textContent, href: f.href } };
});
await calm.close();
check("no '!': 'Report a problem' is in the footer", !foot.health && foot.footer?.text === ctx.msg("report") && /^https:\/\/docs\.google\.com\//.test(foot.footer.href), foot);

await ctx.context.unrouteAll({ behavior: "ignoreErrors" });
const QUERIES = ["veritasium black holes", "kurzgesagt", "minecraft", "cooking pasta", "bitcoin news", "lofi music", "iphone review", "history documentary", "football highlights", "ai generated video"];
await goSearch(page, "veritasium black holes");
const block = await page.evaluate(() => [...new Set([...document.querySelectorAll("ytd-search ytd-video-renderer #channel-info a[href^='/@']")].map((a) => a.getAttribute("href").slice(1)))].slice(0, 2));
const channels = [...new Set(["@veritasium", "@kurzgesagt", ...block])].map((handle) => ({ handle, name: handle === "@veritasium" ? "Veritasium" : handle === "@kurzgesagt" ? "Kurzgesagt – In a Nutshell" : handle.slice(1), added: 1, source: "card" }));
await setList(ctx, { v: 1, channels, words: ["trailer", "reaction"] });
let alarms = 0;
const runs = [];
for (let i = 0; i < RUNS; i++) {
  const q = QUERIES[i % QUERIES.length];
  await goSearch(page, q);
  const hiddenSearch = await page.evaluate(() => document.querySelectorAll("ytd-search [data-shoo-hide]").length);
  await sleep(WAIT);
  const hs = await health(tab);
  const dump = () =>
    page.evaluate((hs) => {
      const set = new Set(hs.map((h) => h.toLowerCase()));
      return [...document.querySelectorAll('a[href^="/@"]')]
        .filter((a) => set.has((a.getAttribute("href").split(/[/?]/)[1] || "").toLowerCase()) && !a.closest("[data-shoo-hide]") && a.getClientRects().length && a.checkVisibility())
        .map((a) => {
          const chain = [];
          for (let n = a; n && chain.length < 10; n = n.parentElement) chain.push(n.tagName.toLowerCase() + (n.id ? `#${n.id}` : ""));
          return chain.join(" < ");
        });
    }, channels.map((c) => c.handle));
  if (hs.badge === "!") console.log("LEAK", JSON.stringify(await dump()).slice(0, 2000));
  const watch = await page.evaluate(() => document.querySelector("ytd-search a#thumbnail[href^='/watch']:not([href*='list='])")?.getAttribute("href"));
  await page.goto(`https://www.youtube.com${watch.split("&")[0]}`, { waitUntil: "domcontentloaded" });
  await consent(page);
  await sleep(WAIT);
  const hw = await health(tab);
  const hiddenSide = await page.evaluate(() => document.querySelectorAll("#secondary [data-shoo-hide]").length);
  const bad = [hs, hw].filter((h) => h.badge === "!").length;
  alarms += bad;
  runs.push({ q, search: hs.entry?.missing ?? null, watch: hw.entry?.missing ?? null, hiddenSearch, hiddenSide });
}
check(`${RUNS} healthy live runs of search + watch raise no '!'`, alarms === 0 && runs.every((r) => r.search && r.watch), { alarms, hiddenTotal: runs.reduce((a, r) => a + r.hiddenSearch + r.hiddenSide, 0), runs });
await finish(ctx, check);
