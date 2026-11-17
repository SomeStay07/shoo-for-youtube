import { launch, reporter, closeWelcome, setList, getList, until, sleep, finish, consent, forceWatchGrid } from "./harness.mjs";

const { check } = reporter("grid-live");
const RUNS = [
  { key: "/podcasts", url: "https://www.youtube.com/podcasts", width: 1000 },
  { key: "/podcasts", url: "https://www.youtube.com/podcasts", width: 1280 },
  { key: "/podcasts", url: "https://www.youtube.com/podcasts", width: 1728 },
  { key: "watch-page grid (kevlar_watch_grid)", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", width: 1280, grid: true },
];
const MAX = 12;

const mark = (page, grid) => page.evaluate((grid) => {
  const scope = grid ? "ytd-watch-grid:not([hidden]) yt-lockup-view-model" : "ytd-page-manager > :not([hidden]) ytd-rich-item-renderer yt-lockup-view-model";
  const cards = [...document.querySelectorAll(scope)].filter((c) => !c.parentElement.closest("yt-lockup-view-model") && c.checkVisibility() && c.querySelector("yt-content-metadata-view-model [role=group] > span") && !c.closest("ytd-playlist-panel-renderer"));
  cards.forEach((c, i) => (c.closest("ytd-rich-item-renderer") || c).setAttribute("data-qa-live", String(i)));
  return cards.length;
}, grid);

const layout = (page, sel) => page.evaluate((s) => {
  const c = document.querySelector(s);
  const nodes = [...c.querySelectorAll("h3, yt-content-metadata-view-model [role=group] > *")].filter((n) => !n.closest(".shoo-btn"));
  return { xy: nodes.map((n) => { const r = n.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; }), height: Math.round(c.getBoundingClientRect().height) };
}, sel);

const geometry = (page, sel) => page.evaluate((s) => {
  const c = document.querySelector(s);
  const btn = c.querySelector(".shoo-btn");
  if (!btn || !btn.checkVisibility({ opacityProperty: true })) return { placed: false };
  const row = c.querySelector("yt-content-metadata-view-model [role=group]");
  const r = row.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  const kids = [...row.children].filter((k) => k !== btn && k.getAttribute("aria-hidden") !== "true");
  const nameNode = kids.find((k) => k.textContent.trim());
  const n = nameNode.getBoundingClientRect();
  const name = { left: Math.max(n.left, r.left), right: Math.min(n.right, r.right), top: n.top, bottom: n.bottom };
  const badgeNode = kids.find((k) => k.hasAttribute("aria-label") && !k.textContent.trim() && k.previousElementSibling === nameNode);
  const badge = badgeNode?.getBoundingClientRect();
  const covers = (x) => Boolean(x) && x.right > x.left && b.left < x.right && b.right > x.left && b.top < x.bottom && b.bottom > x.top;
  const gap = (x) => Math.hypot(Math.max(x.left - b.right, b.left - x.right, 0), Math.max(x.top - b.bottom, b.top - x.bottom, 0));
  const others = [...c.querySelectorAll("button, [role=button]")].filter((x) => x !== btn && !x.closest(".shoo-btn") && x.getBoundingClientRect().width).map((x) => ({ label: x.getAttribute("aria-label"), gap: Math.round(gap(x.getBoundingClientRect())) }));
  const k = c.getBoundingClientRect();
  const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return {
    placed: true,
    name: nameNode.textContent.trim().slice(0, 40),
    kind: btn.classList.contains("shoo-pin") ? "after-name" : btn.classList.contains("shoo-float") ? "corner" : "inline",
    coversName: covers(name),
    coversBadge: covers(badge),
    minGap: others.length ? Math.min(...others.map((o) => o.gap)) : null,
    buttons: others.length,
    onTop: Boolean(at && btn.contains(at)),
    inCard: b.left >= k.left - 0.5 && b.right <= k.right + 0.5 && b.top >= k.top - 4 && b.bottom <= k.bottom + 4,
  };
}, sel);

for (const run of RUNS) {
  const label = `${run.key} at ${run.width} px`;
  const ctx = await launch({ name: `grid-live-${run.width}${run.grid ? "-grid" : ""}`, width: run.width, height: 1000 });
  await closeWelcome(ctx);
  await setList(ctx, null);
  const page = ctx.context.pages().find((p) => !p.url().startsWith("chrome-extension://")) || (await ctx.context.newPage());
  if (run.grid) await forceWatchGrid(page);
  await page.goto(run.url, { waitUntil: "domcontentloaded" });
  await consent(page);
  const found = await until(() => mark(page, run.grid), (n) => n >= 3, 20000, 500);
  if (!found.ok) {
    check(`${label}: rich lockup cards on the page`, null, `NOT TESTABLE live: ${found.value} cards`);
    await finish(ctx, check);
    continue;
  }
  await sleep(1500);
  const n = Math.min(await mark(page, run.grid), MAX);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const sel = `[data-qa-live="${i}"]`;
    await page.mouse.move(1, 1);
    await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "center" }), sel);
    await sleep(300);
    const before = await layout(page, sel);
    await page.locator(`${sel} h3`).first().hover({ timeout: 3000 }).catch(() => {});
    await sleep(700);
    const g = await until(() => geometry(page, sel), (v) => v.placed, 2000);
    const during = await layout(page, sel);
    const shift = Math.max(0, ...before.xy.flatMap((p, j) => p.map((x, q) => Math.abs(x - (during.xy[j]?.[q] ?? Infinity)))));
    rows.push({ i, ...g.value, shift, height: before.height === during.height });
  }
  const bad = rows.filter((r) => !r.placed || !r.onTop || !r.inCard || r.coversName || r.coversBadge || (r.minGap !== null && r.minGap < 24));
  const kinds = rows.reduce((a, r) => ({ ...a, [r.kind]: (a[r.kind] || 0) + 1 }), {});
  check(`${label}: ${rows.length} cards — ⊘ visible, covers neither the channel name nor its badge, ≥ 24 px from every YouTube button (${JSON.stringify(kinds)})`, rows.length >= 3 && bad.length === 0, bad.length ? bad : rows.map((r) => `${r.name}: ${r.kind}, gap ${r.minGap}`));
  const moved = rows.filter((r) => r.shift !== 0 || !r.height);
  check(`${label}: showing ⊘ moves no text and keeps the card height`, moved.length === 0, moved);

  const target = rows.find((r) => r.placed) || rows[0];
  const sel = `[data-qa-live="${target.i}"]`;
  await page.mouse.move(1, 1);
  await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "center" }), sel);
  await sleep(300);
  await page.locator(`${sel} h3`).first().hover();
  await sleep(700);
  const box = await page.locator(`${sel} .shoo-btn`).boundingBox();
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const listed = await until(() => getList(ctx), (l) => (l?.channels?.length || 0) > 0, 3000);
  const menus = await page.evaluate(() => [...document.querySelectorAll("tp-yt-iron-dropdown, ytd-menu-popup-renderer, yt-sheet-view-model, yt-list-view-model")].filter((m) => m.checkVisibility() && m.getBoundingClientRect().height > 10 && !m.closest("[data-qa-live]")).length);
  const got = listed.value?.channels || [];
  check(`${label}: a click at the centre of ⊘ on "${target.name}" lists that channel and opens no ⋮ menu`, Boolean(box) && got.length === 1 && (got[0].name || "").startsWith(target.name.replace(/…$/, "").slice(0, 12)) && menus === 0, { box, got, menus });
  await setList(ctx, null);
  await finish(ctx, check);
}
