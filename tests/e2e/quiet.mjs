import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { launch, reporter, closeWelcome, setList, until, sleep, finish, ROOT, OUT } from "./harness.mjs";
import { searchCard, searchPage, serve } from "./fixtures.mjs";

const BUILD = join(OUT, "quiet-build");
execFileSync(process.execPath, [join(ROOT, "scripts/build.mjs")], { env: { ...process.env, DIST: BUILD, SHOO_TEST_HOOKS: "1" }, stdio: "ignore" });

const { check } = reporter("quiet");
const ctx = await launch({ name: "quiet", ext: join(BUILD, "chrome") });
await closeWelcome(ctx);
const SEARCH = "https://www.youtube.com/results?search_query=shoo-quiet";
const handles = ["@q1", "@q2", "@q3", "@q4", "@q5", "@q6"];
await serve(ctx.context, SEARCH, searchPage(handles.map((h, i) => searchCard({ vid: `q${String(i).padStart(10, "0")}`, title: `Quiet ${i}`, handle: h, name: `Quiet ${h.slice(1)}` }))));
await setList(ctx, { v: 1, channels: [{ handle: "@listed-elsewhere", name: "Listed Elsewhere", added: 1, source: "card" }], words: [] });
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
const card = (h) => `[data-qa]:has(#channel-info a[href="/${h}"])`;
const applied = () => page.evaluate(() => {
  document.dispatchEvent(new CustomEvent("shoo:stats"));
  return JSON.parse(document.documentElement.getAttribute("data-shoo-stats") || "{}").applied ?? null;
});

await page.goto(SEARCH, { waitUntil: "domcontentloaded" });
await sleep(1000);
await page.hover(`${card("@q1")} h3`);
await sleep(400);
const a0 = await applied();
for (const h of ["@q2", "@q1", "@q2", "@q1"]) {
  await page.hover(`${card(h)} h3`);
  await sleep(300);
}
const a1 = await applied();
const placed = await page.evaluate((s) => Boolean(document.querySelector(`${s} .shoo-btn`)), card("@q1"));
check("moving the one ⊘ between cards does not re-check the cards it leaves and enters", a0 !== null && placed && a1 - a0 === 0, { before: a0, after: a1, moves: 4, placed });
await page.mouse.move(1, 1);

await page.evaluate((s) => {
  document.querySelector(`${s} #channel-thumbnail`).removeAttribute("href");
  document.querySelector(`${s} ytd-channel-name #text a`).removeAttribute("href");
}, `[data-qa="q0000000004"]`);
await sleep(500);
const cdp = await ctx.context.newCDPSession(page);
const worlds = [];
cdp.on("Runtime.executionContextCreated", (e) => worlds.push(e.context));
await cdp.send("Runtime.enable");
await sleep(300);
const world = worlds.find((c) => c.auxData?.type === "isolated" && (c.origin || "").includes(ctx.extId) && c.auxData?.frameId === worlds.find((w) => w.auxData?.isDefault)?.auxData?.frameId);
const inShoo = (expression) => cdp.send("Runtime.evaluate", { expression, contextId: world.id, returnByValue: true });
await inShoo('Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange"));');
const hiddenNow = (await inShoo("document.hidden")).result?.value === true;
const b0 = await applied();
await sleep(13000);
const b1 = await applied();
check("a background tab (document.hidden in Shoo's world) does no safety-net work over two 6 s ticks", Boolean(world) && hiddenNow && b0 !== null && b1 - b0 === 0, { world: Boolean(world), hiddenNow, before: b0, after: b1 });

await page.evaluate((s) => {
  document.querySelector(`${s} ytd-channel-name #text a`).firstChild.data = "Listed Elsewhere";
}, `[data-qa="q0000000004"]`);
await sleep(300);
await inShoo('delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event("visibilitychange"));');
const caught = await until(() => page.evaluate((s) => document.querySelector(s).hasAttribute("data-shoo-hide"), `[data-qa="q0000000004"]`), Boolean, 400, 25);
check("back to the tab: a card that changed to a listed name while the tab was hidden is hidden at once (not after the next tick)", caught.ok, { ms: caught.ms });

await finish(ctx, check);
