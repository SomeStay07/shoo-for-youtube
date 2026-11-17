import { launch, reporter, closeWelcome, setList, getList, until, sleep, finish } from "./harness.mjs";
import { searchCard, searchPage, serve } from "./fixtures.mjs";

const { check } = reporter("shelf");
const ctx = await launch({ name: "shelf" });
await closeWelcome(ctx);
const SEARCH = "https://www.youtube.com/results?search_query=shoo-shelf";
const shelf = (cards) => `<ytd-shelf-renderer data-qa-shelf="1"><div id="dismissible"><div id="title-container"><h2><span id="title">Latest from Listed One</span></h2></div><div id="contents"><ytd-vertical-list-renderer><div id="items">${cards.join("")}</div></ytd-vertical-list-renderer></div></div></ytd-shelf-renderer>`;
await serve(ctx.context, SEARCH, searchPage([
  searchCard({ vid: "o000000000a", title: "Top result", handle: "@other", name: "Other" }),
  shelf([searchCard({ vid: "s000000000a", title: "Shelf one", handle: "@listedone", name: "Listed One" }), searchCard({ vid: "s000000000b", title: "Shelf two", handle: "@listedone", name: "Listed One" })]),
  searchCard({ vid: "o000000000b", title: "After shelf", handle: "@other", name: "Other" }),
]));
const LISTED = { v: 1, channels: [{ handle: "@listedone", name: "Listed One", added: 1, source: "card" }], words: [] };
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
const state = () => page.evaluate(() => {
  const s = document.querySelector("[data-qa-shelf]");
  return {
    header: s.querySelector("h2").checkVisibility(),
    shelfCardsHidden: [...s.querySelectorAll("ytd-video-renderer")].filter((c) => c.hasAttribute("data-shoo-hide")).length,
    shelfCardsVisible: [...s.querySelectorAll("ytd-video-renderer")].filter((c) => c.checkVisibility()).length,
    others: [...document.querySelectorAll('[data-qa^="o"]')].filter((c) => c.checkVisibility()).length,
    reveal: document.documentElement.hasAttribute("data-shoo-reveal"),
    undo: [...s.querySelectorAll(".shoo-line button")].filter((b) => b.checkVisibility()).length,
  };
});
const tell = (type) => ctx.worker.evaluate(async (t) => {
  const [tab] = await chrome.tabs.query({ url: "https://www.youtube.com/*" });
  return chrome.tabs.sendMessage(tab.id, { type: t });
}, type);

await setList(ctx, LISTED);
await page.goto(SEARCH, { waitUntil: "domcontentloaded" });
const all = await until(state, (s) => s.shelfCardsHidden === 2, 4000);
await sleep(400);
const a = await state();
check("every video in a shelf hidden: the shelf goes too, header included; other results stay", all.ok && !a.header && a.others === 2, a);
const count = await tell("count");
check("the popup count still includes the videos in a hidden shelf", count?.count === 2, count);
await tell("reveal");
const shown = await until(state, (s) => s.reveal && s.header && s.shelfCardsVisible === 2, 3000);
check("Show hidden brings the shelf back with its header and both videos", shown.ok, shown.value);
await tell("hide");
const again = await until(state, (s) => !s.reveal && !s.header, 3000);
check("Hide them again hides the shelf header again", again.ok, again.value);

await setList(ctx, null);
const back = await until(state, (s) => s.header && s.shelfCardsVisible === 2, 3000);
check("taking the channel off the list brings the shelf back", back.ok, back.value);
await page.hover('[data-qa="s000000000a"] h3');
await sleep(300);
await page.click('[data-qa="s000000000a"] .shoo-btn');
const slot = await until(state, (s) => s.shelfCardsHidden === 2 && s.undo === 1, 3000);
check("hiding the shelf's channel with ⊘: the shelf stays while its 'Hidden … · Undo' line is up", slot.ok && slot.value.header, slot.value);
await page.click('[data-qa="s000000000a"] .shoo-line button');
const undone = await until(state, (s) => s.shelfCardsHidden === 0 && s.header && s.shelfCardsVisible === 2, 3000);
check("Undo brings both videos back, header visible", undone.ok, undone.value);
const LATE = "https://www.youtube.com/results?search_query=shoo-shelf-late";
const lateHtml = searchPage([shelf([searchCard({ vid: "s000000000c", title: "Late one", handle: "@listedone", name: "Listed One" }), searchCard({ vid: "s000000000d", title: "Late two", handle: "@listedone", name: "Listed One" })])]);
const inner = /<ytd-page-manager>([\s\S]*)<\/ytd-page-manager>/.exec(lateHtml)[1];
await serve(ctx.context, LATE, lateHtml.replace(inner, "").replace("</body>", `<template id="later">${inner}</template><script>setTimeout(() => document.querySelector("ytd-page-manager").append(document.getElementById("later").content.cloneNode(true)), 1500)</script></body>`));
await setList(ctx, LISTED);
await page.goto(LATE, { waitUntil: "domcontentloaded" });
const late = await until(() => page.evaluate(() => {
  const s = document.querySelector("[data-qa-shelf]");
  return s ? { cards: s.querySelectorAll("[data-shoo-hide]").length, header: s.querySelector("h2").checkVisibility() } : null;
}), (v) => v && v.cards === 2 && !v.header, 4000);
check("a search page that arrives in one piece after Shoo is ready: the fully hidden shelf goes, header included", late.ok, late.value);

await setList(ctx, null);
await page.goto(SEARCH, { waitUntil: "domcontentloaded" });
await sleep(600);
const go = (path, watch) => page.evaluate(([p, w]) => {
  document.dispatchEvent(new CustomEvent("yt-navigate-start"));
  history.pushState({}, "", p);
  const pm = document.querySelector("ytd-page-manager");
  pm.querySelector("ytd-search").hidden = w;
  let flexy = pm.querySelector("ytd-watch-flexy");
  if (w && !flexy) pm.insertAdjacentHTML("beforeend", '<ytd-watch-flexy><div id="secondary"><div id="related"></div></div></ytd-watch-flexy>');
  flexy = pm.querySelector("ytd-watch-flexy");
  if (flexy) flexy.hidden = !w;
  document.dispatchEvent(new CustomEvent("yt-navigate-finish"));
}, [path, watch]);
const gone = () => page.evaluate(() => document.querySelector("[data-qa-shelf]").hasAttribute("data-shoo-shelf"));
await go("/watch?v=w000000000a", true);
await sleep(400);
await setList(ctx, LISTED);
await sleep(1200);
const onWatch = await gone();
check("on a watch page the search page left in the background is not scanned for shelves", onWatch === false, { shelfMarked: onWatch });
await go("/results?search_query=shoo-shelf", false);
const backOnSearch = await until(gone, Boolean, 3000);
check("…and back on search the fully hidden shelf goes again", backOnSearch.ok, backOnSearch.value);
await setList(ctx, null);
await finish(ctx, check);
