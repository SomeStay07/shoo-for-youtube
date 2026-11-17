// Store screenshots for Shoo, real captures on live YouTube in Chrome for Testing.
//
//   EXT=<unpacked build dir> LANG=<en|ru|es|pt_BR|de>[,<more>] node store/capture-shots.mjs
//
// Build into a scratch dir first and point EXT at it: DIST=<scratch> node scripts/build.mjs; EXT=<scratch>/chrome.
// Never point EXT at a build someone is using (dist/chrome is the owner's unpacked install).
//
// Env:
//   EXT        unpacked build (required)
//   LANG       one locale or a comma list, run one after another. LOCALE wins over LANG if both are set.
//              A shell value like "en_US.UTF-8" is not a locale here: set LANG=en explicitly.
//   SHOTS_OUT  output root (default store/shots); files go to <SHOTS_OUT>/<locale>/
//   SCHEME     dark (default) or light: YouTube via PREF f6=400, extension pages via prefers-color-scheme
//   QUERY      search to use; default tries a few until one channel has 2+ cards
//   THUMBS     blur (default): a frosted layer over every thumbnail (backdrop blur 24 px + a 35% page-colour tint), so
//              faces and thumbnail text can't be read while the page stays calm. keep: thumbnails sharp, only after a
//              person has checked every frame for faces.
//
// Output, 2560x1600 each: a 1024x640 CSS page at 2.5x, so store/store-images.mjs can frame and zoom into the Shoo
// element without upscaling. Where that element sits goes to <SHOTS_OUT>/<locale>/frames.json (CSS px).
//   1-search-button.png      search results, pointer on a card, ⊘ showing next to the channel name
//   2-hidden-undo.png        after the click: "Shoo hid videos from <channel> · Undo" in place of the cards
//   3-import.png             welcome page after pasting a BlockTube export: the import result line
//   4-popup-show-hidden.png  after "Show hidden on this page (N)" in the real popup: the hidden videos back, dimmed, each with its
//                            reason line, and the real popup again over that page in its revealed state
//   5-list.png               the list page with the words and channels
//   report.json              what was captured (no third-party names)
//
// Third-party channel names and avatars are blurred everywhere (YouTube pages, our slot line, the list page).
//
// AppleLanguages (com.google.chrome.for.testing) is machine-global, so this script takes the same lock file as
// Errand's tests/e2e/harness.mjs setLang(): locale scripts of both projects never run in parallel.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { CHROME, consent, openRealPopup, setList, getList, sleep, until } from "../tests/e2e/harness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = {
  en: { apple: "en-US", hl: "en", gl: "US" },
  ru: { apple: "ru-RU", hl: "ru", gl: "RU" },
  es: { apple: "es-ES", hl: "es", gl: "ES" },
  pt_BR: { apple: "pt-BR", hl: "pt", gl: "BR" },
  de: { apple: "de-DE", hl: "de", gl: "DE" },
};
// A 1024x640 CSS page (same layout as a 1280x800 window at 125%), captured at 2.5x = 2560x1600 device px.
const W = 1024;
const H = 640;
const ZOOM = 2.5;
const OUT_W = W * ZOOM;
const OUT_H = H * ZOOM;
const SCHEME = process.env.SCHEME === "light" ? "light" : "dark";
const THUMBS = process.env.THUMBS === "keep" ? "keep" : "blur";
const SHOTS_OUT = resolve(process.env.SHOTS_OUT || join(ROOT, "store/shots"));
// Topic queries, not channel names: titles then rarely carry a channel name. Videos-only filter: no Shorts shelf.
const QUERIES = process.env.QUERY ? [process.env.QUERY] : ["swiftui navigation stack tutorial", "swiftui tutorial", "how black holes work", "black holes explained"];
const VIDEOS_ONLY = "&sp=EgIQAQ%253D%253D";

// Demo import: a BlockTube export (the real file format, same as test/samples/blocktube_backup.json) built from the
// channel names in tests/e2e/data/list-500.json (280 named entries, 279 unique). Words are ours; copy-reviewer may want
// other ones. Three words keep the channel rows in frame on the list page.
const DEMO_CHANNELS = 412;
const DEMO_WORDS = ["reaction", "prank", "10 hours"];

