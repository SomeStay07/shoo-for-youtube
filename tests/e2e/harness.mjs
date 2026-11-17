import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripTestHooks } from "../../scripts/ship.mjs";

export const ROOT = new URL("../..", import.meta.url).pathname;
export const EXT = process.env.EXT || join(ROOT, "dist/chrome");
export const OUT = process.env.OUT || join(ROOT, ".e2e-out");
export const CHROME = resolveChrome();
mkdirSync(OUT, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = join(process.env.HOME, "Library/Caches/ms-playwright");
  const tails = ["chrome-mac-arm64", "chrome-mac", "chrome-mac-x64"].map((d) => `${d}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`);
  const dirs = (existsSync(base) ? readdirSync(base) : []).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) for (const t of tails) if (existsSync(join(base, d, t))) return join(base, d, t);
  throw new Error(`Chrome for Testing not found under ${base}; set CHROME=<path>`);
}

const SOURCES = ["manifest.json", "lib.js", "content.js", "background.js", "block.css", "popup.html", "popup.css", "popup.js", "welcome.html", "welcome.js", "list.html", "list.js", "importui.js", "pages.css", "_locales"];

function listFiles(dir, rel = "") {
  const full = join(dir, rel);
  if (!existsSync(full)) return [];
  if (!statSync(full).isDirectory()) return [rel];
  return readdirSync(full).flatMap((n) => listFiles(dir, rel ? join(rel, n) : n));
}

export function distStale(ext = join(ROOT, "dist/chrome")) {
  const hash = (p, shipped = false) => createHash("sha256").update(shipped ? stripTestHooks(readFileSync(p, "utf8")) : readFileSync(p)).digest("hex");
  return SOURCES.flatMap((f) => listFiles(ROOT, f)).filter((rel) => !existsSync(join(ext, rel)) || (rel !== "manifest.json" && hash(join(ROOT, rel), rel === "content.js") !== hash(join(ext, rel))));
}

export function reporter(name) {
  const rows = [];
  const check = (label, ok, detail = "") => {
    const status = ok === null ? "NOT TESTABLE" : ok ? "PASS" : "FAIL";
    if (status === "FAIL") process.exitCode = 1;
    const text = typeof detail === "string" ? detail : JSON.stringify(detail);
    rows.push({ name: label, status, detail: text });
    console.log(`${status} ${label}${text ? ` — ${text}` : ""}`);
  };
  process.on("exit", (code) => {
    const n = (s) => rows.filter((r) => r.status === s).length;
    writeFileSync(join(OUT, `${name}.json`), JSON.stringify(rows, null, 2));
    console.log(`RESULT pass=${n("PASS")} fail=${n("FAIL")} nt=${n("NOT TESTABLE")}`);
    if (code === 0 && (rows.length === 0 || n("PASS") + n("FAIL") === 0)) process.exitCode = 1;
  });
  return { rows, check };
}

export async function until(probe, pred, ms = 15000, step = 200) {
  const t0 = Date.now();
  let value = await probe();
  while (!pred(value) && Date.now() - t0 < ms) {
    await sleep(step);
    value = await probe();
  }
  return { value, ok: Boolean(pred(value)), ms: Date.now() - t0 };
}

