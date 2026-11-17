import { launch, reporter, closeWelcome, setList, getList, until, sleep, finish } from "./harness.mjs";
import { gridLockup, gridPage, serve } from "./fixtures.mjs";

const { check } = reporter("grid-lockup");
const ctx = await launch({ name: "grid-lockup", width: 1728, height: 1000 });
await closeWelcome(ctx);
const cards = [
  gridLockup({ vid: "g000000000a", title: "Long row", handle: "@ironbet", name: "ЖЕЛЕЗНАЯ СТАВКА", rest: ["48 тыс.", "Трансляция закончилась 10 ч назад", "Трансляция закончилась 10 ч назад"] }),
  gridLockup({ vid: "g000000000b", title: "Short row", handle: "@vdud", name: "вДудь", rest: ["8,4 тыс.", "11 мин. назад"] }),
  gridLockup({ vid: "g000000000c", title: "No badge", handle: "@plain", name: "Plain Channel", badge: false, rest: ["1K", "Streamed 7 hours ago, a very long piece of metadata text"] }),
];
const pages = { subscriptions: "https://www.youtube.com/feed/subscriptions", home: "https://www.youtube.com/" };
await serve(ctx.context, pages.subscriptions, gridPage(cards, "subscriptions"));
await serve(ctx.context, pages.home, gridPage(cards, "home"));
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
const card = (vid) => `ytd-rich-item-renderer[data-qa="${vid}"]`;

const geometry = (vid) => page.evaluate((s) => {
  const c = document.querySelector(s);
  const row = c.querySelector("yt-content-metadata-view-model [role=group]");
  const btn = c.querySelector(".shoo-btn");
  const kebab = c.querySelector(".kebab");
  if (!btn || !row) return { placed: Boolean(btn), row: Boolean(row) };
  const r = row.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  const k = kebab.getBoundingClientRect();
  const dx = Math.max(k.left - b.right, b.left - k.right, 0);
  const dy = Math.max(k.top - b.bottom, b.top - k.bottom, 0);
  const name = row.querySelector("[role=text]").getBoundingClientRect();
  const prev = btn.previousElementSibling;
  return {
    placed: true,
    inRow: btn.parentElement === row,
    inside: b.width > 0 && b.left >= r.left - 0.5 && b.right <= r.right + 0.5 && b.top >= r.top - 4 && b.bottom <= r.bottom + 4,
    gapToKebab: Math.round(Math.hypot(dx, dy)),
    afterName: Math.round(b.left - name.right),
    prev: prev?.getAttribute("aria-label") || prev?.textContent || null,
    btn: [Math.round(b.left), Math.round(b.right)],
    row: [Math.round(r.left), Math.round(r.right)],
    overflow: row.scrollWidth > row.clientWidth,
  };
}, card(vid));

for (const [surface, url] of Object.entries(pages)) {
  await setList(ctx, null);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.querySelectorAll(".kebab").forEach((k) => k.addEventListener("click", () => (window.__kebabClicks = (window.__kebabClicks || 0) + 1))));
  await sleep(800);
  for (const vid of ["g000000000a", "g000000000b", "g000000000c"]) {
    await page.mouse.move(1, 1);
    await page.hover(`${card(vid)} h3`);
    const g = await until(() => geometry(vid), (v) => v.placed, 3000);
    const v = g.value;
    const ok = v.placed && v.inRow && v.inside && v.gapToKebab >= 24 && v.afterName >= 0 && v.afterName <= 30;
    check(`${surface} grid, ${vid.slice(-1) === "a" ? "long row with badge" : vid.slice(-1) === "b" ? "short row" : "long row, no badge"}: ⊘ sits in the row right after the channel name, fully visible and ≥ 24 px from ⋮`, ok, v);
  }
  await page.mouse.move(1, 1);
  await page.hover(`${card("g000000000a")} h3`);
  await sleep(300);
  const box = await page.locator(`${card("g000000000a")} .shoo-btn`).boundingBox();
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const listed = await until(() => getList(ctx), (l) => l?.channels?.some((c) => c.handle === "@ironbet"), 3000);
  const kebabClicks = await page.evaluate(() => window.__kebabClicks || 0);
  const hidden = await page.evaluate((s) => document.querySelector(s).hasAttribute("data-shoo-hide"), card("g000000000a"));
  check(`${surface} grid, long row: a click at the centre of ⊘ hides that channel and doesn't open ⋮`, Boolean(box) && listed.ok && kebabClicks === 0 && hidden, { box, listed: listed.value?.channels?.map((c) => c.handle), kebabClicks, hidden });
}
await finish(ctx, check);
