import { launch, reporter, closeWelcome, setList, getList, goSearch, until, sleep, finish, consent } from "./harness.mjs";

const { check } = reporter("watch-channel");
const ctx = await launch({ name: "watch-channel" });
await closeWelcome(ctx);
await setList(ctx, null);
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
const QUERY = "veritasium black holes";
const HANDLE = "@veritasium";

const control = () =>
  page.evaluate(() => {
    const box = document.getElementById("shoo-page");
    if (!box) return null;
    return {
      inOwner: Boolean(box.closest("ytd-watch-metadata #owner")),
      afterSubscribe: box.previousElementSibling?.id === "subscribe-button" || Boolean(box.parentElement?.querySelector("#subscribe-button")),
      inHeader: Boolean(box.closest("yt-page-header-view-model")),
      texts: [...box.querySelectorAll(".shoo-text, button")].map((n) => n.textContent),
      visible: box.checkVisibility(),
      inPlayer: Boolean(box.closest("#movie_player")),
    };
  });
const ours = () => page.evaluate(() => [...document.querySelectorAll(".shoo-page, .shoo-line, .shoo-reason, .shoo-menu, .shoo-all")].filter((n) => n.closest("#movie_player, ytd-player")).length);

await goSearch(page, QUERY);
const href = await page.evaluate((h) => document.querySelector(`ytd-search ytd-video-renderer:has(#channel-info a[href="/${h}"]) a#thumbnail`)?.getAttribute("href"), HANDLE);
const resultsUrl = page.url();
await page.goto(`https://www.youtube.com${href.split("&")[0]}`, { waitUntil: "domcontentloaded", referer: resultsUrl });
const first = await until(control, (c) => c?.texts?.length === 1, 15000);
check("watch: the button sits in the owner row next to Subscribe", first.ok && first.value.inOwner && first.value.afterSubscribe && first.value.visible, first.value);
check("watch: button text is 'Hide this channel's videos'", first.value?.texts?.[0] === ctx.msg("pageHide"), first.value?.texts);
const name = await page.evaluate(() => document.querySelector("ytd-watch-metadata ytd-video-owner-renderer ytd-channel-name #text")?.textContent.trim());
const videoBefore = await page.evaluate(() => {
  const v = document.querySelector("#movie_player video");
  return v ? { paused: v.paused, t: v.currentTime } : null;
});

await page.locator("#shoo-page button").click();
const after = await until(control, (c) => c?.texts?.length === 3, 3000);
check("watch: click shows 'Hidden: <channel> · Back to results · Undo'", after.ok && after.value.texts[0] === ctx.msg("cardHidden", name) && after.value.texts[1] === ctx.msg("pageBack") && after.value.texts[2] === ctx.msg("undo"), after.value?.texts);
const stored = await until(() => getList(ctx), (l) => l?.channels?.length === 1, 3000);
check("watch: click stores the channel (handle + name)", stored.value?.channels?.[0]?.handle?.toLowerCase() === HANDLE && stored.value.channels[0].name === name && stored.value.channels[0].source === "watch", stored.value?.channels?.[0]);
const videoAfter = await page.evaluate(() => {
  const v = document.querySelector("#movie_player video");
  return v ? { paused: v.paused, t: v.currentTime } : null;
});
check("watch: no overlay over the player, player state untouched by the click", (await ours()) === 0 && JSON.stringify(videoBefore?.paused) === JSON.stringify(videoAfter?.paused), { ours: await ours(), videoBefore, videoAfter });
check("watch: video keeps playing after the click (needs playback)", null, "YouTube refuses playback in automation: Timur's Chrome");

await page.locator("#shoo-page button", { hasText: ctx.msg("undo") }).click();
const undone = await until(control, (c) => c?.texts?.[0] === ctx.msg("pageHide"), 3000);
const empty = await until(() => getList(ctx), (l) => l?.channels?.length === 0, 3000);
check("watch: Undo removes the channel and brings the button back", undone.ok && empty.ok, { control: undone.value?.texts, list: empty.value });

await page.locator("#shoo-page button").click();
await until(() => getList(ctx), (l) => l?.channels?.length === 1, 3000);
await page.locator("#shoo-page button", { hasText: ctx.msg("pageBack") }).click();
const backed = await until(() => page.url(), (u) => u.includes("/results"), 8000);
check("watch: 'Back to results' returns to the search page", backed.ok, backed.value);

