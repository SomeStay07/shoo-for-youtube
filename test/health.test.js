const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../lib.js");

test("a problem is reported only after two checks in a row see it", () => {
  const first = L.confirmHealth(null, ["search"]);
  assert.deepEqual(first, { report: null, pending: ["search"] });
  const second = L.confirmHealth(first.pending, ["search"]);
  assert.deepEqual(second, { report: ["search"], pending: null });
});

test("a problem seen once and gone the next time is never reported", () => {
  const first = L.confirmHealth(null, ["sidebar"]);
  assert.deepEqual(L.confirmHealth(first.pending, []), { report: [], pending: null });
});

test("only the surfaces seen twice are reported", () => {
  const first = L.confirmHealth(null, ["search", "sidebar"]);
  assert.deepEqual(L.confirmHealth(first.pending, ["sidebar", "home"]).report, ["sidebar"]);
});

test("checks run at least 6 s apart", () => {
  assert.ok(L.HEALTH_DELAY_MS >= 6000);
});

test("no identity: a surface with cards but no channel link or name row on any of them", () => {
  assert.deepEqual(L.identityMissing({ search: { cards: 12, identified: 0 }, sidebar: { cards: 20, identified: 20 } }), ["search"]);
  assert.deepEqual(L.identityMissing({ search: { cards: 3, identified: 0 } }), [], "too few cards to judge");
  assert.deepEqual(L.identityMissing({ home: { cards: 30, identified: 1 } }), []);
});

test("health names map to the four surfaces the popup can name", () => {
  assert.deepEqual(L.SURFACES, ["search", "subs", "home", "sidebar"]);
});

test("the report link stays hidden while the feedback form does not exist", () => {
  assert.equal(L.reportUrl({ version: "0.1.0", browser: "Chrome", page: "search", missing: ["search"] }, ""), "");
  const url = L.reportUrl({ version: "0.1.0", browser: "Chrome 150", page: "search", missing: ["search", "sidebar"] }, "https://docs.google.com/forms/d/e/x/viewform?usp=pp_url&entry.1=VERSION&entry.2=BROWSER&entry.3=PAGE&entry.4=FILTERS");
  assert.match(url, /entry\.1=0\.1\.0/);
  assert.match(url, /entry\.4=search%2C\+sidebar/);
});

test("a check that did not look again never reuses an old miss: one transient miss raises no '!'", () => {
  let s = L.healthStep(null, true, ["search"]);
  assert.equal(s.report, null);
  s = L.healthStep(s.state, false, []);
  assert.equal(s.report, null, "the replayed miss must not confirm");
  s = L.healthStep(s.state, true, []);
  assert.deepEqual(s.report, []);
});

test("two fresh checks in a row confirm, with a skipped check between them", () => {
  let s = L.healthStep(null, true, ["sidebar"]);
  s = L.healthStep(s.state, false, []);
  s = L.healthStep(s.state, true, ["sidebar"]);
  assert.deepEqual(s.report, ["sidebar"]);
});

test("the published report form: reportUrl fills version, browser, page and surfaces", () => {
  const FORM = "https://docs.google.com/forms/d/e/1FAIpQLScyBVju13aygKeL1ZQQ8LSB8UHkBHkBR1n0mu_yN1a-jZzmig/viewform?usp=pp_url&entry.1038899811=VERSION&entry.1100498239=BROWSER&entry.820481797=PAGE&entry.593235433=FILTERS";
  assert.equal(L.FEEDBACK_FORM, FORM);
  const url = new URL(L.reportUrl({ version: "0.1.0", browser: "Google Chrome 151 / en-US", page: "watch", missing: ["search", "sidebar"] }));
  assert.equal(url.origin + url.pathname, "https://docs.google.com/forms/d/e/1FAIpQLScyBVju13aygKeL1ZQQ8LSB8UHkBHkBR1n0mu_yN1a-jZzmig/viewform");
  assert.equal(url.searchParams.get("usp"), "pp_url");
  assert.equal(url.searchParams.get("entry.1038899811"), "0.1.0");
  assert.equal(url.searchParams.get("entry.1100498239"), "Google Chrome 151 / en-US");
  assert.equal(url.searchParams.get("entry.820481797"), "watch");
  assert.equal(url.searchParams.get("entry.593235433"), "search, sidebar");
  const empty = new URL(L.reportUrl({ version: "0.1.0", browser: "Chrome", page: "", missing: [] }));
  assert.equal(empty.searchParams.get("entry.820481797"), "");
  assert.equal(empty.searchParams.get("entry.593235433"), "");
});
