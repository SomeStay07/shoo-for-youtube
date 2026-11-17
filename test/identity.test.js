const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../lib.js");

const ID = "UCzyxwvutsrqponmlkjihgfe";

function blockIdFirstThenLearn() {
  const local = L.addChannel(L.emptyList(), { id: ID, name: "Dee" }, "card", 100);
  const learned = L.patchChannel(local.list, local.key, { handle: "@dee" });
  return { local, learned };
}

test("an id-first block that later learns its handle: Undo with the key it was given still removes it", () => {
  const { local, learned } = blockIdFirstThenLearn();
  assert.equal(local.key, `i:${ID}`);
  assert.equal(L.entryKey(learned.channels[0]), "h:dee", "learning changes the entry key");
  const r = L.removeChannel(learned, local.key);
  assert.equal(r.removed?.id, ID);
  assert.deepEqual(r.list.channels, []);
});

test("Stop hiding with a verdict read before the handle was learned removes the entry", () => {
  const { learned } = blockIdFirstThenLearn();
  const staleKey = L.entryKey({ id: ID, name: "Dee" });
  assert.deepEqual(L.removeChannel(learned, staleKey).list.channels, []);
});

test("a second learn patch sent with the old key still lands", () => {
  const { local, learned } = blockIdFirstThenLearn();
  const renamed = L.patchChannel(learned, local.key, { name: "Dee Renamed" });
  assert.equal(renamed.channels[0].name, "Dee Renamed");
});

test("a handle key never resolves to another entry by id, and a name key keeps exact matching", () => {
  const list = { v: 1, channels: [{ handle: "@one", id: ID, added: 1, source: "card" }, { name: "Plain", added: 2, source: "import" }], words: [] };
  assert.equal(L.removeChannel(list, "h:two").removed, null);
  assert.equal(L.removeChannel(list, "i:UCaaaaaaaaaaaaaaaaaaaaaa").removed, null);
  assert.equal(L.removeChannel(list, "n:plain").removed?.name, "Plain");
  assert.equal(L.removeChannel(list, "n:other").removed, null);
});

test("Undo import finds an id-only entry after it learned its handle and name", () => {
  const before = { v: 1, channels: [{ handle: "@keep", name: "Keep", added: 1, source: "card" }], words: [] };
  const imported = L.mergeImport(before, L.parseImport(ID), 10);
  const learned = L.patchChannel(imported.list, `i:${ID}`, { handle: "@dee", name: "Dee" });
  const undone = L.undoImport(learned, imported.undo);
  assert.deepEqual(undone.channels.map((c) => c.handle), ["@keep"]);
});

test("Undo import puts back an entry the import filled in, even after it learned a handle", () => {
  const before = { v: 1, channels: [{ id: ID, added: 1, source: "card" }], words: [] };
  const imported = L.mergeImport(before, { channels: [{ id: ID, name: "Filled" }], words: [] }, 10);
  const learned = L.patchChannel(imported.list, `i:${ID}`, { handle: "@dee" });
  const undone = L.undoImport(learned, imported.undo);
  assert.deepEqual(undone.channels, [{ id: ID, added: 1, source: "card" }]);
});

test("a retried block whose first run was saved: the result's prev is this tab's own entry, so the local prev is kept", () => {
  const sentAt = 1000;
  const local = L.addChannel(L.emptyList(), { handle: "@x", name: "X" }, "card", sentAt);
  const firstRun = L.addChannel(L.emptyList(), { handle: "@x", name: "X" }, "card", sentAt + 5);
  const retry = L.addChannel(firstRun.list, { handle: "@x", name: "X" }, "card", sentAt + 300);
  assert.deepEqual(retry.prev, firstRun.list.channels[0]);
  const settled = L.settleBlock(local, { key: retry.key, prev: retry.prev, index: retry.index }, sentAt);
  assert.equal(settled.prev, null);
  assert.equal(settled.key, "h:x");
});

test("a block of a channel that was already listed before the click keeps the worker's prev", () => {
  const sentAt = 1000;
  const old = { v: 1, channels: [{ handle: "@x", name: "X", added: 5, source: "card" }], words: [] };
  const local = L.addChannel(L.emptyList(), { handle: "@x", name: "X" }, "card", sentAt);
  const worker = L.addChannel(old, { handle: "@x", name: "X" }, "card", sentAt + 5);
  const settled = L.settleBlock(local, { key: worker.key, prev: worker.prev, index: worker.index }, sentAt);
  assert.deepEqual(settled.prev, old.channels[0]);
  assert.equal(L.settleBlock(local, null, sentAt), null);
});
