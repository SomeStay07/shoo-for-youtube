import { launch, reporter, closeWelcome, setList, getList, until, sleep, finish } from "./harness.mjs";
import { searchPage, serve } from "./fixtures.mjs";

const { check } = reporter("identity");
const ctx = await launch({ name: "identity" });
await closeWelcome(ctx);
const SEARCH = "https://www.youtube.com/results?search_query=shoo-identity";
const uc = (n) => `UC${String(n).padStart(22, "q")}`;
const idFirst = (vid, n, name) => `<ytd-video-renderer data-qa="${vid}"><div id="dismissible">
  <ytd-thumbnail><a id="thumbnail" href="/watch?v=${vid}">thumb</a></ytd-thumbnail>
  <div class="text-wrapper"><div id="meta"><h3><a id="video-title" title="Video ${vid}" href="/watch?v=${vid}">Video ${vid}</a></h3></div>
  <div id="channel-info"><a id="channel-thumbnail" href="/channel/${uc(n)}">avatar</a>
  <ytd-channel-name id="channel-name"><div id="text-container"><yt-formatted-string id="text"><a class="yt-simple-endpoint" href="/@learn${n}">${name}</a></yt-formatted-string></div></ytd-channel-name>
  </div></div></div></ytd-video-renderer>`;
await serve(ctx.context, SEARCH, searchPage([idFirst("i000000001a", 1, "Learn One"), idFirst("i000000002a", 2, "Learn Two"), idFirst("i000000003a", 3, "Learn Three"), idFirst("i000000004a", 4, "Learn Four")]));
await setList(ctx, null);
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
const card = (n) => `[data-qa="i00000000${n}a"]`;
const boxState = (n) => page.evaluate((s) => {
  const b = document.querySelector(s);
  return { hidden: b.hasAttribute("data-shoo-hide"), shown: b.checkVisibility() && !b.hasAttribute("data-shoo-slot"), lines: [...b.querySelectorAll(".shoo-line")].map((l) => l.textContent) };
}, card(n));
const entryOf = async (n) => (await getList(ctx))?.channels?.find((c) => c.id === uc(n)) ?? null;
const clickHide = async (n) => {
  await page.mouse.move(1, 1);
  await page.hover(`${card(n)} h3`);
  await sleep(300);
  await page.click(`${card(n)} .shoo-btn`);
};
const tabId = async () => {
  await page.bringToFront();
  return ctx.worker.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t?.id));
};

await page.goto(SEARCH, { waitUntil: "domcontentloaded" });
await sleep(800);

await clickHide(1);
const learned1 = await until(() => entryOf(1), (e) => e?.handle === "@learn1", 5000);
await page.click(`${card(1)} .shoo-line button`);
const undone = await until(async () => ({ entry: await entryOf(1), card: await boxState(1) }), (s) => !s.entry && s.card.shown, 4000);
check("id-first block, the entry learns its @handle, then Undo: the channel leaves the list and its card comes back", learned1.ok && undone.ok, { learned: learned1.value, after: undone.value });

await clickHide(2);
const tab = await tabId();
await ctx.worker.evaluate((id) => chrome.tabs.sendMessage(id, { type: "reveal" }), tab);
const learned2 = await until(() => entryOf(2), (e) => e?.handle === "@learn2", 5000);
await sleep(400);
await page.click(`${card(2)} .shoo-reason button`);
const stopped = await until(() => entryOf(2), (e) => !e, 4000);
check("id-first block, 'Show hidden' opened before the handle is learned, then 'Stop hiding': the channel leaves the list", learned2.ok && stopped.ok, { learned: learned2.value, after: stopped.value });
await ctx.worker.evaluate((id) => chrome.tabs.sendMessage(id, { type: "hide" }), tab);
await setList(ctx, null);
await sleep(400);

const welcome = await ctx.context.newPage();
await welcome.goto(`chrome-extension://${ctx.extId}/welcome.html`);
await welcome.waitForSelector("#paste");
await welcome.evaluate((id) => {
  const area = document.getElementById("paste");
  area.value = id;
  area.dispatchEvent(new ClipboardEvent("paste", { bubbles: true }));
}, uc(3));
await until(() => welcome.evaluate(() => Boolean(document.querySelector(".import-undo"))), Boolean, 4000);
await page.bringToFront();
await page.reload({ waitUntil: "domcontentloaded" });
const learned3 = await until(() => entryOf(3), (e) => e?.handle === "@learn3" && e.name === "Learn Three", 6000);
await welcome.bringToFront();
await welcome.click(".import-undo");
const unimported = await until(() => entryOf(3), (e) => !e, 4000);
check("an imported UC id learns its @handle and name on a page, then Undo import still takes it out", learned3.ok && unimported.ok, { learned: learned3.value, after: unimported.value });
await welcome.close();
await setList(ctx, null);
await page.bringToFront();
await sleep(400);

await ctx.worker.evaluate(() => {
  const real = OPS.block;
  let first = true;
  OPS.block = async (m) => {
    const res = await real(m);
    if (first) {
      first = false;
      return null;
    }
    return res;
  };
  globalThis.__restoreBlock = () => (OPS.block = real);
});
await clickHide(4);
await sleep(1500);
await page.click(`${card(4)} .shoo-line button`);
const retried = await until(async () => ({ entry: await entryOf(4), card: await boxState(4) }), (s) => !s.entry && s.card.shown, 4000);
check("a block saved by the worker whose reply was lost (retried, so the worker's prev is this tab's own entry): Undo removes the channel", retried.ok, retried.value);
await ctx.worker.evaluate(() => globalThis.__restoreBlock?.());

await finish(ctx, check);