const wantRaw = process.env.LOCALE || (LOCALES[(process.env.LANG || "").split(",")[0]] ? process.env.LANG : "");
if (!process.env.EXT) throw new Error("set EXT=<unpacked build dir> (build into a scratch dir: DIST=<dir> node scripts/build.mjs)");
if (!wantRaw) throw new Error(`set LANG to one of ${Object.keys(LOCALES).join(", ")} (got LANG=${process.env.LANG || ""})`);
const EXT = resolve(process.env.EXT);
if (!existsSync(join(EXT, "manifest.json"))) throw new Error(`no manifest.json in ${EXT}`);
const WANT = wantRaw.split(",");
for (const l of WANT) if (!LOCALES[l]) throw new Error(`unknown locale ${l}; use ${Object.keys(LOCALES).join(", ")}`);

// ---------- AppleLanguages lock (same file and protocol as Errand's harness) ----------
const ERRAND_LOCK = join(ROOT, "../errand-for-youtube/.e2e-out/.lang.lock");
const LANG_LOCK = process.env.LANG_LOCK || (existsSync(dirname(dirname(ERRAND_LOCK))) ? ERRAND_LOCK : join(ROOT, ".e2e-out/.lang.lock"));
const LANG_WAIT_MS = Number(process.env.LANG_LOCK_WAIT_MS || 600000);
let locked = false;
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};
const writeLang = (l) => execFileSync("defaults", ["write", "com.google.chrome.for.testing", "AppleLanguages", `("${l}")`]);
const readLang = () => {
  try {
    return execFileSync("defaults", ["read", "com.google.chrome.for.testing", "AppleLanguages"], { stdio: ["ignore", "pipe", "ignore"] }).toString().replace(/\s+/g, " ").trim();
  } catch {
    return null;
  }
};
function release() {
  if (!locked) return;
  writeLang("en-US");
  rmSync(LANG_LOCK, { force: true });
  locked = false;
}
function lock() {
  if (locked) return;
  mkdirSync(dirname(LANG_LOCK), { recursive: true });
  const start = Date.now();
  for (;;) {
    try {
      writeFileSync(LANG_LOCK, String(process.pid), { flag: "wx" });
      locked = true;
      process.on("exit", () => {
        try {
          release();
        } catch {}
      });
      for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(sig, () => {
        try {
          release();
        } catch {}
        process.exit(1);
      });
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const holder = Number(readFileSync(LANG_LOCK, "utf8").trim());
    if (!holder || !alive(holder)) {
      rmSync(LANG_LOCK, { force: true });
      continue;
    }
    if (Date.now() - start > LANG_WAIT_MS) throw new Error(`AppleLanguages is locked by pid ${holder} (${LANG_LOCK}); locale scripts run one at a time`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
}
function setLang(apple) {
  lock();
  writeLang(apple);
}

// ---------- browser ----------
async function launch(loc) {
  const { apple, hl, gl } = LOCALES[loc];
  const profile = join(tmpdir(), `shoo-store-${loc}-${process.pid}`);
  rmSync(profile, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME,
    headless: false,
    locale: apple,
    ignoreDefaultArgs: ["--enable-automation"],
    colorScheme: SCHEME,
    viewport: { width: W, height: H },
    deviceScaleFactor: ZOOM,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--lang=${apple}`, "--headless=new", "--disable-blink-features=AutomationControlled", "--use-mock-keychain", "--password-store=basic", "--remote-debugging-port=0", "--mute-audio", "--hide-scrollbars"],
  });
  await context.addCookies([{ name: "PREF", value: `hl=${hl}&gl=${gl}${SCHEME === "dark" ? "&f6=400" : ""}`, domain: ".youtube.com", path: "/", secure: true, sameSite: "Lax", expires: Math.floor(Date.now() / 1000) + 86400 }]);
  let port = null;
  for (let i = 0; i < 50 && !port; i++) {
    const file = join(profile, "DevToolsActivePort");
    port = existsSync(file) ? Number(readFileSync(file, "utf8").split("\n")[0]) : null;
    if (!port) await sleep(100);
  }
  const errors = [];
  const watch = (p) => p.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  context.pages().forEach(watch);
  context.on("page", watch);
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const ctx = { context, worker, port, errors, profile, extId: worker.url().split("/")[2] };
  context.on("serviceworker", (w) => {
    if (w.url().includes(ctx.extId)) ctx.worker = w;
  });
  for (let i = 0; i < 50 && !ctx.ui; i++) {
    ctx.ui = await ctx.worker.evaluate(() => chrome.i18n.getUILanguage()).catch(() => null);
    if (!ctx.ui) await sleep(100);
  }
  return ctx;
}

// Names and avatars on YouTube's cards: 6 px leaves the shape of "an avatar and a name" (so ⊘ reads as part of that
// row) and no readable letter or face. Our own lines set the name larger: 8 px there.
const BLUR_PX = Number(process.env.BLUR_PX || 6);
const LINE_BLUR_PX = Math.max(BLUR_PX, 8);
// Thumbnails: a frosted layer on top instead of filter: blur() on the image. A filter smears colour past the edges and
// turns the page muddy; backdrop-filter stays inside the rounded box. 24 px at this size leaves no readable face or text.
const THUMB_TINT = SCHEME === "dark" ? "15, 15, 15" : "255, 255, 255";
const THUMB_CSS = `
  ytd-thumbnail, yt-thumbnail-view-model { position: relative; }
  ytd-thumbnail::after, yt-thumbnail-view-model::after {
    content: ""; position: absolute; inset: 0; z-index: 50; pointer-events: none; border-radius: 12px;
    backdrop-filter: blur(24px); background: rgba(${THUMB_TINT}, 0.35);
  }
  ytd-reel-item-renderer img, ytm-shorts-lockup-view-model img { filter: blur(24px) !important; }
`;
const BLURRED = `#channel-thumbnail, #avatar, yt-img-shadow#avatar, .yt-spec-avatar-shape, yt-avatar-shape, yt-decorated-avatar-view-model, #avatar-btn,
  ytd-topbar-menu-button-renderer img, ytd-channel-name, #channel-name, .yt-content-metadata-view-model-wiz__metadata-text a,
  ytd-video-renderer [class*="metadata-snippet-container"], ytd-video-renderer ytd-expandable-metadata-renderer, #page-manager a[href^="/@"], #page-manager a[href^="/channel/"],
  #page-manager a[href^="/c/"], #page-manager a[href^="/user/"]`;
// Only the outermost match blurs: nested matches (ytd-channel-name > #channel-name > a) used to stack three blurs, and
// the name faded to nothing, leaving ⊘ with no visible row to belong to.
const blurCss = () => `
  :is(${BLURRED}) { filter: blur(${BLUR_PX}px) !important; }
  :is(${BLURRED}) :is(${BLURRED}) { filter: none !important; }
  .shoo-blur { filter: blur(${LINE_BLUR_PX}px) !important; }
  ${THUMBS === "blur" ? THUMB_CSS : ""}
  html { scrollbar-width: none; }
`;

// Our own lines carry the third-party name in their text: wrap that name in a blurred span (display only).
const blurNameIn = (page, selector, name) =>
  page.evaluate(([sel, n]) => {
    let hits = 0;
    for (const node of document.querySelectorAll(sel)) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const texts = [];
      while (walker.nextNode()) if (walker.currentNode.nodeValue.includes(n)) texts.push(walker.currentNode);
      for (const tn of texts) {
        const i = tn.nodeValue.indexOf(n);
        const after = tn.splitText(i);
        after.splitText(n.length);
        const span = document.createElement("span");
        span.className = "shoo-blur";
        span.style.display = "inline-block";
        after.replaceWith(span);
        span.append(after);
        hits += 1;
      }
    }
    return hits;
  }, [selector, name]);

// Union of the boxes of every element matching the selectors, in CSS px of the viewport.
async function rectOf(page, selectors) {
  const r = await page.evaluate((sels) => {
    const boxes = sels.flatMap((s) => [...document.querySelectorAll(s)]).map((n) => n.getBoundingClientRect()).filter((b) => b.width && b.height);
    if (!boxes.length) return null;
    const x = Math.min(...boxes.map((b) => b.left)), y = Math.min(...boxes.map((b) => b.top));
    return { x, y, w: Math.max(...boxes.map((b) => b.right)) - x, h: Math.max(...boxes.map((b) => b.bottom)) - y };
  }, selectors);
  return r && Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v)]));
}

