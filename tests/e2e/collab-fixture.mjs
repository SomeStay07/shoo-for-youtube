import { launch, reporter, closeWelcome, setList, getList, until, sleep, finish } from "./harness.mjs";
import { searchCard, lockup, searchPage, watchPage, serve, officialCard } from "./fixtures.mjs";

const { check } = reporter("collab-fixture");
const ctx = await launch({ name: "collab-fixture" });
await closeWelcome(ctx);
const SEARCH = "https://www.youtube.com/results?search_query=shoo-collab-fixture";
const WATCH = "https://www.youtube.com/watch?v=shooFixture";
await serve(ctx.context, SEARCH, searchPage([
  searchCard({ vid: "c1aaaaaaaaa", title: "Collab one", handle: "@alphaone", collab: "Alpha One and Beta Two", stack: true }),
  searchCard({ vid: "c2aaaaaaaaa", title: "Collab more", handle: "@deltafour", collab: "Delta Four and 2 more", stack: true }),
  searchCard({ vid: "c3aaaaaaaaa", title: "Cartoon", handle: "@tomandjerry", name: "Tom and Jerry" }),
  searchCard({ vid: "c4aaaaaaaaa", title: "Three way", handle: "@eps", collab: "Epsilon, Zeta und Eta", stack: true }),
  searchCard({ vid: "c5aaaaaaaaa", title: "Plain", handle: "@plain", name: "Plain Channel" }),
  officialCard({ handle: "@offchan", name: "Official Channel" }),
]));
await serve(ctx.context, WATCH, watchPage([
  lockup({ vid: "s1aaaaaaaaa", title: "Side collab", spans: ["Gamma Three", "and Beta Two"], stack: true }),
  lockup({ vid: "s2aaaaaaaaa", title: "Side ru", spans: ["Иван Канал", "и Beta Two"], stack: true }),
  lockup({ vid: "s3aaaaaaaaa", title: "Side more", spans: ["Chiefy", "and 2 more"], stack: true }),
  lockup({ vid: "s4aaaaaaaaa", title: "Side plain", spans: ["Solo Side"] }),
]));
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
const state = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-qa]")].map((c) => [c.dataset.qa.slice(0, 2), c.getAttribute("data-shoo-hide") || "-"])));
const entry = (o) => ({ added: 1, source: "import", ...o });

const cases = [
  ["partner name in 'A and B' (search)", [entry({ name: "Beta Two" })], SEARCH, { c1: "channel", c2: "-", c3: "-", c4: "-", c5: "-" }],
  ["first channel by its link (search collab)", [entry({ handle: "@alphaone", name: "Alpha One" })], SEARCH, { c1: "channel", c2: "-" }],
  ["'and N more' keeps the readable name only", [entry({ name: "Delta Four" }), entry({ name: "2 more" })], SEARCH, { c2: "channel", c1: "-" }],
  ["whole text first: 'Tom and Jerry' is one channel", [entry({ name: "Tom and Jerry" })], SEARCH, { c3: "channel" }],
  ["a single-channel card is never split into parts", [entry({ name: "Jerry" }), entry({ name: "Tom" })], SEARCH, { c3: "-" }],
  ["'A, B und C' (de)", [entry({ name: "Eta" })], SEARCH, { c4: "channel" }],
  ["sidebar collab by partner name (en and ru separators)", [entry({ name: "Beta Two" })], WATCH, { s1: "channel", s2: "channel", s3: "-", s4: "-" }],
  ["official channel card (search header variant) of a listed channel", [entry({ handle: "@offchan", name: "Official Channel" })], SEARCH, { of: "channel", c5: "-" }],
  ["official channel card matched by its h1 name for a name-only entry", [entry({ name: "Official Channel" })], SEARCH, { of: "channel" }],
  ["sidebar 'and N more'", [entry({ name: "Chiefy" })], WATCH, { s3: "channel", s1: "-" }],
];
for (const [label, channels, url, want] of cases) {
  await setList(ctx, { v: 1, channels, words: [] });
  if (page.url() !== url) await page.goto(url, { waitUntil: "domcontentloaded" });
  const got = await until(state, (s) => Object.entries(want).every(([k, v]) => s[k] === v), 3000);
  check(`collab: ${label}`, got.ok, { want, got: got.value });
}

await setList(ctx, null);
await page.goto(SEARCH, { waitUntil: "domcontentloaded" });
await sleep(500);
const c1 = '[data-qa="c1aaaaaaaaa"]';
await page.hover(c1);
await sleep(300);
const label = await page.evaluate((s) => document.querySelector(`${s} .shoo-btn`)?.getAttribute("aria-label"), c1);
check("collab card button says 'Hide videos from…'", label === ctx.msg("cardHideCollab"), label);
await page.hover(c1);
await sleep(300);
await page.click(`${c1} .shoo-btn`);
const menu = await page.evaluate((s) => [...document.querySelectorAll(`${s} > .shoo-menu button`)].map((b) => b.textContent), c1);
check("click 1 opens the list of readable channels", JSON.stringify(menu) === JSON.stringify(["Alpha One", "Beta Two"]), menu);
await page.click(`${c1} > .shoo-menu button:text-is("Beta Two")`);
const l1 = await until(() => getList(ctx), (l) => l?.channels?.length === 1, 3000);
check("click 2 picks one: a partner is stored by name only", l1.value?.channels?.[0]?.name === "Beta Two" && !l1.value.channels[0].handle, l1.value?.channels);
await setList(ctx, null);
await sleep(300);
await page.hover(c1);
await sleep(300);
await page.click(`${c1} .shoo-btn`);
await page.click(`${c1} > .shoo-menu button:text-is("Alpha One")`);
const l2 = await until(() => getList(ctx), (l) => l?.channels?.length === 1, 3000);
check("picking the first channel stores its handle and name", l2.value?.channels?.[0]?.handle === "@alphaone" && l2.value.channels[0].name === "Alpha One", l2.value?.channels);
await setList(ctx, null);
await sleep(300);
const c2 = '[data-qa="c2aaaaaaaaa"]';
await page.hover(c2);
await sleep(300);
const label2 = await page.evaluate((s) => document.querySelector(`${s} .shoo-btn`)?.getAttribute("aria-label"), c2);
check("'and N more' card with one readable channel: one click, named button", label2 === ctx.msg("cardHide", "Delta Four"), label2);
await page.hover(c1);
await sleep(300);
await page.click(`${c1} .shoo-btn`);
await page.click(`${c1} > .shoo-menu p`);
const stillOpen = await page.evaluate((s) => Boolean(document.querySelector(`${s} > .shoo-menu`)), c1);
await page.mouse.click(5, 5);
const closedByOutside = await page.evaluate((s) => !document.querySelector(`${s} > .shoo-menu`), c1);
check("a click inside the list keeps it open; a click outside closes it", stillOpen && closedByOutside, { stillOpen, closedByOutside });
await page.hover(c1);
await sleep(300);
await page.click(`${c1} .shoo-btn`);
await page.keyboard.press("Escape");
const closed = await page.evaluate((s) => ({ menu: Boolean(document.querySelector(`${s} > .shoo-menu`)), focus: document.activeElement?.classList.contains("shoo-btn") }), c1);
check("Escape closes the channel list and returns focus to the button", !closed.menu && closed.focus, closed);
await finish(ctx, check);
