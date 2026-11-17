import { launch, reporter, closeWelcome, setList, getList, until, sleep, finish } from "./harness.mjs";
import { serve } from "./fixtures.mjs";

const { check } = reporter("back-forward");
const ctx = await launch({ name: "back-forward" });
await closeWelcome(ctx);
const LABEL = ctx.msg("pageHide");
const SEARCH = "https://www.youtube.com/results?search_query=shoo-back-forward";
const CH = {
  "/user/AlphaOld": ["@chanalpha", "Alpha"],
  "/user/BravoOld": ["@chanbravo", "Bravo"],
  "/@chanalpha": ["@chanalpha", "Alpha"],
  "/@chanbravo": ["@chanbravo", "Bravo"],
};
const header = ([handle, name]) => `<yt-page-header-view-model><div><h1><span role="text">${name}</span></h1>
  <yt-content-metadata-view-model><div role="group"><span role="text">${handle}</span><span aria-hidden="true"> • </span><span role="text">1K subscribers</span></div></yt-content-metadata-view-model>
  <div class="actions"><yt-flexible-actions-view-model><div><button>Subscribe</button></div></yt-flexible-actions-view-model></div></div></yt-page-header-view-model>`;
const app = (path) => `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><ytd-app><ytd-page-manager>
  <ytd-search ${path ? "hidden" : ""}><ytd-section-list-renderer><div id="contents"></div></ytd-section-list-renderer></ytd-search>
  <ytd-browse page-subtype="channels" ${path ? "" : "hidden"}>${header(CH[path] || ["@nobody", "Nobody"])}<div id="contents"></div></ytd-browse>
  </ytd-page-manager></ytd-app>
<script>
  const CH = ${JSON.stringify(CH)};
  const HEADER_MS = 60;
  window.setHeader = (path) => {
    const h = document.querySelector("ytd-browse yt-page-header-view-model");
    const [handle, name] = CH[path];
    h.querySelector("h1 [role=text]").textContent = name;
    h.querySelector("yt-content-metadata-view-model [role=text]").textContent = handle;
  };
  const show = () => {
    const onChannel = location.pathname in CH;
    document.querySelector("ytd-search").hidden = onChannel;
    document.querySelector("ytd-browse").hidden = !onChannel;
  };
  window.go = (path) => {
    document.dispatchEvent(new CustomEvent("yt-navigate-start"));
    history.pushState({}, "", path);
    show();
    document.dispatchEvent(new CustomEvent("yt-navigate-finish"));
    setTimeout(() => setHeader(path), HEADER_MS);
  };
  addEventListener("popstate", () => {
    const path = location.pathname;
    show();
    document.dispatchEvent(new CustomEvent("yt-page-data-updated"));
    document.dispatchEvent(new CustomEvent("yt-navigate-finish"));
    if (path in CH) setTimeout(() => setHeader(path), HEADER_MS);
  }, true);
</script></body></html>`;
await serve(ctx.context, SEARCH, app(null));
await serve(ctx.context, "https://www.youtube.com/user/AlphaOld", app("/user/AlphaOld"));
const page = ctx.context.pages()[0] || (await ctx.context.newPage());

const buttonFor = (path) => until(() => page.evaluate(([p, l]) => location.pathname === p && document.querySelector("#shoo-page button")?.textContent === l, [path, LABEL]), Boolean, 5000, 50);

const move = (how, path, press) =>
  page.evaluate(
    ([how, path, press, label]) =>
      new Promise((resolve) => {
        const t0 = performance.now();
        const head = () => [...document.querySelectorAll('ytd-browse[page-subtype="channels"]:not([hidden]) yt-page-header-view-model [role=text]')].map((n) => n.textContent.trim()).find((s) => s.startsWith("@")) || null;
        const btn = () => {
          const b = document.querySelector("#shoo-page button");
          return b && b.checkVisibility() && b.textContent === label ? b : null;
        };
        const frames = [];
        let rec = null;
        const doPress = () => {
          const b = btn();
          rec = { t: Math.round(performance.now() - t0), path: location.pathname, header: head(), clicked: Boolean(b) };
          if (b) {
            b.click();
            rec.after = document.getElementById("shoo-page")?.textContent || null;
          }
        };
        const sample = () => {
          frames.push({ path: location.pathname, header: head(), btn: Boolean(btn()) });
          if (!rec && press === "first" && location.pathname === path && btn()) doPress();
        };
        const obs = new MutationObserver(sample);
        obs.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
        let raf = requestAnimationFrame(function tick() {
          sample();
          raf = requestAnimationFrame(tick);
        });
        if (typeof press === "number") setTimeout(() => rec || doPress(), press);
        if (how === "back") history.back();
        else if (how === "forward") history.forward();
        else window.go(path);
        setTimeout(() => {
          obs.disconnect();
          cancelAnimationFrame(raf);
          resolve({ frames, rec });
        }, 2000);
      }),
    [how, path, press, LABEL],
  );

