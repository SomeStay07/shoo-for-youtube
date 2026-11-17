const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const L = require("../lib.js");

const sample = (f) => L.parseImport(fs.readFileSync(path.join(__dirname, "samples", f), "utf8"));
const strip = (c) => Object.fromEntries(Object.entries(c).filter(([k]) => ["handle", "id", "name"].includes(k)));

test("BlockTube backup: UC ids with names from context-menu comments, names, plain title words; the rest counted as skipped", () => {
  const p = sample("blocktube_backup.json");
  assert.equal(p.format, "blocktube");
  assert.deepEqual(p.channels.map(strip), [
    { id: "UCabcdefghijklmnopqrstuv", name: "Slop Farm TV" },
    { id: "UC0123456789abcdefghijkl", name: "AI Cats Daily" },
    { id: "UCzyxwvutsrqponmlkjihgfe" },
    { name: "Mr Fake Facts" },
  ]);
  assert.deepEqual(p.words, ["reaction", "10 hours"]);
  assert.equal(p.skipped.patterns, 2, "/ai\\s*story/i in names and /\\bai\\b/i in titles");
  assert.equal(p.skipped.other, 1, "one video id; the default JS filter returns false and is not counted");
});

test("Channel Blocker 1.0 .save: display names, a typed @handle read as a handle, plain title words", () => {
  const p = sample("ChannelBlocker-2026-11-15.save");
  assert.equal(p.format, "channelblocker");
  assert.deepEqual(p.channels.map(strip), [{ name: "Slop Farm TV" }, { name: "AI Cats Daily" }, { handle: "@HandleSomeoneTyped" }]);
  assert.deepEqual(p.words, ["reaction"]);
  assert.equal(p.skipped.patterns, 2, "^\\d+ hours? and the channel pattern AI .*Stories");
  assert.equal(p.skipped.other, 2, "one excluded channel, one comment filter");
});

test("Channel Blocker old numeric-key format", () => {
  const p = sample("channelblocker-old.save");
  assert.equal(p.format, "channelblocker-old");
  assert.deepEqual(p.channels.map((c) => c.name), ["Slop Farm TV", "Old Name Only"]);
  assert.deepEqual(p.words, ["reaction", "Minecraft"]);
  assert.equal(p.skipped.patterns, 1);
  assert.equal(p.skipped.other, 1);
});

test("plain lines: @handle, UC id, channel URLs, names; # lines and blanks ignored", () => {
  const p = sample("plain.txt");
  assert.equal(p.format, "lines");
  assert.deepEqual(p.channels.map(strip), [{ handle: "@SlopFarmTV" }, { handle: "@AICatsDaily" }, { id: "UCabcdefghijklmnopqrstuv" }, { id: "UC0123456789abcdefghijkl" }]);
  const q = L.parseImport("# my list\n\nSome Channel Name\r\n  @x_y.z  \nhttps://m.youtube.com/@Mob\nhttps://www.youtube.com/c/OldCustom\n");
  assert.deepEqual(q.channels.map(strip), [{ name: "Some Channel Name" }, { handle: "@x_y.z" }, { handle: "@Mob" }]);
  assert.equal(q.skipped.other, 1, "/c/ URLs can't be matched");
});

test("percent-encoded handles in URLs are decoded", () => {
  assert.deepEqual(L.parseImport("https://www.youtube.com/@%D0%BA%D0%BE%D1%82").channels.map(strip), [{ handle: "@кот" }]);
});

test("text with nothing usable gives an empty result", () => {
  const p = L.parseImport("   \n# only a comment\n");
  assert.equal(p.channels.length + p.words.length, 0);
  const j = L.parseImport('{"hello": 1}');
  assert.equal(j.channels.length + j.words.length, 0);
});

test("merge always adds, dedupes by handle, then id, then name, and counts what was added", () => {
  const list = { v: 1, channels: [{ handle: "@SlopFarmTV", name: "Slop Farm TV", added: 1, source: "card" }, { name: "AI Cats Daily", added: 2, source: "import" }], words: ["Reaction"] };
  const frozen = JSON.stringify(list);
  const r = L.mergeImport(list, L.parseImport(fs.readFileSync(path.join(__dirname, "samples", "blocktube_backup.json"), "utf8")), 100);
  assert.equal(JSON.stringify(list), frozen, "input list untouched, so Undo can put it back as it was");
  assert.deepEqual(r.added, { channels: 3, words: 1 });
  assert.equal(r.idOnly, 1);
  const cats = r.list.channels.filter((c) => c.name === "AI Cats Daily");
  assert.equal(cats.length, 1, "BlockTube's AI Cats Daily (id + name) merged into the name-only entry");
  assert.equal(cats[0].id, "UC0123456789abcdefghijkl");
  assert.deepEqual(r.list.words, ["Reaction", "10 hours"]);
  const again = L.mergeImport(r.list, L.parseImport(fs.readFileSync(path.join(__dirname, "samples", "blocktube_backup.json"), "utf8")), 200);
  assert.deepEqual(again.added, { channels: 0, words: 0 });
  assert.deepEqual(again.list, r.list);
  const h = L.mergeImport({ v: 1, channels: [{ handle: "@slopfarmtv", added: 1, source: "card" }], words: [] }, L.parseImport("@SlopFarmTV"), 5);
  assert.equal(h.added.channels, 0, "handles compare case-insensitively");
});

