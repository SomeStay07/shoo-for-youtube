import { chromium } from "playwright-core";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { reporter, CHROME, EXT, OUT, consent, sleep, messagesFor, openRealPopup } from "./harness.mjs";

const { check } = reporter("with-errand");
const ERRAND = process.env.ERRAND || new URL("../../../errand-for-youtube/dist/chrome", import.meta.url).pathname;
if (!existsSync(join(ERRAND, "manifest.json"))) {
  check("Errand build present", null, `no ${ERRAND}`);
  process.exit(0);
}
const profile = join(OUT, "profile-with-errand");
rmSync(profile, { recursive: true, force: true });
const context = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME,
  headless: false,
  ignoreDefaultArgs: ["--enable-automation"],
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${EXT},${ERRAND}`, `--load-extension=${EXT},${ERRAND}`, "--headless=new", "--lang=en-US", "--disable-blink-features=AutomationControlled", "--mute-audio", "--remote-debugging-port=0"],
});
await context.addCookies([{ name: "PREF", value: "hl=en&gl=US", domain: ".youtube.com", path: "/", secure: true, sameSite: "Lax" }]);
const errors = [];
context.on("page", (p) => p.on("pageerror", (e) => String(e.stack || e).includes("chrome-extension://") && errors.push(String(e).slice(0, 200))));
await sleep(3000);
const workers = context.serviceWorkers();
let shooWorker = null;
for (const w of workers) if (await w.evaluate(() => Boolean(globalThis.ShooLib)).catch(() => false)) shooWorker = w;
for (const p of context.pages()) if (p.url().includes("welcome.html")) await p.close();
check("both extensions loaded", workers.length >= 2 && Boolean(shooWorker), workers.map((w) => w.url().split("/")[2]));
await shooWorker.evaluate(() => chrome.storage.local.set({ list: { v: 1, channels: [{ handle: "@veritasium", name: "Veritasium", added: 1, source: "card" }], words: [] } }));
const page = context.pages()[0] || (await context.newPage());
page.on("pageerror", (e) => String(e.stack || e).includes("chrome-extension://") && errors.push(String(e).slice(0, 200)));
await page.goto("https://www.youtube.com/results?search_query=veritasium+black+holes", { waitUntil: "domcontentloaded" });
await consent(page);
await page.waitForSelector("ytd-search ytd-video-renderer", { state: "attached", timeout: 25000 });
await sleep(3000);
const s = await page.evaluate(() => ({
  errand: [...document.documentElement.attributes].map((a) => a.name).filter((n) => n.startsWith("data-er")).length,
  shooHidden: document.querySelectorAll("ytd-search [data-shoo-hide]").length,
  visibleListed: [...document.querySelectorAll('ytd-search ytd-video-renderer:has(#channel-info a[href="/@veritasium"])')].filter((c) => c.checkVisibility() && !c.closest("[data-shoo-slot]")).length,
}));
await page.locator('ytd-search ytd-video-renderer:not([data-shoo-hide])').first().hover();
s.buttons = await page.evaluate(() => document.querySelectorAll("ytd-search .shoo-btn").length);
check("search with Errand on: Errand active, Shoo hides the listed channel and adds its buttons", s.errand > 0 && s.shooHidden > 0 && s.visibleListed === 0 && s.buttons > 0, s);
const href = await page.evaluate(() => document.querySelector("ytd-search a#thumbnail[href^='/watch']:not([href*='list='])")?.getAttribute("href"));
await page.goto(`https://www.youtube.com${href.split("&")[0]}`, { waitUntil: "domcontentloaded" });
await sleep(8000);
const w = await page.evaluate(() => ({
  shooControl: (() => {
    const box = document.querySelector("ytd-watch-metadata #shoo-page");
    return Boolean(box && box.checkVisibility() && (box.closest("#owner") || box.previousElementSibling?.id === "top-row"));
  })(),
  sidebarShown: [...document.querySelectorAll("#secondary yt-lockup-view-model")].filter((c) => c.checkVisibility()).length,
  sidebarCards: document.querySelectorAll("#secondary yt-lockup-view-model").length,
  shooSidebarHidden: document.querySelectorAll("#secondary [data-shoo-hide]").length,
}));
check("watch with Errand on: Shoo's owner-row control present; Errand's sidebar hiding stays in charge", w.shooControl, w);
const port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
const msg = messagesFor("en");
const canShow = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll("[data-shoo-hide]")].filter((b) => !b.closest("ytd-watch-flexy[hidden], ytd-watch-grid[hidden], ytd-search[hidden], ytd-browse[hidden]"));
  return { all: boxes.length, canRender: boxes.filter((b) => b.parentElement?.checkVisibility()).length };
});
const popup = await openRealPopup({ worker: shooWorker, port }, page);
const k = await popup.eval(() => ({ button: document.getElementById("showHidden")?.textContent ?? null, nothing: document.getElementById("nothing")?.textContent ?? null }));
await popup.close();
const want = canShow.canRender ? { button: msg("popupShowHidden", canShow.canRender), nothing: null } : { button: null, nothing: msg("popupNothingHere") };
check("watch with Errand on: Shoo's popup counts only hidden videos that could show (not the ones in areas Errand hides)", canShow.all > canShow.canRender ? k.button === want.button && k.nothing === want.nothing : null, { ...canShow, popup: k });
check("no extension page errors with both loaded", errors.length === 0, errors);
await context.close();
