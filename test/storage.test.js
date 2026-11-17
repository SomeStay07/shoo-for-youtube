const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../lib.js");

const uc = (i) => "UC" + String(i).padStart(22, "x").slice(-22);
function bigList(n, words) {
  const channels = [];
  for (let i = 0; i < n; i++) {
    const e = { added: 1763200000000 + i, source: i % 3 ? "card" : "import" };
    if (i % 2) e.handle = `@SomeLongChannelHandle${i}`;
    if (i % 3 === 0) e.id = uc(i);
    e.name = `Some Channel Name ${i} – Official`;
    channels.push(e);
  }
  return { v: 1, channels, words: Array.from({ length: words }, (_, i) => `keyword number ${i}`) };
}

test("5,000 channels + 500 words stay under 1 MB", () => {
  const bytes = L.listBytes(bigList(5000, 500));
  assert.ok(bytes < 1024 * 1024, `${bytes} bytes`);
});

test("500 channels + 50 words are at most 100 KB", () => {
  const bytes = L.listBytes(bigList(500, 50));
  assert.ok(bytes <= 100 * 1024, `${bytes} bytes`);
});

test("compiling a 5,000 + 500 list takes under 50 ms and matching stays cheap", () => {
  const list = bigList(5000, 500);
  const t0 = performance.now();
  const m = L.compile(list);
  const compileMs = performance.now() - t0;
  assert.ok(compileMs < 50, `compile ${compileMs.toFixed(1)} ms`);
  const t1 = performance.now();
  for (let i = 0; i < 1000; i++) L.cardVerdict(m, { links: [{ handle: `@nobody${i}` }], nameText: `Nobody ${i}`, title: `A perfectly ordinary video title ${i}` });
  const perCard = (performance.now() - t1) / 1000;
  assert.ok(perCard < 0.5, `${perCard.toFixed(3)} ms per card`);
});

test("listBytes counts UTF-8 bytes, not characters", () => {
  assert.equal(L.listBytes({ v: 1, channels: [], words: ["я"] }), Buffer.byteLength(JSON.stringify({ v: 1, channels: [], words: ["я"] })));
});