test("export then import gives an identical list", () => {
  const list = {
    v: 1,
    channels: [
      { handle: "@A", name: "Ä Channel", added: 1700000000000, source: "card" },
      { id: "UCabcdefghijklmnopqrstuv", added: 1700000000001, source: "import" },
      { name: "Name Only, and more", added: 1700000000002, source: "sidebar" },
      { handle: "@B", id: "UC0123456789abcdefghijkl", name: "B", added: 1700000000003, source: "watch" },
    ],
    words: ["alpha", "c++", "猫", "10 hours"],
  };
  const file = JSON.stringify(L.exportList(list));
  assert.equal(JSON.parse(file).format, "shoo-list");
  assert.equal(JSON.parse(file).version, 1);
  const p = L.parseImport(file);
  assert.equal(p.format, "shoo");
  const r = L.mergeImport(L.emptyList(), p, 9999999999999);
  assert.deepEqual(r.list, list);
  assert.equal(JSON.stringify(r.list), JSON.stringify(list));
});

test("readList repairs junk from storage without throwing", () => {
  assert.deepEqual(L.readList(undefined), L.emptyList());
  assert.deepEqual(L.readList({ channels: [null, 5, { name: "" }, { name: "X" }], words: ["", 3, "w"] }).channels.map((c) => c.name), ["X"]);
  assert.deepEqual(L.readList({ channels: "x", words: {} }), L.emptyList());
});

test("JSON objects and arrays that are not one of the known formats import nothing", () => {
  for (const text of ['[{"name":"X","id":"y"}]', '["a","b"]', "[1, 2, 3]", "[2024]", "[]", "{}", '{"a": 1}', "[\n  1,\n  2\n]"]) {
    const p = L.parseImport(text);
    assert.equal(p.format, "unknown", text);
    assert.equal(p.channels.length + p.words.length, 0, text);
  }
});

test("plain names that look a bit like JSON import as names (a number, a quoted name, names starting with [n])", () => {
  const cases = [
    ["1984", ["1984"]],
    ['"Veritasium"', ["Veritasium"]],
    ["[2024] Best Of Channel\nSecond", ["[2024] Best Of Channel", "Second"]],
    ["[1] Channel One\n[2] Channel Two", ["[1] Channel One", "[2] Channel Two"]],
    ['"Some Channel"\n@next', ["Some Channel", "@next"]],
    ["123", ["123"]],
  ];
  for (const [text, names] of cases) {
    const p = L.parseImport(text);
    assert.equal(p.format, "lines", text);
    assert.deepEqual(p.channels.map((c) => c.name || c.handle), names, text);
  }
});

test("every junk import from QA rounds 1 and 2 still imports nothing", () => {
  const bt = fs.readFileSync(path.join(__dirname, "samples", "blocktube_backup.json"), "utf8");
  const pretty = JSON.stringify(JSON.parse(bt), null, 2);
  const cb = fs.readFileSync(path.join(__dirname, "samples", "ChannelBlocker-2026-11-15.save"), "utf8");
  const cbOld = fs.readFileSync(path.join(__dirname, "samples", "channelblocker-old.save"), "utf8");
  const junk = [
    '{"filterData": {"channelId": [',
    ...[0.2, 0.6, 0.95].map((f) => pretty.slice(0, Math.floor(pretty.length * f))),
    bt.slice(0, Math.floor(bt.length * 0.5)),
    cb.slice(0, Math.floor(cb.length * 0.5)),
    cbOld.slice(0, Math.floor(cbOld.length * 0.5)),
    "\u0000\u0001binary\u00ff",
    '  [\n"@a",\n"@b"',
    "\uFEFF{\"filterData\": {",
    "[1,",
  ];
  for (const text of junk) {
    const p = L.parseImport(text);
    assert.equal(p.format, "unknown", JSON.stringify(text.slice(0, 40)));
    assert.equal(p.channels.length + p.words.length, 0, JSON.stringify(text.slice(0, 40)));
  }
});

test("a file over 5 MB is not read", () => {
  const p = L.parseImport("@a\n".repeat(1_800_000));
  assert.equal(p.format, "too-big");
  assert.equal(p.channels.length + p.words.length, 0);
});

test("more than 20,000 entries in one import are refused as too big, 20,000 still import", () => {
  const lines = (n) => Array.from({ length: n }, (_, i) => `Channel name ${i}`).join("\n");
  const over = L.parseImport(lines(20_001));
  assert.equal(over.format, "too-big");
  assert.equal(over.channels.length + over.words.length, 0);
  assert.equal(L.parseImport(lines(20_000)).channels.length, 20_000);
  const words = L.parseImport(JSON.stringify({ format: "shoo-list", version: 1, channels: [], words: Array.from({ length: 20_001 }, (_, i) => `w${i}`) }));
  assert.equal(words.format, "too-big");
  const t0 = performance.now();
  assert.equal(L.parseImport("Some channel name\n".repeat(190_000)).format, "too-big");
  assert.ok(performance.now() - t0 < 1000);
});

