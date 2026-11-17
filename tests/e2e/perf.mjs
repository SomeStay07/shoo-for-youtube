import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { launch, reporter, closeWelcome, setList, sleep, ROOT, OUT } from "./harness.mjs";
import { cycle } from "./workload.mjs";

const MIN = Number(process.env.MIN || 30);
const LIST = JSON.parse(readFileSync(join(ROOT, "tests/e2e/data/list-500.json"), "utf8"));
const MEMORY_URL = "https://www.youtube.com/hashtag/minecraft";
const BUILD = join(OUT, process.env.PERF_BUILD || "perf-build");
execFileSync(process.execPath, [join(ROOT, "scripts/build.mjs")], { env: { ...process.env, DIST: BUILD, SHOO_TEST_HOOKS: "1" }, stdio: "inherit" });
const TEST_EXT = join(BUILD, "chrome");

async function arm(name) {
  const ext = name === "ext";
  const ctx = await launch({ name: `perf-${name}${process.env.PERF_TAG || ""}`, extension: ext, ext: TEST_EXT });
  if (ext) {
    await closeWelcome(ctx);
    await setList(ctx, LIST);
  }
  const page = ctx.context.pages()[0] || (await ctx.context.newPage());
  const cdp = await ctx.context.newCDPSession(page);
  await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
  await cdp.send("HeapProfiler.enable");
  const get = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
  const acc = { script: 0, task: 0 };
  let prev = null;
  const own = { calls: 0, ms: 0, maxMs: 0 };
  let prevOwn = null;
  let polling = true;
  const poll = (async () => {
    while (polling) {
      try {
        const m = await get();
        const cur = { script: m.ScriptDuration, task: m.TaskDuration };
        for (const k of Object.keys(acc)) {
          const d = prev ? cur[k] - prev[k] : cur[k];
          acc[k] += d >= 0 ? d : cur[k];
        }
        prev = cur;
        if (ext) {
          const s = await page.evaluate(() => {
            document.dispatchEvent(new CustomEvent("shoo:stats"));
            return document.documentElement.getAttribute("data-shoo-stats");
          });
          if (s) {
            const c = JSON.parse(s);
            const reset = !prevOwn || c.calls < prevOwn.calls;
            own.calls += reset ? c.calls : c.calls - prevOwn.calls;
            own.ms += reset ? c.ms : c.ms - prevOwn.ms;
            own.maxMs = Math.max(own.maxMs, c.maxMs);
            prevOwn = c;
          }
        }
      } catch {}
      await sleep(2000);
    }
  })();
  const harvest = async () => {
    if (!ext) return;
    const s = await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent("shoo:stats"));
      return document.documentElement.getAttribute("data-shoo-stats");
    }).catch(() => null);
    if (s && prevOwn) {
      const c = JSON.parse(s);
      if (c.calls >= prevOwn.calls) {
        own.calls += c.calls - prevOwn.calls;
        own.ms += c.ms - prevOwn.ms;
        own.maxMs = Math.max(own.maxMs, c.maxMs);
      }
    }
    prevOwn = null;
  };
  const samples = [];
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < MIN * 60000) {
    const done = await cycle(page, i, { beforeFullNav: harvest });
    await harvest();
    let memErr = 0;
    try {
      await page.goto(MEMORY_URL, { waitUntil: "domcontentloaded" });
      await sleep(5000);
    } catch {
      memErr = 1;
    }
    await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
    const m = await get().catch(() => ({}));
    samples.push({ i, s: Math.round((Date.now() - t0) / 1000), path: new URL(page.url()).pathname, heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2), errs: done.filter((d) => d.includes(":ERR")).length + memErr, memErr });
    console.log(name, JSON.stringify(samples.at(-1)));
    i++;
  }
  polling = false;
  await poll;
  await ctx.context.close();
  return { name, cycles: i, scriptS: +acc.script.toFixed(2), taskS: +acc.task.toFixed(2), own: { ...own, ms: +own.ms.toFixed(1) }, samples };
}

const { check } = reporter("perf");
const [none, ext] = await Promise.all([arm("none"), arm("ext")]);
writeFileSync(join(OUT, process.env.PERF_OUT || "perf-data.json"), JSON.stringify({ minutes: MIN, none, ext }, null, 1));
const errs = (arm) => arm.samples.reduce((a, x) => a + x.errs, 0);
const valid = none.cycles >= 20 && ext.cycles >= 20 && errs(none) + errs(ext) <= 0.1 * 12 * (none.cycles + ext.cycles);
const share = ext.own.ms / 1000 / none.scriptS;
check(`extension's own script time <= 2% of the no-extension baseline (${MIN} min, 500 channels + 50 words)`, valid ? share <= 0.02 : null, {
  valid,
  stepErrors: [errs(none), errs(ext)], ownMs: ext.own.ms, calls: ext.own.calls, maxMsPerCall: ext.own.maxMs, baselineScriptS: none.scriptS, extArmScriptS: ext.scriptS, sharePct: +(share * 100).toFixed(2), cycles: [none.cycles, ext.cycles] });
const robustSlope = (xs) => {
  const pts = xs.map((x) => [x.s / 60, x.heapMB]).filter(([, y]) => Number.isFinite(y));
  const ks = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (pts[j][0] !== pts[i][0]) ks.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
  if (ks.length < 3) return null;
  ks.sort((a, b) => a - b);
  return ks[Math.floor(ks.length / 2)];
};
const memPath = new URL(MEMORY_URL).pathname;
const atFixed = (arm) => arm.samples.filter((x) => !x.memErr && x.path === memPath);
const sNone = robustSlope(atFixed(none));
const sExt = robustSlope(atFixed(ext));
check(`no heap growth trend with the extension (MB/min after GC, sampled on ${memPath} at the end of every cycle, Theil-Sen slope)`, !valid ? null : sExt !== null && sExt <= Math.max(0.1, (sNone ?? 0) + 0.1), { extMBperMin: sExt && +sExt.toFixed(3), noneMBperMin: sNone && +sNone.toFixed(3), samples: [atFixed(none).length, atFixed(ext).length], heapMB: { none: atFixed(none).map((x) => x.heapMB), ext: atFixed(ext).map((x) => x.heapMB) } });
