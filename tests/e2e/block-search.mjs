import { launch, reporter, closeWelcome, setList, getList, goSearch, searchCards, until, sleep, finish } from "./harness.mjs";

const { check } = reporter("block-search");
const ctx = await launch({ name: "block-search" });
await closeWelcome(ctx);
await setList(ctx, null);
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
const QUERIES = process.env.QUERY ? [process.env.QUERY] : ["veritasium black holes", "kurzgesagt vs veritasium", "minute physics", "veritasium", "vsauce"];
let QUERY;
let cards = [];
let handle;
let n = 0;
for (QUERY of QUERIES) {
  await goSearch(page, QUERY);
  cards = await searchCards(page);
  const counts = {};
  for (const c of cards) if (c.handle) counts[c.handle] = (counts[c.handle] || 0) + 1;
  [handle, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [];
  if (n >= 2 && n < cards.filter((c) => c.handle).length) break;
}
check("precondition: a channel with 2+ cards on the search page", n >= 2, { query: QUERY, handle, cards: n, total: cards.length });
const name = cards.find((c) => c.handle === handle)?.name;
const sel = `ytd-search ytd-video-renderer:has(#channel-info a[href="/${handle}"])`;

const first = page.locator(sel).first();
await first.scrollIntoViewIfNeeded();
await first.hover({ position: { x: 600, y: 60 } });
await sleep(300);
const hover = await page.evaluate((s) => {
  const card = document.querySelector(s);
  const b = card?.querySelector(".shoo-btn");
  return b ? { tag: b.tagName, inLink: Boolean(b.closest("a")), inChannelRow: b.previousElementSibling?.tagName === "YTD-CHANNEL-NAME" && Boolean(b.closest("#channel-info")), label: b.getAttribute("aria-label"), title: b.title, opacity: getComputedStyle(b).opacity, buttons: document.querySelectorAll(".shoo-btn").length } : null;
}, sel);
check("hover shows a real <button> outside the card's link, in the channel row, one button on the page", hover?.tag === "BUTTON" && !hover.inLink && hover.inChannelRow && hover.opacity === "1" && hover.buttons === 1, hover);
check("button label is 'Hide videos from <channel>' and the tooltip names the product", hover?.label === ctx.msg("cardHide", name) && hover?.title === ctx.msg("cardHideTip", name), { label: hover?.label, title: hover?.title, want: ctx.msg("cardHide", name) });

await page.mouse.move(5, 5);
await sleep(200);
await page.locator(`${sel} >> nth=1 >> a#video-title`).focus();
await page.keyboard.press("Tab");
await page.keyboard.press("Shift+Tab");
await sleep(400);
const focus = await page.evaluate((s) => {
  const card = document.querySelectorAll(s)[1];
  const b = card?.querySelector(".shoo-btn");
  return { focusedInCard: card?.contains(document.activeElement), opacity: b && getComputedStyle(b).opacity };
}, sel);
let tabs = 0;
let reached = false;
for (; tabs < 25 && !reached; tabs++) {
  await page.keyboard.press("Tab");
  reached = await page.evaluate((s) => document.activeElement?.classList.contains("shoo-btn") && document.querySelectorAll(s)[1]?.contains(document.activeElement), sel);
}
check("keyboard focus inside the card shows the button, and Tab reaches it", focus.focusedInCard && focus.opacity === "1" && reached, { ...focus, tabs, reached });
await page.mouse.move(5, 5);
await first.hover({ position: { x: 600, y: 60 } });
await sleep(400);
const held = await page.evaluate((s) => ({ inFocused: Boolean(document.querySelectorAll(s)[1]?.querySelector(".shoo-btn")), inHovered: Boolean(document.querySelectorAll(s)[0]?.querySelector(".shoo-btn")), focused: document.activeElement?.classList.contains("shoo-btn") }), sel);
check("while ⊘ has keyboard focus, hovering another card leaves it on the focused card", held.inFocused && !held.inHovered && held.focused, held);
await page.evaluate(() => document.activeElement?.blur());

await page.mouse.move(5, 5);
await first.hover({ position: { x: 600, y: 60 } });
await sleep(200);
const url0 = page.url();
const nav0 = await page.evaluate(() => performance.timeOrigin);
await page.locator(`${sel} >> nth=0 >> .shoo-btn`).click();
const hidden = await until(() => searchCards(page), (cs) => cs.filter((c) => c.handle === handle).every((c) => !c.shown), 3000, 100);
const mine = hidden.value.filter((c) => c.handle === handle);
check("one click hides every card of that channel on the page, no reload", hidden.ok && page.url() === url0 && (await page.evaluate(() => performance.timeOrigin)) === nav0, { hiddenNow: mine.filter((c) => !c.shown).length, of: mine.length, ms: hidden.ms });
const others = hidden.value.filter((c) => c.handle && c.handle !== handle);
check("other channels stay visible", others.length > 0 && others.every((c) => c.shown), { others: others.length, hiddenOthers: others.filter((c) => !c.shown).length });
const line = await page.evaluate(() => {
  const l = document.querySelector("[data-shoo-slot] > .shoo-line");
  return l ? { text: l.querySelector(".shoo-text")?.textContent, button: l.querySelector("button")?.textContent, visible: l.checkVisibility(), focused: l.contains(document.activeElement) } : null;
});
check("the slot shows 'Hidden: <channel> · Undo'", line?.visible && line.text === ctx.msg("cardHidden", name) && line.button === ctx.msg("undo"), line);
const stored = await until(() => getList(ctx), (l) => l?.channels?.length === 1, 3000);
const entry = stored.value?.channels?.[0];
check("the block stores handle and name", entry?.handle?.toLowerCase() === handle.toLowerCase() && entry?.name === name && entry?.source === "card", entry);

await page.locator("[data-shoo-slot] > .shoo-line button").click();
const back = await until(() => searchCards(page), (cs) => cs.filter((c) => c.handle === handle).every((c) => c.shown), 3000, 100);
check("Undo brings all of them back", back.ok, { shown: back.value.filter((c) => c.handle === handle && c.shown).length, of: mine.length });
const after = await until(() => getList(ctx), (l) => l?.channels?.length === 0, 3000);
check("Undo removes the entry from storage", after.ok, after.value);
check("no slot line left after Undo", !(await page.evaluate(() => document.querySelector(".shoo-line"))));

await finish(ctx, check);
