// QA r2: import fixes (malformed / truncated / binary / too big) and regressions around them
// (plain lists starting "[Word" / "{Word", valid BlockTube / Channel Blocker, Undo import), list page + welcome page.
// Run: OUT=<shoo>/.e2e-out/qa-r2 node tests/e2e/qa/qa-r2-import.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { launchLocked, save, sleep, OUT, ROOT } from "./qa-lib.mjs";
import { reporter, closeWelcome, setList, getList, until, finish, messagesFor } from "../harness.mjs";

const { check } = reporter("qa-r2-import");
const ctx = await launchLocked({ name: "qa-r2-import" });
const swErrors = [];
ctx.worker.on("console", (m) => ["error", "warning"].includes(m.type()) && swErrors.push(m.text().slice(0, 200)));
await closeWelcome(ctx);
await setList(ctx, null);
const SHOTS = join(OUT, "import");
mkdirSync(SHOTS, { recursive: true });
const msg = messagesFor("en");
const NOTHING = msg("importNothing");
const TOOBIG = msg("importTooBig");
const data = {};

const lp = await ctx.context.newPage();
await lp.goto(`chrome-extension://${ctx.extId}/list.html`);
await lp.waitForFunction(() => document.body.dataset.ready === "1");
const result = () => lp.evaluate(() => [...document.querySelectorAll("#result p, #result button")].map((n) => n.textContent));
const fileImport = async (file) => {
  await lp.evaluate(() => (document.getElementById("result").textContent = ""));
  await lp.setInputFiles("#importFile input[type=file]", file);
  return (await until(result, (r) => r.length > 0, 60000)).value;
};
const pasteImport = async (text) => {
  await lp.evaluate(() => (document.getElementById("result").textContent = ""));
  await lp.evaluate(() => (document.getElementById("many").open = true));
  await lp.evaluate((v) => {
    const a = document.querySelector("#manyBox textarea");
    a.value = v;
    a.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await lp.click("#manyBox button");
  return (await until(result, (r) => r.length > 0, 60000)).value;
};
const undoImport = async () => {
  if (!(await lp.$("#result .import-undo"))) return false;
  await lp.click("#result .import-undo");
  await sleep(700);
  return true;
};
const snap = async () => JSON.stringify(await getList(ctx));

// A non-empty starting list so "nothing added" is checked against real content.
const SEED = { v: 1, channels: [{ handle: "@keepme", name: "Keep Me", added: 5, source: "card" }], words: ["keepword"] };
await setList(ctx, SEED);
await sleep(400);
const base = await snap();

// ---------- 1. r1 FAILs ----------
const bad = async (label, run) => {
  const r = await run();
  const after = await snap();
  data[label] = { result: r, unchanged: after === base };
  check(`${label}: nothing added, says '${NOTHING.slice(0, 32)}…', no Undo`, after === base && r.length === 1 && r[0] === NOTHING, data[label]);
  if (after !== base) {
    await undoImport();
    await setList(ctx, SEED);
    await sleep(300);
  }
};
await bad("malformed JSON paste {\"filterData\": {\"channelId\": [", () => pasteImport('{"filterData": {"channelId": ['));
const bt = readFileSync(join(ROOT, "test/samples/blocktube_backup.json"), "utf8");
const pretty = JSON.stringify(JSON.parse(bt), null, 2);
for (const frac of [0.6, 0.2, 0.95]) {
  const tf = join(SHOTS, `blocktube_truncated_${Math.round(frac * 100)}.json`);
  writeFileSync(tf, pretty.slice(0, Math.floor(pretty.length * frac)));
  await bad(`truncated BlockTube file (${Math.round(frac * 100)}%)`, () => fileImport(tf));
}
const ctb = readFileSync(join(ROOT, "test/samples/ChannelBlocker-2026-11-15.save"), "utf8");
const tcb = join(SHOTS, "channelblocker_truncated.save");
writeFileSync(tcb, ctb.slice(0, Math.floor(ctb.length * 0.5)));
await bad("truncated Channel Blocker file (50%)", () => fileImport(tcb));
await bad("binary file (NUL + control bytes)", () => fileImport({ name: "garbage.json", mimeType: "application/json", buffer: Buffer.from("\u0000\u0001binaryÿ") }));
const png = readFileSync(join(ROOT, "icons", "icon-128.png"));
await bad("binary file (a real PNG named list.txt)", () => fileImport({ name: "list.txt", mimeType: "text/plain", buffer: png }));
const zipBuf = readFileSync(join(ROOT, "dist", "shoo-chrome-0.1.0.zip"));
await bad("binary file (a zip named backup.json)", () => fileImport({ name: "backup.json", mimeType: "application/json", buffer: zipBuf.subarray(0, 40000) }));

// too big
const big = Array.from({ length: 20001 }, (_, i) => `Channel Number ${i}`).join("\n");
let t0 = Date.now();
const rBig = await pasteImport(big);
data.big20001 = { result: rBig, ms: Date.now() - t0, unchanged: (await snap()) === base };
check("20,001-line paste: refused, says the list is too long (importTooBig)", data.big20001.unchanged && rBig.length === 1 && rBig[0] === TOOBIG, data.big20001);
const bigFile = join(SHOTS, "big-20001.txt");
writeFileSync(bigFile, big);
const rBigF = await fileImport(bigFile);
check("20,001-line file: refused with importTooBig", (await snap()) === base && rBigF[0] === TOOBIG, rBigF);
// BlockTube JSON with 15,000 channel ids + 6,000 titles = 21,000 entries
const btBig = { filterData: { channelId: Array.from({ length: 15000 }, (_, i) => `UC${String(i).padStart(22, "x")}`), title: Array.from({ length: 6000 }, (_, i) => `word${i}`) } };
const btBigFile = join(SHOTS, "blocktube-21000.json");
writeFileSync(btBigFile, JSON.stringify(btBig));
const rBt = await fileImport(btBigFile);
check("BlockTube file with 15,000 ids + 6,000 titles (21,000 entries): refused with importTooBig", (await snap()) === base && rBt[0] === TOOBIG, rBt);
// > 5,000,000 chars of text but < 20 MB: parser cap
const longLines = Array.from({ length: 9000 }, (_, i) => `Channel ${i} ${"x".repeat(600)}`).join("\n");
const longFile = join(SHOTS, "long-5.4M.txt");
writeFileSync(longFile, longLines);
t0 = Date.now();
const rLong = await fileImport(longFile);
check(`text file of ${(longLines.length / 1e6).toFixed(1)}M chars (9,000 lines, over the 5M-char cap): refused with importTooBig`, (await snap()) === base && rLong[0] === TOOBIG, { result: rLong, ms: Date.now() - t0 });
// > 20 MB file: refused in the page before reading
const hugeFile = join(SHOTS, "huge-21MB.txt");
writeFileSync(hugeFile, Buffer.alloc(21_000_000, 0x61));
t0 = Date.now();
const rHuge = await fileImport(hugeFile);
data.huge = { result: rHuge, ms: Date.now() - t0 };
check("21 MB file: refused with importTooBig without sending it to the worker", (await snap()) === base && rHuge[0] === TOOBIG, data.huge);
await lp.screenshot({ path: join(SHOTS, "list-toobig-en.png"), fullPage: true });
// exactly 20,000 into an empty list still works (boundary)
await setList(ctx, null);
await sleep(300);
const exactly = Array.from({ length: 20000 }, (_, i) => `Channel Number ${i}`).join("\n");
t0 = Date.now();
const rEx = await pasteImport(exactly);
const lEx = await getList(ctx);
data.exactly = { result: rEx, ms: Date.now() - t0, channels: lEx?.channels?.length };
check("20,000-line paste (the limit) is accepted", lEx?.channels?.length === 20000 && /Channels added: 20,?000/.test(rEx[0] || ""), data.exactly);
// list already at 20,000 + another 1,000: what happens?
const more = Array.from({ length: 1000 }, (_, i) => `Another Channel ${i}`).join("\n");
const rMore = await pasteImport(more);
const lMore = await getList(ctx);
const bytes = await ctx.worker.evaluate(() => chrome.storage.local.getBytesInUse("list"));
data.over = { result: rMore, channels: lMore?.channels?.length, bytes };
check("(exploratory) 20,000 already listed + paste 1,000 more: stored without errors", (lMore?.channels?.length || 0) >= 20000, data.over);
await undoImport();
await undoImport();
await setList(ctx, SEED);
await sleep(400);

// ---------- 2. regressions: lists that must still import ----------
const good = async (label, text, expect) => {
  const r = await pasteImport(text);
  const l = await getList(ctx);
  const names = l.channels.filter((c) => c.handle !== "@keepme").map((c) => c.name || c.handle || c.id);
  const words = l.words.filter((w) => w !== "keepword");
  data[label] = { result: r, names, words };
  check(`${label}: imports as names`, JSON.stringify(names) === JSON.stringify(expect), data[label]);
  const undone = await undoImport();
  check(`${label}: Undo import restores the list byte for byte`, undone && (await snap()) === base, { undone });
};
await good("plain list whose first line starts '[Word'", "[Official] Some Channel\nOther Channel\n@handle_here", ["[Official] Some Channel", "Other Channel", "@handle_here"]);
await good("plain list whose first line starts '{Word'", "{Studio} Channel\nPlain Name", ["{Studio} Channel", "Plain Name"]);
await good("plain list with '[Word' and '{Word' lines in the middle", "Alpha Channel\n[Live] Beta\n{Gamma}\nDelta", ["Alpha Channel", "[Live] Beta", "{Gamma}", "Delta"]);
await good("plain list starting '[ Word' (space after bracket)", "[ Remix ] Channel\nNext One", ["[ Remix ] Channel", "Next One"]);

// edge single-line names that happen to be valid JSON or look like it (exploratory: report, judge as SUGGESTION)
const edge = {};
for (const text of ["1984", "\"Veritasium\"", "null", "[2024] Best Of Channel\nSecond", "[1] Channel One\n[2] Channel Two", "-1 Channel", "{}"]) {
  const r = await pasteImport(text);
  const l = await getList(ctx);
  edge[text] = { result: r[0], added: l.channels.length - 1 };
  await undoImport();
  if ((await snap()) !== base) {
    await setList(ctx, SEED);
    await sleep(300);
  }
}
data.edgeNames = edge;
console.log("edge names", JSON.stringify(edge));

// valid files still import, Undo import byte for byte
const goodFile = async (label, path, re) => {
  const r = await fileImport(path);
  const l = await getList(ctx);
  data[label] = { result: r, channels: l.channels.length - 1, words: l.words.length - 1 };
  check(`${label}: imports`, re.test(r[0] || "") && l.channels.length > 1, data[label]);
  const undone = await undoImport();
  check(`${label}: Undo import restores the list byte for byte`, undone && (await snap()) === base, { undone });
};
await goodFile("BlockTube backup (file)", join(ROOT, "test/samples/blocktube_backup.json"), /Channels added: [1-9]/);
const ptf = join(SHOTS, "blocktube_pretty.json");
writeFileSync(ptf, pretty);
await goodFile("BlockTube backup, pretty-printed (file)", ptf, /Channels added: [1-9]/);
await goodFile("Channel Blocker 1.0 (file)", join(ROOT, "test/samples/ChannelBlocker-2026-11-15.save"), /Channels added: [1-9]/);
await goodFile("Channel Blocker old format (file)", join(ROOT, "test/samples/channelblocker-old.save"), /Channels added: [1-9]/);
await goodFile("plain.txt sample (file)", join(ROOT, "test/samples/plain.txt"), /Channels added: [1-9]/);
const bomFile = join(SHOTS, "blocktube_bom.json");
writeFileSync(bomFile, "﻿" + bt);
await goodFile("BlockTube backup with a BOM (file)", bomFile, /Channels added: [1-9]/);
const crlf = join(SHOTS, "plain_crlf.txt");
writeFileSync(crlf, "Name One\r\n@handle_two\r\n[Tag] Three\r\n");
await goodFile("plain list with CRLF and a '[Tag]' line (file)", crlf, /Channels added: 3/);
// Shoo's own export round trip
await setList(ctx, { v: 1, channels: [SEED.channels[0], { handle: "@other", name: "Other", added: 6, source: "card" }, { id: "UCabcdefghijklmnopqrstuv", added: 7, source: "import" }], words: ["keepword", "second"] });
await sleep(300);
const exported = await lp.evaluate(() => {
  const s = globalThis.ShooLib;
  return s.exportList ? JSON.stringify(s.exportList(null)) : null;
});
data.exportFn = exported ? "ShooLib.exportList present" : "no exportList in ShooLib (skipped round-trip via lib)";

// ---------- welcome page import box: too big + malformed ----------
const wp = await ctx.context.newPage();
await wp.setViewportSize({ width: 420, height: 900 });
await wp.goto(`chrome-extension://${ctx.extId}/welcome.html`);
await sleep(800);
const wPaste = async (text) => {
  await wp.evaluate(() => (document.getElementById("result").textContent = ""));
  await wp.evaluate((v) => {
    const a = document.getElementById("paste");
    a.value = v;
    a.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await wp.click("#box .paste > button");
  return (await until(() => wp.evaluate(() => [...document.querySelectorAll("#result p")].map((n) => n.textContent)), (r) => r.length > 0, 60000)).value;
};
await setList(ctx, SEED);
await sleep(300);
const wb = await wPaste(big);
const wm = await wPaste('{"filterData": {"channelId": [');
const overflow = await wp.evaluate(() => document.documentElement.scrollWidth > innerWidth);
await wp.screenshot({ path: join(SHOTS, "welcome-420-en.png"), fullPage: true });
check("welcome 420 px: 20,001-line paste → importTooBig; malformed JSON → importNothing; nothing added; no overflow", wb[0] === TOOBIG && wm[0] === NOTHING && (await snap()) === base && !overflow, { wb, wm, overflow });
await wp.close();

save("r2-import", { data, swErrors });
check("no service-worker errors/warnings", swErrors.length === 0, swErrors.slice(0, 5));
await finish(ctx, check);
