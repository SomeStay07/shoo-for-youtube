const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const shipped = ["lib.js", "content.js", "background.js", "popup.js", "list.js", "welcome.js", "importui.js"];

test("permissions are exactly storage and the YouTube host", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.host_permissions, ["https://www.youtube.com/*"]);
  for (const key of ["optional_permissions", "optional_host_permissions", "externally_connectable", "web_accessible_resources", "content_security_policy"]) assert.equal(manifest[key], undefined, key);
});

test("one content script on YouTube at document_start, embeds excluded, isolated world", () => {
  assert.equal(manifest.content_scripts.length, 1);
  const cs = manifest.content_scripts[0];
  assert.deepEqual(cs.matches, ["https://www.youtube.com/*"]);
  assert.deepEqual(cs.exclude_matches, ["https://www.youtube.com/embed/*"]);
  assert.equal(cs.run_at, "document_start");
  assert.equal(cs.world, undefined);
  assert.equal(manifest.minimum_chrome_version, "120");
});

test("shipped JS makes no network requests and never reads YouTube's page data", () => {
  const banned = [/\bfetch\s*\(/, /XMLHttpRequest/, /ytInitialData/, /__data\b/, /\bworld\s*:\s*["']MAIN/, /["']MAIN["']/, /\bsendBeacon\b/, /\bWebSocket\b/, /\bEventSource\b/, /\beval\s*\(/, /new Function\b/, /chrome\.scripting/, /\.polymer\b|\.__dataHost|\binst\.data\b/, /innerHTML|outerHTML\s*=|insertAdjacentHTML|document\.write/];
  for (const file of shipped) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    for (const re of banned) assert.ok(!re.test(text), `${file} contains ${re}`);
  }
});

test("HTML pages load only local scripts and styles", () => {
  for (const file of fs.readdirSync(root).filter((f) => f.endsWith(".html"))) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    for (const [, ref] of text.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(!/^(https?:)?\/\//.test(ref), `${file} loads ${ref}`);
  }
});
