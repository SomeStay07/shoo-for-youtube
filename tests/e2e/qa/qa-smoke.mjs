// Smoke gaps not in the gate: list-page imports (BlockTube, Channel Blocker, paste, malformed, truncated, 20,001),
// Undo import, word add/edit/remove, popup states ("!" with report inside the box, revealed / hide again, reload hint),
// health badge on healthy live pages.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { launchLocked, botWall, ownUi, save, sleep, consent, OUT, ROOT } from "./qa-lib.mjs";
import { reporter, closeWelcome, setList, getList, until, finish, openRealPopup, goSearch } from "../harness.mjs";

const { check } = reporter("qa-smoke");
const ctx = await launchLocked({ name: "qa-smoke" });
const swErrors = [];
ctx.worker.on("console", (m) => ["error", "warning"].includes(m.type()) && swErrors.push(m.text().slice(0, 200)));
await closeWelcome(ctx);
await setList(ctx, null);
const SHOTS = join(OUT, "smoke");
mkdirSync(SHOTS, { recursive: true });
const data = {};

// ---------- list page imports ----------
const lp = await ctx.context.newPage();
await lp.goto(`chrome-extension://${ctx.extId}/list.html`);
await lp.waitForFunction(() => document.body.dataset.ready === "1");
const result = () => lp.evaluate(() => [...document.querySelectorAll("#result p, #result button")].map((n) => n.textContent));
const fileImport = async (path, name) => {
  await lp.evaluate(() => (document.getElementById("result").textContent = ""));
  await lp.setInputFiles("#importFile input[type=file]", path ? path : name);
  return (await until(result, (r) => r.length > 0, 5000)).value;
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
  return (await until(result, (r) => r.length > 0, 30000)).value;
};
const undoImport = async () => {
  await lp.click("#result .import-undo");
  await sleep(600);
};

const r1 = await fileImport(join(ROOT, "test/samples/blocktube_backup.json"));
const l1 = await getList(ctx);
data.blocktube = { result: r1, channels: l1?.channels?.length, words: l1?.words?.length };
check("import BlockTube backup (file) adds channels and words and says what was skipped", /Channels added: [1-9]/.test(r1[0] || "") && r1.some((x) => /Skipped/i.test(x)) && l1.channels.length > 0, data.blocktube);
await undoImport();
const l1u = await getList(ctx);
check("Undo import after BlockTube: list back to empty (key removed)", l1u === null, l1u);

await setList(ctx, { v: 1, channels: [{ handle: "@keepme", name: "Keep Me", added: 5, source: "card" }], words: ["keepword"] });
await sleep(400);
const before = JSON.stringify(await getList(ctx));
const r2 = await fileImport(join(ROOT, "test/samples/ChannelBlocker-2026-11-15.save"));
const l2 = await getList(ctx);
data.channelblocker = { result: r2, channels: l2.channels.map((c) => c.name || c.handle), words: l2.words };
check("import Channel Blocker 1.0 (file) merges into an existing list", /Channels added: [1-9]/.test(r2[0] || "") && l2.channels.some((c) => c.handle === "@keepme"), data.channelblocker);
await undoImport();
const after2 = JSON.stringify(await getList(ctx));
check("Undo import restores the previous list byte for byte", after2 === before, { before, after2 });

const r3 = await fileImport(join(ROOT, "test/samples/channelblocker-old.save"));
check("import Channel Blocker old format (file)", /Channels added: [1-9]/.test(r3[0] || ""), r3);
await undoImport();

const r4 = await pasteImport("@SlopFarmTV\nhttps://www.youtube.com/@AICatsDaily/videos\nUCabcdefghijklmnopqrstuv\n# comment\nSome Name Only");
const l4 = await getList(ctx);
data.paste = { result: r4, channels: l4.channels.map((c) => c.name || c.handle || c.id) };
check("paste plain lines (handle, URL, UC id, name, # comment ignored)", /Channels added: 4/.test(r4[0] || "") && r4.some((x) => /ID/.test(x)), data.paste);
await undoImport();

const beforeBad = JSON.stringify(await getList(ctx));
const r5 = await pasteImport('{"filterData": {"channelId": [');
const l5 = await getList(ctx);
data.malformedJson = { result: r5, list: l5 };
check("malformed JSON paste ('{\"filterData\": {\"channelId\": [') adds nothing", JSON.stringify(l5) === beforeBad, data.malformedJson);
if (JSON.stringify(l5) !== beforeBad && (await lp.$("#result .import-undo"))) await undoImport();