// YouTube's logo in the masthead (CSS px), so store-images.mjs can report how wide it ends up in each store image.
// Store policy: YouTube branding must never be the most prominent element (Errand's approved shot: logo about 80 px).
const logoRect = async (page) => (await rectOf(page, ["ytd-masthead #logo-icon svg"])) || rectOf(page, ["ytd-masthead #logo-icon"]);
// Where a frame may start: under the masthead and under the card before `sel`, so no sliver of it shows at the top edge.
const startUnder = (page, sel, mast) =>
  page.evaluate(([s, m]) => {
    const prev = document.querySelector(s)?.previousElementSibling;
    const b = prev && prev.getClientRects().length ? prev.getBoundingClientRect().bottom : 0;
    return Math.round(Math.max(m, b + 2));
  }, [sel, mast]);
// Bottom of YouTube's masthead (CSS px): frames 2 and 4 start below it, so the logo stays out of those images.
const mastheadBottom = async (page) => (await rectOf(page, ["ytd-masthead #container"]))?.h ?? 56;

async function popupShot(ctx, page, bg, top = 8) {
  const popup = await openRealPopup(ctx, page);
  await popup.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: SCHEME }] });
  await sleep(400);
  // Chrome grows a popup window to its content a moment after it opens; a capture before that tiles the page (a second
  // copy at the right edge, seen on a popup opened right after another). Wait until the window holds the whole body.
  const settled = await until(() => popup.eval(() => innerWidth >= document.documentElement.scrollWidth && innerHeight >= document.documentElement.scrollHeight), Boolean, 3000, 100);
  const info = await popup.eval(() => {
    const b = document.body.getBoundingClientRect();
    const shownText = (id) => {
      const n = document.getElementById(id);
      return n && !n.hidden && n.getClientRects().length ? n.textContent : null;
    };
    return { w: Math.ceil(b.width), h: Math.ceil(b.bottom + parseFloat(getComputedStyle(document.body).marginBottom || 0)), button: shownText("showHidden"), revealed: shownText("revealed"), hideAgain: shownText("hideAgain"), report: shownText("report"), counts: shownText("counts"), lang: document.documentElement.lang };
  });
  info.settled = settled.ok;
  // Still not grown: give the view the body's size (what Chrome sizes the popup window to) before the capture.
  if (!settled.ok) {
    await popup.send("Emulation.setDeviceMetricsOverride", { width: info.w, height: info.h, deviceScaleFactor: 0, mobile: false });
    await sleep(300);
  }
  const res = await popup.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !settled.ok, clip: { x: 0, y: 0, width: info.w, height: info.h, scale: ZOOM } });
  await popup.close();
  const png = res.result?.data;
  if (!png) throw new Error("popup screenshot failed");
  const comp = await ctx.context.newPage();
  await comp.setViewportSize({ width: W, height: H });
  const h = Math.min(info.h, H - top - 16);
  // Where Chrome opens an extension popup: under the toolbar, near the right edge. top: the edge it hangs from (8 px under
  // the top of the page, or just under the masthead when the frame starts there).
  await comp.setContent(`<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;position:relative;background:#000">
    <img src="data:image/png;base64,${bg.toString("base64")}" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px">
    <div style="position:absolute;left:${W - 24 - info.w}px;top:${top}px;width:${info.w}px;height:${h}px;border-radius:10px;overflow:hidden;box-shadow:0 0 0 1px ${SCHEME === "dark" ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)"},0 12px 40px rgba(0,0,0,${SCHEME === "dark" ? 0.6 : 0.28})">
      <img src="data:image/png;base64,${png}" style="display:block;width:${info.w}px">
    </div></body></html>`);
  await sleep(300);
  return { comp, info };
}

