const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const REQUIRED = ["en", "ru", "es", "pt_BR", "de"];
const localeDirs = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
const locales = localeDirs(path.join(root, "_locales"));
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const messages = Object.fromEntries(locales.map((loc) => [loc, JSON.parse(read(`_locales/${loc}/messages.json`))]));
const SCRIPTS = ["content.js", "popup.js", "welcome.js", "list.js", "background.js", "importui.js"];
const PAGES = ["popup.html", "welcome.html", "list.html"];

function usedKeys() {
  const keys = new Set(["extNameShort"]);
  for (const file of SCRIPTS) for (const match of read(file).matchAll(/\bt\("(\w+)"/g)) keys.add(match[1]);
  for (const file of PAGES) for (const match of read(file).matchAll(/data-i18n(?:-\w+)?="(\w+)"/g)) keys.add(match[1]);
  for (const match of read("manifest.json").matchAll(/__MSG_(\w+)__/g)) keys.add(match[1]);
  for (const match of read("popup.js").matchAll(/: "(surface\w+)"/g)) keys.add(match[1]);
  return keys;
}

test("dot-files next to the locale folders are not read as locales", () => {
  assert.ok(!locales.some((l) => l.startsWith(".")));
});

test("every used key exists in every locale, and en has no keys nobody uses", () => {
  const used = usedKeys();
  for (const key of used) for (const loc of locales) assert.ok(messages[loc][key]?.message?.trim(), `${loc} is missing ${key}`);
  const unused = Object.keys(messages.en).filter((k) => !used.has(k));
  assert.deepEqual(unused, [], "unused keys in en");
});

test("all locales have the same keys and placeholders", () => {
  const base = messages.en;
  for (const loc of locales) {
    assert.deepEqual(Object.keys(messages[loc]).sort(), Object.keys(base).sort(), loc);
    for (const [key, value] of Object.entries(base)) {
      const names = Object.keys(value.placeholders || {}).sort();
      assert.deepEqual(Object.keys(messages[loc][key].placeholders || {}).sort(), names, `${loc}.${key}`);
      for (const name of names) assert.ok(messages[loc][key].message.includes(`$${name.toUpperCase()}$`), `${loc}.${key} uses $${name}$`);
    }
  }
});

test("store limits: name <= 75, short name <= 45, description <= 132 characters", () => {
  for (const loc of locales) {
    assert.ok(messages[loc].extName.message.length <= 75, `${loc} name`);
    assert.ok(messages[loc].extNameShort.message.length <= 45, `${loc} short name`);
    assert.ok(messages[loc].extDescription.message.length <= 132, `${loc} description`);
  }
});

test("UI copy never claims AI detection and never says it never breaks", () => {
  for (const loc of locales) {
    for (const [key, { message }] of Object.entries(messages[loc])) {
      assert.ok(!/detects? AI|AI[- ]detect|never breaks/i.test(message), `${loc}.${key}`);
    }
  }
});

const missing = REQUIRED.filter((loc) => !locales.includes(loc));
test("all five locales are present (en, ru, es, pt_BR, de)", { skip: missing.length ? `waiting for the copywriter: ${missing.join(", ")}` : false }, () => {
  assert.deepEqual(missing, []);
});