const handleOf = (path) => CH[path][0];
const rows = [];
const PRESSES = ["first", 0, 5, 15, 50, 100, 200, 300, 600, 1200];
for (const [a, b] of [["/user/AlphaOld", "/user/BravoOld"], ["/@chanalpha", "/@chanbravo"]]) {
  for (const how of ["yt-navigate", "back", "forward"]) {
    for (const press of PRESSES) {
      await setList(ctx, null);
      await page.goto(SEARCH, { waitUntil: "domcontentloaded" });
      await sleep(300);
      await page.evaluate((p) => window.go(p), a);
      if (!(await buttonFor(a)).ok) {
        rows.push({ how, press, a, b, setup: "A never got its button" });
        continue;
      }
      let target = b;
      if (how !== "yt-navigate") {
        await page.evaluate((p) => window.go(p), b);
        if (!(await buttonFor(b)).ok) {
          rows.push({ how, press, a, b, setup: "B never got its button" });
          continue;
        }
        target = a;
        if (how === "forward") {
          await page.evaluate(() => history.back());
          if (!(await buttonFor(a)).ok) {
            rows.push({ how, press, a, b, setup: "Back to A never got its button" });
            continue;
          }
          target = b;
        }
      }
      const from = how === "back" ? b : a;
      const r = await move(how, target, press);
      const saved = await until(() => getList(ctx), (l) => (l?.channels?.length || 0) > 0, r.rec?.clicked ? 4000 : 300, 50);
      const hid = saved.value?.channels?.map((c) => c.handle.toLowerCase()) || [];
      const stale = r.frames.filter((f) => f.path === target && f.btn && f.header !== handleOf(target)).length;
      rows.push({ how, press, from, to: target, rec: r.rec, hid, stale });
    }
  }
}
const kinds = { "yt-navigate": "forward in the app (yt-navigate)", back: "browser Back", forward: "browser Forward" };
for (const how of Object.keys(kinds)) {
  const mine = rows.filter((r) => r.how === how);
  const setup = mine.filter((r) => r.setup);
  const wrong = mine.filter((r) => r.hid?.length && (r.hid.length !== 1 || r.hid[0] !== handleOf(r.rec.path) || r.rec.header?.toLowerCase() !== r.hid[0]));
  const silent = mine.filter((r) => r.rec?.clicked && !r.hid?.length);
  const stale = mine.filter((r) => r.stale);
  const worked = mine.filter((r) => r.hid?.length === 1 && r.hid[0] === handleOf(r.to)).length;

  check(`${kinds[how]} between channel pages (/user/ and @), presses at first sight and 0–1,200 ms: every press that acted hid the channel of the page it was on, whose header was on screen (${worked} of ${mine.length} hid the destination)`, !setup.length && wrong.length === 0 && worked > 0, { wrong, setup });
  check(`${kinds[how]}: no silent presses — a visible 'Hide this channel's videos' always acts`, !setup.length && silent.length === 0, silent);
  check(`${kinds[how]}: no frame shows 'Hide this channel's videos' while the header is still the other channel's`, !setup.length && stale.length === 0, stale.map((r) => ({ press: r.press, to: r.to, stale: r.stale })));
}

await setList(ctx, null);
await page.goto("https://www.youtube.com/user/AlphaOld", { waitUntil: "domcontentloaded" });
const full = await buttonFor("/user/AlphaOld");
if (full.ok) await page.click("#shoo-page button");
const fullSaved = await until(() => getList(ctx), (l) => (l?.channels?.length || 0) > 0, 3000);
check("full page load of a /user/ channel page: the button is there and hides that channel", full.ok && fullSaved.value?.channels?.map((c) => c.handle).join() === "@chanalpha", fullSaved.value?.channels);
await setList(ctx, null);
await finish(ctx, check);
