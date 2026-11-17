import { join } from "node:path";
import { launch, reporter, closeWelcome, setList, goSearch, until, sleep, finish, messagesFor, consent, OUT } from "./harness.mjs";

const { check } = reporter("owner-row");
const LOCALES = (process.env.LOCALES || "en,ru,es,pt_BR,de").split(",");
const HL = { en: "en", ru: "ru", es: "es", pt_BR: "pt", de: "de" };
const WIDTHS = [1280, 1024];
const HANDLE = "@veritasium";

const measure = (page) =>
  page.evaluate(() => {
    const meta = document.querySelector("ytd-watch-flexy:not([hidden]) ytd-watch-metadata");
    const row = meta?.querySelector("#top-row");
    const owner = meta?.querySelector("#owner");
    const actions = meta?.querySelector("#actions");
    if (!row || !owner || !actions) return null;
    const r = row.getBoundingClientRect();
    const o = owner.getBoundingClientRect();
    const buttons = [...actions.querySelectorAll("button, a[role=button]")]
      .filter((b) => b.checkVisibility() && b.getBoundingClientRect().width > 0)
      .map((b) => {
        const x = b.getBoundingClientRect();
        return { label: (b.getAttribute("aria-label") || b.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40), left: Math.round(x.left), right: Math.round(x.right), top: Math.round(x.top) };
      });
    const box = document.getElementById("shoo-page");
    const shoo = box?.getBoundingClientRect();
    return {
      lang: document.documentElement.lang,
      row: { left: Math.round(r.left), right: Math.round(r.right) },
      owner: { right: Math.round(o.right), top: Math.round(o.top), height: Math.round(o.height) },
      shoo: shoo ? { left: Math.round(shoo.left), right: Math.round(shoo.right), top: Math.round(shoo.top), height: Math.round(shoo.height), visible: box.checkVisibility(), inOwner: owner.contains(box), rightUnderRow: box.previousElementSibling === row && shoo.top >= r.bottom - 1 && shoo.top - r.bottom <= 24 && shoo.left <= r.left + 1 } : null,
      buttons,
      overflowPx: Math.max(0, ...buttons.map((b) => b.right - r.right)),
      overlapPx: Math.max(0, ...buttons.filter((b) => b.top < o.top + o.height).map((b) => o.right - b.left)),
    };
  });

for (const loc of LOCALES) {
  const M = messagesFor(loc.replace("_", "-"));
  const ctx = await launch({ name: `owner-row-${loc}`, hl: HL[loc], colorScheme: "light", width: 1280, height: 900 });
  await closeWelcome(ctx);
  await setList(ctx, null);
  const page = ctx.context.pages()[0] || (await ctx.context.newPage());
  await goSearch(page, "veritasium black holes");
  const href = await page.evaluate((h) => {
    const pick = document.querySelector(`ytd-search ytd-video-renderer:has(#channel-info a[href="/${h}"]) a#thumbnail[href^="/watch"]`) || document.querySelector('ytd-search ytd-video-renderer:has(#channel-info a[href^="/@"]) a#thumbnail[href^="/watch"]:not([href*="list="])');
    return pick?.getAttribute("href");
  }, HANDLE);
  if (!href) {
    check(`${loc}: owner row`, null, "no search result with a channel link to open");
    await finish(ctx, check);
    continue;
  }
  await page.goto(`https://www.youtube.com${href.split("&")[0]}`, { waitUntil: "domcontentloaded", referer: page.url() });
  await consent(page);
  const ready = await until(() => page.evaluate(() => document.querySelectorAll("#shoo-page button").length), (n) => n === 1, 15000);
  await sleep(2500);
  const before = {};
  await page.evaluate(() => (document.getElementById("shoo-page").style.display = "none"));
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await sleep(1200);
    before[w] = await measure(page);
  }
  await page.evaluate(() => (document.getElementById("shoo-page").style.display = ""));
  await page.setViewportSize({ width: 1280, height: 900 });
  await sleep(800);
  await page.locator("#shoo-page button").click();
  const shown = await until(() => page.evaluate(() => document.querySelectorAll("#shoo-page .shoo-text, #shoo-page button").length), (n) => n === 3, 3000);
  const name = await page.evaluate(() => document.querySelector("ytd-watch-metadata ytd-video-owner-renderer ytd-channel-name #text")?.textContent.trim());
  await page.evaluate(([a, b, c]) => {
    const [text, back, undo] = document.querySelectorAll("#shoo-page .shoo-text, #shoo-page button");
    text.textContent = a;
    back.textContent = b;
    undo.textContent = c;
  }, [M("cardHidden", name), M("pageBack"), M("undo")]);
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await sleep(1200);
    const after = await measure(page);
    await page.screenshot({ path: join(OUT, `owner-row-${loc}-${w}.png`), clip: { x: 0, y: 0, width: w, height: 900 } }).catch(() => {});
    const lost = (before[w]?.buttons || []).map((b) => b.label).filter((l) => l && !(after?.buttons || []).some((a) => a.label === l));
    const moved = (before[w]?.buttons || []).filter((b) => (after?.buttons || []).some((a) => a.label === b.label && Math.abs(a.left - b.left) > 1)).map((b) => b.label);
    const ok = Boolean(ready.ok && shown.ok && after && moved.length === 0 && after.overflowPx <= Math.max(0, before[w]?.overflowPx ?? 0) && after.overlapPx <= 0 && lost.length === 0 && after.shoo?.visible && after.shoo.rightUnderRow && !after.shoo.inOwner);
    check(`${loc} ${w}px: 'Shoo hid videos from … · Back to results · Undo' is its own line right under the owner row, Like/Share/Save exactly where YouTube puts them without Shoo, no overflow beyond YouTube's own`, ok, { lang: after?.lang, movedVsYouTubeAlone: moved, overflowPxYouTubeAlone: before[w]?.overflowPx, overflowPx: after?.overflowPx, overlapPx: after?.overlapPx, buttonsLost: lost, shooLine: after?.shoo, row: after?.row, actions: after?.buttons.map((b) => `${b.label}@${b.left}-${b.right}`) });
  }
  await finish(ctx, check);
}
