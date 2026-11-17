const T0 = performance.now();
const L = globalThis.ShooLib;
const { createImporter, el } = globalThis.ShooImport;
const t = L.translator(chrome.i18n);
const LANG = chrome.i18n.getUILanguage();
const $ = (id) => document.getElementById(id);
const dateFmt = new Intl.DateTimeFormat(LANG, { dateStyle: "medium" });

let list = L.emptyList();
const removedChannels = new Map();
const removedWords = new Map();
let focusAfter = null;

const send = (message) => chrome.runtime.sendMessage(message).catch(() => null);
const labelOf = (e) => e.name || e.handle || e.id || "";
const channelUrl = (e) => (e.handle ? `https://www.youtube.com/${e.handle}` : `https://www.youtube.com/channel/${e.id}`);

function matches(q, ...values) {
  return !q || values.some((v) => v && L.norm(v).includes(q));
}

function removedRow(name, onUndo, id) {
  return el("li", { class: "row removed", id }, el("span", { class: "muted" }, t("listRemoved", name)), el("button", { type: "button", class: "link", onclick: onUndo }, t("undo")));
}

function channelRow(e) {
  const key = L.entryKey(e);
  const main = el("div", { class: "main" });
  main.append(e.name ? el("span", { class: "name" }, e.name) : el("span", { class: "name muted" }, t("listIdOnlyRow")));
  const meta = el("div", { class: "meta muted" });
  if (e.handle || e.id) meta.append(el("a", { href: channelUrl(e), target: "_blank", rel: "noopener" }, e.handle || e.id));
  if (e.added) meta.append(el("span", {}, dateFmt.format(new Date(e.added))));
  main.append(meta);
  const unhide = el("button", { type: "button", class: "secondary", onclick: async () => {
    const r = await send({ type: "unhide", key });
    if (r?.removed) {
      removedChannels.set(key, { entry: r.removed, index: r.index });
      focusAfter = `removed-${key}`;
      render();
    }
  } }, t("unhideChannel"));
  return el("li", { class: "row", "data-key": key }, main, unhide);
}

function wordRow(word) {
  const input = el("input", { type: "text", value: word, "aria-label": t("listWordLabel"), spellcheck: "false" });
  input.addEventListener("change", () => send({ type: "editWord", from: word, to: input.value }));
  const remove = el("button", { type: "button", class: "secondary", onclick: async () => {
    const index = list.words.indexOf(word);
    await send({ type: "removeWord", word });
    removedWords.set(L.norm(word), { word, index });
    focusAfter = `removedw-${L.norm(word)}`;
    render();
  } }, t("unhideWord"));
  return el("li", { class: "row word", "data-word": word }, input, remove);
}

function render() {
  const q = L.norm($("filter").value);
  const items = list.channels.map((e, i) => ({ e, i }));
  for (const [key, r] of removedChannels) if (!list.channels.some((e) => L.entryKey(e) === key)) items.push({ e: r.entry, i: r.index, removed: key });
  items.sort((a, b) => (b.e.added || 0) - (a.e.added || 0) || b.i - a.i);
  const rows = [];
  for (const it of items) {
    if (!matches(q, it.e.name, it.e.handle, it.e.id)) continue;
    if (it.removed) {
      const key = it.removed;
      rows.push(removedRow(labelOf(it.e), async () => {
        const r = removedChannels.get(key);
        removedChannels.delete(key);
        await send({ type: "restore", entry: r.entry, index: r.index });
      }, `removed-${key}`));
    } else rows.push(channelRow(it.e));
  }
  $("channels").replaceChildren(...rows);

  const words = list.words.map((w) => ({ w }));
  for (const [n, r] of [...removedWords].sort((a, b) => a[1].index - b[1].index)) {
    if (list.words.some((w) => L.norm(w) === n)) continue;
    words.splice(Math.min(Math.max(r.index, 0), words.length), 0, { w: r.word, removed: n });
  }
  $("words").replaceChildren(
    ...words
      .filter(({ w }) => matches(q, w))
      .map(({ w, removed }) =>
        removed
          ? removedRow(w, async () => {
              const r = removedWords.get(removed);
              removedWords.delete(removed);
              await send({ type: "restoreWord", word: r.word, index: r.index });
            }, `removedw-${removed}`)
          : wordRow(w),
      ),
  );
  $("empty").hidden = Boolean(list.channels.length || list.words.length || removedChannels.size || removedWords.size);
  if (focusAfter) {
    document.getElementById(focusAfter)?.querySelector("button")?.focus();
    focusAfter = null;
  }
}

function exportFile() {
  const blob = new Blob([JSON.stringify(L.exportList(list), null, 1)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `shoo-list-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function init() {
  L.localizeDocument(document, t, LANG);
  const importer = createImporter(t, $("result"));
  $("importFile").replaceChildren(importer.fileButton(t("listImport")));
  const { box } = importer.pasteBox();
  $("manyBox").replaceChildren(box);
  importer.dropOn(document.body);
  $("export").addEventListener("click", exportFile);
  $("filter").addEventListener("input", render);
  const wordInput = $("addWord");
  const syncAdd = () => ($("addWordButton").disabled = !wordInput.value.trim());
  wordInput.addEventListener("input", syncAdd);
  syncAdd();
  $("addWordForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!wordInput.value.trim()) return;
    const word = wordInput.value;
    wordInput.focus();
    await send({ type: "addWord", word });
    wordInput.value = "";
    syncAdd();
  });
  const g0 = performance.now();
  const { list: stored } = await chrome.storage.local.get("list");
  const getMs = performance.now() - g0;
  list = L.readList(stored);
  render();
  document.body.dataset.getMs = getMs.toFixed(1);
  document.body.dataset.loadMs = (performance.now() - T0).toFixed(1);
  document.body.dataset.ready = "1";
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.list) return;
  list = L.readList(changes.list.newValue);
  render();
});

init();
