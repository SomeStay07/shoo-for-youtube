// Small promo tile 440x280 for the Chrome Web Store. Tiles are global (not per locale): en only.
// Usage: node store/tiles.mjs            -> store/images/en/promo-small-440x280.png
//        OUT=<dir> node store/tiles.mjs  -> <dir>/promo-small-440x280.png (render to scratch first)
// Text and the mark are drawn here (plain HTML in headless Chrome); no generated art in v0.1.
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.OUT ? resolve(process.env.OUT) : join(ROOT, "store/images/en");
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const COPY = JSON.parse(readFileSync(join(ROOT, "store/captions.json"), "utf8")).en;
const mark = readFileSync(join(ROOT, "icons/shoo-mark.svg"), "utf8").replace(/<!--[\s\S]*?-->\s*/g, "");

// Brand: deep green #16302B, cream #F4EBD9, amber #F2A541 (Errand's palette; Shoo is the inverse body: cream disc, green ring).
const GREEN = "#16302B";
const CREAM = "#F4EBD9";

export function shoot(html, width, height, out) {
  const dir = mkdtempSync(join(tmpdir(), "shoo-render-"));
  const page = join(dir, "page.html");
  writeFileSync(page, html);
  mkdirSync(dirname(out), { recursive: true });
  // Opaque page and an opaque default background: Chrome writes an RGB PNG (colour type 2), no alpha.
  const run = () => execFileSync(CHROME, ["--headless=new", "--use-mock-keychain", "--password-store=basic", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", `--window-size=${width},${height}`, `--screenshot=${out}`, pathToFileURL(page).href], { stdio: "ignore", timeout: 60000 });
  try {
    run();
  } catch {
    run();
  }
  rmSync(dir, { recursive: true, force: true });
}

export function pngInfo(file) {
  const head = Buffer.alloc(26);
  const fd = openSync(file, "r");
  readSync(fd, head, 0, 26, 0);
  closeSync(fd);
  if (head.toString("latin1", 1, 4) !== "PNG") throw new Error(`${file} is not a PNG`);
  const type = head[25];
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20), bitDepth: head[24], colorType: type, alpha: type === 4 || type === 6 };
}

function small(text) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; }
    body { width: 440px; height: 280px; overflow: hidden; background: ${GREEN}; color: ${CREAM};
      font-family: -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif; -webkit-font-smoothing: antialiased; }
    .tile { position: relative; width: 440px; height: 280px; overflow: hidden; }
    /* One quiet echo of the mark, bleeding off the right edge: ring and slash in a lighter green, no fill. */
    .echo { position: absolute; width: 300px; height: 300px; right: -205px; top: 50%; transform: translateY(-50%); }
    .echo circle, .echo path { stroke: #23463F; }
    .text { position: absolute; left: 28px; top: 0; bottom: 0; width: 340px; display: flex; flex-direction: column; justify-content: center; }
    .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
    .brand svg { width: 46px; height: 46px; flex: none; border-radius: 50%; box-shadow: 0 0 0 2px rgba(244, 235, 217, 0.22); }
    .name { font-size: 32px; font-weight: 700; letter-spacing: -0.02em; }
    .slogan { font-size: 27px; font-weight: 650; line-height: 1.18; letter-spacing: -0.015em; }
  </style></head><body><div class="tile">
    <svg class="echo" viewBox="0 0 96 96"><circle cx="48" cy="48" r="43" fill="none" stroke-width="7"/><path d="M18 18 L78 78" stroke-width="7"/></svg>
    <div class="text">
      <div class="brand">${mark}<div class="name">Shoo</div></div>
      <div class="slogan">${text}</div>
    </div>
  </div></body></html>`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const out = join(OUT, "promo-small-440x280.png");
  shoot(small(COPY.tile), 440, 280, out);
  const info = pngInfo(out);
  const ok = info.width === 440 && info.height === 280 && !info.alpha && info.bitDepth === 8 && info.colorType === 2;
  console.log(`${out} ${info.width}x${info.height} bit depth ${info.bitDepth} colour type ${info.colorType}${info.alpha ? " (HAS ALPHA)" : " (RGB, no alpha)"}`);
  if (!ok) {
    console.error("FAIL: the store wants 440x280, 24-bit RGB PNG, no alpha");
    process.exitCode = 1;
  }
}
