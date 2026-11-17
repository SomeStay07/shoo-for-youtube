// Shoo + Errand 0.4.0 (built to scratch) in one browser: search, watch layout at 1280/1024/800, Errand's reveal,
// both health badges (no false "!"), Shoo popup counts, errors from both.
import { join } from "node:path";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { setLang, resetLang, botWall, save, sleep, consent, OUT } from "./qa-lib.mjs";
import { reporter, CHROME, EXT, openRealPopup, messagesFor } from "../harness.mjs";

const ERRAND = process.env.ERRAND;
const { check } = reporter("qa-errand");
const SHOTS = join(OUT, "errand");
mkdirSync(SHOTS, { recursive: true });
const profile = join(OUT, "profile-qa-errand");
rmSync(profile, { recursive: true, force: true });
setLang("en-US");
const context = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME,
  headless: false,
  ignoreDefaultArgs: ["--enable-automation"],
  viewport: { width: 1280, height: 900 },
  colorScheme: "dark",
  args: [`--disable-extensions-except=${EXT},${ERRAND}`, `--load-extension=${EXT},${ERRAND}`, "--headless=new", "--lang=en-US", "--disable-blink-features=AutomationControlled", "--mute-audio", "--remote-debugging-port=0", "--use-mock-keychain", "--password-store=basic"],
});
resetLang();
await context.addCookies([{ name: "PREF", value: "hl=en&gl=US&f6=400", domain: ".youtube.com", path: "/", secure: true, sameSite: "Lax" }]);
const errors = [];
const hookPage = (p) => {
  p.on("pageerror", (e) => String(e.stack || e).includes("chrome-extension://") && errors.push({ where: p.url().slice(0, 60), text: String(e.stack || e).slice(0, 200) }));
  p.on("console", (m) => {
    const loc = m.location()?.url || "";
    if (m.type() === "error" && (loc.startsWith("chrome-extension://") || p.url().startsWith("chrome-extension://"))) errors.push({ where: p.url().slice(0, 60), text: m.text().slice(0, 200) });
  });
};
context.pages().forEach(hookPage);
context.on("page", hookPage);
await sleep(4000);
let shoo = null;
let errand = null;
for (const w of context.serviceWorkers()) {
  if (await w.evaluate(() => Boolean(globalThis.ShooLib)).catch(() => false)) shoo = w;
  if (await w.evaluate(() => Boolean(globalThis.ErrandLib)).catch(() => false)) errand = w;
}
for (const w of [shoo, errand]) w?.on("console", (m) => ["error", "warning"].includes(m.type()) && errors.push({ where: "sw", text: m.text().slice(0, 200) }));
const welcomes = context.pages().filter((p) => /welcome\.html/.test(p.url())).length;
check("both extensions loaded, each opens its welcome page", Boolean(shoo && errand) && welcomes === 2, { shoo: Boolean(shoo), errand: Boolean(errand), welcomes });
for (const p of context.pages()) if (p.url().includes("welcome.html")) await p.close();
const shooId = shoo.url().split("/")[2];
const port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
const msg = messagesFor("en");
await shoo.evaluate(() => chrome.storage.local.set({ list: { v: 1, channels: [{ handle: "@veritasium", name: "Veritasium", added: 1, source: "card" }, { handle: "@kurzgesagt", name: "Kurzgesagt – In a Nutshell", added: 2, source: "card" }], words: [] } }));
const page = context.pages()[0] || (await context.newPage());
const tabId = async () => shoo.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t?.id));
const badges = async () => {
  const id = await tabId();
  return { shoo: await shoo.evaluate((i) => chrome.action.getBadgeText({ tabId: i }), id), errand: await errand.evaluate((i) => chrome.action.getBadgeText({ tabId: i }), id) };
};
const data = {};

// home: Errand's question
await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
await consent(page);
await sleep(15000);
const home = await page.evaluate(() => ({ intent: Boolean(document.getElementById("er-intent")), shooUi: document.querySelectorAll(".shoo-btn, #shoo-page, #shoo-all").length }));
data.home = { ...home, badges: await badges() };
await page.screenshot({ path: join(SHOTS, "home.png") });
check("home with Errand's question: Shoo adds nothing, no '!' from either", data.home.badges.shoo === "" && data.home.badges.errand === "" && home.shooUi === 0, data.home);

