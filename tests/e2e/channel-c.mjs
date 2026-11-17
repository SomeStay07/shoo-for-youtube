import { launch, reporter, closeWelcome, setList, getList, until, sleep, finish } from "./harness.mjs";
import { searchCard, searchPage, serve } from "./fixtures.mjs";

const { check } = reporter("channel-c");
const ctx = await launch({ name: "channel-c" });
await closeWelcome(ctx);
const SEARCH = "https://www.youtube.com/results?search_query=shoo-channel-c";
await serve(ctx.context, SEARCH, searchPage([searchCard({ vid: "x000000000a", title: "Some result", handle: "@other", name: "Other" })]));
const CHANNEL = `<ytd-browse page-subtype="channels"><yt-page-header-view-model><div><h1><span role="text">Fixture Channel</span></h1>
  <yt-content-metadata-view-model><div role="group"><span role="text">@shoofixture</span><span aria-hidden="true"> • </span><span role="text">1K subscribers</span></div></yt-content-metadata-view-model>
  <div class="actions"><yt-flexible-actions-view-model><div><button>Subscribe</button></div></yt-flexible-actions-view-model></div></div></yt-page-header-view-model>
  <div id="contents">${searchCard({ vid: "c000000000a", title: "Own video", handle: "@shoofixture", name: "Fixture Channel" })}</div></ytd-browse>`;
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
const spaTo = (path) => page.evaluate(([p, html]) => {
  document.dispatchEvent(new CustomEvent("yt-navigate-start"));
  history.pushState({}, "", p);
  const pm = document.querySelector("ytd-page-manager");
  pm.querySelector("ytd-search").hidden = true;
  pm.querySelector('ytd-browse[page-subtype="channels"]')?.remove();
  pm.insertAdjacentHTML("beforeend", html);
  document.dispatchEvent(new CustomEvent("yt-navigate-finish"));
}, [path, CHANNEL]);
const control = () => page.evaluate(() => {
  const box = document.getElementById("shoo-page");
  const own = document.querySelector('[data-qa="c000000000a"]');
  return { texts: box ? [...box.querySelectorAll(".shoo-text, button")].map((n) => n.textContent) : null, ownShown: own?.checkVisibility() ?? null, ownHidden: own?.hasAttribute("data-shoo-hide") ?? null };
});

for (const path of ["/c/ShooFixture", "/user/ShooFixture"]) {
  await setList(ctx, null);
  await page.goto(SEARCH, { waitUntil: "domcontentloaded" });
  await sleep(600);
  await spaTo(path);
  const btn = await until(control, (c) => c.texts?.[0] === ctx.msg("pageHide"), 4000);
  check(`${path} reached in the app (no handle or ID in the address): 'Hide this channel's videos' is there`, btn.ok, btn.value);
  if (!btn.ok) continue;
  await page.click("#shoo-page button");
  const saved = await until(() => getList(ctx), (l) => l?.channels?.length === 1, 3000);
  check(`${path}: the press stores the channel by the header's own @handle`, saved.value?.channels?.[0]?.handle === "@shoofixture", saved.value?.channels);
  await page.goto(SEARCH, { waitUntil: "domcontentloaded" });
  await sleep(600);
  await spaTo(path);
  const listed = await until(control, (c) => c.texts?.[0] === ctx.msg("pageHidden"), 4000);
  check(`${path} of a listed channel: says it's hidden elsewhere and leaves its own videos on its page`, listed.ok && listed.value.ownShown && !listed.value.ownHidden, listed.value);
}
const header = (handle, name) => `<yt-page-header-view-model><div><h1><span role="text">${name}</span></h1>
  <yt-content-metadata-view-model><div role="group"><span role="text">${handle}</span><span aria-hidden="true"> • </span><span role="text">1K subscribers</span></div></yt-content-metadata-view-model>
  <div class="actions"><yt-flexible-actions-view-model><div><button>Subscribe</button></div></yt-flexible-actions-view-model></div></div></yt-page-header-view-model>`;
