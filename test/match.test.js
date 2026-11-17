const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../lib.js");

const A = { handle: "@SlopFarm", name: "Slop Farm TV", added: 1, source: "card" };
const B = { id: "UCabcdefghijklmnopqrstuv", name: "AI Cats Daily", added: 2, source: "import" };
const C = { name: "Mr Fake Facts", added: 3, source: "import" };
const D = { id: "UCzyxwvutsrqponmlkjihgfe", added: 4, source: "import" };
const list = { v: 1, channels: [A, B, C, D], words: [] };
const m = L.compile(list);
const hit = (slot) => L.matchSlot(m, slot);

test("a handle link matches the listed handle, case-insensitive", () => {
  assert.deepEqual(hit({ handle: "@slopfarm" })?.entry, A);
  assert.equal(hit({ handle: "@SLOPFARM", name: "Something else" })?.by, "handle");
});

test("a UC link matches the listed id", () => {
  assert.equal(hit({ id: "UCabcdefghijklmnopqrstuv" })?.by, "id");
});

test("a namesake with another handle on a linked card is not hidden", () => {
  assert.equal(hit({ handle: "@SlopFarmFan", name: "Slop Farm TV" }), null);
  assert.equal(hit({ id: "UC0000000000000000000000", name: "AI Cats Daily" }), null);
});

test("a name-only slot (sidebar, collab partner) matches the exact remembered name of any entry", () => {
  assert.deepEqual(hit({ name: "Slop Farm TV" })?.entry, A);
  assert.equal(hit({ name: "  slop farm tv " })?.by, "name");
  assert.deepEqual(hit({ name: "Ｓｌｏｐ Farm TV" })?.entry, A, "NFKC");
  assert.equal(hit({ name: "Slop Farm" }), null, "exact name, not a prefix");
});

test("a name-only entry (Channel Blocker import) matches by name even on a linked card", () => {
  assert.deepEqual(hit({ handle: "@anything", name: "Mr Fake Facts" })?.entry, C);
  assert.deepEqual(hit({ name: "mr fake facts" })?.entry, C);
});

test("an id-only entry and a handle-only card can't compare links, so the remembered name decides", () => {
  assert.deepEqual(hit({ handle: "@aicats", name: "AI Cats Daily" })?.entry, B);
  assert.equal(hit({ handle: "@aicats", name: "AI Cats Weekly" }), null);
});

test("an entry with no name matches only by its link", () => {
  assert.deepEqual(hit({ id: "UCzyxwvutsrqponmlkjihgfe" })?.entry, D);
  assert.equal(hit({ name: "" }), null);
});

test("rename: a link match with a different name updates the stored name", () => {
  assert.deepEqual(L.learnFrom(A, { handle: "@SlopFarm", name: "Slop Farm Reloaded" }, "handle"), { name: "Slop Farm Reloaded" });
  assert.equal(L.learnFrom(A, { handle: "@slopfarm", name: "slop farm tv" }, "handle"), null, "same name in another case is not a rename");
});

test("a UC-only entry learns its handle and name from a card that shows its UC link", () => {
  assert.deepEqual(L.learnFrom(D, { id: D.id, handle: "@deedee", name: "Dee Dee" }, "id"), { handle: "@deedee", name: "Dee Dee" });
});

test("never learns a link or a name from a name match", () => {
  assert.equal(L.learnFrom(C, { handle: "@mrfake", name: "Mr Fake Facts" }, "name"), null);
  assert.equal(L.learnFrom(B, { handle: "@aicats", name: "AI Cats Daily" }, "name"), null);
});

test("cardVerdict: channel first, learning only from a single-channel linked card", () => {
  const v = L.cardVerdict(m, { links: [{ handle: "@SlopFarm" }], nameText: "Slop Farm New Name", collab: false, title: "x" });
  assert.equal(v.kind, "channel");
  assert.deepEqual(v.learn, { name: "Slop Farm New Name" });
  const c = L.cardVerdict(m, { links: [{ handle: "@SlopFarm" }], nameText: "Slop Farm New Name and Someone", collab: true, title: "x" });
  assert.equal(c.kind, "channel");
  assert.equal(c.learn, null);
});

test("cardVerdict: exempt entry (the channel's own page) is not hidden by channel", () => {
  const v = L.cardVerdict(m, { links: [{ handle: "@SlopFarm" }], nameText: "Slop Farm TV", title: "x" }, { exempt: L.entryKey(A) });
  assert.equal(v, null);
});

