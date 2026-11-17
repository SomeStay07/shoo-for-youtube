import { launch, reporter, closeWelcome, setList, getList, until, sleep, finish } from "./harness.mjs";
import { searchCard, searchPage, serve } from "./fixtures.mjs";

const { check } = reporter("fixes");
const ctx = await launch({ name: "fixes" });
await closeWelcome(ctx);
const SEARCH = "https://www.youtube.com/results?search_query=shoo-fixes";
const handles = ["@alpha", "@beta", "@gamma", "@delta", "@eps"];
await serve(ctx.context, SEARCH, searchPage(handles.map((h, i) => searchCard({ vid: `f${String(i).padStart(10, "0")}`, title: `Video ${i}`, handle: h, name: `Name ${h.slice(1)}` }))));
await setList(ctx, null);
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
const card = (h) => `[data-qa]:has(#channel-info a[href="/${h}"])`;
const boxState = (h) => page.evaluate((s) => {
  const b = document.querySelector(s);
  return { hidden: b.hasAttribute("data-shoo-hide"), shown: b.checkVisibility() && !b.hasAttribute("data-shoo-slot"), lines: [...b.querySelectorAll(".shoo-line")].map((l) => l.textContent) };
}, card(h));
const hoverAndClick = async (h) => {
  await page.mouse.move(1, 1);
  await page.hover(`${card(h)} h3`);
  await sleep(300);
  await page.click(`${card(h)} .shoo-btn`);
};

await page.goto(SEARCH, { waitUntil: "domcontentloaded" });
await sleep(800);

await page.hover(`${card("@alpha")} h3`);
await sleep(300);
await page.mouse.move(1, 1);
await sleep(300);
const rest = await page.evaluate((s) => Number(getComputedStyle(document.querySelector(`${s} .shoo-btn`)).opacity), card("@alpha"));
const cdp = await ctx.context.newCDPSession(page);
await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
await sleep(400);
const touch = await page.evaluate((s) => ({ hoverNone: matchMedia("(hover: none)").matches, opacity: Number(getComputedStyle(document.querySelector(`${s} .shoo-btn`)).opacity) }), card("@alpha"));
await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
check("touch screens (hover: none): the placed ⊘ stays visible without hover", touch.hoverNone ? rest === 0 && touch.opacity === 1 : null, { rest, ...touch });

await page.mouse.move(1, 1);
await page.focus(`${card("@alpha")} #video-title`);
await page.keyboard.press("Shift+Tab");
await page.keyboard.press("Tab");
let reached = false;
for (let i = 0; i < 8 && !reached; i++) {
  await page.keyboard.press("Tab");
  reached = await page.evaluate((s) => document.activeElement?.classList.contains("shoo-btn") && document.querySelector(s).contains(document.activeElement), card("@alpha"));
}
await page.hover(`${card("@eps")} h3`);
await sleep(500);
const stay = await page.evaluate(([a, e]) => ({ focusOnButton: document.activeElement?.classList.contains("shoo-btn") ?? false, inFocusedCard: Boolean(document.querySelector(`${a} .shoo-btn`)), inHovered: Boolean(document.querySelector(`${e} .shoo-btn`)), focusVisible: document.activeElement?.matches(":focus-visible") }), [card("@alpha"), card("@eps")]);
await page.keyboard.press("Enter");
const keyed = await until(async () => ((await getList(ctx))?.channels || []).map((c) => c.handle), (l) => l.length > 0, 3000);
check("keyboard focus on ⊘ (Tab) and the mouse drifts to another card: ⊘ stays on the focused card and Enter hides that card's channel", reached && stay.focusOnButton && stay.inFocusedCard && !stay.inHovered && JSON.stringify(keyed.value) === '["@alpha"]', { reached, ...stay, listed: keyed.value });
await page.mouse.move(1, 1);
await setList(ctx, null);
await until(() => boxState("@alpha"), (b) => b.shown, 3000);
await page.hover(`${card("@alpha")} h3`);
await sleep(300);
await page.click(`${card("@alpha")} .shoo-btn`);
await page.mouse.move(1, 1);
await page.hover(`${card("@eps")} h3`);
await sleep(500);
const mouseMoved = await page.evaluate((e) => Boolean(document.querySelector(`${e} .shoo-btn`)), card("@eps"));
check("after a mouse click the ⊘ still follows the mouse to the next card", mouseMoved, { inHovered: mouseMoved });
await setList(ctx, null);
await until(() => boxState("@alpha"), (b) => b.shown, 3000);
await page.mouse.move(1, 1);

const listPage = await ctx.context.newPage();
await listPage.goto(`chrome-extension://${ctx.extId}/list.html`);
await listPage.waitForFunction(() => document.body.dataset.ready === "1");
const twice = await listPage.evaluate(async () => {
  const m = { type: "block", slot: { handle: "@opcache", name: "Op Cache" }, source: "card", op: "qa-op-1" };
  const a = await chrome.runtime.sendMessage(m);
  const b = await chrome.runtime.sendMessage(m);
  return { a, b };
});
check("a retried write with the same op id gets the first result back (prev stays null, so Undo removes the entry)", twice.a?.prev === null && twice.b?.prev === null && twice.b?.key === twice.a?.key, twice);
await listPage.close();
await setList(ctx, null);
await sleep(500);

