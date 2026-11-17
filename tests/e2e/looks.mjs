import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, reporter, closeWelcome, until, sleep, finish, ROOT, OUT } from "./harness.mjs";

const { check } = reporter("looks");
const WANT = (process.env.LOCALES || "en,ru,es,pt_BR,de").split(",");
const B_ROWS = {
  welcomeTitle: {
    en: "Hide a channel once, and Shoo hides its videos in search and next to the player",
    ru: "Скройте канал один раз, и Shoo уберёт его видео из поиска и из колонки рядом с плеером",
    es: "Oculta un canal una vez y Shoo esconde sus videos en la búsqueda y junto al reproductor",
    pt_BR: "Oculte um canal uma vez e o Shoo esconde os vídeos dele na pesquisa e ao lado do player",
    de: "Kanal einmal ausblenden: Shoo blendet seine Videos in der Suche und neben dem Player aus",
  },
};
const sample = readFileSync(join(ROOT, "test/samples/blocktube_backup.json"), "utf8");

function fake({ M, loc }) {
  if (!location.protocol.startsWith("chrome-extension")) return;
  const get = (key, subs = []) => {
    const e = M[key];
    if (!e) return "";
    const list = Array.isArray(subs) ? subs : [subs];
    let s = e.message;
    for (const [name, { content }] of Object.entries(e.placeholders || {})) s = s.replace(new RegExp(`\\$${name}\\$`, "gi"), list[Number(content.slice(1)) - 1] ?? "");
    return s;
  };
  Object.defineProperty(chrome.i18n, "getMessage", { value: (k, s) => (k === "@@bidi_dir" ? "ltr" : get(k, s)) });
  Object.defineProperty(chrome.i18n, "getUILanguage", { value: () => loc.replace("_", "-") });
}

const overflow = (page, width) =>
  page.evaluate((w) => {
    const bad = [];
    for (const n of document.body.querySelectorAll("*")) {
      const r = n.getBoundingClientRect();
      if (r.width && (r.right > w + 0.5 || n.scrollWidth > n.clientWidth + 1) && getComputedStyle(n).overflowX === "visible") bad.push(`${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""} ${Math.round(r.right)}px "${n.textContent.trim().slice(0, 40)}"`);
    }
    return { docWidth: document.documentElement.scrollWidth, bad: bad.slice(0, 5), lang: document.documentElement.lang };
  }, width);

