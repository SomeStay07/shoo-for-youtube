// Does Shoo keep removed cards alive? Fixture search page with N cards (most off-screen), Shoo processes them,
// the page removes the results (as YouTube does on SPA navigation), GC, count DOM nodes. Same with no extension.
import { launchLocked, save, sleep } from "./qa-lib.mjs";
import { reporter, closeWelcome, setList } from "../harness.mjs";
import { searchCard, searchPage, serve } from "../fixtures.mjs";

const N = Number(process.env.N || 2000);
const ROUNDS = Number(process.env.ROUNDS || 5);
const { check } = reporter("qa-detached");
const out = {};
for (const arm of ["shoo", "none"]) {
  const ctx = await launchLocked({ name: `qa-detached-${arm}`, extension: arm === "shoo" });
  if (arm === "shoo") {
    await closeWelcome(ctx);
    await setList(ctx, { v: 1, channels: [{ handle: "@ch3", name: "Name 3", added: 1, source: "card" }], words: ["zzz"] });
  }
  const URL = "https://www.youtube.com/results?search_query=shoo-detached";
  await serve(ctx.context, URL, searchPage([searchCard({ vid: "seed0000000", title: "seed", handle: "@seed", name: "Seed" })]));
  const page = ctx.context.pages()[0] || (await ctx.context.newPage());
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await sleep(1500);
  const cdp = await ctx.context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const nodes = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    await sleep(300);
    await cdp.send("HeapProfiler.collectGarbage");
    const m = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
    return { nodes: m.Nodes, heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2), listeners: m.JSEventListeners };
  };
  const html = Array.from({ length: N }, (_, i) => searchCard({ vid: `d${String(i).padStart(10, "0")}`, title: `Video ${i}`, handle: `@ch${i % 50}`, name: `Name ${i % 50}` })).join("");
  const rounds = [];
  const base = await nodes();
  for (let r = 0; r < ROUNDS; r++) {
    await page.evaluate((h) => {
      const host = document.querySelector("ytd-item-section-renderer #contents");
      const sec = document.createElement("div");
      sec.id = "qa-batch";
      sec.innerHTML = h;
      host.append(sec);
    }, html);
    await sleep(1500);
    // hover one card so the shared ⊘ lands in the batch, like a user would
    await page.mouse.move(300, 200);
    await page.mouse.move(320, 260);
    await sleep(400);
    const added = await nodes();
    await page.evaluate(() => document.getElementById("qa-batch").remove());
    await sleep(1500);
    const removed = await nodes();
    rounds.push({ r, added, removed });
  }
  // let Shoo's health tick (6 s) and safety net run, then measure again
  await sleep(8000);
  const settled = await nodes();
  out[arm] = { base, rounds, settled, hidden: arm === "shoo" ? null : 0 };
  console.log(arm, JSON.stringify({ base, settled, last: rounds[rounds.length - 1] }));
  await ctx.context.close();
}
save("detached", out);
const leakShoo = out.shoo.settled.nodes - out.shoo.base.nodes;
const leakNone = out.none.settled.nodes - out.none.base.nodes;
const perCard = (out.shoo.rounds[0].added.nodes - out.shoo.base.nodes) / N;
check(`removed cards are released: ${ROUNDS}×${N} cards added and removed, DOM nodes left after GC (Shoo vs none)`, leakShoo - leakNone < perCard * N * 0.05, { leakShoo, leakNone, nodesPerCard: +perCard.toFixed(1), retainedCardsEquiv: Math.round((leakShoo - leakNone) / perCard) });