await ctx.worker.evaluate(() => {
  const real = OPS.block;
  let first = true;
  OPS.block = (m) => {
    if (first) {
      first = false;
      return Promise.resolve(null);
    }
    return real(m);
  };
  globalThis.__restoreBlock = () => (OPS.block = real);
});
await hoverAndClick("@beta");
await page.click(`${card("@beta")} .shoo-line button`);
await sleep(3000);
const ordered = { list: (await getList(ctx))?.channels?.map((c) => c.handle) ?? null, card: await boxState("@beta") };
check("Undo right after a block whose first message was lost: the channel ends up not listed and its card shown", Array.isArray(ordered.list) ? !ordered.list.includes("@beta") && ordered.card.shown : ordered.card.shown, ordered);
await ctx.worker.evaluate(() => globalThis.__restoreBlock?.());
await setList(ctx, null);
await sleep(500);

await ctx.worker.evaluate(() => {
  const real = OPS.block;
  OPS.block = () => Promise.resolve(null);
  globalThis.__restoreBlock = () => (OPS.block = real);
});
await hoverAndClick("@beta");
const failed = await until(() => boxState("@beta"), (b) => b.shown && b.lines.includes(ctx.msg("cardNotSaved")), 6000);
await ctx.worker.evaluate(() => globalThis.__restoreBlock?.());
await hoverAndClick("@beta");
const retriedOk = await until(() => boxState("@beta"), (b) => b.hidden && b.lines.includes(ctx.msg("cardHidden", "Name beta") + ctx.msg("undo")), 4000);
const failedLeft = await page.evaluate((s) => [...document.querySelectorAll(`${s} .shoo-failed`)].filter((n) => n.checkVisibility()).length, card("@beta"));
check("a block that failed, then the same block again without reload succeeds: only 'Hidden: … · Undo' shows, the 'Not saved' line is gone", failed.ok && retriedOk.ok && failedLeft === 0, { failed: failed.value, after: retriedOk.value, failedLeft });
await page.click(`${card("@beta")} .shoo-line button`);
await until(() => boxState("@beta"), (b) => b.shown, 3000);
await setList(ctx, null);
await sleep(500);

await ctx.worker.evaluate(() => {
  const real = OPS.block;
  OPS.block = async (m) => {
    await new Promise((r) => setTimeout(r, 2500));
    return real(m);
  };
  globalThis.__restoreBlock = () => (OPS.block = real);
});
await hoverAndClick("@gamma");
await sleep(400);
await ctx.worker.evaluate(() => chrome.storage.local.set({ list: { v: 1, channels: [], words: ["zzz-unrelated-word"] } }));
const during = [];
for (let i = 0; i < 12; i++) {
  await sleep(150);
  during.push(await boxState("@gamma"));
}
const settled = await until(() => getList(ctx), (l) => l?.channels?.some((c) => c.handle === "@gamma"), 5000);
await sleep(500);
const end = await boxState("@gamma");
const flashed = during.filter((b) => !b.hidden || !b.lines.length).length;
check("another change to the list lands while this tab's block is still being saved: the card stays hidden with its Undo line the whole time", flashed === 0 && end.hidden && end.lines.length === 1 && settled.ok, { flashed, of: during.length, end, list: settled.value });
await ctx.worker.evaluate(() => globalThis.__restoreBlock?.());
if (end.lines.length) {
  await page.click(`${card("@gamma")} .shoo-line button`);
  const undoneG = await until(() => getList(ctx), (l) => l && !l.channels.some((c) => c.handle === "@gamma") && l.words.includes("zzz-unrelated-word"), 4000);
  check("Undo after that removes only the channel and keeps the other change", undoneG.ok, undoneG.value);
}
await setList(ctx, null);
await sleep(500);

const silent = await ctx.context.newPage();
await silent.addInitScript(() => {
  if (!location.href.includes("/popup.html")) return;
  const fake = [{ id: 987654321, url: "https://www.youtube.com/results?search_query=qa", active: true }];
  Object.defineProperty(chrome.tabs, "query", { value: async () => fake });
});
await silent.goto(`chrome-extension://${ctx.extId}/popup.html`);
await silent.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 5000 }).catch(() => {});
const here = await silent.evaluate(() => ({ text: document.getElementById("here").textContent.trim(), status: document.getElementById("status").textContent }));
check("popup on a YouTube tab whose script doesn't answer says to reload it", here.text === ctx.msg("reloadTab") && here.status === ctx.msg("popupOn"), here);
await silent.close();

await page.mouse.move(1, 1);
await page.hover(`${card("@gamma")} h3`);
await sleep(300);
const oldWorker = ctx.worker;
await oldWorker.evaluate(() => chrome.runtime.reload()).catch(() => {});
await until(() => ctx.worker !== oldWorker, Boolean, 10000);
await sleep(1500);
await page.click(`${card("@gamma")} .shoo-btn`);
const orphan = await until(() => boxState("@gamma"), (s) => s.shown && s.lines.length > 0, 4000);
check("after an extension update (orphaned script): a block that can't be saved leaves the card shown and says to reload the tab", orphan.ok && orphan.value.lines[0] === ctx.msg("cardNotSaved"), orphan.value);
await page.mouse.move(1, 1);
await page.hover(`${card("@delta")} h3`);
await sleep(400);
const noButton = await page.evaluate((s) => ({ inCard: Boolean(document.querySelector(`${s} .shoo-btn`)), anywhere: document.querySelectorAll(".shoo-btn").length }), card("@delta"));
check("orphaned script places no ⊘ on another card", !noButton.inCard && noButton.anywhere === 0, noButton);
await finish(ctx, check);
