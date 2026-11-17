// Five locales through the real Chrome UI language (AppleLanguages lock held per locale, one at a time):
// welcome (install), list page, real action popup (empty / counts / "!" / revealed), injected strings on YouTube.
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { setLang, resetLang, botWall, save, sleep, consent, OUT } from "./qa-lib.mjs";
import { launch, reporter, setList, until, openRealPopup, goSearch, messagesFor } from "../harness.mjs";

const { check } = reporter("qa-locales");
const SHOTS = join(OUT, "locales");
mkdirSync(SHOTS, { recursive: true });
const LOCALES = (process.env.LOCALES || "en,ru,es,pt_BR,de").split(",");
const APPLE = { en: ["en-US", "en"], ru: ["ru-RU", "ru"], es: ["es-ES", "es"], pt_BR: ["pt-BR", "pt"], de: ["de-DE", "de"] };
const overflow = (target, width) => {
  const fn = (w) => {
    const bad = [];
    for (const n of document.body.querySelectorAll("*")) {
      if (!n.checkVisibility()) continue;
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      if (r.width && (r.right > w + 0.5 || (n.scrollWidth > n.clientWidth + 1 && cs.overflowX === "visible" && n.children.length === 0))) bad.push(`${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}${n.className && typeof n.className === "string" ? "." + n.className.split(" ")[0] : ""} r=${Math.round(r.right)} sw=${n.scrollWidth} cw=${n.clientWidth} "${n.textContent.trim().slice(0, 40)}"`);
    }
    return { docWidth: document.documentElement.scrollWidth, bad: bad.slice(0, 6) };
  };
  return target.evaluate ? (target.eval ? target.eval(fn, width) : target.evaluate(fn, width)) : null;
};
const all = {};
for (const loc of LOCALES) {
  const [apple, hl] = APPLE[loc];
  setLang(apple);
  const res = (all[loc] = {});
  try {
    const ctx = await launch({ name: `qa-loc-${loc}`, hl, gl: "US" });
    const msg = messagesFor(ctx.lang);
    res.lang = ctx.lang;
    check(`${loc}: Chrome UI language → extension locale`, ctx.lang.replace("-", "_").startsWith(loc === "pt_BR" ? "pt_BR" : loc), { lang: ctx.lang });
    // welcome
    const { value: welcome } = await until(async () => ctx.context.pages().find((p) => p.url().includes("welcome.html")) || null, Boolean, 8000);
    if (welcome) {
      for (const width of [420, 1280]) {
        await welcome.setViewportSize({ width, height: 900 });
        await sleep(300);
        const o = await welcome.evaluate((w) => {
          const bad = [];
          for (const n of document.body.querySelectorAll("*")) {
            if (!n.checkVisibility()) continue;
            const r = n.getBoundingClientRect();
            if (r.width && (r.right > w + 0.5 || (n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX === "visible" && !n.children.length))) bad.push(`${n.tagName.toLowerCase()}#${n.id} "${n.textContent.trim().slice(0, 40)}"`);
          }
          return { docWidth: document.documentElement.scrollWidth, bad, title: document.querySelector("h1").textContent, first: document.getElementById("importFirst").textContent.slice(0, 50), titleLines: Math.round(document.querySelector("h1").getBoundingClientRect().height / parseFloat(getComputedStyle(document.querySelector("h1")).lineHeight)) };
        }, width);
        await welcome.screenshot({ path: join(SHOTS, `${loc}-welcome-${width}.png`), fullPage: true });
        res[`welcome${width}`] = o;
        check(`${loc}: welcome at ${width}px in the right language, no overflow`, o.title === msg("welcomeTitle") && o.docWidth <= width && o.bad.length === 0, o);
      }
      await welcome.close();
    } else check(`${loc}: welcome opened on install`, false);
    // list page
    await setList(ctx, { v: 1, channels: [{ handle: "@SomeVeryLongChannelHandleForLayout", name: "Ein sehr langer Kanalname für das Layout – Offiziell", added: 3, source: "card" }, { id: "UCabcdefghijklmnopqrstuv", added: 2, source: "import" }, { name: "Name Only", added: 1, source: "sidebar" }], words: ["alpha", "Überraschungsei"] });
    const lp = await ctx.context.newPage();
    await lp.goto(`chrome-extension://${ctx.extId}/list.html`);
    await lp.waitForFunction(() => document.body.dataset.ready === "1");
    await lp.evaluate(() => (document.getElementById("many").open = true));
    for (const width of [420, 1280]) {
      await lp.setViewportSize({ width, height: 900 });
      await sleep(300);
      const o = await lp.evaluate((w) => {
        const bad = [];
        for (const n of document.body.querySelectorAll("*")) {
          if (!n.checkVisibility()) continue;
          const r = n.getBoundingClientRect();
          if (r.width && (r.right > w + 0.5 || (n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX === "visible" && !n.children.length && n.tagName !== "TEXTAREA"))) bad.push(`${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""} "${n.textContent.trim().slice(0, 40)}"`);
        }
        return { docWidth: document.documentElement.scrollWidth, bad, h1: document.querySelector("h1").textContent };
      }, width);
      await lp.screenshot({ path: join(SHOTS, `${loc}-list-${width}.png`), fullPage: true });
      res[`list${width}`] = o;
      check(`${loc}: list page at ${width}px in the right language, no overflow`, o.h1 === msg("listTitle") && o.docWidth <= width && o.bad.length === 0, o);
    }
    await lp.close();
    // live search: injected strings + popup states
    await setList(ctx, { v: 1, channels: [{ handle: "@veritasium", name: "Veritasium", added: 1, source: "card" }], words: [] });
    const page = ctx.context.pages().find((p) => !p.url().startsWith("chrome-extension://")) || (await ctx.context.newPage());
    let live = true;
    try {
      await goSearch(page, "veritasium kurzgesagt");
    } catch {
      live = false;
    }
    if (!live || (await botWall(page))) check(`${loc}: live search`, null, "bot page or no results");
    else {
      const card = page.locator("ytd-search ytd-video-renderer:not([data-shoo-hide]):has(#channel-info a[href^='/@'])").first();
      await card.scrollIntoViewIfNeeded();
      await card.hover({ position: { x: 500, y: 40 } });
      await sleep(400);
      const b = await page.evaluate(() => {
        const x = document.querySelector("ytd-search .shoo-btn");
        const c = x?.closest("ytd-video-renderer");
        return x ? { label: x.getAttribute("aria-label"), title: x.title, name: (c.querySelector("ytd-channel-name #text")?.textContent || "").trim() } : null;
      });
      check(`${loc}: ⊘ label and tooltip localized`, b && b.label === msg("cardHide", b.name) && b.title === msg("cardHideTip", b.name), b);
      await page.click("ytd-search .shoo-btn");
      await sleep(800);
      const line = await page.evaluate(() => {
        const l = document.querySelector("[data-shoo-slot] > .shoo-line");
        if (!l) return null;
        const r = l.getBoundingClientRect();
        const c = l.parentElement.getBoundingClientRect();
        return { text: l.querySelector(".shoo-text")?.textContent, button: l.querySelector("button")?.textContent, fits: r.right <= c.right + 1 && l.scrollWidth <= l.clientWidth + 1 };
      });
      await page.screenshot({ path: join(SHOTS, `${loc}-search-line.png`) });
      check(`${loc}: slot line localized and fits`, line && line.text === msg("cardHidden", b?.name) && line.button === msg("undo") && line.fits, line);
      await page.click("[data-shoo-slot] > .shoo-line button").catch(() => {});
      await sleep(800);
      const popW = async (pop) => pop.eval(() => {
        const bad = [];
        for (const n of document.body.querySelectorAll("*")) {
          if (!n.checkVisibility()) continue;
          const r = n.getBoundingClientRect();
          if (r.right > innerWidth + 0.5 || (n.scrollWidth > n.clientWidth + 1 && !n.children.length && getComputedStyle(n).overflowX === "visible")) bad.push(`${n.tagName.toLowerCase()}#${n.id} "${n.textContent.trim().slice(0, 40)}"`);
        }
        return { w: innerWidth, docWidth: document.documentElement.scrollWidth, bad, text: document.body.innerText.replace(/\s+/g, " ").slice(0, 200) };
      });
      let pop = await openRealPopup(ctx, page);
      const p1 = await popW(pop);
      await pop.screenshot(join(SHOTS, `${loc}-popup-counts.png`));
      check(`${loc}: popup (counts + Show hidden) ≤ 340 px, no overflow, localized`, p1.w <= 340 && p1.docWidth <= p1.w && !p1.bad.length && p1.text.includes(msg("popupOn")), p1);
      await pop.eval(() => document.getElementById("showHidden")?.click());
      await sleep(800);
      pop = await openRealPopup(ctx, page);
      const p2 = await popW(pop);
      await pop.screenshot(join(SHOTS, `${loc}-popup-revealed.png`));
      check(`${loc}: popup revealed state fits, localized`, p2.docWidth <= p2.w && !p2.bad.length && p2.text.includes(msg("popupHideAgain")), p2);
      await pop.eval(() => document.getElementById("hideAgain")?.click());
      await sleep(600);
      const tabId = await ctx.worker.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t?.id));
      await ctx.worker.evaluate((id) => chrome.storage.session.set({ health: { [id]: { page: "watch", missing: ["search", "sidebar"], ts: Date.now() } } }), tabId);
      pop = await openRealPopup(ctx, page);
      const p3 = await popW(pop);
      await pop.screenshot(join(SHOTS, `${loc}-popup-broken.png`));
      await pop.close();
      await sleep(400);
      check(`${loc}: popup '!' state (two surfaces) fits, localized, report inside the box`, p3.docWidth <= p3.w && !p3.bad.length && p3.text.includes(msg("surfaceSidebar")) && p3.text.includes(msg("report")), p3);
      await ctx.worker.evaluate(() => chrome.storage.session.set({ health: {} }));
      await setList(ctx, null);
      await sleep(400);
      pop = await openRealPopup(ctx, page);
      const p4 = await popW(pop);
      await pop.screenshot(join(SHOTS, `${loc}-popup-empty.png`));
      check(`${loc}: popup empty-list state fits, localized`, p4.docWidth <= p4.w && !p4.bad.length && p4.text.includes(msg("popupEmpty")), p4);
      await pop.close();
      Object.assign(res, { p1, p2, p3, p4, line, b });
    }
    const pt = await ctx.context.newPage();
    pt.on("console", (m) => m.type() === "error" && ctx.errors.push({ where: "popup-tab", text: m.text().slice(0, 200) }));
    await pt.goto(`chrome-extension://${ctx.extId}/popup.html`);
    await pt.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 5000 }).catch(() => ctx.errors.push({ where: "popup-tab", text: "popup never ready" }));
    await pt.close();
    check(`${loc}: no extension errors (pages, popup)`, ctx.errors.length === 0, ctx.errors.slice(0, 3));
    await ctx.context.close();
  } finally {
    resetLang();
  }
}
save("locales", all);
