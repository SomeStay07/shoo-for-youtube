// Settings churn: 200 rapid block / undo clicks across 2 tabs at the same time (fixture search page,
// 10 channels x 2 cards). At the end: storage has no duplicates, and both tabs show exactly what the list says.
import { launchLocked, save, sleep } from "./qa-lib.mjs";
import { reporter, closeWelcome, setList, getList, finish } from "../harness.mjs";
import { searchCard, searchPage, serve } from "../fixtures.mjs";

const OPS = Number(process.env.OPS || 100);
const { check } = reporter("qa-settings-churn");
const ctx = await launchLocked({ name: "qa-settings-churn" });
const swErrors = [];
ctx.worker.on("console", (m) => ["error", "warning"].includes(m.type()) && swErrors.push(m.text().slice(0, 200)));
await closeWelcome(ctx);
await setList(ctx, null);
const SEARCH = "https://www.youtube.com/results?search_query=shoo-churn";
const H = Array.from({ length: 10 }, (_, i) => `@chan${i}`);
const cards = [];
H.forEach((h, i) => {
  for (let k = 0; k < 2; k++) cards.push(searchCard({ vid: `c${i}k${k}`.padEnd(11, "0"), title: `Video ${i}-${k}`, handle: h, name: `Channel ${i}` }));
});
await serve(ctx.context, SEARCH, searchPage(cards));
const tabs = [ctx.context.pages()[0] || (await ctx.context.newPage()), await ctx.context.newPage()];
for (const t of tabs) {
  await t.goto(SEARCH, { waitUntil: "domcontentloaded" });
  await sleep(800);
}
const sel = (h, k = 0) => `ytd-video-renderer[data-qa]:has(#channel-info a[href="/${h}"]) >> nth=${k}`;
const stateOf = (t, h) =>
  t.evaluate((h) => {
    const cs = [...document.querySelectorAll("ytd-video-renderer[data-qa]")].filter((c) => c.querySelector(`#channel-info a[href="/${h}"]`));
    return cs.map((c) => ({ hidden: c.hasAttribute("data-shoo-hide"), shown: c.checkVisibility() && !c.hasAttribute("data-shoo-slot"), undo: Boolean(c.querySelector(":scope > .shoo-line:not(.shoo-failed) button")), failed: Boolean(c.querySelector(".shoo-failed")) }));
  }, h);

const stats = tabs.map(() => ({ block: 0, undo: 0, skip: 0, err: 0 }));
let seed = 7;
const rnd = (n) => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
};
async function worker(i) {
  const t = tabs[i];
  const st = stats[i];
  let done = 0;
  let guard = 0;
  while (done < OPS && guard++ < OPS * 4) {
    const h = H[rnd(H.length)];
    try {
      const [c0] = await stateOf(t, h);
      if (c0.undo) {
        await t.click(`${sel(h)} >> .shoo-line button`, { timeout: 1500 });
        st.undo++;
        done++;
      } else if (c0.shown) {
        await t.mouse.move(1, 1);
        await t.hover(`${sel(h)} >> h3`, { timeout: 1500 });
        await sleep(140);
        await t.click(`${sel(h)} >> .shoo-btn`, { timeout: 1500 });
        st.block++;
        done++;
      } else st.skip++;
    } catch (e) {
      st.err++;
    }
  }
}
const t0 = Date.now();
await Promise.all([worker(0), worker(1)]);
const ms = Date.now() - t0;
await sleep(4000);
const list = await getList(ctx);
const keys = (list?.channels || []).map((c) => c.handle.toLowerCase());
const listed = new Set(keys);
const mismatch = [];
for (const [i, t] of tabs.entries()) {
  for (const h of H) {
    const s = await stateOf(t, h);
    for (const [k, c] of s.entries()) {
      const want = listed.has(h);
      const isHidden = !c.shown;
      if (want !== isHidden || c.failed) mismatch.push({ tab: i, h, k, listed: want, ...c });
    }
  }
}
const out = { ms, stats, listed: keys, mismatch, swErrors, ctxErrors: ctx.errors };
save("settings-churn", out);
const total = stats.reduce((s, x) => s + x.block + x.undo, 0);
check(`settings churn: ${total} block/undo clicks across 2 tabs in ${Math.round(ms / 1000)} s`, total >= 2 * OPS * 0.9, stats);
check("settings churn: no duplicate entries in storage", keys.length === listed.size, keys);
check("settings churn: both tabs match the stored list exactly (hidden iff listed), no 'Not saved' lines", mismatch.length === 0, mismatch.slice(0, 8));
// reload both tabs: the stored list is the truth
for (const t of tabs) await t.reload({ waitUntil: "domcontentloaded" });
await sleep(1500);
const after = [];
for (const [i, t] of tabs.entries()) for (const h of H) for (const c of await stateOf(t, h)) if (listed.has(h) !== !c.shown) after.push({ tab: i, h });
check("settings churn: after reload both tabs still match the list", after.length === 0, after.slice(0, 5));
const lp = await ctx.context.newPage();
await lp.goto(`chrome-extension://${ctx.extId}/list.html`);
await lp.waitForFunction(() => document.body.dataset.ready === "1");
const rows = await lp.evaluate(() => document.querySelectorAll("#channels .row:not(.removed)").length);
check("settings churn: list page shows the same number of channels", rows === listed.size, { rows, listed: listed.size });
check("settings churn: no service-worker errors", swErrors.length === 0, swErrors.slice(0, 5));
await finish(ctx, check);