async function goSearch(page, query) {
  await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}${VIDEOS_ONLY}`, { waitUntil: "domcontentloaded" });
  await consent(page);
  await page.waitForSelector("ytd-search ytd-video-renderer", { timeout: 25000, state: "attached" });
  await sleep(3000);
}

function demoExport() {
  const list = JSON.parse(readFileSync(join(ROOT, "tests/e2e/data/list-500.json"), "utf8"));
  const names = list.channels.map((c) => c.name).filter(Boolean).slice(0, DEMO_CHANNELS);
  return JSON.stringify({
    filterData: {
      javascript: "(video, objectType) => {\n  // Add custom conditions below\n\n  // Custom conditions did not match, do not block\n  return false;\n}",
      videoId: ["// Add your video ID filters below", ""],
      channelId: ["// Add your channel ID filters below", ""],
      channelName: ["// Add your channel name filters below", ...names, ""],
      comment: ["// Add your comment filters below", ""],
      title: ["// Add your video title filters below", ...DEMO_WORDS, ""],
      vidLength: [null, null],
    },
    options: { shorts: true },
    uiPass: "",
    uiTheme: "dark",
  });
}

const report = { ext: EXT, scheme: SCHEME, thumbs: THUMBS, locales: [] };

try {
  for (const loc of WANT) {
    const row = { locale: loc, shots: {}, problems: [] };
    const frames = {};
    report.locales.push(row);
    const out = join(SHOTS_OUT, loc);
    mkdirSync(out, { recursive: true });
    setLang(LOCALES[loc].apple);
    row.appleLanguages = readLang();
    const ctx = await launch(loc);
    row.ui = ctx.ui;
    if (!ctx.ui || ctx.ui.replace("-", "_").toLowerCase().slice(0, 2) !== loc.toLowerCase().slice(0, 2)) throw new Error(`${loc}: extension UI language is ${ctx.ui}; AppleLanguages did not take (${row.appleLanguages})`);

    // 3: import result on the welcome page (first, on an empty list).
    let welcome;
    for (let i = 0; i < 40 && !welcome; i++) {
      welcome = ctx.context.pages().find((p) => p.url().includes("welcome.html"));
      if (!welcome) await sleep(150);
    }
    if (!welcome) {
      welcome = await ctx.context.newPage();
      await welcome.goto(`chrome-extension://${ctx.extId}/welcome.html`);
    }
    await welcome.setViewportSize({ width: W, height: H });
    await welcome.emulateMedia({ colorScheme: SCHEME });
    await welcome.waitForLoadState("load");
    await setList(ctx, null);
    await welcome.reload();
    await sleep(600);
    await welcome.evaluate((t) => {
      const a = document.getElementById("paste") || document.querySelector("#box textarea");
      a.value = t;
      a.dispatchEvent(new ClipboardEvent("paste", { bubbles: true }));
    }, demoExport());
    const imported = await until(() => welcome.evaluate(() => document.querySelector("#result")?.innerText || ""), (s) => /\d/.test(s), 5000);
    row.shots.import = { result: imported.value };
    if (!imported.ok) row.problems.push("import result did not appear");
    await welcome.evaluate(() => {
      document.getElementById("paste")?.blur();
      document.querySelector("#result")?.scrollIntoView({ block: "nearest" });
    });
    await welcome.mouse.move(W - 4, H - 4);
    await sleep(300);
    frames["3-import.png"] = { anchor: await rectOf(welcome, ["h1", "#import"]) };
    await welcome.screenshot({ path: join(out, "3-import.png") });
    const importedList = await getList(ctx);
    row.shots.import.channels = importedList?.channels?.length ?? 0;
    row.shots.import.words = importedList?.words?.length ?? 0;
    await welcome.close();

    // 1 and 2: search, ⊘ on a card, then the slot line after the click. The imported list stays in storage, so the popup
    // (4) and the list page (5) show the same list: imported channels and words plus the channel hidden from the card.
    const page = await ctx.context.newPage();
    await page.setViewportSize({ width: W, height: H });
    let pick = null;
    for (const q of QUERIES) {
      await goSearch(page, q);
      pick = await page.evaluate(() => {
        const cards = [...document.querySelectorAll("ytd-search:not([hidden]) ytd-video-renderer:not([data-shoo-hide])")];
        const by = {};
        cards.forEach((c, i) => {
          const h = c.querySelector('#channel-info a[href^="/@"], ytd-channel-name a[href^="/@"]')?.getAttribute("href")?.split("/")[1];
          if (h) (by[h] ||= []).push(i);
        });
        const best = Object.entries(by).filter(([, ix]) => ix.length >= 2).sort((a, b) => a[1][0] - b[1][0])[0];
        if (!best) return null;
        const card = cards[best[1][0]];
        card.setAttribute("data-store-a", "");
        return { handle: best[0], cards: best[1].length, index: best[1][0], name: (card.querySelector("ytd-channel-name #text")?.textContent || "").trim() };
      });
      if (pick) {
        row.query = q;
        break;
      }
    }
    if (!pick) {
      await page.screenshot({ path: join(out, "debug-search.png") });
      const seen = await page.evaluate(() => ({ url: location.href, cards: document.querySelectorAll("ytd-search ytd-video-renderer").length, visible: document.querySelectorAll("ytd-search:not([hidden]) ytd-video-renderer").length, hidden: document.querySelectorAll("[data-shoo-hide]").length }));
      throw new Error(`${loc}: no channel with 2+ cards on ${QUERIES.join(" / ")}; last page ${JSON.stringify(seen)}; see ${join(out, "debug-search.png")}`);
    }
    row.shots.search = { cardsOfChannel: pick.cards, firstIndex: pick.index };
    await page.addStyleTag({ content: blurCss() });
    // Titles that name a channel on this page: blur that name inside the title.
    const names = await page.evaluate(() => [...new Set([...document.querySelectorAll("ytd-search ytd-channel-name #text")].map((n) => n.textContent.trim()).filter((n) => n.length >= 3))]);
    let titleHits = 0;
    for (const n of names) titleHits += await blurNameIn(page, "ytd-search #video-title", n);
    row.shots.search.titlesWithChannelName = titleHits;
    // Keep the top of the page (search box, chips) when the card is already in the upper half; otherwise put the
    // card's top just under the masthead so no half card hangs above it.
    await page.evaluate((h) => {
      const top = document.querySelector("[data-store-a]").getBoundingClientRect().top;
      if (top > h * 0.45) window.scrollBy(0, top - 68);
    }, H);
    await sleep(1200);
    const title = await page.locator("[data-store-a] #video-title").boundingBox();
    await page.mouse.move(title.x + 30, title.y + 6);
    await sleep(500);
    const btn = page.locator("[data-store-a] .shoo-btn");
    const bb = await btn.boundingBox().catch(() => null);
    if (!bb) throw new Error(`${loc}: ⊘ did not appear on hover (is the build mid-edit?)`);
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await sleep(400);
    row.shots.search.button = await btn.evaluate((b) => ({ label: b.getAttribute("aria-label") ? "set" : "missing", opacity: getComputedStyle(b).opacity }));
    // Anchor: the query typed in the search box (not the whole box: it is wider than a zoomed frame) and the card's
    // channel row (avatar, name, ⊘), so the frame can zoom in until ⊘ reads as part of that row. The frame starts right
    // of YouTube's logo (minX).
    const logo1 = await logoRect(page);
    const query1 = await page.evaluate(() => {
      const input = document.querySelector("ytd-masthead yt-searchbox input.ytSearchboxComponentInput, ytd-masthead ytd-searchbox input#search");
      if (!input) return null;
      const b = input.getBoundingClientRect();
      const cs = getComputedStyle(input);
      const ctx2d = document.createElement("canvas").getContext("2d");
      ctx2d.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(ctx2d.measureText(input.value).width + 8), h: Math.round(b.height) };
    });
    const row1 = await rectOf(page, ["[data-store-a] #channel-thumbnail", "[data-store-a] .shoo-btn"]);
    const parts1 = [query1, row1].filter(Boolean);
    const anchor1 = { x: Math.min(...parts1.map((r) => r.x)), y: Math.min(...parts1.map((r) => r.y)) };
    anchor1.w = Math.max(...parts1.map((r) => r.x + r.w)) - anchor1.x;
    anchor1.h = Math.max(...parts1.map((r) => r.y + r.h)) - anchor1.y;
    frames["1-search-button.png"] = { anchor: anchor1, query: query1, row: row1, logo: logo1, minX: logo1 ? logo1.x + logo1.w + 4 : 0 };
    await page.screenshot({ path: join(out, "1-search-button.png") });

    await btn.click();
    const slot = await until(() => page.evaluate(() => document.querySelector("[data-shoo-slot] > .shoo-line")?.innerText || ""), Boolean, 4000, 100);
    if (!slot.ok) throw new Error(`${loc}: no "hid videos from … · Undo" line after the click`);
    await blurNameIn(page, "[data-shoo-slot] .shoo-line .shoo-text", pick.name);
    await page.mouse.move(W - 4, H - 4);
    await page.evaluate(() => document.activeElement?.blur());
    // The frame starts under the masthead (no YouTube logo in this image): put the line just under it.
    const mast = await mastheadBottom(page);
    await page.evaluate((y) => {
      const top = document.querySelector("[data-shoo-slot] > .shoo-line").getBoundingClientRect().top;
      window.scrollBy(0, top - y);
    }, mast + 24);
    await sleep(600);
    row.shots.hidden = { lineHasName: slot.value.includes(pick.name), hiddenCards: await page.evaluate(() => document.querySelectorAll("[data-shoo-hide]").length) };
    const slotLine = await rectOf(page, ["[data-shoo-slot] > .shoo-line > *"]);
    frames["2-hidden-undo.png"] = { anchor: slotLine, logo: await logoRect(page), minY: await startUnder(page, "[data-shoo-slot]", mast) };
    await page.screenshot({ path: join(out, "2-hidden-undo.png") });

    // 4: "See what Shoo hid on this page". The real flow: open the popup, press "Show hidden on this page (N)"; the
    // page then shows the hidden videos dimmed, each with its reason line. Then the popup again, in its revealed state
    // ("Hidden videos are shown on this page" · "Hide them again" · Edit list · Report a problem), over that page.
    const first = await openRealPopup(ctx, page);
    row.shots.popup = { button: await first.eval(() => document.getElementById("showHidden")?.textContent || null) };
    if (!row.shots.popup.button) row.problems.push("popup has no 'Show hidden on this page' button");
    await first.eval(() => document.getElementById("showHidden")?.click());
    await sleep(300);
    if (await first.isOpen()) await first.close();
    const shown = await until(() => page.evaluate(() => document.documentElement.hasAttribute("data-shoo-reveal") && document.querySelectorAll("[data-shoo-hide] > .shoo-reason").length), (n) => n > 0, 5000, 100);
    if (!shown.ok) throw new Error(`${loc}: "Show hidden" did not reveal anything`);
    await page.mouse.move(W - 4, H - 4);
    await page.evaluate(() => document.activeElement?.blur());
    // The frame starts under the masthead (no logo) with the popup hanging from that edge: put the first dimmed card's
    // reason line just under it, so both hidden cards of that channel are in frame.
    await page.evaluate((y) => {
      const r = (document.querySelector("[data-shoo-hide][data-store-a] > .shoo-reason") || document.querySelector("[data-shoo-hide] > .shoo-reason")).getBoundingClientRect().top;
      window.scrollBy(0, r - y);
    }, mast + 24);
    await sleep(800);
    // Reason lines carry the channel name: blur it (every channel name on the page, plus the one hidden from the card).
    let reasonHits = 0;
    for (const n of new Set([pick.name, ...names])) reasonHits += await blurNameIn(page, "[data-shoo-hide] > .shoo-reason span", n);
    const reasons = await page.evaluate(() => [...document.querySelectorAll("[data-shoo-hide] > .shoo-reason")].map((r) => ({ blurred: Boolean(r.querySelector(".shoo-blur")), box: r.getBoundingClientRect().top })));
    row.shots.revealed = { reasonLines: reasons.length, blurredNames: reasonHits };
    if (reasons.some((r) => !r.blurred)) row.problems.push(`revealed: ${reasons.filter((r) => !r.blurred).length} reason line(s) without a blurred name (a word reason has no name; a channel one must)`);
    await sleep(300);
    const bg = await page.screenshot({ type: "png" });
    const reasonRect = await rectOf(page, ["[data-shoo-hide][data-store-a] > .shoo-reason .shoo-row > *"]) || await rectOf(page, ["[data-shoo-hide] > .shoo-reason .shoo-row > *"]);
    const cardRect = await page.evaluate(() => {
      const b = (document.querySelector("[data-shoo-hide][data-store-a]") || document.querySelector("[data-shoo-hide]")).getBoundingClientRect();
      return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) };
    });
    const logo4 = await logoRect(page);
    const start4 = await startUnder(page, "[data-shoo-hide][data-store-a]", mast);
    const popTop = start4 + 6;
    const { comp, info } = await popupShot(ctx, page, bg, popTop);
    row.shots.popup.revealed = { text: info.revealed, hideAgain: info.hideAgain, report: info.report, h: info.h, settled: info.settled };
    if (!info.hideAgain) row.problems.push("revealed popup has no 'Hide them again' button");
    if (!info.report) row.problems.push("popup has no 'Report a problem' link");
    const pop = { x: W - 24 - info.w, y: popTop, w: info.w, h: Math.min(info.h, H - popTop - 16) };
    // Anchor: the popup and the first reason line; the frame keeps both whole and stays under the masthead.
    const anchor4 = reasonRect ? { x: Math.min(pop.x, reasonRect.x), y: Math.min(pop.y, reasonRect.y) } : { x: pop.x, y: pop.y };
    anchor4.w = Math.max(pop.x + pop.w, reasonRect ? reasonRect.x + reasonRect.w : 0) - anchor4.x;
    anchor4.h = Math.max(pop.y + pop.h, reasonRect ? reasonRect.y + reasonRect.h : 0) - anchor4.y;
    frames["4-popup-show-hidden.png"] = { anchor: anchor4, popup: pop, reason: reasonRect, card: cardRect, logo: logo4, minY: start4 };
    await comp.screenshot({ path: join(out, "4-popup-show-hidden.png") });
    await comp.close();

    // 5: the list page: imported channels and words plus the one hidden from the card.
    const now = await getList(ctx);
    row.shots.popup.list = { channels: now?.channels?.length ?? 0, words: now?.words?.length ?? 0 };
    const list = await ctx.context.newPage();
    await list.setViewportSize({ width: W, height: H });
    await list.emulateMedia({ colorScheme: SCHEME });
    await list.goto(`chrome-extension://${ctx.extId}/list.html`);
    await until(() => list.evaluate(() => document.querySelectorAll("#channels li").length), (n) => n > 0, 5000);
    await list.addStyleTag({ content: `#channels .name, #channels .meta a { filter: blur(${LINE_BLUR_PX}px) !important; } html { scrollbar-width: none; }` });
    // At 125% the page is taller than the frame: start at the Words heading so channel rows are in frame too.
    await list.evaluate(() => {
      const h = document.querySelector("section h2");
      window.scrollBy(0, h.getBoundingClientRect().top - 14);
    });
    await list.mouse.move(W - 4, H - 4);
    await sleep(400);
    row.shots.list = await list.evaluate(() => ({ words: document.querySelectorAll("#words li").length, channels: document.querySelectorAll("#channels li").length, lang: document.documentElement.lang }));
    frames["5-list.png"] = { anchor: await rectOf(list, ["section:has(#words)"]) };
    await list.screenshot({ path: join(out, "5-list.png") });
    if (row.shots.list.channels !== row.shots.popup.list.channels || row.shots.list.words !== row.shots.popup.list.words) row.problems.push(`popup list ${JSON.stringify(row.shots.popup.list)} and list page ${JSON.stringify(row.shots.list)} differ`);
    await list.close();

    row.sizes = {};
    for (const f of ["1-search-button.png", "2-hidden-undo.png", "3-import.png", "4-popup-show-hidden.png", "5-list.png"]) {
      const head = readFileSync(join(out, f)).subarray(0, 26);
      row.sizes[f] = `${head.readUInt32BE(16)}x${head.readUInt32BE(20)} type ${head[25]}`;
      if (head.readUInt32BE(16) !== OUT_W || head.readUInt32BE(20) !== OUT_H) row.problems.push(`${f} is ${row.sizes[f]}, want ${OUT_W}x${OUT_H}`);
    }
    writeFileSync(join(out, "frames.json"), JSON.stringify({ viewport: { w: W, h: H }, scale: ZOOM, shots: frames }, null, 2));
    row.errors = ctx.errors;
    await ctx.context.close();
    rmSync(ctx.profile, { recursive: true, force: true });
    console.log(`${loc}: ${out}`, JSON.stringify(row));
  }
} finally {
  release();
  report.appleLanguagesAfter = readLang();
  mkdirSync(SHOTS_OUT, { recursive: true });
  writeFileSync(join(SHOTS_OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(`AppleLanguages now ${report.appleLanguagesAfter}; report ${join(SHOTS_OUT, "report.json")}`);
}
