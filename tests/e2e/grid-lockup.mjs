import { launch, reporter, closeWelcome, setList, getList, until, sleep, finish } from "./harness.mjs";
import { gridLockup, gridPage, shelfLockup, shelfPage, watchGridLockup, watchGridPage, serve } from "./fixtures.mjs";

const { check } = reporter("grid-lockup");
const ctx = await launch({ name: "grid-lockup", width: 1728, height: 1000 });
await closeWelcome(ctx);
const grid = [
  gridLockup({ vid: "g000000000a", title: "Long row", handle: "@ironbet", name: "ЖЕЛЕЗНАЯ СТАВКА", rest: ["48 тыс.", "Трансляция закончилась 10 ч назад", "Трансляция закончилась 10 ч назад"] }),
  gridLockup({ vid: "g000000000b", title: "Short row", handle: "@vdud", name: "вДудь", rest: ["8,4 тыс.", "11 мин. назад"] }),
  gridLockup({ vid: "g000000000c", title: "No badge", handle: "@plain", name: "Plain Channel", badge: false, rest: ["1K", "Streamed 7 hours ago, a very long piece of metadata text"] }),
  gridLockup({ vid: "g000000000d", title: "Name fills the row", handle: "@longname", name: "A very long channel name that keeps going on and on until the row runs out", rest: ["2K", "1 day ago"] }),
];
const shelf = [
  shelfLockup({ vid: "s000000000a", title: "Narrow card, ⋮ above-right of the name", handle: "@diaryofaceo", name: "The Diary Of A CEO", width: 163 }),
  shelfLockup({ vid: "s000000000b", title: "Narrow card, name fills the column", handle: "@goodmythicalmorning", name: "Good Mythical Morning", width: 163 }),
  shelfLockup({ vid: "s000000000c", title: "Narrow card, short name", handle: "@vox", name: "Vox", width: 163 }),
  shelfLockup({ vid: "s000000000d", title: "Wide card, the row hugs the name and badge", handle: "@diaryofaceo2", name: "The Diary Of A CEO", width: 275 }),
  shelfLockup({ vid: "s000000000e", title: "Middle card", handle: "@drinsanity", name: "Dr Insanity", width: 219 }),
  shelfLockup({ vid: "s000000000f", title: "Middle card, no badge", handle: "@meidastouch", name: "MeidasTouch Podcast Network", badge: false, width: 219 }),
  shelfLockup({ vid: "s000000000g", title: "⋮ not drawn yet, its slot close to the badge", handle: "@diaryofaceo3", name: "The Diary Of A CEO", width: 205, menu: false }),
];
const watch = [
  watchGridLockup({ vid: "w000000000a", title: "Scatman (ski-ba-bop-ba-dop-bop) Official Video [HD] - Scatman John", handle: "@scatmanjohn", name: "Scatman John Official YouTube Channel" }),
  watchGridLockup({ vid: "w000000000b", title: "Take On Me", handle: "@aha", name: "a-ha" }),
  watchGridLockup({ vid: "w000000000c", title: "Some video", handle: "@vampsy", name: "Vampsy", badge: false }),
];
const SURFACES = [
  { key: "subscriptions grid", url: "https://www.youtube.com/feed/subscriptions", html: gridPage(grid, "subscriptions"), cards: ["g000000000a", "g000000000b", "g000000000c", "g000000000d"], after: ["g000000000a", "g000000000b", "g000000000c"], click: ["g000000000a", "@ironbet"] },
  { key: "home grid", url: "https://www.youtube.com/", html: gridPage(grid, "home"), cards: ["g000000000a", "g000000000d"], after: ["g000000000a"], click: ["g000000000d", "@longname"] },
  { key: "shelf of rich lockups (/podcasts)", url: "https://www.youtube.com/podcasts", html: shelfPage(shelf), cards: ["s000000000a", "s000000000b", "s000000000c", "s000000000d", "s000000000e", "s000000000f", "s000000000g"], after: ["s000000000c", "s000000000d"], corner: ["s000000000g"], click: ["s000000000a", "@diaryofaceo"] },
  { key: "watch-page grid (kevlar_watch_grid)", url: "https://www.youtube.com/watch?v=fixturegrid", html: watchGridPage(watch), cards: ["w000000000a", "w000000000b", "w000000000c"], after: ["w000000000b", "w000000000c"], click: ["w000000000a", "@scatmanjohn"] },
];
for (const s of SURFACES) await serve(ctx.context, s.url, s.html);
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
const card = (vid) => `[data-qa="${vid}"]`;

const layout = (vid) => page.evaluate((s) => {
  const c = document.querySelector(s);
  const nodes = [...c.querySelectorAll("h3, [role=group] > *")].filter((n) => !n.closest(".shoo-btn"));
  return { xy: nodes.map((n) => { const r = n.getBoundingClientRect(); return [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10]; }), height: Math.round(c.getBoundingClientRect().height) };
}, card(vid));

