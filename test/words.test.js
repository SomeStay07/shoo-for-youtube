const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../lib.js");

const w = (words) => L.compileWords(words);

test("a word hides titles with a word that starts with it", () => {
  const f = w(["alpha"]);
  assert.equal(f("Alphas are here"), "alpha");
  assert.equal(f("ALPHA test"), "alpha");
  assert.equal(f("the alpha-male myth"), "alpha");
  assert.equal(f("betaalpha"), null, "not inside a word");
});

test("word starts cover Russian and German inflections", () => {
  assert.equal(w(["котик"])("Смешные котики 2026"), "котик");
  assert.equal(w(["Katze"])("Lustige Katzen"), "Katze");
});

test("words of 3 letters or fewer match whole words only", () => {
  const f = w(["AI"]);
  assert.equal(f("AI tools you need"), "AI");
  assert.equal(f("New ai: the end"), "AI");
  assert.equal(f("ai-generated stories"), "AI");
  for (const t of ["Aim higher", "Fresh air", "First aid", "Thai food", "Said it"]) assert.equal(f(t), null, t);
  assert.equal(w(["cat"])("Cats and category"), null);
  assert.equal(w(["cat"])("My cat"), "cat");
});

test("case-insensitive and NFKC-normalized on both sides", () => {
  assert.equal(w(["ＡＩ"])("AI tools"), "ＡＩ");
  assert.equal(w(["ai"])("ＡＩ tools"), "ai");
  assert.equal(w(["ﬁnance"])("Finance news"), "ﬁnance");
});

test("regex characters are taken literally", () => {
  assert.equal(w(["c++"])("C++ tutorial"), "c++");
  assert.equal(w(["c++"])("C tutorial"), null);
  assert.equal(w(["a.b"])("axb"), null);
  assert.equal(w(["(ai)"])("Video (AI) test"), "(ai)");
  assert.equal(w(["[x]"])("x"), null);
  assert.doesNotThrow(() => w(["\\", "$", "^", "|", "?", "*", "+", "{1}", "/"]));
});

test("phrases match with any whitespace between words", () => {
  assert.equal(w(["10 hours"])("10  Hours of rain"), "10 hours");
  assert.equal(w(["10 hours"])("10 minutes"), null);
});

test("scripts without spaces match as substrings", () => {
  assert.equal(w(["猫"])("かわいい猫の動画"), "猫");
  assert.equal(w(["ゲーム"])("ゲーム実況まとめ"), "ゲーム");
  assert.equal(w(["แมว"])("วิดีโอแมวตลก"), "แมว");
  assert.equal(w(["ai"])("AIツール"), "ai", "CJK next to a Latin word counts as a boundary");
});

test("empty and blank words are ignored; no words means nothing matches", () => {
  assert.equal(w([])("anything"), null);
  assert.equal(w(["", "  "])("anything"), null);
});

test("titles only: a word in the channel name or description never hides the card", () => {
  const m = L.compile({ v: 1, channels: [], words: ["slop"] });
  assert.equal(L.cardVerdict(m, { links: [], nameText: "Slop Farm TV", title: "Nice video", description: "slop slop" }), null);
  assert.equal(L.cardVerdict(m, { links: [], nameText: "Nice", title: "Slop compilation" })?.word, "slop");
});
