// Captioned store screenshots for Shoo (ported from Errand's scripts/store-images.mjs).
//
//   OUT=<scratch> node store/store-images.mjs   render into a scratch dir first and look at every image
//   node store/store-images.mjs                 -> store/images/<locale>/screenshot-N.png
//
// Env: ONLY=<locale> one locale · SHOTS=<dir> captures (default store/shots) · OUT=<dir> output root.
// Input: <SHOTS>/<locale>/*.png from store/capture-shots.mjs (2560x1600, a 1024x640 CSS page at 2.5x) plus
// <SHOTS>/<locale>/frames.json (where the Shoo element sits), and store/captions.json { <locale>: { screens: [[file, caption]] } }.
// Output: 1280x800, 8-bit RGB, no alpha; at most 5, numbered without gaps. The promo tile is store/tiles.mjs (en only).
//
// Framing: FRAMES zooms each capture onto its Shoo element (a crop of the real capture, nothing drawn on it).
// A warning is printed when the frame cuts more than 30 px off that element, or, for an unframed shot, off a side.
// Logo: frames.json carries YouTube's masthead logo per shot; its width in the output is printed and a warning is
// printed above LOGO_LIMIT (store policy: YouTube branding never the most prominent element; Errand's approved shot ~80 px).
// minY / minX in frames.json: the frame never starts above / left of them (shots 2 and 4 start under the masthead,
// shot 1 right of the logo, so no logo at all).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { shoot, pngInfo } from "./tiles.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = resolve(process.env.SHOTS || join(ROOT, "store/shots"));
const OUT = process.env.OUT ? resolve(process.env.OUT) : join(ROOT, "store/images");
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const COPY = JSON.parse(readFileSync(join(ROOT, "store/captions.json"), "utf8"));

// Brand (same palette as the mark in icons/shoo-mark.svg).
const GREEN = "#16302B";
const CREAM = "#F4EBD9";

export const MAX_SCREENSHOTS = 5;
export const CROP_LIMIT = 30;
export const LOGO_LIMIT = 100;
export const SIZE = { width: 1280, height: 800 };

// zoom: how much of the page width to show (1 = all of it, 1.6 = 1/1.6 of it).
// place: where the element's centre sits, as a fraction of the frame height from the top.
export const FRAMES = {
  "1-search-button.png": { zoom: 2.0, place: 0.42 }, // search box and the card's channel row with ⊘, right of the logo (minX)
  "2-hidden-undo.png": { zoom: 1.6, place: 0.3 }, // "Shoo hid videos from … · Undo", under the masthead (minY)
  // the page title and the import card with its result line; headroom: start at most 16 CSS px above the title, so no
  // sliver of the mark above it shows at the top edge (es, where the card is taller)
  "3-import.png": { zoom: 1.3, place: 0.5, headroom: 16 },
  // the popup (hanging from the masthead's bottom edge) and the first dimmed card's reason line; under the masthead (minY)
  "4-popup-show-hidden.png": { zoom: 1.07, place: 0.5 },
  "5-list.png": { zoom: 1.3, place: 0.5 }, // the Words section
};
const PAD = 24; // CSS px kept around the element where the frame allows

