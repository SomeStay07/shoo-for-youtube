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
await setList(ctx, null);
await finish(ctx, check);
