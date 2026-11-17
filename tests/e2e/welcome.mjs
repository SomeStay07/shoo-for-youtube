import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, reporter, ROOT, getList, until, sleep, finish, consent } from "./harness.mjs";

const { check } = reporter("welcome");
const sample = (f) => readFileSync(join(ROOT, "test/samples", f), "utf8");
const ctx = await launch({ name: "welcome" });
const opened = await until(() => ctx.context.pages().find((p) => p.url().includes("/welcome.html")) || null, Boolean, 8000);
check("welcome page opens on install", opened.ok, ctx.context.pages().map((p) => p.url()));
const page = opened.value;
await page.waitForLoadState("domcontentloaded");
await sleep(500);

const layout = await page.evaluate(() => {
  const main = document.querySelector("main");
  const kids = [...main.children];
  const section = document.getElementById("import");
  return {
    order: kids.map((k) => k.tagName.toLowerCase() + (k.id ? `#${k.id}` : "")),
    firstInSection: section.firstElementChild?.id,
    firstText: section.firstElementChild?.textContent,
    boxUnder: Boolean(section.querySelector("#box textarea")) && section.querySelector("#importFirst").compareDocumentPosition(section.querySelector("#box")) & Node.DOCUMENT_POSITION_FOLLOWING,
    pin: document.getElementById("pin")?.textContent,
    reload: Boolean(document.getElementById("reload")),
    lang: document.documentElement.lang,
  };
});
check("first content line is 'export before you remove', with the drop box under it", layout.order[0] === "header" && layout.order[1] === "section#import" && layout.firstInSection === "importFirst" && layout.firstText === ctx.msg("welcomeImportFirst") && Boolean(layout.boxUnder), layout);
check("pin step present", layout.pin === ctx.msg("welcomePin"), layout.pin);
check("no YouTube tabs open: no reload step", !layout.reload);
const openYt = await page.evaluate(() => {
  const a = document.getElementById("openYouTube");
  return a ? { text: a.textContent, href: a.href, target: a.target, visible: a.checkVisibility() } : null;
});
check("'Open YouTube' link for people with nothing to import", openYt?.text === ctx.msg("welcomeOpenYouTube") && openYt.href === "https://www.youtube.com/" && openYt.target === "_blank" && openYt.visible, openYt);

const result = () => page.evaluate(() => [...document.querySelectorAll("#result > *")].map((n) => n.textContent));
const paste = async (text) => {
  await page.evaluate((t) => {
    const area = document.getElementById("paste");
    area.focus();
    area.value = t;
    area.dispatchEvent(new ClipboardEvent("paste", { bubbles: true }));
  }, text);
};

await paste("@SlopFarmTV\nUCabcdefghijklmnopqrstuv\n");
const r1 = await until(result, (r) => r.length > 0, 3000);
const l1 = await getList(ctx);
check("paste imports and shows the result line", r1.value[0] === ctx.msg("importResult", 2, 0) && r1.value.includes(ctx.msg("importIdOnly", 1)) && r1.value.includes(ctx.msg("importUndo")) && l1.channels.length === 2, { result: r1.value, list: l1 });
const before = JSON.stringify(await getList(ctx));

await page.evaluate((text) => {
  const dt = new DataTransfer();
  dt.items.add(new File([text], "blocktube_backup.json", { type: "application/json" }));
  const zone = document.getElementById("import");
  zone.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
  zone.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
}, sample("blocktube_backup.json"));
const r2 = await until(result, (r) => r[0] !== r1.value[0], 3000);
check("file drop imports a BlockTube backup and shows added and skipped", r2.value[0] === ctx.msg("importResult", 3, 2) && r2.value.includes(ctx.msg("importSkippedPatterns", 2)) && r2.value.includes(ctx.msg("importSkippedOther", 1)) && r2.value.includes(ctx.msg("importIdOnly", 1)), r2.value);
await page.locator(".import-undo").click();
const undone = await until(async () => JSON.stringify(await getList(ctx)), (s) => s === before, 3000);
check("Undo import restores the previous list byte for byte", undone.ok && (await result()).length === 0, { before: before.length, after: undone.value.length });

