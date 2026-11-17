import { readFileSync } from "node:fs";
import { launch, reporter, closeWelcome, setList, getList, until, sleep, finish } from "./harness.mjs";

const { check } = reporter("list-page");
const ctx = await launch({ name: "list-page", colorScheme: "light" });
await closeWelcome(ctx);

const big = (n, w) => ({
  v: 1,
  channels: Array.from({ length: n }, (_, i) => ({ ...(i % 2 ? { handle: `@SomeLongChannelHandle${i}` } : {}), ...(i % 3 === 0 ? { id: "UC" + String(i).padStart(22, "x") } : {}), ...(i % 7 === 6 && (i % 2 || i % 3 === 0) ? {} : { name: `Some Channel Name ${i} – Official` }), added: 1763200000000 + i, source: i % 3 ? "card" : "import" })),
  words: Array.from({ length: w }, (_, i) => `keyword number ${i}`),
});

const timing = await ctx.worker.evaluate(async (lists) => {
  const out = {};
  for (const [label, list] of Object.entries(lists)) {
    await chrome.storage.local.remove("list");
    let t0 = performance.now();
    await chrome.storage.local.set({ list });
    const setMs = performance.now() - t0;
    t0 = performance.now();
    const { list: back } = await chrome.storage.local.get("list");
    const getMs = performance.now() - t0;
    out[label] = { setMs: +setMs.toFixed(1), getMs: +getMs.toFixed(1), bytesInUse: await chrome.storage.local.getBytesInUse("list"), same: JSON.stringify(back).length === JSON.stringify(list).length };
  }
  return out;
}, { big: big(5000, 500), small: big(500, 50) });
check("5,000 channels + 500 words save and load under 50 ms each, under 1 MB", timing.big.setMs < 50 && timing.big.getMs < 50 && timing.big.bytesInUse < 1048576 && timing.big.same, timing.big);
check("500 channels + 50 words are at most 100 KB in storage", timing.small.bytesInUse <= 102400, timing.small);

await setList(ctx, big(5000, 500));
const page = await ctx.context.newPage();
await page.goto(`chrome-extension://${ctx.extId}/list.html`);
await page.waitForFunction(() => document.body.dataset.ready === "1");
const load = await page.evaluate(() => ({ getMs: Number(document.body.dataset.getMs), loadMs: Number(document.body.dataset.loadMs), rows: document.querySelectorAll("#channels .row").length, words: document.querySelectorAll("#words .row").length, first: document.querySelector("#channels .row .name")?.textContent }));
check("list page with 5,000 + 500: storage read under 50 ms, every row rendered, newest first", load.getMs < 50 && load.rows === 5000 && load.words === 500 && load.first === "Some Channel Name 4999 – Official", load);
check("list page full render time (reported, no threshold in the spec)", true, `${load.loadMs} ms`);

await setList(ctx, { v: 1, channels: [{ handle: "@AAA", name: "Alpha Channel", added: 3, source: "card" }, { id: "UCabcdefghijklmnopqrstuv", added: 2, source: "import" }, { name: "Gamma Name", added: 1, source: "sidebar" }], words: ["alpha", "beta"] });
await until(() => page.evaluate(() => document.querySelectorAll("#channels .row").length), (n) => n === 3, 3000);
const rows = await page.evaluate(() => [...document.querySelectorAll("#channels .row")].map((r) => ({ name: r.querySelector(".name")?.textContent, link: r.querySelector("a")?.getAttribute("href") || null, button: r.querySelector("button")?.textContent })));
check("rows: name, @handle or id linking to the channel, Unhide; ID-only row says the name comes later", rows[0].name === "Alpha Channel" && rows[0].link === "https://www.youtube.com/@AAA" && rows[1].name === ctx.msg("listIdOnlyRow") && rows[1].link === "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv" && rows[2].link === null && rows[0].button === ctx.msg("unhideChannel"), rows);

await page.fill("#filter", "gamma");
const filtered = await page.evaluate(() => ({ ch: document.querySelectorAll("#channels .row").length, w: document.querySelectorAll("#words .row").length }));
await page.fill("#filter", "@aa");
const byHandle = await page.evaluate(() => document.querySelectorAll("#channels .row").length);
await page.fill("#filter", "UCabc");
const byId = await page.evaluate(() => document.querySelectorAll("#channels .row").length);
await page.fill("#filter", "");
check("filter-as-you-type over names, handles, ids, words", filtered.ch === 1 && filtered.w === 0 && byHandle === 1 && byId === 1, { filtered, byHandle, byId });

