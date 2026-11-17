import { launch, reporter, closeWelcome, setList, getList, goSearch, until, sleep, finish, openRealPopup } from "./harness.mjs";

const { check } = reporter("show-hidden");
const ctx = await launch({ name: "show-hidden" });
await closeWelcome(ctx);
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
const HANDLE = "@veritasium";

await setList(ctx, null);
await goSearch(page, "veritasium black holes");
const pick = await page.evaluate((h) => {
  const cards = [...document.querySelectorAll("ytd-search ytd-video-renderer")];
  const mine = cards.filter((c) => c.querySelector(`#channel-info a[href="/${h}"]`));
  const other = cards.find((c) => !c.querySelector(`#channel-info a[href="/${h}"]`) && c.querySelector("#channel-info a[href^='/@']"));
  const wordOf = (c) => (c?.querySelector("#video-title")?.getAttribute("title") || "").split(/\s+/).find((w) => /^\p{L}{6,}$/u.test(w));
  return { name: mine[0]?.querySelector("ytd-channel-name #text")?.textContent.trim(), mineCount: mine.length, otherWord: wordOf(other), mineWord: mine.map(wordOf).find(Boolean) };
}, HANDLE);
check("precondition: listed channel cards and a title word on another card", pick.mineCount >= 2 && pick.otherWord && pick.mineWord, pick);
await setList(ctx, { v: 1, channels: [{ handle: HANDLE, name: pick.name, added: 1, source: "card" }], words: [pick.otherWord, pick.mineWord] });
await sleep(800);
const hiddenNow = await page.evaluate(() => [...document.querySelectorAll("[data-shoo-hide]")].filter((b) => !b.closest("ytd-search[hidden]")).length);

const popup = await openRealPopup(ctx, page);
const pv = await popup.eval(() => ({ status: document.getElementById("status").textContent, counts: document.getElementById("counts").textContent, button: document.getElementById("showHidden")?.textContent, width: document.body.getBoundingClientRect().width }));
check("popup: status names the product and counts", pv.status === ctx.msg("popupOn") && pv.counts === ctx.msg("popupCounts", 1, 2), pv);
check("popup: 'Show hidden on this page (K)' with K = hidden cards on the page", pv.button === ctx.msg("popupShowHidden", hiddenNow) && hiddenNow > 0, { button: pv.button, hiddenNow });
await popup.eval(() => document.getElementById("showHidden").click());
const closed = await until(() => popup.isOpen(), (o) => !o, 3000);
check("popup closes after Show hidden", closed.ok);

const shown = await until(
  () =>
    page.evaluate(() => {
      const boxes = [...document.querySelectorAll("[data-shoo-hide]")].filter((b) => !b.closest("ytd-search[hidden]"));
      return {
        reveal: document.documentElement.hasAttribute("data-shoo-reveal"),
        boxes: boxes.length,
        visible: boxes.filter((b) => b.checkVisibility()).length,
        dimmed: boxes.filter((b) => getComputedStyle(b.querySelector(":scope > :not(.shoo-reason)")).opacity < 0.6).length,
        reasons: boxes.map((b) => [b.querySelector(":scope > .shoo-reason span")?.textContent, b.querySelector(":scope > .shoo-reason button")?.textContent]),
      };
    }),
  (v) => v.reveal && v.visible === v.boxes,
  3000,
);
await page.mouse.move(1, 1);
await sleep(400);
const dim = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll("[data-shoo-hide]")].filter((b) => !b.closest("ytd-search[hidden]"));
  const op = (b) => Number(getComputedStyle(b.querySelector(":scope > :not(.shoo-reason)")).opacity);
  return { boxes: boxes.length, dimmed: boxes.filter((b) => Math.abs(op(b) - 0.4) < 0.05).length };
});
const firstBox = page.locator("ytd-search [data-shoo-hide]").first();
await firstBox.hover();
await sleep(400);
const hovered = await page.evaluate(() => Number(getComputedStyle(document.querySelector("ytd-search [data-shoo-hide] > :not(.shoo-reason)")).opacity));
await page.mouse.move(1, 1);
const s = shown.value;
check("hidden cards come back dimmed (40%, 80% while pointed at)", shown.ok && dim.dimmed === dim.boxes && Math.abs(hovered - 0.8) < 0.05, { boxes: s.boxes, visible: s.visible, ...dim, hovered });
const want = new Set([`${ctx.msg("reasonChannel", pick.name)}|${ctx.msg("unhideChannel")}`, `${ctx.msg("reasonWord", pick.otherWord)}|${ctx.msg("unhideWord")}`, `${ctx.msg("reasonWord", pick.mineWord)}|${ctx.msg("unhideWord")}`]);
check("each has one reason line and its own Unhide button", s.reasons.every(([r, b]) => want.has(`${r}|${b}`)), { total: s.reasons.length, unexpected: s.reasons.filter(([r, b]) => !want.has(`${r}|${b}`)) });

