const L = globalThis.ShooLib;
const t = L.translator(chrome.i18n);
const LANG = chrome.i18n.getUILanguage();
const $ = (id) => document.getElementById(id);
const SURFACE_KEYS = { search: "surfaceSearch", subs: "surfaceSubs", home: "surfaceHome", sidebar: "surfaceSidebar" };

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...kids);
  return node;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  return tab || null;
}

function renderCounts(list) {
  $("status").textContent = t("popupOn");
  $("counts").textContent = list.channels.length || list.words.length ? t("popupCounts", list.channels.length, list.words.length) : t("popupEmpty");
}

async function renderHealth(tab) {
  const node = $("health");
  const { health = {} } = await chrome.storage.session.get("health");
  const entry = tab ? health[tab.id] : null;
  const report = L.reportUrl({ version: chrome.runtime.getManifest().version, browser: L.browserLabel(navigator, LANG), page: entry?.page ?? "", missing: entry?.missing ?? [] });
  const broken = Boolean(entry?.missing?.length);
  $("report").hidden = !report || broken;
  if (report) $("report").href = report;
  if (!broken) {
    node.hidden = true;
    return;
  }
  const names = entry.missing.map((s) => t(SURFACE_KEYS[s] || "surfaceSearch"));
  const kids = [el("p", {}, t("popupBroken", new Intl.ListFormat(LANG).format(names)))];
  const links = [];
  if (report) links.push(el("a", { id: "reportHere", href: report, target: "_blank", rel: "noopener" }, t("report")));
  if (L.BREAKAGE_LISTS_SHOO) links.push(el("a", { id: "known", href: L.BREAKAGE_URL, target: "_blank", rel: "noopener" }, t("knownIssues")));
  if (links.length) kids.push(el("p", { class: "links" }, ...links));
  node.replaceChildren(...kids);
  node.hidden = false;
}

async function renderHere(tab, list) {
  const node = $("here");
  node.replaceChildren();
  if (!tab?.id || !/^https:\/\/www\.youtube\.com\/(?!embed\/)/.test(tab.url || "")) return;
  const res = await chrome.tabs.sendMessage(tab.id, { type: "count" }).catch(() => null);
  if (!res) {
    node.append(el("p", { id: "reload", class: "muted" }, t("reloadTab")));
    return;
  }
  if (res.revealed) {
    node.append(
      el("p", { id: "revealed", class: "muted" }, t("popupRevealed")),
      el("button", { type: "button", id: "hideAgain", class: "primary", onclick: async () => {
        await chrome.tabs.sendMessage(tab.id, { type: "hide" }).catch(() => null);
        window.close();
      } }, t("popupHideAgain")),
    );
    return;
  }
  if (!res.count) {
    if (list.channels.length || list.words.length) node.append(el("p", { id: "nothing", class: "muted" }, t("popupNothingHere")));
    return;
  }
  node.append(
    el("button", { type: "button", id: "showHidden", class: "primary", onclick: async () => {
      await chrome.tabs.sendMessage(tab.id, { type: "reveal" }).catch(() => null);
      window.close();
    } }, t("popupShowHidden", res.count)),
  );
}

async function init() {
  L.localizeDocument(document, t, LANG);
  const tab = await activeTab();
  const { list: stored } = await chrome.storage.local.get("list");
  const list = L.readList(stored);
  renderCounts(list);
  await Promise.all([renderHealth(tab), renderHere(tab, list)]);
  document.body.dataset.ready = "1";
}

$("manage").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.list) renderCounts(L.readList(changes.list.newValue));
  if (area === "session" && changes.health) activeTab().then(renderHealth);
});

init();
