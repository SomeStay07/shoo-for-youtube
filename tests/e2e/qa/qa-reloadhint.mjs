// Popup on a YouTube tab opened BEFORE install: start Chrome without Shoo, open search, then install Shoo
// with CDP Extensions.loadUnpacked (needs --enable-unsafe-extension-debugging). Also the welcome page's
// "Reload YouTube tabs (N)" for that tab.
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { chromium } from "playwright-core";
import { ownUi, save, sleep, OUT, setLang, resetLang } from "./qa-lib.mjs";
import { reporter, CHROME, EXT, consent, until, openRealPopup, messagesFor } from "../harness.mjs";

const { check } = reporter("qa-reloadhint");
const SHOTS = join(OUT, "smoke");
mkdirSync(SHOTS, { recursive: true });
const profile = join(OUT, "profile-qa-reloadhint");
rmSync(profile, { recursive: true, force: true });
setLang("en-US");
const context = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME,
  headless: false,
  ignoreDefaultArgs: ["--enable-automation", "--disable-extensions"],
  viewport: { width: 1280, height: 900 },
  args: ["--headless=new", "--enable-unsafe-extension-debugging", "--use-mock-keychain", "--password-store=basic", "--remote-debugging-port=0", "--lang=en-US", "--mute-audio", "--disable-blink-features=AutomationControlled"],
});
resetLang();
await context.addCookies([{ name: "PREF", value: "hl=en&gl=US&f6=400", domain: ".youtube.com", path: "/", secure: true, sameSite: "Lax" }]);
const errors = [];
context.on("page", (p) => p.on("pageerror", (e) => String(e.stack || e).includes("chrome-extension://") && errors.push(String(e).slice(0, 200))));
const page = context.pages()[0] || (await context.newPage());
await page.goto("https://www.youtube.com/results?search_query=veritasium+black+holes", { waitUntil: "domcontentloaded" });
await consent(page);
await page.waitForSelector("ytd-search ytd-video-renderer", { state: "attached", timeout: 25000 });
await sleep(2000);
const s = await context.browser().newBrowserCDPSession();
const { id: extId } = await s.send("Extensions.loadUnpacked", { path: EXT });
check("Shoo installed into the running browser after the YouTube tab was open", Boolean(extId), { extId });
let worker = null;
for (let i = 0; i < 50 && !worker; i++) {
  worker = context.serviceWorkers().find((w) => w.url().includes(extId)) || null;
  if (!worker) await sleep(200);
}
if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 10000 });
await worker.evaluate(() => chrome.storage.local.set({ list: { v: 1, channels: [{ handle: "@veritasium", name: "Veritasium", added: 1, source: "card" }], words: [] } }));
const msg = messagesFor(await worker.evaluate(() => chrome.i18n.getUILanguage()));
const { value: welcome } = await until(async () => context.pages().find((p) => p.url().includes("welcome.html")) || null, Boolean, 8000);
check("welcome page opens on install", Boolean(welcome));
const port = Number((await import("node:fs")).readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
const ctx = { worker, port };
const untouched = await ownUi(page);
const pop = await openRealPopup(ctx, page);
const p3 = await pop.eval(() => ({ reload: document.getElementById("reload")?.textContent || null, status: document.getElementById("status").textContent, counts: document.getElementById("counts").textContent, show: document.getElementById("showHidden") ? 1 : 0 }));
await pop.screenshot(join(SHOTS, "popup-reload.png"));
await pop.close();
check("popup on the tab opened before install: 'Reload this tab so Shoo works here', no Show hidden", p3.reload === msg("reloadTab") && !p3.show, p3);
check("that tab is untouched before reload (no Shoo nodes)", untouched.hidden === 0 && untouched.btn === 0, untouched);
let w2 = null;
if (welcome) {
  await welcome.bringToFront();
  await welcome.waitForSelector("#reloadTabs", { timeout: 5000 }).catch(() => {});
  const label = await welcome.evaluate(() => document.getElementById("reloadTabs")?.textContent || null);
  await welcome.screenshot({ path: join(SHOTS, "welcome-reload.png"), fullPage: true });
  check("welcome shows 'Reload YouTube tabs (1)'", label === msg("welcomeReloadTabs", 1), { label });
  await welcome.click("#reloadTabs").catch(() => {});
  await sleep(8000);
  w2 = await welcome.evaluate(() => document.getElementById("reloadTabs")?.textContent || null);
}
const reloaded = await ownUi(page);
check("after 'Reload YouTube tabs' the tab runs Shoo (listed channel hidden)", reloaded.hidden > 0, { reloaded, buttonAfter: w2 });
const pop2 = await openRealPopup(ctx, page);
const p4 = await pop2.eval(() => ({ reload: document.getElementById("reload") ? 1 : 0, show: document.getElementById("showHidden")?.textContent || null }));
await pop2.close();
check("popup works on that tab after the reload", !p4.reload && Boolean(p4.show), p4);
check("no extension page errors", errors.length === 0, errors);
save("reloadhint", { p3, p4, untouched, reloaded });
await context.close();
