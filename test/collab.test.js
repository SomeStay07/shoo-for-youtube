const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../lib.js");

test("splits 'A and B' in the five UI languages", () => {
  for (const sep of ["and", "und", "и", "y", "e"]) {
    assert.deepEqual(L.collabNames(`Alpha Channel ${sep} Beta`).parts, ["Alpha Channel", "Beta"], sep);
  }
});

test("splits 'A, B and C'", () => {
  assert.deepEqual(L.collabNames("A1, B2 and C3").parts, ["A1", "B2", "C3"]);
});

test("the whole text is tried first, as one name", () => {
  const c = L.collabNames("Tom and Jerry");
  assert.equal(c.whole, "Tom and Jerry");
  assert.deepEqual(L.collabNames("Solo").parts, ["Solo"]);
});

test("'and N more' keeps only the readable names", () => {
  for (const text of ["Chiefy and 2 more", "Chiefy и ещё 2", "Chiefy und 4 weitere", "Chiefy y 2 más", "Chiefy e mais 2", "Chiefy и еще 10"]) {
    const c = L.collabNames(text);
    assert.deepEqual(c.parts, ["Chiefy"], text);
    assert.equal(c.more, true, text);
  }
  assert.deepEqual(L.collabNames("A, B, and more").parts, ["A", "B"]);
});

const list = { v: 1, channels: [{ name: "Beta" }, { handle: "@alpha", name: "Alpha" }, { name: "Tom and Jerry" }], words: [] };
const m = L.compile(list);

test("a collab card hides if any readable channel matches", () => {
  assert.equal(L.cardVerdict(m, { links: [{ handle: "@other" }], nameText: "Other and Beta", collab: true, title: "t" })?.entry.name, "Beta");
  assert.equal(L.cardVerdict(m, { links: [{ handle: "@alpha" }], nameText: "Alpha and Gamma", collab: true, title: "t" })?.by, "handle");
  assert.equal(L.cardVerdict(m, { links: [], nameText: "Gamma, Delta and Beta", collab: true, title: "t" })?.entry.name, "Beta");
  assert.equal(L.cardVerdict(m, { links: [], nameText: "Gamma and 3 more", collab: true, title: "t" }), null);
});

test("a single-channel card whose name contains 'and' matches as one name and never by its parts", () => {
  assert.equal(L.cardVerdict(m, { links: [{ handle: "@tj" }], nameText: "Tom and Jerry", collab: false, title: "t" })?.entry.name, "Tom and Jerry");
  assert.equal(L.cardVerdict(m, { links: [{ handle: "@ob" }], nameText: "Other and Beta", collab: false, title: "t" }), null);
});

test("the collab button lists the readable channels, first with its link", () => {
  assert.deepEqual(L.cardChannels({ links: [{ handle: "@a" }], nameText: "A and B", collab: true }), [{ handle: "@a", name: "A" }, { name: "B" }]);
  assert.deepEqual(L.cardChannels({ links: [{ handle: "@a" }], nameText: "A and 2 more", collab: true }), [{ handle: "@a", name: "A" }]);
  assert.deepEqual(L.cardChannels({ links: [{ handle: "@tj" }], nameText: "Tom and Jerry", collab: false }), [{ handle: "@tj", name: "Tom and Jerry" }]);
  assert.deepEqual(L.cardChannels({ links: [], nameText: "", collab: false }), []);
});
