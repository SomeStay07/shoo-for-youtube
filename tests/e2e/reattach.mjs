import { launch, reporter, closeWelcome, setList, until, sleep, finish } from "./harness.mjs";
import { searchCard, lockup, searchPage, watchPage, serve } from "./fixtures.mjs";

const { check } = reporter("reattach");
const ctx = await launch({ name: "reattach" });
await closeWelcome(ctx);
const SEARCH = "https://www.youtube.com/results?search_query=shoo-reattach";
const WATCH = "https://www.youtube.com/watch?v=shooReattach";
const card = (i, handle) => searchCard({ vid: `r${String(i).padStart(10, "0")}`, title: `Video ${i}`, handle, name: handle.slice(1) });
await serve(ctx.context, SEARCH, searchPage([card(0, "@listed"), card(1, "@other"), card(2, "@listed")]));
await serve(ctx.context, WATCH, watchPage([lockup({ vid: "w000000000a", title: "Side a", spans: ["Listed Name"] }), lockup({ vid: "w000000000b", title: "Side b", spans: ["Other Name"] })]));
await setList(ctx, { v: 1, channels: [{ handle: "@listed", name: "listed", added: 1, source: "card" }, { name: "Listed Name", added: 2, source: "sidebar" }], words: [] });
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
const state = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-qa]")].map((c) => [c.dataset.qa, { hidden: c.hasAttribute("data-shoo-hide"), shown: c.checkVisibility() }])));

await page.goto(SEARCH, { waitUntil: "domcontentloaded" });
const first = await until(state, (s) => s.r0000000000?.hidden && s.r0000000002?.hidden, 3000);
check("fixture: listed cards hidden on load", first.ok && !first.value.r0000000001.hidden, first.value);

const swapped = await page.evaluate(async (html) => {
  const old = document.querySelector("ytd-search");
  const fresh = document.createElement("ytd-search");
  fresh.innerHTML = html;
  old.replaceWith(fresh);
  await new Promise((r) => requestAnimationFrame(() => r()));
  const c = fresh.querySelector('[data-qa="r0000000010"]');
  return { paintedVisible: c.checkVisibility(), hidden: c.hasAttribute("data-shoo-hide") };
}, `<ytd-two-column-search-results-renderer><div id="primary"><ytd-section-list-renderer><div id="contents"><ytd-item-section-renderer><div id="contents">${card(10, "@listed")}${card(11, "@other")}</div></ytd-item-section-renderer></div></ytd-section-list-renderer></div></ytd-two-column-search-results-renderer>`);
check("results container replaced mid-session: its listed card is hidden before the next frame", swapped.hidden && !swapped.paintedVisible, swapped);

const later = await page.evaluate(async (html) => {
  const list = document.querySelector("ytd-search ytd-item-section-renderer #contents");
  list.insertAdjacentHTML("beforeend", html);
  await new Promise((r) => requestAnimationFrame(() => r()));
  const c = list.querySelector('[data-qa="r0000000012"]');
  return { paintedVisible: c.checkVisibility(), hidden: c.hasAttribute("data-shoo-hide") };
}, card(12, "@listed"));
check("the new container is observed: a card added later is hidden too", later.hidden && !later.paintedVisible, later);

const inner = await page.evaluate(async (html) => {
  const section = document.querySelector("ytd-search ytd-section-list-renderer");
  const fresh = document.createElement("ytd-section-list-renderer");
  fresh.innerHTML = html;
  section.replaceWith(fresh);
  await new Promise((r) => requestAnimationFrame(() => r()));
  const c = fresh.querySelector('[data-qa="r0000000013"]');
  return { paintedVisible: c.checkVisibility(), hidden: c.hasAttribute("data-shoo-hide") };
}, `<div id="contents"><ytd-item-section-renderer><div id="contents">${card(13, "@listed")}</div></ytd-item-section-renderer></div>`);
check("results list replaced inside the page: card hidden before the next frame", inner.hidden && !inner.paintedVisible, inner);

await page.evaluate((html) => document.querySelector("ytd-search ytd-item-section-renderer #contents").insertAdjacentHTML("beforeend", html), card(20, "@other") + card(21, "@other"));
await sleep(500);
const before = await state();
const t0 = Date.now();
await page.evaluate(() => {
  for (const a of document.querySelectorAll('[data-qa="r0000000020"] a[href="/@other"]')) a.setAttribute("href", "/@listed");
});
const swappedLink = await until(state, (s) => s.r0000000020?.hidden, 3000, 50);
check("a card's channel link changes in place (same node, new listed channel): hidden at once", !before.r0000000020.hidden && swappedLink.ok && swappedLink.ms < 1000, { ms: swappedLink.ms });
await page.evaluate(() => {
  const textNode = document.querySelector('[data-qa="r0000000021"] ytd-channel-name a').firstChild;
  textNode.data = "Listed Name";
});
const swappedText = await until(state, (s) => s.r0000000021?.hidden, 8000, 200);
check("a card's channel name text changes in place with no observed mutation: hidden by the safety net within one health tick (<= 6 s)", !before.r0000000021.hidden && swappedText.ok, { ms: Date.now() - t0, waited: swappedText.ms });

await page.goto(WATCH, { waitUntil: "domcontentloaded" });
const side = await until(state, (s) => s.w000000000a?.hidden, 3000);
check("fixture: listed sidebar card hidden on load", side.ok && !side.value.w000000000b.hidden, side.value);
const sideSwap = await page.evaluate(async (html) => {
  const old = document.querySelector("#secondary");
  const fresh = document.createElement("div");
  fresh.id = "secondary";
  fresh.innerHTML = `<div id="related">${html}</div>`;
  old.replaceWith(fresh);
  await new Promise((r) => requestAnimationFrame(() => r()));
  const c = fresh.querySelector('[data-qa="w000000000c"]');
  return { paintedVisible: c.checkVisibility(), hidden: c.hasAttribute("data-shoo-hide") };
}, lockup({ vid: "w000000000c", title: "Side c", spans: ["Listed Name"] }));
check("sidebar container replaced without a navigation: its listed card is hidden before the next frame", sideSwap.hidden && !sideSwap.paintedVisible, sideSwap);
const sideLater = await page.evaluate(async (html) => {
  document.querySelector("#secondary #related").insertAdjacentHTML("beforeend", html);
  await new Promise((r) => requestAnimationFrame(() => r()));
  const c = document.querySelector('[data-qa="w000000000d"]');
  return { paintedVisible: c.checkVisibility(), hidden: c.hasAttribute("data-shoo-hide") };
}, lockup({ vid: "w000000000d", title: "Side d", spans: ["Listed Name"] }));
check("the new sidebar is observed: a card added to it later is hidden before the next frame", sideLater.hidden && !sideLater.paintedVisible, sideLater);
const tab = await ctx.worker.evaluate(() => chrome.tabs.query({ active: true }).then(([t]) => t.id));
await sleep(13000);
const badge = await ctx.worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tab);
check("after the re-attach no '!' (nothing listed is visible)", badge !== "!", { badge });
await finish(ctx, check);
