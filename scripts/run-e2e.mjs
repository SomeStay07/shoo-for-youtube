import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { distStale } from "../tests/e2e/harness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOGS = join(ROOT, ".e2e-out/gate");
const SUITES = {
  fast: [
    ["block-search", "2"],
    ["sidebar-name", "4", { nt: /NOT TESTABLE live: / }],
    ["collab-fixture", "5"],
    ["list-page", "8"],
    ["welcome", "9"],
    ["show-hidden", "10"],
    ["watch-channel", "11", { nt: /needs playback|NOT TESTABLE live: / }],
    ["health", "12"],
    ["playlist", "r1", { nt: /NOT TESTABLE live: / }],
    ["stick", "3"],
    ["reattach", "3"],
    ["looks", "15"],
    ["fixes", "r1"],
    ["owner-row", "r1"],
    ["with-errand", "r1", { nt: /Errand build present/ }],
    ["identity", "r2"],
    ["channel-name", "r2", { nt: /no link to another channel/ }],
    ["quiet", "r2"],
    ["grid-lockup", "r3"],
    ["import-ui", "r3"],
    ["shelf", "r3"],
    ["channel-c", "r3"],
    ["r3-fixes", "r3"],
  ],
  long: [
    ["stick", "3", { env: { CYCLES: "6" }, timeoutMs: 60 * 60 * 1000 }],
    ["perf", "13", { timeoutMs: 75 * 60 * 1000 }],
  ],
};

const names = process.argv.slice(2);
const plan = names.flatMap((n) => SUITES[n] || []);
if (!plan.length) {
  console.error(`usage: node scripts/run-e2e.mjs <${Object.keys(SUITES).join("|")}>`);
  process.exit(2);
}
const only = new Set((process.env.E2E_ONLY || "").split(",").filter(Boolean));
const stale = distStale();
if (stale.length) {
  console.log(`FAIL dist/chrome is older than the sources (${stale.join(", ")}): run npm run build`);
  process.exit(1);
}
mkdirSync(LOGS, { recursive: true });

function run(name, env, timeoutMs = 20 * 60 * 1000) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = "";
    const child = spawn(process.execPath, [join(ROOT, "tests/e2e", `${name}.mjs`)], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      out += `\ngate: killed after ${timeoutMs} ms\n`;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, seconds: Math.round((Date.now() - started) / 1000) });
    });
  });
}

const rows = [];
for (const [name, criterion, opts = {}] of plan) {
  if (only.size && !only.has(name)) continue;
  const { code, out, seconds } = await run(name, opts.env, opts.timeoutMs);
  writeFileSync(join(LOGS, `${name}.log`), out);
  const result = /RESULT pass=(\d+) fail=(\d+) nt=(\d+)/.exec(out);
  const lines = out.split("\n");
  const failed = lines.filter((l) => l.startsWith("FAIL "));
  const nt = lines.filter((l) => l.startsWith("NOT TESTABLE "));
  const badNT = nt.filter((l) => !(opts.nt && opts.nt.test(l)));
  let status = "PASS";
  let note = result ? `${result[1]} pass, ${result[3]} not testable, ${seconds} s` : "";
  if (!result) [status, note] = ["FAIL", `crashed (exit ${code}, ${seconds} s): ${lines.filter(Boolean).slice(-2).join(" | ").slice(0, 240)}`];
  else if (Number(result[2]) || code !== 0) [status, note] = ["FAIL", `${result[2]} fail, ${result[1]} pass, ${result[3]} not testable, ${seconds} s`];
  else if (badNT.length) [status, note] = ["FAIL", `${badNT.length} NOT TESTABLE where a result is required, ${seconds} s`];
  rows.push({ name, criterion, status, note });
  console.log(`${status} ${name} (criterion ${criterion}) — ${note}`);
  for (const l of [...failed, ...nt]) console.log(`    ${l.slice(0, 220)}`);
}
const n = (s) => rows.filter((r) => r.status === s).length;
console.log(`\ne2e: ${n("PASS")} PASS, ${n("FAIL")} FAIL, ${n("SKIP")} SKIP · logs in .e2e-out/gate/`);
process.exitCode = n("FAIL") ? 1 : 0;