const geometry = (vid) => page.evaluate((s) => {
  const c = document.querySelector(s);
  const btn = c.querySelector(".shoo-btn");
  if (!btn || !btn.checkVisibility({ opacityProperty: true })) return { placed: false };
  const row = c.querySelector("yt-content-metadata-view-model [role=group]");
  const r = row.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  const clip = (x) => ({ left: Math.max(x.left, r.left), right: Math.min(x.right, r.right), top: x.top, bottom: x.bottom });
  const name = clip(row.firstElementChild.getBoundingClientRect());
  const badgeNode = row.querySelector('[aria-label="Verified"]');
  const badge = badgeNode && badgeNode.getBoundingClientRect();
  const covers = (x) => Boolean(x) && x.right > x.left && b.left < x.right && b.right > x.left && b.top < x.bottom && b.bottom > x.top;
  const gap = (x) => Math.hypot(Math.max(x.left - b.right, b.left - x.right, 0), Math.max(x.top - b.bottom, b.top - x.bottom, 0));
  const gaps = [...c.querySelectorAll("button, [role=button]")].filter((x) => x !== btn && x.getBoundingClientRect().width).map((x) => Math.round(gap(x.getBoundingClientRect())));
  const k = c.getBoundingClientRect();
  const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return {
    placed: true,
    kind: btn.classList.contains("shoo-pin") ? "after-name" : btn.classList.contains("shoo-float") ? "corner" : "inline",
    coversName: covers(name),
    coversBadge: covers(badge),
    minGap: gaps.length ? Math.min(...gaps) : null,
    onTop: Boolean(at && btn.contains(at)),
    inCard: b.left >= k.left - 0.5 && b.right <= k.right + 0.5 && b.top >= k.top - 4 && b.bottom <= k.bottom + 4,
    afterEnd: Math.round(b.left - (badge || name).right),
    btn: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)],
  };
}, card(vid));

for (const s of SURFACES) {
  await setList(ctx, null);
  await page.goto(s.url, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.querySelectorAll(".kebab").forEach((k) => k.addEventListener("click", () => (window.__kebabClicks = (window.__kebabClicks || 0) + 1))));
  await sleep(800);
  for (const vid of s.cards) {
    await page.mouse.move(1, 1);
    await sleep(150);
    const before = await layout(vid);
    await page.hover(`${card(vid)} h3`);
    const g = await until(() => geometry(vid), (v) => v.placed, 3000);
    await sleep(150);
    const during = await layout(vid);
    const v = g.value;
    const title = await page.evaluate((sel) => document.querySelector(`${sel} h3`).getAttribute("title"), card(vid));
    const wantAfter = s.after.includes(vid);
    const wantCorner = s.corner?.includes(vid);
    const ok = v.placed && v.onTop && v.inCard && !v.coversName && !v.coversBadge && (v.minGap === null || v.minGap >= 24) && (wantAfter ? v.kind === "after-name" && v.afterEnd >= 0 && v.afterEnd <= 8 : true) && (wantCorner ? v.kind === "corner" : true);
    check(`${s.key}, "${title}": ⊘ ${wantAfter ? "right after the name and badge" : wantCorner ? "in the thumbnail corner" : "visible"}, covers neither the name nor the badge, ≥ 24 px from every YouTube button (${v.kind})`, ok, v);
    const shift = Math.max(0, ...before.xy.flatMap((p, i) => p.map((x, j) => Math.abs(x - (during.xy[i]?.[j] ?? Infinity)))));
    check(`${s.key}, "${title}": showing ⊘ on hover moves no text (0 px) and keeps the card height`, shift === 0 && before.xy.length === during.xy.length && before.height === during.height, { shift, before: before.height, during: during.height });
  }
  const [vid, handle] = s.click;
  await page.mouse.move(1, 1);
  await sleep(150);
  await page.hover(`${card(vid)} h3`);
  await sleep(300);
  const box = await page.locator(`${card(vid)} .shoo-btn`).boundingBox();
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const listed = await until(() => getList(ctx), (l) => l?.channels?.some((c) => c.handle === handle), 3000);
  const kebabClicks = await page.evaluate(() => window.__kebabClicks || 0);
  check(`${s.key}: a click at the centre of ⊘ hides that channel (${handle}) and doesn't open ⋮`, Boolean(box) && listed.ok && kebabClicks === 0, { box, listed: listed.value?.channels?.map((c) => c.handle), kebabClicks });
}

await setList(ctx, null);
await page.goto(SURFACES[2].url, { waitUntil: "domcontentloaded" });
await sleep(600);
await page.evaluate(() => document.querySelector('[data-qa="s000000000d"] .menu').remove());
await page.hover(`${card("s000000000d")} h3`);
const first = await until(() => geometry("s000000000d"), (v) => v.placed, 3000);
await page.evaluate((left) => {
  const meta = document.querySelector('[data-qa="s000000000d"] yt-lockup-metadata-view-model');
  meta.insertAdjacentHTML("beforeend", `<div class="menu" style="left:${left}px;top:0"><button class="kebab" aria-label="More actions">⋮</button></div>`);
}, first.value.placed ? first.value.btn[2] - (await page.evaluate(() => document.querySelector('[data-qa="s000000000d"] yt-lockup-metadata-view-model').getBoundingClientRect().left)) + 4 : 0);
const late = await until(() => geometry("s000000000d"), (v) => v.placed && v.minGap >= 24, 2000, 50);
check("⋮ drawn by YouTube after ⊘ was placed (lazy menu on first hover): ⊘ moves away to keep ≥ 24 px, still off the name and badge", first.value.placed && late.ok && !late.value.coversName && !late.value.coversBadge, { first: first.value, late: late.value });
await finish(ctx, check);