await page.click('#channels .row[data-key="h:aaa"] button');
const removed = await until(() => page.evaluate(() => document.querySelector("#channels .removed")?.textContent || null), Boolean, 3000);
const l1 = await getList(ctx);
check("Unhide leaves 'Removed: <name> · Undo' in its place", removed.value === ctx.msg("listRemoved", "Alpha Channel") + ctx.msg("undo") && l1.channels.length === 2 && (await page.evaluate(() => document.querySelector("#channels .row").classList.contains("removed"))), { removed: removed.value, left: l1.channels.length });
await page.click("#channels .removed button");
const l2 = await until(() => getList(ctx), (l) => l.channels.length === 3, 3000);
check("Undo puts the channel back at its old place", l2.ok && l2.value.channels[0].handle === "@AAA", l2.value.channels.map((c) => c.handle || c.id || c.name));

await page.fill('#words .row[data-word="beta"] input', "betas");
await page.press('#words .row[data-word="beta"] input', "Tab");
const l3 = await until(() => getList(ctx), (l) => l.words.includes("betas"), 3000);
check("words edit in place", l3.ok, l3.value.words);
await page.click('#words .row[data-word="alpha"] button');
const wr = await until(() => page.evaluate(() => document.querySelector("#words .removed")?.textContent || null), Boolean, 3000);
check("removing a word leaves 'Removed: <word> · Undo'", wr.value === ctx.msg("listRemoved", "alpha") + ctx.msg("undo"), wr.value);
await page.click("#words .removed button");
const l4 = await until(() => getList(ctx), (l) => l.words[0] === "alpha", 3000);
check("Undo puts the word back", l4.ok, l4.value.words);
const emptyAdd = await page.evaluate(() => document.getElementById("addWordButton").disabled);
await page.fill("#addWord", "  ");
const blankAdd = await page.evaluate(() => document.getElementById("addWordButton").disabled);
await page.fill("#addWord", "x");
const typedAdd = await page.evaluate(() => document.getElementById("addWordButton").disabled);
check("the word 'Add' is disabled while the field is empty or blank and enabled once something is typed", emptyAdd && blankAdd && !typedAdd, { emptyAdd, blankAdd, typedAdd });
await page.fill("#addWord", "Gamma ray");
await page.press("#addWord", "Enter");
const l5 = await until(() => getList(ctx), (l) => l.words.includes("Gamma ray"), 3000);
check("add a word", l5.ok, l5.value.words);
const addButton = await page.evaluate(() => {
  const b = document.querySelector("#addWordForm button");
  return b ? { text: b.textContent, visible: b.checkVisibility(), type: b.type } : null;
});
await page.fill("#addWord", "Delta wave");
if (addButton) await page.click("#addWordForm button");
const l5b = await until(() => getList(ctx), (l) => l.words.includes("Delta wave"), 3000);
check("a visible 'Add' button next to the word field adds the word", addButton?.text === ctx.msg("importAdd") && addButton.visible && l5b.ok && (await page.inputValue("#addWord")) === "", { addButton, words: l5b.value?.words });
const afterAdd = await page.evaluate(() => ({ focus: document.activeElement?.id || document.activeElement?.tagName, disabled: document.getElementById("addWordButton").disabled }));
check("after adding with the button, focus is back in the word field and 'Add' is disabled again", afterAdd.focus === "addWord" && afterAdd.disabled, afterAdd);

const listNow = await getList(ctx);
const [download] = await Promise.all([page.waitForEvent("download"), page.click("#export")]);
const file = readFileSync(await download.path(), "utf8");
const exported = JSON.parse(file);
check("Export writes one JSON file in the Shoo format", exported.format === "shoo-list" && exported.version === 1 && exported.channels.length === 3 && /^shoo-list-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()), { name: download.suggestedFilename(), format: exported.format });
await setList(ctx, null);
await page.setInputFiles("#importFile input[type=file]", { name: "back.json", mimeType: "application/json", buffer: Buffer.from(file) });
const round = await until(() => getList(ctx), (l) => l?.channels?.length === 3, 3000);
const norm = (l) => JSON.stringify({ channels: l.channels.map((c) => Object.fromEntries(Object.entries(c).sort())), words: l.words });
check("re-importing the export gives the same list", round.ok && norm(round.value) === norm(listNow), { same: round.ok && norm(round.value) === norm(listNow) });