test("entryKey prefers handle, then id, then name", () => {
  assert.equal(L.entryKey(A), "h:slopfarm");
  assert.equal(L.entryKey(B), "i:UCabcdefghijklmnopqrstuv");
  assert.equal(L.entryKey(C), "n:mr fake facts");
});

test("addChannel stores handle/id and name, newest last; removeChannel and restore give the list back", () => {
  const start = L.emptyList();
  const { list: one, key } = L.addChannel(start, { handle: "@New", name: "New One" }, "card", 10);
  assert.deepEqual(one.channels, [{ handle: "@New", name: "New One", added: 10, source: "card" }]);
  const { list: two, removed, index } = L.removeChannel(one, key);
  assert.equal(two.channels.length, 0);
  assert.deepEqual(L.restoreChannel(two, removed, index), one);
  assert.deepEqual(start, L.emptyList(), "inputs are not mutated");
});

test("addChannel merges into an existing entry instead of duplicating it", () => {
  const { list, key, prev } = L.addChannel({ v: 1, channels: [D], words: [] }, { id: D.id, name: "Dee" }, "card", 9);
  assert.equal(list.channels.length, 1);
  assert.equal(list.channels[0].name, "Dee");
  assert.deepEqual(prev, D);
  assert.equal(key, L.entryKey(list.channels[0]));
});

test("words: add, edit, remove; duplicates ignored case-insensitively", () => {
  let list = L.addWord(L.emptyList(), "Alpha");
  list = L.addWord(list, "alpha ");
  list = L.addWord(list, "  ");
  assert.deepEqual(list.words, ["Alpha"]);
  list = L.editWord(list, "Alpha", "beta");
  assert.deepEqual(list.words, ["beta"]);
  assert.deepEqual(L.removeWord(list, "BETA").words, []);
});

test("a removed word comes back at its old place", () => {
  const list = { v: 1, channels: [], words: ["a1", "b2", "c3"] };
  const index = list.words.indexOf("b2");
  const removed = L.removeWord(list, "b2");
  assert.deepEqual(L.restoreWord(removed, "b2", index), list);
  assert.deepEqual(L.restoreWord(list, "b2", 0), list, "already there: unchanged");
});

test("a name that is only a handle (a header's '@handle' row) never replaces the stored name", () => {
  assert.equal(L.learnFrom(A, { handle: "@SlopFarm", name: "@SlopFarm" }, "handle"), null);
  assert.equal(L.learnFrom(D, { id: D.id, name: "@dee" }, "id"), null);
});

test("a card with one handle link and one id link: an id-only entry learns the handle and name", () => {
  const v = L.cardVerdict(m, { links: [{ handle: "@deedee" }, { id: D.id }], nameText: "Dee Dee", collab: false, title: "x" });
  assert.equal(v.by, "id");
  assert.deepEqual(v.learn, { handle: "@deedee", name: "Dee Dee" });
});

test("a card with one handle link and one id link: a handle entry learns the id", () => {
  const v = L.cardVerdict(m, { links: [{ handle: "@SlopFarm" }, { id: "UC1111111111111111111111" }], nameText: "Slop Farm TV", collab: false, title: "x" });
  assert.equal(v.by, "handle");
  assert.deepEqual(v.learn, { id: "UC1111111111111111111111" });
});

test("two different handles on one card: nothing is merged, nothing learned from the second", () => {
  const v = L.cardVerdict(m, { links: [{ handle: "@someoneelse" }, { handle: "@SlopFarm" }], nameText: "Someone Else", collab: false, title: "x" });
  assert.equal(v.by, "handle");
  assert.equal(v.learn, null);
});