const bt = readFileSync(join(ROOT, "test/samples/blocktube_backup.json"), "utf8");
const pretty = JSON.stringify(JSON.parse(bt), null, 2);
const truncated = pretty.slice(0, Math.floor(pretty.length * 0.6));
const tf = join(SHOTS, "blocktube_truncated.json");
writeFileSync(tf, truncated);
const beforeTr = JSON.stringify(await getList(ctx));
const r6 = await fileImport(tf);
const l6 = await getList(ctx);
const junk = (l6?.channels || []).filter((c) => /[{}\[\]":]/.test(c.name || ""));
data.truncated = { result: r6, added: (l6?.channels?.length || 0) - (JSON.parse(beforeTr)?.channels?.length || 0), junk: junk.slice(0, 6).map((c) => c.name) };
check("truncated (corrupt) BlockTube backup file: no JSON fragments imported as channel names", junk.length === 0, data.truncated);
if (await lp.$("#result .import-undo")) await undoImport();
const afterTrUndo = JSON.stringify(await getList(ctx));
check("Undo after the truncated-file import restores the list", afterTrUndo === beforeTr, { equal: afterTrUndo === beforeTr });

const r7 = await fileImport({ name: "garbage.json", mimeType: "application/json", buffer: Buffer.from("\u0000\u0001binaryÿ") });
check("binary / garbage file: nothing found message, nothing added", r7.length === 1 && JSON.stringify(await getList(ctx)) === afterTrUndo, r7);
if (await lp.$("#result .import-undo")) await undoImport();

const big = Array.from({ length: 20001 }, (_, i) => `Channel Number ${i}`).join("\n");
const t0 = Date.now();
const r8 = await pasteImport(big);
const ms8 = Date.now() - t0;
const l8 = await getList(ctx);
data.big = { result: r8, ms: ms8, channelsAfter: l8?.channels?.length };
check("20,001-line paste is refused (nothing added)", (l8?.channels?.length || 0) === (JSON.parse(afterTrUndo)?.channels?.length || 0), data.big);
check("20,001-line refusal says why (too many entries), not 'No channels or words found'", r8.length > 0 && !/No channels or words found/.test(r8[0]), r8);
const exactly = Array.from({ length: 20000 }, (_, i) => `Channel Number ${i}`).join("\n");
await setList(ctx, null);
await sleep(300);
const t1 = Date.now();
const r9 = await pasteImport(exactly);
const ms9 = Date.now() - t1;
const l9 = await getList(ctx);
const bytes9 = await ctx.worker.evaluate(() => chrome.storage.local.getBytesInUse("list"));
data.max = { result: r9, ms: ms9, channels: l9?.channels?.length, bytes: bytes9 };
check("20,000-line paste is accepted and stored", l9?.channels?.length === 20000, data.max);
const rows9 = await lp.evaluate(() => document.querySelectorAll("#channels .row").length);
check("list page renders 20,000 rows after the import", rows9 === 20000, { rows9 });
await undoImport();
const l9u = await getList(ctx);
check("Undo import of 20,000 restores empty", l9u === null, { left: l9u?.channels?.length });

// ---------- words on the list page ----------
await setList(ctx, null);
await sleep(300);
await lp.fill("#addWord", "Alpha");
await lp.click("#addWordButton");
await until(() => getList(ctx), (l) => l?.words?.includes("Alpha"), 3000);
const focusAfterAdd = await lp.evaluate(() => document.activeElement?.id);
await lp.fill("#addWord", "alpha");
await lp.press("#addWord", "Enter");
await sleep(600);
const lw = await getList(ctx);
check("word add: stored; focus back in the field; the same word twice (other case) is not duplicated", lw.words.length === 1 && focusAfterAdd === "addWord", { words: lw.words, focusAfterAdd });
const addDisabled = await lp.evaluate(() => document.getElementById("addWordButton").disabled);
check("empty word field: Add is disabled", addDisabled, { addDisabled });
const wi = lp.locator("#words .row.word input").first();
await wi.fill("beta");
await wi.press("Enter");
await sleep(600);
const le = await getList(ctx);
check("word edit in place saves", JSON.stringify(le.words) === '["beta"]', le.words);
await lp.click("#words .row.word button");
const rm = await until(() => lp.evaluate(() => document.querySelector("#words .removed")?.textContent || null), Boolean, 3000);
check("word remove leaves 'Removed: … · Undo'", rm.ok && (await getList(ctx)).words.length === 0, rm.value);
await lp.click("#words .removed button");
const lr = await until(() => getList(ctx), (l) => l?.words?.length === 1, 3000);
check("word Undo puts it back", lr.ok, lr.value?.words);
await lp.screenshot({ path: join(SHOTS, "list-words.png"), fullPage: true });
await lp.close();

// ---------- live search: badge, popup states ----------
await setList(ctx, { v: 1, channels: [{ handle: "@veritasium", name: "Veritasium", added: 1, source: "card" }, { handle: "@kurzgesagt", name: "Kurzgesagt – In a Nutshell", added: 2, source: "card" }], words: [] });
const page = ctx.context.pages().find((p) => !p.url().startsWith("chrome-extension://")) || (await ctx.context.newPage());
await goSearch(page, "veritasium black holes");
if (await botWall(page)) check("live search (bot wall)", null, "bot page");
await sleep(14000);
const tabId = await ctx.worker.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t?.id));
const badge = await ctx.worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
const ui0 = await ownUi(page);
check("healthy live search with listed channels hidden: no '!' badge after 14 s", badge === "" && ui0.hidden > 0, { badge, hidden: ui0.hidden });