await page.evaluate((text) => {
  const dt = new DataTransfer();
  dt.items.add(new File([text], "blocktube_backup.json", { type: "application/json" }));
  const zone = document.getElementById("import");
  zone.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
}, sample("blocktube_backup.json"));
await until(result, (r) => r.includes(ctx.msg("importUndo")), 3000);
await ctx.worker.evaluate(() => chrome.storage.local.get("list").then(({ list }) => chrome.storage.local.set({ list: { ...list, channels: [...list.channels, { handle: "@blockedmeanwhile", name: "Blocked Meanwhile", added: 5, source: "card" }] } })));
await sleep(300);
await page.locator(".import-undo").click();
const kept = await until(() => getList(ctx), (l) => l && !l.channels.some((c) => c.name === "AI Cats Daily"), 3000);
const keptList = kept.value;
check("Undo import removes only what the import added: a channel hidden in another tab meanwhile stays", kept.ok && keptList.channels.some((c) => c.handle === "@blockedmeanwhile") && keptList.channels.length === JSON.parse(before).channels.length + 1, keptList?.channels.map((c) => c.handle || c.id || c.name));
await ctx.worker.evaluate((b) => chrome.storage.local.set({ list: JSON.parse(b) }), before);
await sleep(300);

await page.setInputFiles("#box input[type=file]", { name: "ChannelBlocker 2026-11-15.save", mimeType: "application/octet-stream", buffer: Buffer.from(sample("ChannelBlocker-2026-11-15.save")) });
const r3 = await until(result, (r) => r.length > 0, 3000);
check("'Choose a file' imports a Channel Blocker .save", r3.value[0] === ctx.msg("importResult", 3, 1) && r3.value.includes(ctx.msg("importSkippedPatterns", 2)) && r3.value.includes(ctx.msg("importSkippedOther", 2)), r3.value);
await page.locator(".import-undo").click();
await until(async () => JSON.stringify(await getList(ctx)), (s) => s === before, 3000);

await paste("# nothing here\n");
const r4 = await until(result, (r) => r.length > 0, 3000);
check("text with no channels or words says so", r4.value[0] === ctx.msg("importNothing"), r4.value);

await paste("@SlopFarmTV");
const r5 = await until(result, (r) => r[0] !== r4.value[0], 3000);
check("importing only duplicates adds nothing and offers no Undo", r5.value[0] === ctx.msg("importResult", 0, 0) && !r5.value.includes(ctx.msg("importUndo")), r5.value);

const welcomeAdd = await page.evaluate(() => {
  const area = document.getElementById("paste");
  area.value = "";
  area.dispatchEvent(new Event("input", { bubbles: true }));
  return document.querySelector("#box .paste > button").disabled;
});
await page.fill("#paste", "@typed");
const welcomeTyped = await page.evaluate(() => document.querySelector("#box .paste > button").disabled);
await page.fill("#paste", "");
check("welcome paste box: 'Add' is disabled while the box is empty", welcomeAdd && !welcomeTyped, { welcomeAdd, welcomeTyped });

await page.evaluate(() => {
  globalThis.__send = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = () => Promise.reject(new Error("no worker"));
});
await paste("@NeverSaved");
const r6 = await until(result, (r) => r.length > 0 && r[0] !== r5.value[0], 3000);
await page.evaluate(() => (chrome.runtime.sendMessage = globalThis.__send));
check("an import the worker can't save says so instead of clearing the result", r6.value[0] === ctx.msg("cardNotSaved"), r6.value);

const yt = await ctx.context.newPage();
await yt.goto("https://www.youtube.com/results?search_query=veritasium", { waitUntil: "domcontentloaded" });
await consent(yt);
const origin0 = await yt.evaluate(() => performance.timeOrigin);
const again = await ctx.context.newPage();
await again.goto(`chrome-extension://${ctx.extId}/welcome.html`);
const btn = await until(() => again.evaluate(() => document.getElementById("reloadTabs")?.textContent || null), Boolean, 4000);
check("with a YouTube tab open: 'Reload YouTube tabs (N)'", btn.value === ctx.msg("welcomeReloadTabs", 1), btn.value);
await again.click("#reloadTabs");
const reloaded = await until(() => yt.evaluate(() => performance.timeOrigin).catch(() => origin0), (o) => o !== origin0, 10000);
const done = await again.evaluate(() => document.getElementById("reloadTabs").textContent);
check("the button reloads the open tabs", reloaded.ok && done === ctx.msg("welcomeReloadDone"), { reloaded: reloaded.ok, done });

await finish(ctx, check);