// search
await page.goto("https://www.youtube.com/results?search_query=veritasium+black+holes", { waitUntil: "domcontentloaded" });
await page.waitForSelector("ytd-search ytd-video-renderer", { state: "attached", timeout: 25000 }).catch(() => {});
await sleep(14000);
if (await botWall(page)) check("search with Errand", null, "bot page");
const s = await page.evaluate(() => ({
  errandAttrs: [...document.documentElement.attributes].map((a) => a.name).filter((n) => n.startsWith("data-er")),
  shooHidden: document.querySelectorAll("ytd-search [data-shoo-hide]").length,
  listedVisible: [...document.querySelectorAll("ytd-search ytd-video-renderer")].filter((c) => c.checkVisibility() && c.querySelector('#channel-info a[href="/@veritasium"], #channel-info a[href="/@kurzgesagt"]') && !c.closest("[data-shoo-slot]")).length,
  shortsVisible: [...document.querySelectorAll("ytd-search a[href^='/shorts/']")].filter((a) => a.checkVisibility()).length,
  canRender: [...document.querySelectorAll("[data-shoo-hide]")].filter((b) => !b.closest("ytd-search[hidden]") && b.parentElement?.checkVisibility()).length,
}));
await page.locator("ytd-search ytd-video-renderer:not([data-shoo-hide])").first().hover({ position: { x: 500, y: 40 } });
await sleep(400);
s.btn = await page.evaluate(() => document.querySelectorAll("ytd-search .shoo-btn").length);
s.badges = await badges();
data.search = s;
await page.screenshot({ path: join(SHOTS, "search.png") });
check("search: Errand hides Shorts, Shoo hides listed channels and shows ⊘, no '!' from either", s.errandAttrs.length > 0 && s.shortsVisible === 0 && s.shooHidden > 0 && s.listedVisible === 0 && s.btn === 1 && s.badges.shoo === "" && s.badges.errand === "", s);
let pop = await openRealPopup({ worker: shoo, port }, page);
const pc = await pop.eval(() => ({ show: document.getElementById("showHidden")?.textContent || null, nothing: document.getElementById("nothing")?.textContent || null, counts: document.getElementById("counts").textContent }));
await pop.close();
check("Shoo popup on search counts only hidden videos that could show", pc.show === msg("popupShowHidden", s.canRender), { ...pc, canRender: s.canRender });

