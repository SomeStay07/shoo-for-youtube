import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, reporter, closeWelcome, setList, getList, until, sleep, finish, OUT } from "./harness.mjs";

const { check } = reporter("import-ui");
const ctx = await launch({ name: "import-ui", colorScheme: "light" });
await closeWelcome(ctx);
const SEED = { v: 1, channels: [{ handle: "@keepme", name: "Keep Me", added: 5, source: "card" }], words: ["keepword"] };
await setList(ctx, SEED);
const base = JSON.stringify(await getList(ctx));
const lp = await ctx.context.newPage();
await lp.goto(`chrome-extension://${ctx.extId}/list.html`);
await lp.waitForFunction(() => document.body.dataset.ready === "1");
const result = () => lp.evaluate(() => [...document.querySelectorAll("#result p")].map((n) => n.textContent));
const clearResult = () => lp.evaluate(() => (document.getElementById("result").textContent = ""));
const box = () => lp.evaluate(() => document.querySelector("#manyBox textarea").value);
await lp.evaluate(() => (document.getElementById("many").open = true));

async function pasteAdd(text) {
  await clearResult();
  await lp.evaluate((v) => {
    const a = document.querySelector("#manyBox textarea");
    a.value = v;
    a.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await lp.click("#manyBox button");
  return (await until(result, (r) => r.length > 0, 30000)).value;
}
async function pasteEvent(text) {
  await clearResult();
  await lp.evaluate(() => (document.querySelector("#manyBox textarea").value = ""));
  await lp.focus("#manyBox textarea");
  await lp.evaluate((v) => {
    const a = document.querySelector("#manyBox textarea");
    a.value = v;
    a.dispatchEvent(new Event("paste", { bubbles: true }));
  }, text);
  return (await until(result, (r) => r.length > 0, 30000)).value;
}
async function file(path) {
  await clearResult();
  await lp.setInputFiles("#importFile input[type=file]", path);
  return (await until(result, (r) => r.length > 0, 60000)).value;
}

const big = Array.from({ length: 20001 }, (_, i) => `Channel Number ${i}`).join("\n");
const r1 = await pasteAdd(big);
const kept1 = await box();
check("paste box keeps the text after 'too long' (Add button)", r1[0] === ctx.msg("importTooBig") && kept1 === big && JSON.stringify(await getList(ctx)) === base, { result: r1, keptChars: kept1.length });
const junk = '{"filterData": {"channelId": [';
const r2 = await pasteAdd(junk);
const kept2 = await box();
check("paste box keeps the text after 'nothing found' (Add button)", r2[0] === ctx.msg("importNothing") && kept2 === junk, { result: r2, kept: kept2 });
const r3 = await pasteEvent(junk);
const kept3 = await box();
check("paste box keeps the text after 'nothing found' (paste)", r3[0] === ctx.msg("importNothing") && kept3 === junk, { result: r3, kept: kept3 });
const r4 = await pasteAdd("@okchannel\nAnother Name");
const kept4 = await box();
check("a paste that imports something still clears the box", /: 2\b/.test(r4[0] || "") && kept4 === "", { result: r4, kept: kept4 });
await lp.click("#result .import-undo");
await until(() => getList(ctx), (l) => JSON.stringify(l) === base, 3000);

const many = Array.from({ length: 20000 }, (_, i) => `Bulk Channel ${i}`).join("\n");
const r5 = await pasteAdd(many);
const want = ctx.msg("importResult", new Intl.NumberFormat("en-US").format(20000), "0");
check("numbers in the import result are formatted for the UI language (20,000)", r5[0] === want, { got: r5[0], want });
if (await lp.$("#result .import-undo")) await lp.click("#result .import-undo");
await until(() => getList(ctx), (l) => JSON.stringify(l) === base, 5000);

const zip = join(OUT, "import-ui-big.zip");
const buf = Buffer.alloc(21_000_000);
for (let i = 0; i < buf.length; i++) buf[i] = (i * 131 + 7) % 256;
writeFileSync(zip, buf);
const r6 = await file(zip);
check("a file over the size cap that isn't text (zip/video) says 'nothing found', not 'too long'", r6[0] === ctx.msg("importNothing") && JSON.stringify(await getList(ctx)) === base, r6);
const txt = join(OUT, "import-ui-big.txt");
writeFileSync(txt, Buffer.alloc(21_000_000, 0x61));
const r7 = await file(txt);
check("a text file over the size cap still says 'too long'", r7[0] === ctx.msg("importTooBig") && JSON.stringify(await getList(ctx)) === base, r7);
await setList(ctx, null);
await finish(ctx, check);