for (const loc of WANT) {
  const file = join(ROOT, `_locales/${loc}/messages.json`);
  if (!existsSync(file)) {
    check(`${loc}: popup 340 px and welcome 420 px`, null, `waiting for the copywriter: _locales/${loc} does not exist yet`);
    continue;
  }
  const M = JSON.parse(readFileSync(file, "utf8"));
  for (const scheme of ["light", "dark"]) {
    const ctx = await launch({ name: `looks-${loc}-${scheme}`, colorScheme: scheme, width: 420, height: 900 });
    await closeWelcome(ctx);
    await ctx.context.addInitScript(fake, { M, loc });
    const tabId = await ctx.worker.evaluate(async (url) => (await chrome.tabs.create({ url, active: true })).id, `chrome-extension://${ctx.extId}/popup.html`);
    await ctx.worker.evaluate(() => chrome.storage.local.set({ list: { v: 1, channels: [{ handle: "@x", name: "X", added: 1, source: "card" }], words: ["w"] } }));
    await sleep(1000);
    const popup = ctx.context.pages().find((p) => p.url().includes("popup.html"));
    await popup.setViewportSize({ width: 340, height: 600 });
    await popup.waitForFunction(() => document.body.dataset.ready === "1");
    await ctx.worker.evaluate((id) => chrome.storage.session.set({ health: { [id]: { page: "watch", missing: ["search", "sidebar"], ts: Date.now() } } }), tabId);
    await popup.waitForFunction(() => !document.getElementById("health").hidden, null, { timeout: 3000 }).catch(() => {});
    await popup.evaluate((label) => {
      const b = document.createElement("button");
      b.className = "primary";
      b.textContent = label;
      document.getElementById("here").append(b);
    }, M.popupShowHidden.message.replace("$COUNT$", "128"));
    const po = await overflow(popup, 340);
    const broken = await popup.evaluate(() => document.querySelector("#health p")?.textContent);
    await popup.screenshot({ path: join(OUT, `popup-${loc}-${scheme}.png`), fullPage: true });
    check(`${loc} ${scheme}: popup fits 340 px (health line, counts, Show hidden)`, po.docWidth <= 340 && po.bad.length === 0 && po.lang.startsWith(loc.slice(0, 2)) && Boolean(broken), { ...po, broken });

    const welcome = await ctx.context.newPage();
    await welcome.setViewportSize({ width: 420, height: 900 });
    await welcome.goto(`chrome-extension://${ctx.extId}/welcome.html`);
    await welcome.evaluate((t) => {
      const a = document.getElementById("paste");
      a.value = t;
      a.dispatchEvent(new ClipboardEvent("paste", { bubbles: true }));
    }, sample);
    await until(() => welcome.evaluate(() => document.querySelectorAll("#result > *").length), (n) => n >= 4, 3000);
    const wo = await overflow(welcome, 420);
    await welcome.screenshot({ path: join(OUT, `welcome-${loc}-${scheme}.png`), fullPage: true });
    const title = await welcome.evaluate(() => {
      const h = document.querySelector("h1");
      return { lines: Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight)) };
    });
    check(`${loc} ${scheme}: welcome fits 420 px (with an import result), title in <= 2 lines`, wo.docWidth <= 420 && wo.bad.length === 0 && wo.lang.startsWith(loc.slice(0, 2)) && title.lines <= 2, { ...wo, ...title });
    const b = await welcome.evaluate((text) => {
      const h = document.querySelector("h1");
      h.textContent = text;
      return { lines: Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight)), width: document.documentElement.scrollWidth };
    }, B_ROWS.welcomeTitle[loc]);
    await welcome.screenshot({ path: join(OUT, `welcome-${loc}-${scheme}-B.png`), fullPage: true });
    check(`${loc} ${scheme}: welcome B row (welcomeTitle B) fits 420 px in <= 2 lines`, b.width <= 420 && b.lines <= 2, b);
    const scrollbar = await welcome.evaluate(async ([a, bText]) => {
      const style = document.createElement("style");
      style.textContent = "html { overflow-y: scroll; }";
      document.head.append(style);
      const h = document.querySelector("h1");
      const measure = () => ({ lines: Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight)), width: document.documentElement.scrollWidth, client: document.documentElement.clientWidth });
      h.textContent = a;
      const A = measure();
      h.textContent = bText;
      const B = measure();
      return { A, B };
    }, [M.welcomeTitle.message, B_ROWS.welcomeTitle[loc]]);
    check(`${loc} ${scheme}: welcome with a classic scrollbar (html{overflow-y:scroll}) fits, A and B titles in <= 2 lines`, scrollbar.A.width <= scrollbar.A.client && scrollbar.B.width <= scrollbar.B.client && scrollbar.A.lines <= 2 && scrollbar.B.lines <= 2, scrollbar);
    const listPage = await ctx.context.newPage();
    for (const width of [420, 1280]) {
      await listPage.setViewportSize({ width, height: 900 });
      if (!listPage.url().includes("list.html")) await listPage.goto(`chrome-extension://${ctx.extId}/list.html`);
      await listPage.waitForFunction(() => document.body.dataset.ready === "1");
      const lo = await overflow(listPage, width);
      const help = await listPage.evaluate(() => {
        const p = document.querySelector('[data-i18n="listMisses"]');
        const r = p.getBoundingClientRect();
        return { chars: p.textContent.length, visible: p.checkVisibility(), right: Math.round(r.right), lines: Math.round(r.height / parseFloat(getComputedStyle(p).lineHeight)) };
      });
      await listPage.screenshot({ path: join(OUT, `list-${loc}-${scheme}-${width}.png`), fullPage: true });
      check(`${loc} ${scheme}: list page ${width} px fits, the 'what it can't do' help line included`, lo.docWidth <= width && lo.bad.length === 0 && help.visible && help.chars === M.listMisses.message.length && help.right <= width, { ...lo, help });
    }
    await finish(ctx, check);
  }
}
