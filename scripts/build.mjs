import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_HOOK, stripTestHooks } from "./ship.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = process.env.DIST || join(ROOT, "dist");
const TEST_HOOKS = process.env.SHOO_TEST_HOOKS === "1";
export const FILES = ["manifest.json", "lib.js", "content.js", "background.js", "block.css", "popup.html", "popup.css", "popup.js", "welcome.html", "welcome.js", "list.html", "list.js", "importui.js", "pages.css", "icons", "_locales"];
const SKIP = new Set([".DS_Store", "icon-1024.png", "shoo-mark.svg"]);

const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));

function referencedFiles(out) {
  const refs = new Set([`_locales/${manifest.default_locale}/messages.json`]);
  const add = (value) => {
    if (typeof value === "string") refs.add(value);
    else if (Array.isArray(value)) value.forEach(add);
    else if (value && typeof value === "object") Object.values(value).forEach(add);
  };
  add(manifest.icons);
  add(manifest.action?.default_icon);
  add(manifest.action?.default_popup);
  add(manifest.background?.service_worker);
  add(manifest.options_page);
  for (const script of manifest.content_scripts || []) add([script.js, script.css]);
  for (const file of readdirSync(out).filter((f) => /\.(html|js)$/.test(f))) {
    const text = readFileSync(join(out, file), "utf8");
    const pattern = file.endsWith(".html") ? /(?:src|href)="([^"]+)"/g : /(?:importScripts|getURL)\("([^"]+)"\)/g;
    for (const [, ref] of text.matchAll(pattern)) refs.add(ref);
  }
  return [...refs].map((ref) => ref.split(/[?#]/)[0]).filter((ref) => ref && !/^[a-z]+:|^\/\//i.test(ref));
}

const out = join(DIST, "chrome");
const zip = join(DIST, `shoo-chrome-${manifest.version}.zip`);
rmSync(out, { recursive: true, force: true });
for (const file of existsSync(DIST) ? readdirSync(DIST).filter((f) => /^shoo-chrome-.*\.zip$/.test(f)) : []) rmSync(join(DIST, file), { force: true });
mkdirSync(out, { recursive: true });
for (const file of FILES) cpSync(join(ROOT, file), join(out, file), { recursive: true, filter: (src) => !SKIP.has(basename(src)) });
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
if (!TEST_HOOKS) writeFileSync(join(out, "content.js"), stripTestHooks(readFileSync(join(ROOT, "content.js"), "utf8")));
const hooked = readdirSync(out).filter((f) => f.endsWith(".js") && readFileSync(join(out, f), "utf8").includes(TEST_HOOK));
if (!TEST_HOOKS && hooked.length) throw new Error(`test hook left in the package: ${hooked.join(", ")}`);
if (TEST_HOOKS && !hooked.length) throw new Error("SHOO_TEST_HOOKS=1 but the test hook is missing");
const missing = referencedFiles(out).filter((ref) => !existsSync(join(out, ref)));
if (missing.length) throw new Error(`referenced but not shipped: ${missing.join(", ")}`);
execFileSync("zip", ["-qrX", zip, ".", "-x", "*.DS_Store"], { cwd: out });
console.log(`chrome: ${out}${TEST_HOOKS ? " (test build with hooks, not for the store)" : ""}\nzip: ${zip}`);