// watch pages: listed channel video and another channel's video, widths 1280/1024/800
const urls = await page.evaluate(() => {
  const all = [...document.querySelectorAll("ytd-search ytd-video-renderer")].map((c) => ({ h: c.querySelector("#channel-info a[href^='/@']")?.getAttribute("href"), v: c.querySelector("a#thumbnail[href^='/watch']")?.getAttribute("href") })).filter((x) => x.v && !x.v.includes("list="));
  return { listed: all.find((x) => /veritasium|kurzgesagt/i.test(x.h || ""))?.v, other: all.find((x) => x.h && !/veritasium|kurzgesagt/i.test(x.h))?.v };
});
data.urls = urls;
for (const width of [1280, 1024, 800]) {
  await page.setViewportSize({ width, height: 900 });
  for (const [label, url] of Object.entries(urls)) {
    if (!url) continue;
    await page.goto(`https://www.youtube.com${url.split("&")[0]}`, { waitUntil: "domcontentloaded" });
    await sleep(16000);
    if (await botWall(page)) {
      check(`watch ${label} ${width}`, null, "bot page");
    }
    const w = await page.evaluate(() => {
      const rect = (n) => {
        if (!n || !n.checkVisibility()) return null;
        const r = n.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) };
      };
      const over = (a, b) => a && b && !(a.r <= b.x || b.r <= a.x || a.b <= b.y || b.b <= a.y);
      const shooBox = rect(document.getElementById("shoo-page"));
      const reveal = rect(document.getElementById("er-reveal"));
      const pill = rect(document.getElementById("er-pill"));
      const comments = rect(document.getElementById("er-comments"));
      const sub = rect(document.querySelector("ytd-watch-metadata #subscribe-button"));
      const owner = rect(document.querySelector("ytd-watch-metadata #owner"));
      const sidebarVisible = [...document.querySelectorAll("#secondary yt-lockup-view-model, #related yt-lockup-view-model")].filter((c) => c.checkVisibility()).length;
      return { shooBox, shooText: document.getElementById("shoo-page")?.textContent || null, reveal, pill, comments, sub, owner, sidebarVisible, overlaps: { shooReveal: over(shooBox, reveal), shooPill: over(shooBox, pill), shooComments: over(shooBox, comments), shooSub: document.getElementById("shoo-page")?.className.includes("shoo-page") ? over(shooBox, sub) : false, inViewport: shooBox ? shooBox.x >= 0 && shooBox.r <= innerWidth : null } };
    });
    w.badges = await badges();
    await page.screenshot({ path: join(SHOTS, `watch-${label}-${width}.png`) });
    data[`watch ${label} ${width}`] = w;
    const want = label === "listed" ? msg("pageHidden") : msg("pageHide");
    check(`watch (${label}) ${width}px with Errand: Errand hides the sidebar with its reveal button; Shoo's control by the owner row; nothing overlaps; no '!' from either`, w.sidebarVisible === 0 && w.reveal && w.shooBox && w.shooText.includes(want) && !Object.entries(w.overlaps).some(([k, v]) => k !== "inViewport" && v) && w.overlaps.inViewport && w.badges.shoo === "" && w.badges.errand === "", w);
    if (label === "listed" && width === 1280) {
      // Errand reveal → Shoo hides the listed channel's sidebar cards by name
      await page.click("#er-reveal").catch(() => {});
      for (let i = 0; i < 40 && !(await page.evaluate(() => document.documentElement.hasAttribute("data-er-reveal"))); i++) await sleep(500);
      await sleep(4000);
      const r = await page.evaluate(() => {
        const cards = [...document.querySelectorAll("#secondary yt-lockup-view-model, #related yt-lockup-view-model")];
        const vis = cards.filter((c) => c.checkVisibility());
        const nameOf = (c) => c.querySelector("yt-content-metadata-view-model [role=group] > [role=text]")?.textContent.trim() || "";
        return { cards: cards.length, visible: vis.length, listedVisible: vis.filter((c) => /^(Veritasium|Kurzgesagt – In a Nutshell)$/.test(nameOf(c))).length, shooHidden: document.querySelectorAll("#secondary [data-shoo-hide], #related [data-shoo-hide]").length };
      });
      r.badges = await badges();
      await page.screenshot({ path: join(SHOTS, "watch-listed-revealed.png") });
      data.revealed = r;
      check("after Errand's reveal: sidebar shows, Shoo still hides the listed channels there by name, no '!'", r.visible > 0 ? r.listedVisible === 0 && r.badges.shoo === "" && r.badges.errand === "" : null, r);
      pop = await openRealPopup({ worker: shoo, port }, page);
      const pw = await pop.eval(() => ({ show: document.getElementById("showHidden")?.textContent || null, nothing: document.getElementById("nothing")?.textContent || null }));
      await pop.close();
      data.revealedPopup = pw;
      check("Shoo popup on the revealed watch page counts the sidebar cards it hid", r.shooHidden ? Boolean(pw.show) : Boolean(pw.nothing), pw);
    }
  }
}
// Shorts: Errand redirects/blocks; Shoo adds nothing
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto("https://www.youtube.com/shorts/aqz-KE-bpKQ", { waitUntil: "domcontentloaded" });
await sleep(6000);
data.shorts = { url: page.url().slice(0, 70), shooUi: await page.evaluate(() => document.querySelectorAll(".shoo-btn, #shoo-page").length), badges: await badges() };
check("Shorts URL with Errand: Errand's redirect to /watch stands; Shoo then acts as on any watch page (its control only), no '!'", /\/watch\?v=/.test(data.shorts.url) && data.shorts.shooUi <= 1 && data.shorts.badges.shoo === "" && data.shorts.badges.errand === "", data.shorts);
check("no errors from either extension (pages, popups, workers)", errors.length === 0, errors.slice(0, 6));
save("errand", data);
await context.close();