await page.goto(`https://www.youtube.com/${HANDLE}/videos`, { waitUntil: "domcontentloaded" });
await consent(page);
const firstVideo = await until(() => page.evaluate(() => document.querySelector('ytd-browse[page-subtype="channels"]:not([hidden]) a[href^="/watch?v="]')?.getAttribute("href")), Boolean, 15000);
await page.goto(`https://www.youtube.com${firstVideo.value.split("&")[0]}`, { waitUntil: "domcontentloaded" });
const listed = await until(control, (c) => c?.texts?.length === 2, 15000);
check("watch (direct open, listed channel): 'Hidden in search and feeds · Unhide'", listed.ok && listed.value.texts[0] === ctx.msg("pageHidden") && listed.value.texts[1] === ctx.msg("unhideChannel"), listed.value?.texts);
await page.locator("#shoo-page button").click();
const unl = await until(() => getList(ctx), (l) => l?.channels?.length === 0, 3000);
const btnBack = await until(control, (c) => c?.texts?.[0] === ctx.msg("pageHide"), 3000);
check("watch: Unhide removes the channel from the list", unl.ok && btnBack.ok, { list: unl.value, control: btnBack.value?.texts });
await page.locator("#shoo-page button").click();
const noBack = await until(control, (c) => c?.texts?.length >= 2, 3000);
check("watch (opened directly, not from results): no 'Back to results'", noBack.ok && !noBack.value.texts.includes(ctx.msg("pageBack")), noBack.value?.texts);

await page.goto(`https://www.youtube.com/${HANDLE}/videos`, { waitUntil: "domcontentloaded" });
await consent(page);
await until(() => page.evaluate(() => document.querySelectorAll('ytd-browse[page-subtype="channels"]:not([hidden]) :is(ytd-rich-item-renderer, yt-lockup-view-model)').length), (n) => n > 6, 15000);
const ch = await until(control, (c) => c?.texts?.length === 2, 10000);
check("channel page: control in the header; listed channel shows 'Hidden in search and feeds · Unhide'", ch.ok && ch.value.inHeader && ch.value.texts[0] === ctx.msg("pageHidden"), ch.value);
const own = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('ytd-browse[page-subtype="channels"]:not([hidden]) ytd-rich-item-renderer')];
  return { cards: cards.length, hidden: cards.filter((c) => c.hasAttribute("data-shoo-hide")).length, buttons: document.querySelectorAll('ytd-browse[page-subtype="channels"] .shoo-btn').length, title: cards[2]?.querySelector("h3, #video-title")?.textContent.trim() };
});
check("channel page: the channel's own videos are not hidden on its own page", own.cards > 0 && own.hidden === 0, own);
const list = await getList(ctx);
const word = own.title?.split(/\s+/).find((w) => w.length > 5 && /^\p{L}+$/u.test(w));
await setList(ctx, { ...list, words: [word] });
const byWord = await until(() => page.evaluate(() => [...document.querySelectorAll('ytd-browse[page-subtype="channels"]:not([hidden]) ytd-rich-item-renderer')].filter((c) => c.getAttribute("data-shoo-hide") === "word").length), (n) => n > 0, 5000);
check("channel page: words still hide cards there", byWord.ok, { word, hiddenByWord: byWord.value });

await setList(ctx, null);
const btn = await until(control, (c) => c?.texts?.[0] === ctx.msg("pageHide"), 5000);
check("channel page: unlisted channel shows the Hide button", btn.ok, btn.value?.texts);
await page.locator("#shoo-page button").click();
const chStored = await until(() => getList(ctx), (l) => l?.channels?.length === 1, 3000);
check("channel page: click stores handle + name (source channel)", chStored.value?.channels?.[0]?.handle?.toLowerCase() === HANDLE && chStored.value.channels[0].source === "channel" && Boolean(chStored.value.channels[0].name), chStored.value?.channels?.[0]);
await sleep(500);

const VID = "UCHnyfMqiRRG1u-2MsSQLbXA";
await setList(ctx, { v: 1, channels: [{ id: VID, added: 1, source: "import" }], words: [] });
await page.goto(`https://www.youtube.com/${HANDLE}`, { waitUntil: "domcontentloaded" });
await consent(page);
const idListed = await until(control, (c) => c?.texts?.[0] === ctx.msg("pageHidden"), 15000);
const taught = await until(() => getList(ctx), (l) => Boolean(l?.channels?.[0]?.handle && l.channels[0].name), 5000);
check("channel page opened directly: an ID-only entry is recognised and learns its @handle and name", idListed.ok && taught.ok && taught.value.channels[0].handle.toLowerCase() === HANDLE && taught.value.channels[0].id === VID, { control: idListed.value?.texts, entry: taught.value?.channels?.[0] });

await setList(ctx, null);
await page.goto("https://www.youtube.com/c/veritasium", { waitUntil: "domcontentloaded" });
await consent(page);
const custom = await until(control, (c) => c?.texts?.[0] === ctx.msg("pageHide"), 15000);
check("/c/ channel URL opened directly: the Hide button is there (channel ID from the page)", custom.ok && custom.value.inHeader, custom.value);
if (custom.ok) {
  await page.locator("#shoo-page button").click();
  const byId = await until(() => getList(ctx), (l) => l?.channels?.length === 1, 3000);
  check("/c/ page: click stores the channel ID and name", byId.value?.channels?.[0]?.id === VID && Boolean(byId.value.channels[0].name), byId.value?.channels?.[0]);
}
await finish(ctx, check);