const wordBox = '[data-shoo-hide="word"]';
const clickedTag = await page.evaluate((s) => { const b = document.querySelector(s); b?.setAttribute("data-qa-word", ""); return b?.tagName; }, wordBox);
await page.locator("[data-qa-word] .shoo-reason button").first().click();
const unw = await until(() => getList(ctx), (l) => !l.words.includes(pick.otherWord), 3000);
const removedLine = await page.evaluate(() => [...document.querySelectorAll(".shoo-removed")].map((n) => [n.querySelector(".shoo-text")?.textContent, n.querySelector("button")?.textContent, n.closest("[data-shoo-hide]") ? "hidden" : "visible"]));
const dbg = await page.evaluate(() => { const b = document.querySelector("[data-qa-word]"); return { hide: b?.getAttribute("data-shoo-hide"), kids: [...(b?.children || [])].map((k) => k.tagName + "." + k.className).slice(-4), reveal: document.documentElement.hasAttribute("data-shoo-reveal") }; });
check("Unhide word removes the word; the card shows 'Removed: <word> · Undo'", { clickedTag, words: unw.value?.words, dbg, removedLine } && unw.ok && removedLine.some(([t, b, v]) => t === ctx.msg("listRemoved", pick.otherWord) && b === ctx.msg("undo") && v === "visible"), { clickedTag, words: unw.value?.words, dbg, removedLine });
await page.locator(".shoo-removed button").first().click();
const rew = await until(() => getList(ctx), (l) => l.words.includes(pick.otherWord), 3000);
const rehidden = await page.evaluate((w) => [...document.querySelectorAll('[data-shoo-hide="word"] .shoo-reason span')].some((n) => n.textContent.includes(w)), pick.otherWord);
check("Undo puts the word back and the card is hidden (dimmed) again", rew.ok && rehidden, { words: rew.value.words });

const both = await page.evaluate((w) => {
  const box = [...document.querySelectorAll('[data-shoo-hide="channel"]')].find((b) => (b.querySelector("#video-title")?.getAttribute("title") || "").includes(w));
  if (!box) return false;
  box.setAttribute("data-qa-both", "");
  return true;
}, pick.mineWord);
if (both) {
  await page.locator("[data-qa-both] .shoo-reason button").click();
  const step = await until(() => page.evaluate(() => {
    const b = document.querySelector("[data-qa-both]");
    return { kind: b.getAttribute("data-shoo-hide"), reason: b.querySelector(".shoo-reason span")?.textContent, removed: b.querySelector(".shoo-removed .shoo-text")?.textContent };
  }), (v) => v.kind === "word", 3000);
  check("card matching channel and word: after Unhide channel it stays dimmed with the word reason", step.ok && step.value.reason === ctx.msg("reasonWord", pick.mineWord) && step.value.removed === ctx.msg("listRemoved", pick.name), step.value);
  await page.locator("[data-qa-both] .shoo-reason .shoo-row button").click();
  const gone = await until(() => page.evaluate(() => document.querySelector("[data-qa-both]").getAttribute("data-shoo-hide")), (v) => v === null, 3000);
  check("…and is shown only when the last matching entry is gone", gone.ok, gone.value);
} else check("card matching channel and word", null, "no veritasium card with that word on the page");

const again = await openRealPopup(ctx, page);
const rv = await again.eval(() => ({ line: document.getElementById("revealed")?.textContent, button: document.getElementById("hideAgain")?.textContent, show: Boolean(document.getElementById("showHidden")) }));
check("popup after 'Show hidden': says hidden videos are shown here and offers 'Hide them again'", rv.line === ctx.msg("popupRevealed") && rv.button === ctx.msg("popupHideAgain") && !rv.show, rv);
if (rv.button) {
  await again.eval(() => document.getElementById("hideAgain").click());
  const hiddenAgain = await until(() => page.evaluate(() => ({ reveal: document.documentElement.hasAttribute("data-shoo-reveal"), visible: [...document.querySelectorAll("[data-shoo-hide]")].filter((b) => !b.closest("ytd-search[hidden]") && b.checkVisibility() && !b.hasAttribute("data-shoo-slot")).length, reasons: document.querySelectorAll(".shoo-reason").length })), (v) => !v.reveal && v.visible === 0 && v.reasons === 0, 3000);
  check("'Hide them again' hides them on the page without a reload", hiddenAgain.ok, hiddenAgain.value);
} else await again.close();