export function planScreens(screens, exists, max = MAX_SCREENSHOTS) {
  const render = [];
  const missing = [];
  const dropped = [];
  for (const [file, caption] of screens) {
    if (!exists(file)) missing.push(file);
    else if (render.length >= max) dropped.push(file);
    else render.push({ file, caption, out: `screenshot-${render.length + 1}.png` });
  }
  return { render, missing, dropped };
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

// The part of the capture (image px) shown in the box. Without an anchor: the top of the page, centred.
export function frameWindow(image, box, { zoom = 1, place = 0.5 } = {}, anchor = null, pad = 0, minY = 0, minX = 0) {
  const aspect = box.width / box.height;
  let w = image.width / zoom;
  let h = w / aspect;
  if (h > image.height) {
    h = image.height;
    w = h * aspect;
  }
  let x = (image.width - w) / 2;
  let y = 0;
  if (anchor) {
    x = Math.max(Math.min(anchor.x + anchor.w / 2 - w / 2, anchor.x - pad), minX);
    y = Math.max(anchor.y + anchor.h / 2 - place * h, minY);
  }
  x = clamp(x, 0, image.width - w);
  y = clamp(y, 0, image.height - h);
  return { x, y, w, h, scale: box.width / w };
}

// Output px cut off the anchor (or, without one, off the image's left and right).
export function frameCuts(image, win, anchor = null) {
  const s = win.scale;
  if (!anchor) return { left: win.x * s, right: (image.width - win.x - win.w) * s };
  return {
    left: Math.max(0, win.x - anchor.x) * s,
    right: Math.max(0, anchor.x + anchor.w - (win.x + win.w)) * s,
    top: Math.max(0, win.y - anchor.y) * s,
    bottom: Math.max(0, anchor.y + anchor.h - (win.y + win.h)) * s,
  };
}

// Width (output px) of the part of rect that falls inside the window.
export function visibleWidth(win, rect) {
  if (!rect) return 0;
  const w = Math.min(rect.x + rect.w, win.x + win.w) - Math.max(rect.x, win.x);
  const h = Math.min(rect.y + rect.h, win.y + win.h) - Math.max(rect.y, win.y);
  return w > 0 && h > 0 ? w * win.scale : 0;
}

export function cropWarnings(cuts, limit = CROP_LIMIT) {
  return Object.entries(cuts)
    .filter(([, px]) => px > limit)
    .map(([side, px]) => ({ side, px: Math.round(px) }));
}

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  body { background: ${GREEN}; color: ${CREAM}; font-family: -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased; overflow: hidden; }
`;

function screenshotPage(caption, image, place) {
  const img = place
    ? `<img src="${pathToFileURL(image).href}" style="position:absolute;left:${place.left}px;top:${place.top}px;width:${place.width}px;height:${place.height}px">`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    .frame { width: ${SIZE.width}px; height: ${SIZE.height}px; padding: 56px 80px 0; display: flex; flex-direction: column; gap: 40px; }
    h1 { font-size: 46px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.15; max-width: 1040px; }
    .shot { position: relative; flex: 1; min-height: 0; border-radius: 14px 14px 0 0; overflow: hidden; background: #0f0f0f;
      box-shadow: 0 -2px 0 rgba(244,235,217,0.08), 0 24px 60px rgba(0,0,0,0.35); }
    .shot img { display: block; max-width: none; }
  </style></head><body><div class="frame">
    <h1>${caption}</h1>
    <div class="shot">${img}</div>
  </div></body></html>`;
}

const MEASURE = `<script>const s = document.querySelector(".shot"); document.body.dataset.box = s.clientWidth + "x" + s.clientHeight;</script></body>`;