await page.click("#many summary");
const manyEmpty = await page.evaluate(() => document.querySelector("#manyBox .paste > button").disabled);
await page.fill("#manyBox textarea", "x");
const manyTyped = await page.evaluate(() => document.querySelector("#manyBox .paste > button").disabled);
check("'Paste a list' Add is disabled while the box is empty", manyEmpty && !manyTyped, { manyEmpty, manyTyped });
await page.fill("#manyBox textarea", "https://www.youtube.com/@DeltaChan\nEpsilon Name");
await page.click("#manyBox button");
const l6 = await until(() => getList(ctx), (l) => l.channels.length === 5, 3000);
check("'Add many (paste)' uses the same parser", l6.ok && l6.value.channels.some((c) => c.handle === "@DeltaChan") && l6.value.channels.some((c) => c.name === "Epsilon Name"), l6.value.channels.slice(-2));

const resultText = () => page.evaluate(() => document.getElementById("result").textContent.trim());
const settle = async (prev) => (await until(resultText, (t) => t && t !== prev, 5000)).value;
const before7 = JSON.stringify(await getList(ctx));
let shown = await resultText();
const pasteMany = async (text) => {
  await page.evaluate(() => (document.getElementById("many").open = true));
  await page.evaluate((v) => {
    const a = document.querySelector("#manyBox textarea");
    a.value = v;
    a.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await page.click("#manyBox button");
};
await pasteMany(Array.from({ length: 20_001 }, (_, i) => `Channel Number ${i}`).join("\n"));
shown = (await until(resultText, (t) => t && t !== shown, 30000)).value;
check("20,001 pasted lines: nothing added, the line says the list is too long", shown === ctx.msg("importTooBig") && JSON.stringify(await getList(ctx)) === before7, { shown });
await page.evaluate(() => (document.getElementById("result").textContent = ""));
await page.setInputFiles("#importFile input[type=file]", { name: "huge.txt", mimeType: "text/plain", buffer: Buffer.alloc(20_000_001, "a") });
shown = await settle("");
check("a file over the size cap: nothing added, the line says the list is too long", shown === ctx.msg("importTooBig") && JSON.stringify(await getList(ctx)) === before7, { shown });
const bt = JSON.stringify(JSON.parse(readFileSync(new URL("../../test/samples/blocktube_backup.json", import.meta.url), "utf8")), null, 2);
const broken = [
  ["malformed JSON paste", () => pasteMany('{"filterData": {"channelId": [')],
  ["truncated BlockTube backup file", () => page.setInputFiles("#importFile input[type=file]", { name: "blocktube.json", mimeType: "application/json", buffer: Buffer.from(bt.slice(0, Math.floor(bt.length * 0.6))) })],
  ["binary file", () => page.setInputFiles("#importFile input[type=file]", { name: "pic.json", mimeType: "application/json", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0xff, 0xfe, 0x01]) })],
];
for (const [label, act] of broken) {
  await page.evaluate(() => (document.getElementById("result").textContent = ""));
  await act();
  shown = await settle("");
  check(`${label}: nothing added, 'nothing found' line`, shown === ctx.msg("importNothing") && JSON.stringify(await getList(ctx)) === before7, { shown, list: JSON.stringify(await getList(ctx)) === before7 ? "unchanged" : (await getList(ctx)).channels.slice(-3) });
  if (await page.$("#result .import-undo")) await page.click("#result .import-undo");
  await until(async () => JSON.stringify(await getList(ctx)), (j) => j === before7, 3000);
}

await setList(ctx, null);
const empty = await until(() => page.evaluate(() => !document.getElementById("empty").hidden && document.getElementById("empty").textContent), Boolean, 3000);
check("empty list shows the empty line", empty.value === ctx.msg("listEmpty"), empty.value);
const help = await page.evaluate(() => [...document.querySelectorAll("p")].some((p) => p.dataset.i18n === "listMisses" && p.textContent.length > 10));
check("help line on the known misses", help);
await finish(ctx, check);
