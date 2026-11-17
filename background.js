if (!globalThis.ShooLib && typeof importScripts === "function") importScripts("lib.js");

const L = globalThis.ShooLib;
const t = L.translator(chrome.i18n);
let queue = Promise.resolve();

function enqueue(job) {
  const run = queue.then(job);
  queue = run.catch(() => {});
  return run;
}

async function mutate(fn) {
  const { list: raw } = await chrome.storage.local.get("list");
  const before = L.readList(raw);
  const result = fn(before) || {};
  const next = result.list;
  if (next && JSON.stringify(next) !== JSON.stringify(raw)) await chrome.storage.local.set({ list: next });
  return { ...result, raw };
}

const OPS = {
  block: (m) => mutate((l) => L.addChannel(l, m.slot || {}, String(m.source || "card"), Date.now())).then((r) => ({ key: r.key, prev: r.prev, index: r.index })),
  undoBlock: (m) =>
    mutate((l) => {
      const { list } = L.removeChannel(l, m.key);
      return { list: m.prev ? L.restoreChannel(list, m.prev, m.index) : list };
    }).then(() => true),
  unhide: (m) => mutate((l) => L.removeChannel(l, m.key)).then((r) => ({ removed: r.removed, index: r.index })),
  restore: (m) => mutate((l) => ({ list: L.restoreChannel(l, m.entry, m.index) })).then(() => true),
  learnMany: (m) =>
    mutate((l) => {
      let list = l;
      for (const p of Array.isArray(m.patches) ? m.patches.slice(0, 500) : []) if (p && typeof p.key === "string") list = L.patchChannel(list, p.key, p.patch);
      return { list };
    }).then(() => true),
  addWord: (m) => mutate((l) => ({ list: L.addWord(l, m.word) })).then(() => true),
  removeWord: (m) => mutate((l) => ({ list: L.removeWord(l, m.word) })).then(() => true),
  restoreWord: (m) => mutate((l) => ({ list: L.restoreWord(l, m.word, m.index) })).then(() => true),
};

const PAGE_OPS = {
  editWord: (m) => mutate((l) => ({ list: L.editWord(l, m.from, m.to) })).then(() => true),
  import: (m) =>
    mutate((l) => {
      const parsed = L.parseImport(String(m.text ?? ""));
      const merged = L.mergeImport(l, parsed, Date.now());
      return { list: merged.list, report: { format: parsed.format, found: parsed.channels.length + parsed.words.length, added: merged.added, idOnly: merged.idOnly, skipped: parsed.skipped, undo: merged.undo } };
    }).then((r) => ({ ...r.report, hadList: r.raw !== undefined })),
  undoImport: async (m) => {
    const r = await mutate((l) => ({ list: L.undoImport(l, m.undo) }));
    const left = r.list;
    if (m.hadList === false && !left.channels.length && !left.words.length) await chrome.storage.local.remove("list");
    return true;
  },
};

async function recordHealth(tabId, page, missing) {
  if (!(await chrome.tabs.get(tabId).catch(() => null))) return;
  const { health = {} } = await chrome.storage.session.get("health");
  health[tabId] = { page, missing, ts: Date.now() };
  await chrome.storage.session.set({ health });
  try {
    if (missing.length) {
      await chrome.action.setBadgeText({ tabId, text: "!" });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#d93025" });
      await chrome.action.setTitle({ tabId, title: t("titleBroken") });
    } else {
      await chrome.action.setBadgeText({ tabId, text: "" });
      await chrome.action.setTitle({ tabId, title: t("extName") });
    }
  } catch {}
}

async function dropHealth(tabId) {
  const { health = {} } = await chrome.storage.session.get("health");
  if (!(tabId in health)) return;
  delete health[tabId];
  await chrome.storage.session.set({ health });
}

const OPS_KEEP = 200;
const opsDone = new Map();

async function runOp(op, message) {
  const id = typeof message.op === "string" ? message.op.slice(0, 80) : null;
  if (id && opsDone.has(id)) return opsDone.get(id);
  const res = await op(message);
  if (id && res !== null && res !== undefined) {
    opsDone.set(id, res);
    while (opsDone.size > OPS_KEEP) opsDone.delete(opsDone.keys().next().value);
  }
  return res;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || typeof message !== "object" || sender.id !== chrome.runtime.id) return;
  const fromPage = typeof sender.url === "string" && sender.url.startsWith(chrome.runtime.getURL(""));
  const tabId = sender.tab?.id;
  if (message.type === "health" && tabId !== undefined && Array.isArray(message.missing)) {
    const missing = message.missing.filter((s) => L.SURFACES.includes(s));
    enqueue(() => recordHealth(tabId, String(message.page || ""), missing));
    return;
  }
  const op = OPS[message.type] || (fromPage ? PAGE_OPS[message.type] : null);
  if (!op) return;
  enqueue(() => runOp(op, message)).then(respond, () => respond(null));
  return true;
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
});

chrome.tabs.onRemoved.addListener((tabId) => enqueue(() => dropHealth(tabId)));

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading") enqueue(() => dropHealth(tabId));
});
