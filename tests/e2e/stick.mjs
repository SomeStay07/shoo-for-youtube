import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, reporter, closeWelcome, setList, finish, ROOT } from "./harness.mjs";
import { cycle } from "./workload.mjs";

const { check } = reporter("stick");
const CYCLES = Number(process.env.CYCLES || 1);
const LIST = JSON.parse(readFileSync(join(ROOT, "tests/e2e/data/list-500.json"), "utf8"));
const LIB = readFileSync(join(ROOT, "lib.js"), "utf8");
const PROBE = readFileSync(join(ROOT, "tests/e2e/flash-probe.js"), "utf8");
const ctx = await launch({ name: "stick" });
await closeWelcome(ctx);
await setList(ctx, LIST);
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
await page.addInitScript(`${LIB}\nwindow.__SHOO_LIST = ${JSON.stringify(LIST)};\n${PROBE}`);
const harvest = [];
const take = async () => {
  const s = await page.evaluate(() => (window.__flash ? JSON.parse(JSON.stringify(window.__flash)) : null)).catch(() => null);
  if (s?.frames) harvest.push({ url: page.url(), ...s });
};
const steps = [];
for (let i = 0; i < CYCLES; i++) {
  const done = await cycle(page, i, { all: true, mark: (n) => page.evaluate((x) => window.__setScenario?.(x), n).catch(() => {}), beforeFullNav: take });
  steps.push(...done);
  console.log(`cycle ${i}: ${done.join(" ")}`);
}
await take();
const per = {};
let frames = 0;
let flash = 0;
let hides = 0;
const events = [];
for (const h of harvest) {
  frames += h.frames;
  flash += h.flashFrames;
  hides += h.hides;
  events.push(...h.events);
  for (const [k, v] of Object.entries(h.perScenario)) {
    per[k] = per[k] || { frames: 0, flashFrames: 0, hides: 0 };
    for (const f of ["frames", "flashFrames", "hides"]) per[k][f] += v[f];
  }
}
const errs = steps.filter((s) => s.includes(":ERR"));
check(`workload ran: ${CYCLES} cycle(s), every step done`, errs.length === 0, { steps: steps.length, errs });
check("the list actually hid cards during the run", hides > 0, { hides, list: `${LIST.channels.length} channels + ${LIST.words.length} words` });
check("0 frames with a blocked card visible (search, scroll continuations, masthead SPA, results→watch, back, forward, reload, watch sidebar, hashtag)", flash === 0, { frames, flashFrames: flash, events: events.slice(0, 8) });
console.log(JSON.stringify(per));
await finish(ctx, check);