function measureBox(html) {
  // Headless Chrome sometimes exits non-zero after printing the DOM: use what it printed.
  let dom;
  try {
    dom = execFileSync(
      CHROME,
      ["--headless=new", "--use-mock-keychain", "--password-store=basic", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", `--window-size=${SIZE.width},${SIZE.height}`, "--dump-dom", `data:text/html;base64,${Buffer.from(html.replace("</body>", MEASURE)).toString("base64")}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60000 },
    );
  } catch (e) {
    dom = String(e.stdout || "");
  }
  const found = dom.match(/data-box="(\d+)x(\d+)"/);
  if (!found) throw new Error("could not measure the screenshot box");
  return { width: Number(found[1]), height: Number(found[2]) };
}

function readFrames(locale) {
  const file = join(SHOTS, locale, "frames.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

let warnings = 0;
function warn(text) {
  warnings += 1;
  console.warn(`WARNING ${text}`);
}

function renderScreens(locale, screens) {
  const plan = planScreens(screens, (file) => existsSync(join(SHOTS, locale, file)));
  const frames = readFrames(locale);
  for (const file of plan.missing) console.log(`skip ${locale}/${file} (no screenshot)`);
  for (const file of plan.dropped) warn(`${locale}/${file} dropped: the store takes ${MAX_SCREENSHOTS} screenshots`);
  for (const { file, caption, out } of plan.render) {
    const image = join(SHOTS, locale, file);
    const size = pngInfo(image);
    const box = measureBox(screenshotPage(caption, image, null));
    const frame = FRAMES[file] || {};
    const meta = frames?.shots?.[file] || {};
    const cssAnchor = meta.anchor;
    const k = size.width / (frames?.viewport?.w || size.width);
    const px = (r) => r && { x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k };
    let anchor = null;
    if (frame.zoom && frame.zoom !== 1) {
      if (!cssAnchor) warn(`${locale}/${file}: no anchor in frames.json, shown whole (recapture with store/capture-shots.mjs)`);
      else anchor = px(cssAnchor);
    }
    const minY = anchor ? Math.max((meta.minY || 0) * k, frame.headroom == null ? 0 : anchor.y - frame.headroom * k) : 0;
    const win = frameWindow(size, box, anchor ? frame : {}, anchor, PAD * (anchor ? k : 0), minY, anchor ? (meta.minX || 0) * k : 0);
    const logo = Math.round(visibleWidth(win, px(meta.logo)));
    const place = { left: Math.round(-win.x * win.scale), top: Math.round(-win.y * win.scale), width: Math.round(size.width * win.scale), height: Math.round(size.height * win.scale) };
    const target = join(OUT, locale, out);
    shoot(screenshotPage(caption, image, place), SIZE.width, SIZE.height, target);
    const info = pngInfo(target);
    const ok = info.width === SIZE.width && info.height === SIZE.height && info.bitDepth === 8 && info.colorType === 2;
    const cuts = frameCuts(size, win, anchor);
    const what = anchor ? `zoom ${(size.width / win.w).toFixed(2)}, element cut px` : "whole page, side cut px";
    console.log(
      `${target} <- ${locale}/${file} ${size.width}x${size.height} in ${box.width}x${box.height}, ${what}: ${Object.entries(cuts).map(([k, v]) => `${k} ${Math.round(v)}`).join(" ")}; ` +
        `${info.width}x${info.height} bit depth ${info.bitDepth} colour type ${info.colorType}${info.alpha ? " HAS ALPHA" : ""}; ` +
        `YouTube logo ${meta.logo ? `${logo} px wide` : "not measured"}`,
    );
    if (!ok) warn(`${target}: the store wants ${SIZE.width}x${SIZE.height}, 24-bit RGB PNG, no alpha`);
    if (logo > LOGO_LIMIT) warn(`${locale}/${file}: YouTube's logo is ${logo} px wide (limit ${LOGO_LIMIT}); frame it out or show less zoom`);
    const cut = cropWarnings(cuts);
    if (cut.length) warn(`${locale}/${file}: the frame cuts ${cut.map(({ side, px }) => `${px} px off the ${anchor ? "element's " : ""}${side}`).join(", ")} (limit ${CROP_LIMIT}); change FRAMES or the caption length`);
  }
  const dir = join(OUT, locale);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const n = Number(name.match(/^screenshot-(\d+)\.png$/)?.[1]);
    if (n > plan.render.length) warn(`${join(dir, name)} is left from an older set (this one has ${plan.render.length}); delete it before upload`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  for (const [locale, copy] of Object.entries(COPY)) {
    if (process.env.ONLY && process.env.ONLY !== locale) continue;
    if (!copy.screens) continue;
    renderScreens(locale, copy.screens);
  }
  console.log("promo tile not touched here: node store/tiles.mjs (en only, global in the store)");
  console.log(`${warnings} warning(s)`);
}