await setList(ctx, { v: 1, channels: [{ handle: HANDLE, name: pick.name, added: 1, source: "card" }], words: [] });
const box = page.locator('input[name="search_query"]').first();
await page.evaluate(() => window.scrollTo(0, 0));
await box.click();
await box.fill("veritasium");
await box.press("Enter");
await page.waitForURL(/search_query=veritasium$/, { timeout: 15000 });
await sleep(3000);
const reset = await page.evaluate(() => ({ reveal: document.documentElement.hasAttribute("data-shoo-reveal"), reasons: document.querySelectorAll(".shoo-reason").length, visibleHidden: [...document.querySelectorAll("[data-shoo-hide]")].filter((b) => b.checkVisibility()).length }));
check("state resets on the next navigation", !reset.reveal && reset.reasons === 0 && reset.visibleHidden === 0, reset);

await setList(ctx, null);
await goSearch(page, "lofi hip hop radio");
const p2 = await openRealPopup(ctx, page);
const none = await p2.eval(() => ({ nothing: document.getElementById("nothing")?.textContent ?? null, counts: document.getElementById("counts").textContent }));
check("empty list: one empty line only (how to start), no 'Nothing hidden on this page' under it", none.nothing === null && none.counts === ctx.msg("popupEmpty"), none);
await p2.close();
await setList(ctx, { v: 1, channels: [{ handle: "@nobody-qa-zz", name: "Nobody QA", added: 1, source: "card" }], words: [] });
await sleep(500);
const p3 = await openRealPopup(ctx, page);
const zero = await p3.eval(() => ({ nothing: document.getElementById("nothing")?.textContent ?? null, counts: document.getElementById("counts").textContent }));
check("list not empty, K = 0: 'Nothing hidden on this page'", zero.nothing === ctx.msg("popupNothingHere") && zero.counts === ctx.msg("popupCounts", 1, 0), zero);
await p3.close();

const all = { q: "kurzgesagt", handle: "@kurzgesagt" };
await goSearch(page, all.q);
const kname = await page.evaluate((h) => document.querySelector(`ytd-search ytd-video-renderer:has(#channel-info a[href="/${h}"]) ytd-channel-name #text`)?.textContent.trim(), all.handle);
const mix = await page.evaluate((h) => {
  const cards = [...document.querySelectorAll("ytd-search:not([hidden]) ytd-section-list-renderer :is(ytd-video-renderer, yt-lockup-view-model, ytd-channel-renderer)")];
  return { total: cards.length, mine: cards.filter((c) => c.querySelector(`a[href="/${h}"]`)).length };
}, all.handle);
const everything = await page.evaluate(() => {
  const handles = new Set();
  const words = new Set();
  for (const c of document.querySelectorAll("ytd-search:not([hidden]) ytd-section-list-renderer :is(ytd-video-renderer, yt-lockup-view-model, ytd-channel-renderer, ytd-playlist-renderer, ytd-radio-renderer, ytd-universal-watch-card-renderer)")) {
    const a = c.querySelector('a[href^="/@"]');
    if (a) handles.add(a.getAttribute("href").split("/")[1]);
    else words.add((c.querySelector("h3, #video-title")?.textContent || "").trim().split(/\s+/).find((w) => /^\p{L}{4,}$/u.test(w)) || "zzzz");
  }
  return { handles: [...handles], words: [...words] };
});
await setList(ctx, { v: 1, channels: everything.handles.map((handle, i) => ({ handle, name: handle === all.handle ? kname : `Qa ${i}`, added: 1, source: "card" })), words: everything.words });
mix.mine = mix.total;
const line = await until(() => page.evaluate(() => {
  const l = document.getElementById("shoo-all");
  return l ? { text: l.querySelector("span").textContent, button: l.querySelector("button").textContent, visible: l.checkVisibility() } : null;
}), Boolean, 5000);
if (mix.total && mix.mine === mix.total) {
  const n = await page.evaluate(() => [...document.querySelectorAll("ytd-search:not([hidden]) ytd-section-list-renderer [data-shoo-hide]")].filter((b) => !b.matches("ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model")).length);
  check("search page with every result hidden: '<Brand> hid all N results · Show them'", line.ok && line.value.text === ctx.msg("allHidden", n) && line.value.button === ctx.msg("showThem") && line.value.visible, { ...line.value, hiddenBoxes: n, mix });
  await page.locator("#shoo-all button").click();
  const rv = await until(() => page.evaluate(() => document.documentElement.hasAttribute("data-shoo-reveal") && !document.getElementById("shoo-all")), Boolean, 2000);
  check("'Show them' shows the hidden cards", rv.ok);
} else {
  check("search page with every result hidden: line shown", null, `precondition: not every result on '${all.q}' is from ${all.handle} (${mix.mine}/${mix.total}); line shown=${line.ok}`);
}
await finish(ctx, check);