export async function launch({ name, extension = true, width = 1280, height = 900, ext = EXT, hl = "en", gl = "US", colorScheme = "dark", keep = false, locale = "en-US" } = {}) {
  if (extension && ext === join(ROOT, "dist/chrome") && !process.env.E2E_ALLOW_STALE) {
    const stale = distStale(ext);
    if (stale.length) throw new Error(`dist/chrome is older than the sources (${stale.slice(0, 5).join(", ")}); run npm run build`);
  }
  const profile = join(OUT, `profile-${name}`);
  if (!keep) rmSync(profile, { recursive: true, force: true });
  rmSync(join(profile, "DevToolsActivePort"), { force: true });
  const args = [`--lang=${locale}`, process.env.HEADED === "1" ? "--window-position=-2000,0" : "--headless=new", "--disable-blink-features=AutomationControlled", "--use-mock-keychain", "--password-store=basic", "--remote-debugging-port=0", "--mute-audio"];
  if (extension) args.unshift(`--disable-extensions-except=${ext}`, `--load-extension=${ext}`);
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME,
    headless: false,
    locale,
    ignoreDefaultArgs: ["--enable-automation"],
    colorScheme,
    viewport: { width, height },
    args,
  });
  await context.addCookies([{ name: "PREF", value: `hl=${hl}&gl=${gl}${colorScheme === "dark" ? "&f6=400" : ""}`, domain: ".youtube.com", path: "/", secure: true, sameSite: "Lax", expires: Math.floor(Date.now() / 1000) + 86400 }]);
  let port = null;
  for (let i = 0; i < 50 && !port; i++) {
    const file = join(profile, "DevToolsActivePort");
    port = existsSync(file) ? Number(readFileSync(file, "utf8").split("\n")[0]) : null;
    if (!port) await sleep(100);
  }
  const errors = [];
  const extRequests = [];
  const watchPage = (page) => {
    page.on("pageerror", (err) => {
      const stack = String(err.stack || err);
      if (stack.includes("chrome-extension://") || page.url().startsWith("chrome-extension://")) errors.push({ where: page.url().slice(0, 80), text: stack.slice(0, 400) });
    });
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const loc = msg.location()?.url || "";
      if (loc.startsWith("chrome-extension://") || page.url().startsWith("chrome-extension://")) errors.push({ where: page.url().slice(0, 80), text: msg.text().slice(0, 300), loc });
    });
  };
  context.pages().forEach(watchPage);
  context.on("page", watchPage);
  context.on("request", (req) => {
    const url = req.url();
    if (url.startsWith("chrome-extension://") || url.startsWith("data:") || url.startsWith("blob:")) return;
    let origin = "";
    try {
      origin = req.serviceWorker()?.url() || req.frame()?.url() || "";
    } catch {}
    if (origin.startsWith("chrome-extension://")) extRequests.push({ from: origin.slice(0, 80), url: url.slice(0, 120) });
  });
  const ctx = { context, errors, extRequests, port, name };
  if (!extension) return ctx;
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  ctx.worker = worker;
  ctx.extId = worker.url().split("/")[2];
  context.on("serviceworker", (w) => {
    if (w.url().includes(ctx.extId)) ctx.worker = w;
  });
  for (let i = 0; i < 50 && !ctx.lang; i++) {
    ctx.lang = await ctx.worker.evaluate(() => globalThis.chrome?.i18n?.getUILanguage?.() || null).catch(() => null);
    if (!ctx.lang) await sleep(100);
  }
  if (!ctx.lang) throw new Error("extension service worker did not start");
  ctx.msg = messagesFor(ctx.lang);
  return ctx;
}

export function messagesFor(lang) {
  const tries = [lang.replace("-", "_"), lang.split("-")[0], "en"];
  const loc = tries.find((l) => existsSync(join(ROOT, `_locales/${l}/messages.json`)));
  const M = JSON.parse(readFileSync(join(ROOT, `_locales/${loc}/messages.json`), "utf8"));
  return (key, ...subs) => {
    let s = M[key].message;
    const names = Object.entries(M[key].placeholders || {});
    for (const [name, { content }] of names) s = s.replace(new RegExp(`\\$${name}\\$`, "gi"), subs[Number(content.slice(1)) - 1] ?? "");
    return s;
  };
}

export async function closeWelcome(ctx, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms && !ctx.context.pages().some((p) => p.url().includes("welcome.html"))) await sleep(100);
  for (const p of ctx.context.pages()) if (p.url().includes("welcome.html")) await p.close();
}

export async function consent(page) {
  const reject = page.locator(["Reject", "Отклонить", "Rechazar", "Rejeitar", "Recusar", "ablehnen"].flatMap((t) => [`ytd-consent-bump-v2-lightbox button:has-text("${t}")`, `form button:has-text("${t}")`]).join(", ")).first();
  await reject.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  if (await reject.isVisible().catch(() => false)) {
    await reject.click();
    await page.waitForTimeout(2500);
  }
}