let pop = await openRealPopup(ctx, page);
const p0 = await pop.eval(() => ({ status: document.getElementById("status").textContent, counts: document.getElementById("counts").textContent, show: document.getElementById("showHidden")?.textContent || null, report: !document.getElementById("report").hidden, health: !document.getElementById("health").hidden }));
check("popup on a healthy search tab: status, counts, 'Show hidden on this page (K)', footer 'Report a problem' visible, no health box", p0.show && /\(\d+\)/.test(p0.show) && p0.report && !p0.health, p0);
await pop.eval(() => document.getElementById("showHidden").click());
await sleep(800);
const revealed = await page.evaluate(() => ({ attr: document.documentElement.hasAttribute("data-shoo-reveal"), reasons: document.querySelectorAll(".shoo-reason").length }));
pop = await openRealPopup(ctx, page);
const p1 = await pop.eval(() => ({ revealed: document.getElementById("revealed")?.textContent || null, again: document.getElementById("hideAgain")?.textContent || null, show: document.getElementById("showHidden") ? 1 : 0 }));
check("after Show hidden: page revealed with reasons; popup says hidden videos are shown + 'Hide them again'", revealed.attr && revealed.reasons > 0 && p1.revealed === ctx.msg("popupRevealed") && p1.again === ctx.msg("popupHideAgain") && !p1.show, { revealed, p1 });
await pop.eval(() => document.getElementById("hideAgain").click());
await sleep(800);
const hiddenAgain = await page.evaluate(() => ({ attr: document.documentElement.hasAttribute("data-shoo-reveal"), reasons: document.querySelectorAll(".shoo-reason").length, hidden: [...document.querySelectorAll("[data-shoo-hide]")].filter((b) => b.checkVisibility()).length }));
check("'Hide them again' hides them again (no reveal attr, no reason lines, nothing hidden visible)", !hiddenAgain.attr && hiddenAgain.reasons === 0 && hiddenAgain.hidden === 0, hiddenAgain);
await page.screenshot({ path: join(SHOTS, "search-hidden-again.png") });

// "!" state seeded for the active tab
await ctx.worker.evaluate((id) => chrome.storage.session.set({ health: { [id]: { page: "search", missing: ["search"], ts: Date.now() } } }), tabId);
pop = await openRealPopup(ctx, page);
const p2 = await pop.eval(() => {
  const h = document.getElementById("health");
  const inBox = h.querySelector("#reportHere");
  return { health: !h.hidden, text: h.querySelector("p")?.textContent, reportInBox: Boolean(inBox), reportHref: inBox?.href?.slice(0, 60) || null, footerHidden: document.getElementById("report").hidden, reportLinks: [...document.querySelectorAll("a")].filter((a) => a.checkVisibility() && /forms/.test(a.href)).length };
});
await pop.screenshot(join(SHOTS, "popup-broken.png"));
check("popup with '!': box names the surface, 'Report a problem' inside the box, footer link hidden, one report link", p2.health && /search results/.test(p2.text || "") && p2.reportInBox && p2.footerHidden && p2.reportLinks === 1, p2);
await ctx.worker.evaluate(() => chrome.storage.session.set({ health: {} }));

// reload hint: tab whose content script is gone (extension reloaded = same as a tab opened before install)
const oldWorker = ctx.worker;
await oldWorker.evaluate(() => chrome.runtime.reload()).catch(() => {});
await until(() => ctx.worker !== oldWorker, Boolean, 10000);
await sleep(2500);
for (const p of ctx.context.pages()) if (p.url().includes("welcome.html")) await p.close();
pop = await openRealPopup(ctx, page);
const p3 = await pop.eval(() => ({ reload: document.getElementById("reload")?.textContent || null, status: document.getElementById("status").textContent, show: document.getElementById("showHidden") ? 1 : 0 }));
await pop.screenshot(join(SHOTS, "popup-reload.png"));
check("popup on a YouTube tab with no live Shoo script (opened before install / after update): 'Reload this tab so Shoo works here'", p3.reload === ctx.msg("reloadTab") && !p3.show, p3);
const welcomeAgain = ctx.context.pages().filter((p) => p.url().includes("welcome.html")).length;
check("extension reload (update) does not open the welcome page again", welcomeAgain === 0, { welcomeAgain });
await page.reload({ waitUntil: "domcontentloaded" });
await sleep(6000);
pop = await openRealPopup(ctx, page);
const p4 = await pop.eval(() => ({ reload: document.getElementById("reload") ? 1 : 0, show: document.getElementById("showHidden")?.textContent || null }));
check("after reloading the tab the popup works again", !p4.reload && Boolean(p4.show), p4);
await pop.close();

save("smoke", { data, swErrors });
check("no service-worker errors/warnings", swErrors.length === 0, swErrors.slice(0, 5));
await finish(ctx, check);