const H = { a: header("@chanalpha", "Alpha"), b: ["@chanbravo", "Bravo"], c: ["@chancharlie", "Charlie"] };
const openOn = async (path, html, list = null) => {
  await setList(ctx, list);
  await page.goto(SEARCH, { waitUntil: "domcontentloaded" });
  await sleep(600);
  await page.evaluate(([p, h]) => {
    document.dispatchEvent(new CustomEvent("yt-navigate-start"));
    history.pushState({}, "", p);
    const pm = document.querySelector("ytd-page-manager");
    pm.querySelector("ytd-search").hidden = true;
    pm.querySelector('ytd-browse[page-subtype="channels"]')?.remove();
    pm.insertAdjacentHTML("beforeend", `<ytd-browse page-subtype="channels">${h}<div id="contents"></div></ytd-browse>`);
    document.dispatchEvent(new CustomEvent("yt-navigate-finish"));
  }, [path, html]);
  return until(() => page.evaluate((l) => [l[0], l[1]].includes(document.querySelector("#shoo-page button")?.textContent), [ctx.msg("pageHide"), ctx.msg("unhideChannel")]), Boolean, 4000);
};
const steps = (list) => page.evaluate(([list, label]) => {
  const handleNow = () => [...document.querySelectorAll('ytd-browse[page-subtype="channels"] yt-page-header-view-model [role=text]')].map((n) => n.textContent.trim()).find((s) => s.startsWith("@")) || null;
  const out = [];
  for (const [op, arg] of list) {
    if (op === "start") document.dispatchEvent(new CustomEvent("yt-navigate-start"));
    if (op === "finish") document.dispatchEvent(new CustomEvent("yt-navigate-finish"));
    if (op === "push") history.pushState({}, "", arg);
    if (op === "header") {
      const h = document.querySelector('ytd-browse[page-subtype="channels"] yt-page-header-view-model');
      h.querySelector("h1 [role=text]").textContent = arg[1];
      h.querySelector("yt-content-metadata-view-model [role=text]").textContent = arg[0];
    }
    if (op === "press") {
      const b = document.querySelector("#shoo-page button");
      const pressed = Boolean(b && b.textContent === label && !b.disabled);
      if (pressed) b.click();
      out.push({ at: arg, path: location.pathname, header: handleNow(), button: Boolean(b), pressed });
    }
  }
  return out;
}, [list, ctx.msg("pageHide")]);
const pressUntil = async (at, ms = 4000) => {
  const r = await until(() => steps([["press", at]]), (x) => x[0].pressed, ms, 50);
  return r.value[0];
};
const listed = async () => {
  await sleep(700);
  return ((await getList(ctx))?.channels || []).map((c) => c.handle);
};
const race = [];
const judge = (name, presses, want, got) => {
  const wrong = presses.filter((p) => p.pressed && p.header?.toLowerCase() !== want);
  race.push({ name, presses, want, got });
  check(`channel → channel in the app, ${name}: only the channel whose header is on screen gets hidden`, wrong.length === 0 && got.length === 1 && got[0].toLowerCase() === want, { got, want, presses });
};

for (const kind of ["user", "at"]) {
  const P = kind === "user" ? { a: "/user/AlphaOld", b: "/user/BravoOld", c: "/user/CharlieOld" } : { a: "/@chanalpha", b: "/@chanbravo", c: "/@chancharlie" };
  let ready = await openOn(P.a, H.a);
  if (ready.ok) {
    const early = await steps([["push", P.b], ["start"], ["press", "after yt-navigate-start (YouTube changes the address first)"], ["finish"], ["press", "right after yt-navigate-finish, old header"]]);
    const gone = await page.evaluate(() => !document.querySelector("#shoo-page button"));
    await sleep(400);
    const mid = await steps([["press", "400 ms later, old header still up"]]);
    await steps([["header", H.b]]);
    const late = await pressUntil("new header shown");
    judge(`${kind === "user" ? "/user/" : "@"} A → B pressed during and right after the move`, [...early, ...mid, late], "@chanbravo", await listed());
    check(`${kind === "user" ? "/user/" : "@"}: no 'Hide this channel's videos' between yt-navigate-start and the new channel's header`, gone && [...early, ...mid].every((p) => !p.button), { early, mid });
  } else check(`${kind}: fixture channel page ready`, false, ready.value);

  ready = await openOn(P.a, H.a);
  if (ready.ok) {
    const chain = await steps([["push", P.b], ["start"], ["finish"], ["press", "on B, old header"], ["push", P.c], ["start"], ["header", H.c], ["press", "on C with C's cached header, before yt-navigate-finish"], ["finish"]]);
    const late = await pressUntil("on C after yt-navigate-finish");
    judge(`${kind === "user" ? "/user/" : "@"} A → B → C, C's header shown at once`, [...chain, late], "@chancharlie", await listed());
  } else check(`${kind}: fixture channel page ready`, false, ready.value);
}

let ready = await openOn("/user/AlphaOld", H.a);
if (ready.ok) {
  const swap = await steps([["header", H.b], ["press", "header redrawn to another channel, before Shoo's next read"]]);
  const late = await pressUntil("after Shoo read the new header");
  judge("/user/ header redrawn without a navigation event, pressed at once", [...swap, late], "@chanbravo", await listed());
} else check("fixture channel page ready", false, ready.value);

ready = await openOn("/user/AlphaOld", H.a);
if (ready.ok) {
  const t0 = Date.now();
  await steps([["push", "/@chanalpha"], ["start"], ["finish"]]);
  const same = await pressUntil("same channel under its @handle address", 3000);
  const ms = Date.now() - t0;
  const got = await listed();
  check("one channel under two addresses (/user/ → @handle, header unchanged): the button comes back within ~1 s and hides it", same.pressed && ms < 2500 && got.length === 1 && got[0] === "@chanalpha", { ms, got, same });
} else check("fixture channel page ready", false, ready.value);

const learned = await (async () => {
  await openOn("/user/AlphaOld", H.a, { v: 1, channels: [{ handle: "@chanalpha", name: "Alpha", added: 1, source: "card" }], words: [] });
  await page.evaluate(() => (document.querySelector('ytd-browse[page-subtype="channels"] yt-page-header-view-model h1 [role=text]').textContent = "Bravo"));
  await sleep(2500);
  return (await getList(ctx))?.channels?.[0];
})();
check("/user/ page named by its own header: the header's name is never learned onto the entry", learned?.name === "Alpha", learned);

await setList(ctx, null);
await finish(ctx, check);
