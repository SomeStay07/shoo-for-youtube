import { launch, reporter, closeWelcome, setList, getList, until, sleep, finish } from "./harness.mjs";
import { searchCard, searchPage, serve } from "./fixtures.mjs";

const { check } = reporter("r3-fixes");
const ctx = await launch({ name: "r3-fixes" });
await closeWelcome(ctx);
const SEARCH = "https://www.youtube.com/results?search_query=shoo-r3-fixes";
const post = `<ytd-post-renderer data-qa="p000000000a"><div id="author"><a id="author-text" href="/@poster"><span>Poster</span></a></div><div id="content"><yt-formatted-string id="content-text">Go watch <a href="/@mentioned">@mentioned</a> today</yt-formatted-string></div></ytd-post-renderer>`;
await serve(ctx.context, SEARCH, searchPage([
  searchCard({ vid: "k000000000a", title: "Collab with no avatar stack", handle: "@kappa", collab: "Kappa Six and Beta Two", stack: false }),
  searchCard({ vid: "a000000000a", title: "Alpha video", handle: "@alpha", name: "Alpha" }),
  searchCard({ vid: "g000000000a", title: "Gamma zzword video", handle: "@gamma", name: "Gamma" }),
  post,
]));
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
const hidden = (qa) => page.evaluate((q) => document.querySelector(`[data-qa="${q}"]`).hasAttribute("data-shoo-hide"), qa);
const entry = (o) => ({ added: 1, source: "import", ...o });

await setList(ctx, { v: 1, channels: [entry({ name: "Beta Two" })], words: [] });
await page.goto(SEARCH, { waitUntil: "domcontentloaded" });
const collab = await until(() => hidden("k000000000a"), Boolean, 3000);
check("collab card without an avatar stack ('A and B' text only): hidden by the partner's name", collab.ok, { hidden: collab.value });

await setList(ctx, { v: 1, channels: [entry({ handle: "@mentioned", name: "Mentioned" })], words: [] });
await sleep(800);
const mention = await hidden("p000000000a");
await setList(ctx, { v: 1, channels: [entry({ handle: "@poster", name: "Poster" })], words: [] });
const author = await until(() => hidden("p000000000a"), Boolean, 3000);
check("community post that @mentions a listed channel stays; the same post is hidden by its author", !mention && author.ok, { hiddenByMention: mention, hiddenByAuthor: author.value });

await setList(ctx, null);
await page.goto(SEARCH, { waitUntil: "domcontentloaded" });
await sleep(600);
await ctx.worker.evaluate(() => {
  const real = OPS.block;
  OPS.block = () => new Promise((r) => (globalThis.__releaseBlock = () => r(null)));
  globalThis.__restoreBlock = () => {
    OPS.block = real;
    globalThis.__releaseBlock?.();
  };
});
await page.hover('[data-qa="a000000000a"] h3');
await sleep(300);
await page.click('[data-qa="a000000000a"] .shoo-btn');
await sleep(300);
const t0 = Date.now();
await ctx.worker.evaluate(() => chrome.storage.local.set({ list: { v: 1, channels: [], words: ["zzword"] } }));
const caught = await until(() => hidden("g000000000a"), Boolean, 16000, 250);
const alpha = await page.evaluate(() => {
  const b = document.querySelector('[data-qa="a000000000a"]');
  return { hidden: b.hasAttribute("data-shoo-hide"), lines: [...b.querySelectorAll(".shoo-line")].map((l) => l.textContent) };
});
check("the worker never answers a block: after the timeout the tab lets go and applies what's in storage (a word added elsewhere hides its video)", caught.ok && Date.now() - t0 >= 8000, { caughtAfterMs: caught.ms, alpha });
check("…and the card whose block got no answer is shown with 'Not saved'", !alpha.hidden && alpha.lines.some((l) => l.includes(ctx.msg("cardNotSaved"))), alpha);
await ctx.worker.evaluate(() => globalThis.__restoreBlock?.());

await setList(ctx, null);
await page.goto(SEARCH, { waitUntil: "domcontentloaded" });
await sleep(600);
await ctx.worker.evaluate(() => {
  const real = OPS.block;
  let first = true;
  OPS.block = (m) => {
    if (!first) return real(m);
    first = false;
    return new Promise((r) => setTimeout(r, 13000)).then(() => real(m));
  };
  globalThis.__restoreBlock = () => (OPS.block = real);
});
const lines = (qa) => page.evaluate((q) => {
  const b = document.querySelector(`[data-qa="${q}"]`);
  return { hidden: b.hasAttribute("data-shoo-hide"), shown: b.checkVisibility(), lines: [...b.querySelectorAll(".shoo-line")].map((l) => l.textContent) };
}, qa);
for (const qa of ["a000000000a", "g000000000a"]) {
  await page.hover(`[data-qa="${qa}"] h3`);
  await sleep(300);
  await page.click(`[data-qa="${qa}"] .shoo-btn`);
  await sleep(200);
}
const notSaved = (s) => s.lines.some((l) => l.includes(ctx.msg("cardNotSaved")));
let secondFailed = false;
const t1 = Date.now();
while (Date.now() - t1 < 17000) {
  if (notSaved(await lines("g000000000a"))) secondFailed = true;
  await sleep(250);
}
const stored = ((await getList(ctx))?.channels || []).map((c) => c.handle).sort();
const first = await lines("a000000000a");
const second = await lines("g000000000a");
check("a block queued behind a slow one gets its own 10 s once its turn comes: it lands and never says 'Not saved'", !secondFailed && second.hidden && stored.join() === "@alpha,@gamma", { secondFailed, second, stored });
check("a block that timed out but landed later: 'Not saved' goes away and the card is hidden as stored", !notSaved(first) && first.hidden && !first.shown, { first, stored });
await ctx.worker.evaluate(() => globalThis.__restoreBlock?.());
await setList(ctx, null);
await finish(ctx, check);