test("channel page slot: handle from the URL, id from the page's identifier only while it is the page that was loaded", () => {
  assert.deepEqual(L.channelOfPage("/@veritasium/videos", { docPath: "/@veritasium", metaId: "UCHnyfMqiRRG1u-2MsSQLbXA" }), { handle: "@veritasium", id: "UCHnyfMqiRRG1u-2MsSQLbXA" });
  assert.deepEqual(L.channelOfPage("/@kurzgesagt", { docPath: "/@veritasium", metaId: "UCHnyfMqiRRG1u-2MsSQLbXA" }), { handle: "@kurzgesagt" }, "after an in-app navigation the identifier is stale");
  assert.deepEqual(L.channelOfPage("/c/veritasium/videos", { docPath: "/c/veritasium", metaId: "UCHnyfMqiRRG1u-2MsSQLbXA" }), { id: "UCHnyfMqiRRG1u-2MsSQLbXA" });
  assert.deepEqual(L.channelOfPage("/user/1veritasium", { docPath: "/user/1veritasium", metaId: "UCHnyfMqiRRG1u-2MsSQLbXA" }), { id: "UCHnyfMqiRRG1u-2MsSQLbXA" });
  assert.equal(L.channelOfPage("/c/other", { docPath: "/watch", metaId: "UCHnyfMqiRRG1u-2MsSQLbXA" }), null);
  assert.equal(L.channelOfPage("/c/other", { docPath: "/c/other", metaId: "junk" }), null);
  assert.deepEqual(L.channelOfPage("/channel/UCHnyfMqiRRG1u-2MsSQLbXA", { docPath: "/watch", metaId: "UCzzzzzzzzzzzzzzzzzzzzzz" }), { id: "UCHnyfMqiRRG1u-2MsSQLbXA" });
});

test("/c/ and /user/ pages reached in the app: the header's own @handle names the channel when the address has neither handle nor ID", () => {
  assert.deepEqual(L.channelOfPage("/c/veritasium", { docPath: "/watch", metaId: "UCzzzzzzzzzzzzzzzzzzzzzz", headerHandle: "@veritasium" }), { handle: "@veritasium" });
  assert.deepEqual(L.channelOfPage("/user/1veritasium/videos", { docPath: "/results", headerHandle: " @veritasium " }), { handle: "@veritasium" });
  assert.equal(L.channelOfPage("/c/other", { docPath: "/watch", headerHandle: "Veritasium" }), null, "a name is not a handle");
  assert.equal(L.channelOfPage("/c/other", { docPath: "/watch", headerHandle: "" }), null);
  assert.deepEqual(L.channelOfPage("/@kurzgesagt", { docPath: "/watch", headerHandle: "@veritasium" }), { handle: "@kurzgesagt" }, "the address wins over a stale header");
  assert.deepEqual(L.channelOfPage("/c/veritasium", { docPath: "/c/veritasium", metaId: "UCHnyfMqiRRG1u-2MsSQLbXA", headerHandle: "@veritasium" }), { id: "UCHnyfMqiRRG1u-2MsSQLbXA" });
  assert.equal(L.channelOfPage("/watch", { docPath: "/watch", headerHandle: "@veritasium" }), null);
});

test("channel header after an in-app move: the name is used and learned only when the header's own @handle is the page's", () => {
  const c = { handle: "@InGeniusOfficial" };
  assert.deepEqual(L.headerSlot(c, { name: "Veritasium", handle: "@veritasium" }), { slot: { handle: "@InGeniusOfficial" }, verified: false }, "stale header: no name at all");
  assert.deepEqual(L.headerSlot(c, { name: "InGenius by Veritasium", handle: "@ingeniusofficial" }), { slot: { handle: "@InGeniusOfficial", name: "InGenius by Veritasium" }, verified: true });
  assert.deepEqual(L.headerSlot(c, { name: "InGenius by Veritasium", handle: "" }), { slot: { handle: "@InGeniusOfficial", name: "InGenius by Veritasium" }, verified: false }, "no @handle row: shown, not learned");
  assert.deepEqual(L.headerSlot({ id: "UCHnyfMqiRRG1u-2MsSQLbXA" }, { name: "Veritasium", handle: "@veritasium" }), { slot: { id: "UCHnyfMqiRRG1u-2MsSQLbXA", name: "Veritasium" }, verified: false }, "/channel/ and /c/ pages: nothing to compare, never learned");
  assert.deepEqual(L.headerSlot(c, { name: "", handle: "@ingeniusofficial" }), { slot: { handle: "@InGeniusOfficial" }, verified: true });
});

test("page kinds: a /playlist page is its own kind, not a channel page or a surface", () => {
  assert.equal(L.pageOf("/playlist"), "playlist");
  assert.equal(L.pageOf("/@someone/playlists"), "channel");
  assert.equal(L.pageOf("/watch"), "watch");
  assert.equal(L.pageOf("/feed/playlists"), "other");
});
