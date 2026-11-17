import { launch, reporter, closeWelcome, setList, getList, goSearch, until, sleep, finish, consent } from "./harness.mjs";

const { check } = reporter("sidebar-name");
const ctx = await launch({ name: "sidebar-name" });
await closeWelcome(ctx);
await setList(ctx, null);
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
const HANDLE = "@veritasium";

await goSearch(page, "veritasium black holes");
const sel = `ytd-search ytd-video-renderer:has(#channel-info a[href="/${HANDLE}"])`;
const watchHref = await page.evaluate((s) => document.querySelector(`${s} a#thumbnail`)?.getAttribute("href"), sel);
await page.locator(sel).first().waitFor({ state: "visible", timeout: 15000 });
await sleep(1000);
await page.locator(sel).first().hover({ position: { x: 600, y: 60 } });
await sleep(300);
await page.locator(`${sel} >> nth=0 >> .shoo-btn`).click();
const stored = await until(() => getList(ctx), (l) => l?.channels?.length === 1, 3000);
const entry = stored.value?.channels?.[0];
check("search-card block stores handle + name", Boolean(entry?.handle && entry?.name), entry);

const sidebar = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("#secondary yt-lockup-view-model")].map((c) => {
      const row = c.querySelector("yt-content-metadata-view-model [role=group]");
      const box = c.closest("ytd-rich-item-renderer") || c;
      const collab = Boolean(c.querySelector("yt-avatar-stack-view-model")) || (row?.querySelectorAll("[role=text]").length || 0) > 1;
      return { name: row?.querySelector("[role=text]")?.textContent.trim(), collab, hidden: box.hasAttribute("data-shoo-hide"), shown: c.checkVisibility(), links: c.querySelectorAll('a[href^="/@"], a[href^="/channel/"]').length };
    }),
  );
await page.goto(`https://www.youtube.com${watchHref.split("&")[0]}`, { waitUntil: "domcontentloaded" });
await consent(page);
const side = await until(sidebar, (s) => s.length >= 10, 20000);
const same = side.value.filter((c) => c.name === entry.name);
check("precondition: the watch sidebar has cards of that channel", same.length > 0, { sidebar: side.value.length, sameChannel: same.length, links: side.value.reduce((a, c) => a + c.links, 0) });
check("sidebar cards of the channel are hidden by its name", same.length > 0 && same.every((c) => c.hidden && !c.shown), same);
const others = side.value.filter((c) => c.name && c.name !== entry.name);
check("other sidebar cards stay visible", others.length > 0 && others.every((c) => !c.hidden && c.shown), { others: others.length, hidden: others.filter((c) => c.hidden).length });

const candidates = others.filter((c) => !c.collab).map((c) => c.name).filter((n, i, all) => /^[\p{L}\p{N} ._'-]{3,}$/u.test(n) && all.indexOf(n) === i).slice(0, 6);
let target = null;
let sideEntry = null;
let search = null;
for (const name of candidates) {
  const watchUrl = page.url();
  const tsel = `#secondary yt-lockup-view-model:has(yt-content-metadata-view-model [role=group] [role=text]:text-is("${name}"))`;
  if (!(await page.locator(tsel).count())) continue;
  await page.locator(tsel).first().scrollIntoViewIfNeeded();
  await page.locator(tsel).first().hover();
  await sleep(300);
  await page.locator(`${tsel} >> nth=0 >> .shoo-btn`).click();
  const two = await until(() => getList(ctx), (l) => l?.channels?.some((c) => c.name === name), 3000);
  sideEntry = two.value?.channels?.find((c) => c.name === name);
  await goSearch(page, name);
  search = await page.evaluate((n) => {
    const cards = [...document.querySelectorAll("ytd-search:not([hidden]) :is(ytd-video-renderer, yt-lockup-view-model)")];
    const nameOf = (c) => (c.querySelector("ytd-channel-name #text") || c.querySelector("yt-content-metadata-view-model [role=group] > :first-child"))?.textContent.trim();
    const mine = cards.filter((c) => nameOf(c) === n);
    const box = (c) => c.closest("ytd-rich-item-renderer") || c;
    return { total: cards.length, mine: mine.length, hidden: mine.filter((c) => box(c).hasAttribute("data-shoo-hide") && !c.checkVisibility()).length, othersHidden: cards.filter((c) => !mine.includes(c) && box(c).hasAttribute("data-shoo-hide")).length };
  }, name);
  target = name;
  if (search.mine > 0) break;
  await ctx.worker.evaluate((n) => chrome.storage.local.get("list").then(({ list }) => chrome.storage.local.set({ list: { ...list, channels: list.channels.filter((c) => c.name !== n) } })), name);
  await page.goto(watchUrl, { waitUntil: "domcontentloaded" });
  await until(sidebar, (x) => x.length >= 10, 20000);
}
check("a block from a sidebar card stores the name only", Boolean(sideEntry) && !sideEntry.handle && !sideEntry.id && sideEntry.source === "sidebar", { target, sideEntry });
check("precondition: the next search page has that channel's cards", search?.mine > 0 ? true : null, { tried: candidates, ...search });
if (search?.mine > 0) check("the name-only entry hides that name on the next search page", search.hidden === search.mine, search);
const learned = (await getList(ctx)).channels.find((c) => c.name === target);
check("a name-only entry never learns a link from a name match", !learned.handle && !learned.id, learned);
await finish(ctx, check);