test("merging 5,000 channels and 500 words into 5,000 stays fast", () => {
  const mk = (n, off) => Array.from({ length: n }, (_, i) => ({ ...(i % 2 ? { handle: `@h${off + i}` } : {}), ...(i % 3 === 0 ? { id: "UC" + String(off + i).padStart(22, "x") } : {}), name: `Some Channel ${off + i}` }));
  const base = L.mergeImport(L.emptyList(), { channels: mk(5000, 0), words: Array.from({ length: 500 }, (_, i) => `w${i}`) }, 1).list;
  const t0 = performance.now();
  const r = L.mergeImport(base, { channels: [...mk(2500, 2500), ...mk(5000, 10000)], words: Array.from({ length: 500 }, (_, i) => `w${i + 250}`) }, 2);
  const ms = performance.now() - t0;
  assert.equal(r.added.channels, 5000);
  assert.equal(r.added.words, 250);
  assert.ok(ms < 400, `${ms.toFixed(0)} ms`);
});

test("Undo import removes only what the import added and keeps what was added since", () => {
  const before = { v: 1, channels: [{ id: "UCabcdefghijklmnopqrstuv", added: 1, source: "card" }, { handle: "@keep", name: "Keep", added: 2, source: "card" }], words: ["old"] };
  const r = L.mergeImport(before, L.parseImport("@new1\nNew Two\nhttps://www.youtube.com/@keep"), 10);
  const filled = L.mergeImport(r.list, { channels: [{ id: "UCabcdefghijklmnopqrstuv", name: "Filled Name" }], words: ["fresh"] }, 11);
  const meanwhile = L.addWord(L.addChannel(filled.list, { handle: "@later", name: "Later" }, "card", 12).list, "laterword");
  const undone = L.undoImport(meanwhile, filled.undo);
  assert.deepEqual(undone.channels.map((c) => c.handle || c.id || c.name), ["UCabcdefghijklmnopqrstuv", "@keep", "@new1", "New Two", "@later"]);
  assert.equal(undone.channels[0].name, undefined, "the name the import filled in is taken back");
  assert.deepEqual(undone.words, ["old", "laterword"]);
  const all = L.undoImport(L.undoImport(meanwhile, filled.undo), r.undo);
  assert.deepEqual(all.channels.map((c) => c.handle || c.id), ["UCabcdefghijklmnopqrstuv", "@keep", "@later"]);
});

test("video links (youtu.be, /watch, /shorts) are skipped and counted, never stored as a channel name", () => {
  const p = L.parseImport("https://youtu.be/dQw4w9WgXcQ\nyoutu.be/abc\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\nhttps://www.youtube.com/shorts/abc123\nhttps://m.youtube.com/watch?v=x\n@ok");
  assert.deepEqual(p.channels.map(strip), [{ handle: "@ok" }]);
  assert.equal(p.skipped.other, 5);
});

test("text that starts like JSON but does not parse imports nothing (malformed paste, truncated backup)", () => {
  const bt = fs.readFileSync(path.join(__dirname, "samples", "blocktube_backup.json"), "utf8");
  const pretty = JSON.stringify(JSON.parse(bt), null, 2);
  for (const text of ['{"filterData": {"channelId": [', pretty.slice(0, Math.floor(pretty.length * 0.6)), "  [\n\"@a\",\n\"@b\"", "\uFEFF{\"filterData\": {"]) {
    const p = L.parseImport(text);
    assert.equal(p.format, "unknown", text.slice(0, 40));
    assert.equal(p.channels.length + p.words.length, 0, text.slice(0, 40));
  }
});

test("binary data imports nothing", () => {
  const cases = ["\u0000\u0001binaryÿ", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]).toString("utf8"), Buffer.from(Array.from({ length: 400 }, (_, i) => (i * 37 + 128) % 256).filter((b) => b !== 0)).toString("utf8")];
  for (const text of cases) {
    const p = L.parseImport(text);
    assert.equal(p.format, "unknown", JSON.stringify(text.slice(0, 20)));
    assert.equal(p.channels.length + p.words.length, 0);
  }
});

test("plain name lists still import, including names with brackets, quotes, tabs and non-Latin letters", () => {
  const p = L.parseImport("Slop Farm TV\n[Official] Music\n\"Quoted\" Name\nКот\tи пёс\n日本のチャンネル\nCafé Ünïcode ✨\n");
  assert.equal(p.format, "lines");
  assert.deepEqual(p.channels.map((c) => c.name), ["Slop Farm TV", "[Official] Music", "\"Quoted\" Name", "Кот\tи пёс", "日本のチャンネル", "Café Ünïcode ✨"]);
  for (const first of ["[Official] Music", "{Braces} TV", "[ Spaced ] Name"]) assert.deepEqual(L.parseImport(`${first}\n@next`).channels.map((c) => c.name || c.handle), [first, "@next"], first);
  assert.equal(L.parseImport("One name with a broken letter \uFFFD here\n@ok").channels.length, 2);
});
