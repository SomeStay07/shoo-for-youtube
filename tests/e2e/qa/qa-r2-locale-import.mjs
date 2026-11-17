// QA r2: import result lines (importTooBig, importNothing) in ru and de on the list page (1280 / 420) and the welcome page (420).
// One locale at a time under Errand's AppleLanguages lock (held for the whole locale run).
// Run: OUT=<shoo>/.e2e-out/qa-r2 LOCALES=ru,de node tests/e2e/qa/qa-r2-locale-import.mjs
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { launchLocked, resetLang, save, sleep, OUT } from "./qa-lib.mjs";
import { reporter, closeWelcome, setList, getList, until, finish, messagesFor } from "../harness.mjs";

const { check } = reporter("qa-r2-locale-import");
const SHOTS = join(OUT, "locale-import");
mkdirSync(SHOTS, { recursive: true });
const LOCALES = (process.env.LOCALES || "ru,de").split(",");
const APPLE = { ru: "ru", de: "de", es: "es", pt_BR: "pt-BR", en: "en-US" };
const big = Array.from({ length: 20001 }, (_, i) => `Channel Number ${i}`).join("\n");
const data = {};
for (const loc of LOCALES) {
  const msg = messagesFor(loc);
  const ctx = await launchLocked({ name: `qa-r2-loc-${loc}` }, APPLE[loc], { hold: true });
  try {
    await closeWelcome(ctx);
    await setList(ctx, { v: 1, channels: [{ handle: "@keepme", name: "Keep Me", added: 5, source: "card" }], words: [] });
    const base = JSON.stringify(await getList(ctx));
    const p = await ctx.context.newPage();
    const rows = [];
    for (const width of [1280, 420]) {
      await p.setViewportSize({ width, height: 900 });
      await p.goto(`chrome-extension://${ctx.extId}/list.html`);
      await p.waitForFunction(() => document.body.dataset.ready === "1");
      const servedTitle = await p.evaluate(() => document.querySelector("h1")?.textContent || document.title);
      const paste = async (text) => {
        await p.evaluate(() => (document.getElementById("result").textContent = ""));
        await p.evaluate(() => (document.getElementById("many").open = true));
        await p.evaluate((v) => {
          const a = document.querySelector("#manyBox textarea");
          a.value = v;
          a.dispatchEvent(new Event("input", { bubbles: true }));
        }, text);
        await p.click("#manyBox button");
        return (await until(() => p.evaluate(() => [...document.querySelectorAll("#result p")].map((n) => n.textContent)), (r) => r.length > 0, 30000)).value;
      };
      const tb = await paste(big);
      const geo = await p.evaluate(() => {
        const r = document.querySelector("#result p");
        const box = r.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(r).lineHeight) || 20;
        return { pageOverflow: document.documentElement.scrollWidth > innerWidth, textOverflow: r.scrollWidth > r.clientWidth + 1, right: Math.round(box.right), vw: innerWidth, lines: Math.round(box.height / lh) };
      });
      await p.screenshot({ path: join(SHOTS, `list-${loc}-${width}-toobig.png`), fullPage: true });
      const nothing = await paste('{"filterData": {"channelId": [');
      const unchanged = JSON.stringify(await getList(ctx)) === base;
      rows.push({ width, servedTitle, tb, nothing, geo, unchanged });
      check(`${loc} list page ${width} px: 20,001 lines → importTooBig in ${loc}, malformed → importNothing in ${loc}, nothing added, no overflow`, tb[0] === msg("importTooBig") && nothing[0] === msg("importNothing") && unchanged && !geo.pageOverflow && !geo.textOverflow && geo.right <= geo.vw, { width, tb, nothing, geo, unchanged });
    }
    // welcome page 420
    await p.setViewportSize({ width: 420, height: 900 });
    await p.goto(`chrome-extension://${ctx.extId}/welcome.html`);
    await sleep(800);
    await p.evaluate((v) => {
      const a = document.getElementById("paste");
      a.value = v;
      a.dispatchEvent(new Event("input", { bubbles: true }));
    }, big);
    await p.click("#box .paste > button");
    const wt = (await until(() => p.evaluate(() => [...document.querySelectorAll("#result p")].map((n) => n.textContent)), (r) => r.length > 0, 30000)).value;
    const wgeo = await p.evaluate(() => ({ pageOverflow: document.documentElement.scrollWidth > innerWidth }));
    await p.evaluate(() => document.getElementById("result").scrollIntoView({ block: "center" }));
    await p.screenshot({ path: join(SHOTS, `welcome-${loc}-420-toobig.png`) });
    check(`${loc} welcome 420 px: 20,001 lines → importTooBig in ${loc}, no overflow`, wt[0] === msg("importTooBig") && !wgeo.pageOverflow && JSON.stringify(await getList(ctx)) === base, { wt, wgeo });
    rows.push({ welcome: wt, wgeo });
    data[loc] = rows;
    await finish(ctx, check);
  } finally {
    await ctx.context.close().catch(() => {});
    console.log("lang after reset:", resetLang());
  }
}
save("r2-locale-import", data);