export async function setList(ctx, list) {
  await ctx.worker.evaluate((l) => (l === null ? chrome.storage.local.remove("list") : chrome.storage.local.set({ list: l })), list);
}

export async function getList(ctx) {
  return ctx.worker.evaluate(() => chrome.storage.local.get("list").then((r) => r.list ?? null));
}

export async function goSearch(page, query) {
  await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded" });
  await consent(page);
  await page.waitForSelector("ytd-search ytd-video-renderer, ytd-search yt-lockup-view-model", { timeout: 25000, state: "attached" });
  await sleep(2500);
}

export const CARD_JS = `const CARD = "ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-rich-grid-media, yt-lockup-view-model, ytm-shorts-lockup-view-model, ytd-reel-item-renderer, ytd-channel-renderer, ytd-playlist-renderer, ytd-radio-renderer, ytd-universal-watch-card-renderer, ytd-post-renderer, yt-official-card-view-model";`;

export async function searchCards(page) {
  return page.evaluate(() => {
    const out = [];
    for (const c of document.querySelectorAll("ytd-search:not([hidden]) ytd-video-renderer")) {
      const a = c.querySelector('#channel-info a[href^="/@"], ytd-channel-name a[href^="/@"]');
      const box = c.closest("ytd-rich-item-renderer") || c;
      out.push({ handle: a?.getAttribute("href")?.split("/")[1] || null, name: (c.querySelector("ytd-channel-name #text")?.textContent || "").trim(), hidden: box.hasAttribute("data-shoo-hide"), slot: box.hasAttribute("data-shoo-slot"), shown: c.checkVisibility() && !box.hasAttribute("data-shoo-slot"), title: c.querySelector("#video-title")?.getAttribute("title") || "" });
    }
    return out;
  });
}

export async function finish(ctx, check) {
  check("no extension errors", ctx.errors.length === 0, ctx.errors.slice(0, 5));
  check("no network requests from the extension", ctx.extRequests.length === 0, ctx.extRequests.slice(0, 5));
  await ctx.context.close().catch(() => {});
}

class RawPage {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
      }
    });
  }
  send(method, params = {}) {
    if (this.ws.readyState !== 1) return Promise.resolve({ result: { closed: true } });
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => this.pending.set(id, resolve));
  }
  async eval(fn, arg) {
    const expression = typeof fn === "function" ? `(${fn})(${JSON.stringify(arg)})` : fn;
    const res = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 400));
    return res.result?.result?.value;
  }
  async screenshot(path) {
    const res = await this.send("Page.captureScreenshot", { format: "png" });
    if (res.result?.data) writeFileSync(path, Buffer.from(res.result.data, "base64"));
  }
}

async function cdpTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return res.json();
}

export async function openRealPopup(ctx, frontPage) {
  if (frontPage) await frontPage.bringToFront();
  await sleep(200);
  const r = await ctx.worker.evaluate(async () => {
    try {
      await chrome.action.openPopup();
      return "ok";
    } catch (e) {
      return String(e);
    }
  });
  if (r !== "ok") throw new Error(`openPopup: ${r}`);
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    target = (await cdpTargets(ctx.port)).find((t) => t.url.includes("/popup.html") && t.type === "page");
    if (!target) await sleep(100);
  }
  if (!target) throw new Error("popup target not found");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  const page = new RawPage(ws);
  await page.send("Runtime.enable");
  for (let i = 0; i < 40; i++) {
    if (await page.eval(() => document.body?.dataset.ready === "1").catch(() => false)) break;
    await sleep(100);
  }
  page.isOpen = async () => (await cdpTargets(ctx.port)).some((t) => t.id === target.id);
  page.close = async () => {
    await fetch(`http://127.0.0.1:${ctx.port}/json/close/${target.id}`).catch(() => {});
  };
  return page;
}
