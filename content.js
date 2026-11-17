(() => {
  const L = globalThis.ShooLib;
  if (!L || window.top !== window) return;
  const translate = L.translator(chrome.i18n);
  const t = (key, ...subs) => {
    try {
      return translate(key, ...subs);
    } catch {
      return "";
    }
  };
  const root = document.documentElement;
  const docPath = location.pathname;
  const NOT_SAVED = t("cardNotSaved");
  const alive = () => {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  };

  const CARD =
    "ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-rich-grid-media, yt-lockup-view-model, ytm-shorts-lockup-view-model, ytd-reel-item-renderer, ytd-channel-renderer, ytd-playlist-renderer, ytd-radio-renderer, ytd-universal-watch-card-renderer, ytd-post-renderer, yt-official-card-view-model";
  const SHORT = "ytm-shorts-lockup-view-model, ytd-reel-item-renderer";
  const AD = "ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-video-renderer, ytd-search-pyv-renderer, ytd-promoted-sparkles-web-renderer, ytd-display-ad-renderer";
  const OWN = ".shoo-btn, .shoo-line, .shoo-reason, .shoo-menu, .shoo-page, .shoo-all";
  const CHANNEL_LINK = 'a[href^="/@"], a[href^="/channel/UC"], a[href^="https://www.youtube.com/@"], a[href^="https://www.youtube.com/channel/UC"]';
  const NOT_IDENTITY = "#description, #description-text, .metadata-snippet-container, #expandable-metadata, ytd-post-renderer #content-text, #home-content-text";
  const CHANNEL_PAGE = 'ytd-browse[page-subtype="channels"]';
  const LEFT_ALONE = 'ytd-playlist-panel-renderer, ytd-browse[page-subtype="playlist"]';
  const SIDEBAR = "#secondary, #related, ytd-watch-next-secondary-results-renderer";
  const HIDE = "data-shoo-hide";
  const SLOT = "data-shoo-slot";
  const SEP = /^(?:,|(?:and|und|и|y|e)\s)/u;

  let list = L.emptyList();
  let listJSON = null;
  let committed = L.emptyList();
  let matcher = L.compile(list);
  let ready = false;
  let page = L.pageOf(location.pathname);
  let exempt = null;
  let revealed = false;
  let pageState = null;
  let cameFromResults = /\/results\?/.test(document.referrer);
  let pending = null;
  let lastSent = null;
  let healthDirty = true;
  let healthTicks = 0;
  let lastPage = null;
  const verdicts = new WeakMap();
  const applied = new WeakSet();
  const listedHref = new Map();
  const nearest = new WeakMap();
  const outers = new WeakMap();
  let allDirty = true;
  const slots = new Map();
  const removed = new Map();
  const learned = new Set();
  const stats = { calls: 0, ms: 0, maxMs: 0, applied: 0 };

  const text = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();
  const NOISE = `ytd-thumbnail, yt-thumbnail-view-model, #mouseover-overlay, ytd-moving-thumbnail-renderer, #expandable-metadata, ytd-expandable-metadata-renderer, #badges, ytd-badge-supported-renderer, #description-text, .metadata-snippet-container, #menu, ytd-menu-renderer, yt-interaction, #dismissed, tp-yt-paper-tooltip, ${OWN}`;
  const NO_CARDS = "#movie_player, ytd-player, tp-yt-iron-dropdown, ytd-comments, yt-chip-cloud-renderer, ytd-watch-metadata";
  const ZONE = "#video-title, h3, h1, #channel-info, ytd-channel-name, #attributed-channel-name, yt-content-metadata-view-model, #author-text, #channel-title, #byline-container";
  const NEAREST = `${NOISE}, ${ZONE}, ${CARD}, ${NO_CARDS}`;
  let depth = 0;
  function timed(fn) {
    return function (...args) {
      if (depth) return fn.apply(this, args);
      depth++;
      const t0 = performance.now();
      try {
        return fn.apply(this, args);
      } finally {
        depth--;
        stats.ms += performance.now() - t0;
      }
    };
  }

  function sendOnce(message) {
    try {
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  }

  async function send(message) {
    if (message.type === "health") return sendOnce(message);
    for (let attempt = 0; attempt < 3 && alive(); attempt++) {
      const res = await sendOnce(message);
      if (res !== null && res !== undefined) return res;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
    return null;
  }

  const opBase = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  let opSeq = 0;
  let chain = Promise.resolve();
  let inFlight = 0;
  let behind = false;
  function write(message, box = null, onFail = writeFailed) {
    const msg = { ...message, op: `${opBase}-${++opSeq}` };
    inFlight++;
    const run = chain.then(() => send(msg));
    chain = run.catch(() => null);
    return run.then(
      (res) => {
        inFlight--;
        if (res === null || res === undefined) onFail(box);
        else {
          if (box) clearFailed(box);
          if (!inFlight && behind) catchUp();
        }
        return res;
      },
      () => {
        inFlight--;
        onFail(box);
        return null;
      },
    );
  }

  function catchUp() {
    behind = false;
    chrome.storage.local.get("list").then(timed(({ list: stored }) => setList(stored)), () => {});
  }

  function el(tag, attrs = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    node.append(...kids);
    return node;
  }

  function stopAll(node) {
    for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend", "dblclick", "keydown", "keyup", "keypress"]) {
      node.addEventListener(type, (e) => e.stopPropagation());
    }
    return node;
  }

  function button(label, onClick, extra = {}) {
    return stopAll(
      el("button", { type: "button", ...extra, onclick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(e);
      } }, label),
    );
  }

  const hrefInfo = new Map();
  function linksOf(scope) {
    const out = [];
    const seen = new Set();
    let skip = null;
    for (const a of scope.querySelectorAll(CHANNEL_LINK)) {
      const href = a.getAttribute("href");
      let info = hrefInfo.get(href);
      if (info === undefined) {
        const c = L.parseChannelHref(href);
        info = c ? { c, k: c.handle ? `h${L.normHandle(c.handle)}` : `i${c.id}` } : null;
        if (hrefInfo.size > 5000) hrefInfo.clear();
        hrefInfo.set(href, info);
      }
      if (!info || seen.has(info.k)) continue;
      skip ??= [...scope.querySelectorAll(NOT_IDENTITY)];
      if (skip.length && skip.some((n) => n.contains(a))) continue;
      seen.add(info.k);
      out.push({ ...info.c });
    }
    return out;
  }

  function nameParts(row) {
    if (!row) return [];
    const kids = [...row.children].filter((k) => k.getAttribute("aria-hidden") !== "true" && text(k));
    if (!kids[0] || kids[0].hasAttribute("aria-label")) return [];
    const parts = [kids[0]];
    for (const k of kids.slice(1)) {
      if (!SEP.test(text(k))) break;
      parts.push(k);
    }
    return parts;
  }

  function nameOf(card) {
    const heading = card.matches("yt-official-card-view-model") && card.querySelector("h1");
    if (heading && text(heading)) return { nameText: text(heading), collab: false };
    const collab = Boolean(card.querySelector("yt-avatar-stack-view-model, ytd-avatar-stack, yt-avatar-stack"));
    const attributed = card.querySelector("#attributed-channel-name");
    if (attributed && !attributed.hidden && text(attributed)) return { nameText: text(attributed), collab: collab || L.collabNames(text(attributed)).parts.length > 1 };
    for (const node of card.querySelectorAll("ytd-channel-name #text")) if (text(node)) return { nameText: text(node), collab };
    const parts = nameParts(card.querySelector("yt-content-metadata-view-model [role=group]"));
    if (parts.length) return { nameText: parts.map(text).join(" "), collab: collab || parts.length > 1 };
    const author = card.querySelector("#author-text");
    if (author && text(author)) return { nameText: text(author), collab };
    return { nameText: "", collab };
  }

  function titleOf(card) {
    if (card.matches("ytd-channel-renderer, ytd-universal-watch-card-renderer, ytd-post-renderer, yt-official-card-view-model")) return "";
    const node = card.querySelector("#video-title") || card.querySelector("h3");
    if (!node) return "";
    return node.getAttribute("title") || text(node);
  }

  function readCard(card) {
    const short = card.matches(SHORT);
    if (short) return { links: [], nameText: "", collab: false, title: titleOf(card), short };
    return { links: linksOf(card), ...nameOf(card), title: titleOf(card), short };
  }

  function outerOf(card) {
    let box = outers.get(card);
    if (!box || !box.contains(card)) {
      box = card.closest("ytd-rich-item-renderer") || card.closest("ytm-shorts-lockup-view-model-v2") || card;
      outers.set(card, box);
    }
    return box;
  }
  const innerOf = (box) => (box.matches(CARD) ? box : box.querySelector(CARD));
  const skipped = new WeakMap();
  function skipCard(card) {
    let v = skipped.get(card);
    if (v === undefined) {
      v = Boolean(card.closest(AD) || card.parentElement?.closest(CARD));
      skipped.set(card, v);
    }
    return v;
  }

  function pageChannel() {
    return L.channelOfPage(location.pathname, { docPath, metaId: document.querySelector('meta[itemprop="identifier"][content^="UC"]')?.content });
  }

  function computeExempt() {
    if (page !== "channel") return null;
    const c = pageChannel();
    const r = c && L.matchSlot(matcher, c);
    return r ? L.entryKey(r.entry) : null;
  }

  function apply(card) {
    if (skipCard(card)) return;
    stats.applied++;
    const box = outerOf(card);
    const info = readCard(card);
    const v = ready && !box.closest(LEFT_ALONE) ? L.cardVerdict(matcher, info, { exempt: exempt && box.closest(CHANNEL_PAGE) ? exempt : null }) : null;
    if (!applied.has(card)) {
      applied.add(card);
      allDirty = true;
    }
    watchCard(card, !v);
    if (v) {
      const tag = v.kind;
      if (box.getAttribute(HIDE) !== tag) {
        box.setAttribute(HIDE, tag);
        allDirty = true;
      }
      verdicts.set(box, v);
      if (v.learn) learn(v);
      if (revealed) syncReason(box, v);
    } else if (box.hasAttribute(HIDE)) {
      unhideBox(box);
    }
    if (removed.size) syncRemoved(box);
    if (slots.size || box.hasAttribute(SLOT)) syncSlot(box);
    if (current && current.card === card) labelButton(info);
  }

  function unhideBox(box) {
    allDirty = true;
    box.removeAttribute(HIDE);
    box.removeAttribute(SLOT);
    verdicts.delete(box);
    slots.delete(box);
    if (revealed || box.lastElementChild?.matches(OWN)) for (const node of box.querySelectorAll(`${SLOT_LINE}, :scope > .shoo-reason`)) node.remove();
  }

  const learnQueue = new Map();
  let learnTimer = 0;
  function learn(v) {
    const key = L.entryKey(v.entry);
    const sig = key + JSON.stringify(v.learn);
    if (learned.has(sig)) return;
    learned.add(sig);
    learnQueue.set(key, { ...learnQueue.get(key), ...v.learn });
    learnTimer ||= setTimeout(flushLearn, 1000);
  }

  function flushLearn() {
    learnTimer = 0;
    const patches = [...learnQueue].map(([key, patch]) => ({ key, patch }));
    learnQueue.clear();
    if (patches.length && alive()) write({ type: "learnMany", patches }, null, () => {});
  }

  function sweepAll() {
    for (const card of document.querySelectorAll(CARD)) apply(card);
    for (const box of document.querySelectorAll(`[${HIDE}]`)) if (!innerOf(box)) unhideBox(box);
    syncPage();
    syncAllHidden(true);
  }

  function sweepActive() {
    for (const pageEl of document.querySelectorAll("ytd-page-manager > :not([hidden])")) for (const card of pageEl.querySelectorAll(CARD)) apply(card);
    syncPage();
    syncAllHidden(true);
  }

  function setList(stored) {
    committed = L.readList(stored);
    if (inFlight) {
      behind = true;
      return;
    }
    behind = false;
    const json = JSON.stringify(committed);
    if (ready && json === listJSON) return;
    healthDirty = true;
    listedHref.clear();
    list = committed;
    listJSON = json;
    matcher = L.compile(list);
    exempt = computeExempt();
    if (ready) sweepAll();
  }

  function localChange(next) {
    listedHref.clear();
    list = next;
    listJSON = JSON.stringify(list);
    matcher = L.compile(list);
    exempt = computeExempt();
    sweepAll();
  }

  let pageFailed = null;
  function showReload(box) {
    if (!box?.isConnected) return;
    if (box.id === "shoo-page") {
      pageFailed = location.href;
      box.dataset.sig = "reload";
      box.replaceChildren(el("span", { class: "shoo-text" }, NOT_SAVED));
      syncPage();
      return;
    }
    box.querySelector(":scope > .shoo-failed")?.remove();
    box.append(stopAll(el("div", { class: "shoo-line shoo-failed", role: "status" }, el("span", { class: "shoo-text" }, NOT_SAVED))));
    syncSlot(box);
  }

  function writeFailed(box) {
    if (box) slots.delete(box);
    pageState = null;
    if (!inFlight) behind = false;
    if (JSON.stringify(committed) !== listJSON) localChange(committed);
    showReload(box);
  }

  function clearFailed(box) {
    if (box?.id === "shoo-page") return;
    box?.querySelector(":scope > .shoo-failed")?.remove();
  }

  function labelOf(c) {
    return c.name || c.handle || c.id || "";
  }

  let shared = null;
  let current = null;
  let menuCleanup = null;

  function glyph() {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    const circle = document.createElementNS(NS, "circle");
    for (const [k, v] of Object.entries({ cx: "8", cy: "8", r: "6.25", fill: "none", stroke: "currentColor", "stroke-width": "1.5" })) circle.setAttribute(k, v);
    const path = document.createElementNS(NS, "path");
    for (const [k, v] of Object.entries({ d: "M3.6 3.6l8.8 8.8", stroke: "currentColor", "stroke-width": "1.5" })) path.setAttribute(k, v);
    svg.append(circle, path);
    return svg;
  }

  function sharedButton() {
    if (!shared) {
      shared = button("", () => {
        if (current?.box.isConnected) onCardButton(current.box, current.card);
      }, { class: "shoo-btn" });
      shared.append(glyph());
    }
    return shared;
  }

  function anchorOf(card, box) {
    if (card.matches("yt-lockup-view-model")) {
      const row = card.querySelector("yt-content-metadata-view-model [role=group]");
      const name = box !== card && nameParts(row).at(-1);
      if (name) {
        let after = name;
        while (after.nextElementSibling?.matches("span[aria-label]:not([role])") && !text(after.nextElementSibling)) after = after.nextElementSibling;
        return { node: after, kind: "shoo-lockup" };
      }
      if (row) return { node: row, append: true, kind: "shoo-lockup" };
    }
    const attributed = card.querySelector("#channel-info #attributed-channel-name");
    if (attributed && !attributed.hidden && attributed.firstElementChild) return { node: attributed };
    const infoName = card.querySelector("#channel-info ytd-channel-name");
    if (infoName && !infoName.hidden) return { node: infoName };
    for (const name of card.querySelectorAll("ytd-channel-name")) if (!name.hidden && !name.parentElement?.closest("[hidden]")) return { node: name };
    const named = card.querySelector("#author-text") || (card.matches("yt-official-card-view-model") && card.querySelector("h1"));
    if (named) return { node: named };
    return { node: box, append: true, kind: "shoo-float" };
  }

  function labelButton(info) {
    if (!shared || !alive()) return;
    const channels = L.cardChannels(info);
    if (!channels.length) return;
    const label = channels.length > 1 ? t("cardHideCollab") : t("cardHide", labelOf(channels[0]));
    if (shared.getAttribute("aria-label") === label) return;
    shared.setAttribute("aria-label", label);
    shared.title = channels.length > 1 ? label : t("cardHideTip", labelOf(channels[0]));
  }

  function dropButton() {
    closeMenus();
    current?.box.removeAttribute("data-shoo-card");
    current = null;
    shared?.remove();
  }

  function placeButton(card) {
    if (!alive()) {
      dropButton();
      return false;
    }
    if (!ready || skipCard(card) || card.matches(SHORT) || card.closest(CHANNEL_PAGE) || card.closest(LEFT_ALONE)) return false;
    const box = outerOf(card);
    if (box.hasAttribute(HIDE)) return false;
    const info = readCard(card);
    if (!L.cardChannels(info).length) return false;
    const btn = sharedButton();
    if (current?.box !== box) {
      closeMenus();
      current?.box.removeAttribute("data-shoo-card");
      box.setAttribute("data-shoo-card", "");
    }
    current = { card, box };
    const anchor = anchorOf(card, box);
    const focused = document.activeElement === btn;
    btn.classList.toggle("shoo-lockup", anchor.kind === "shoo-lockup");
    btn.classList.toggle("shoo-float", anchor.kind === "shoo-float");
    if (anchor.append) {
      if (anchor.node.lastElementChild !== btn) anchor.node.append(btn);
    } else if (anchor.node.nextElementSibling !== btn) anchor.node.after(btn);
    if (focused && document.activeElement !== btn) btn.focus({ preventScroll: true });
    labelButton(info);
    return true;
  }

  let pointerTimer = 0;
  let pointerCard = null;
  function cardUnder(target) {
    if (!(target instanceof Element) || (current && current.box.contains(target) && current.card.isConnected)) return null;
    if (target.closest(OWN)) return null;
    return target.closest(CARD);
  }
  function onPointer(e) {
    const card = cardUnder(e.target);
    if (!card || card === pointerCard) return;
    pointerCard = card;
    clearTimeout(pointerTimer);
    pointerTimer = setTimeout(placePointerCard, 120);
  }
  const placePointerCard = timed(function placePointerCard() {
    const card = pointerCard;
    pointerCard = null;
    if (shared && document.activeElement === shared && shared.matches(":focus-visible")) return;
    if (card?.isConnected && card.matches(":hover")) placeButton(card);
  });
  function onFocus(e) {
    const card = cardUnder(e.target);
    if (card) placeButton(card);
  }
  document.addEventListener("pointerover", timed(onPointer), { capture: true, passive: true });
  document.addEventListener("focusin", timed(onFocus), true);

  function focusButton(box) {
    const card = innerOf(box);
    if (card && placeButton(card)) shared.focus({ preventScroll: true });
  }

  let openMenu = null;
  function closeMenus() {
    if (!openMenu) return;
    menuCleanup?.();
    menuCleanup = null;
    openMenu.remove();
    openMenu = null;
    shared?.setAttribute("aria-expanded", "false");
  }

  function onCardButton(box, card) {
    if (!alive()) {
      dropButton();
      return showReload(box);
    }
    const channels = L.cardChannels(readCard(card));
    if (channels.length === 1) return block(channels[0], box);
    if (!channels.length) return;
    const btn = shared;
    const open = box.querySelector(":scope > .shoo-menu");
    closeMenus();
    if (open) return btn.focus();
    const menu = stopAll(el("div", { class: "shoo-menu", role: "group", "aria-label": t("cardHideCollab") }, el("p", {}, t("cardHideCollab"))));
    for (const c of channels) menu.append(button(labelOf(c), () => {
      closeMenus();
      block(c, box);
    }));
    menu.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape") return;
        closeMenus();
        btn.focus();
      },
      true,
    );
    const b = btn.getBoundingClientRect();
    const o = box.getBoundingClientRect();
    menu.style.top = `${Math.round(b.bottom - o.top + 4)}px`;
    menu.style.left = `${Math.round(Math.max(0, Math.min(b.left - o.left, o.width - 200)))}px`;
    box.append(menu);
    openMenu = menu;
    btn.setAttribute("aria-expanded", "true");
    menu.querySelector("button")?.focus();
    const outside = (e) => {
      if (!menu.contains(e.target) && !btn.contains(e.target)) closeMenus();
    };
    const timer = setTimeout(() => document.addEventListener("click", outside, true), 0);
    menuCleanup = () => {
      clearTimeout(timer);
      document.removeEventListener("click", outside, true);
    };
  }

  function block(slot, box) {
    if (!alive()) return showReload(box);
    clearFailed(box);
    const source = box.closest(SIDEBAR) ? "sidebar" : "card";
    const sentAt = Date.now();
    const local = L.addChannel(list, slot, source, sentAt);
    if (!local.key) return;
    const state = { key: local.key, prev: local.prev, index: local.index, name: labelOf(slot), focus: true };
    slots.set(box, state);
    localChange(local.list);
    write({ type: "block", slot, source }, box).then((res) => {
      const settled = L.settleBlock(local, res, sentAt);
      if (settled) Object.assign(state, settled);
    });
  }

  function undoBlock(state, box) {
    if (!alive()) return showReload(box);
    clearFailed(box);
    const removed = L.removeChannel(list, state.key).list;
    localChange(state.prev ? L.restoreChannel(removed, state.prev, state.index) : removed);
    write({ type: "undoBlock", key: state.key, prev: state.prev, index: state.index }, box);
  }

  const SLOT_LINE = ":scope > .shoo-line:not(.shoo-removed, .shoo-failed)";
  function syncSlot(box) {
    const state = slots.get(box);
    const line = box.querySelector(SLOT_LINE);
    if (!state && !revealed && box.hasAttribute(HIDE) && box.querySelector(":scope > .shoo-failed")) {
      if (!box.hasAttribute(SLOT)) box.setAttribute(SLOT, "");
      line?.remove();
      return;
    }
    if (!state || revealed || !box.hasAttribute(HIDE)) {
      if (state && !box.hasAttribute(HIDE)) slots.delete(box);
      if (box.hasAttribute(SLOT)) box.removeAttribute(SLOT);
      line?.remove();
      return;
    }
    if (!box.hasAttribute(SLOT)) box.setAttribute(SLOT, "");
    if (line) return;
    const undo = button(t("undo"), () => {
      slots.delete(box);
      if (!alive()) return showReload(box);
      undoBlock(state, box);
      focusButton(box);
    });
    box.append(stopAll(el("div", { class: "shoo-line", role: "status" }, el("span", { class: "shoo-text" }, t("cardHidden", state.name)), undo)));
    if (state.focus) {
      state.focus = false;
      undo.focus({ preventScroll: true });
    }
  }

  function clearSlots() {
    for (const box of [...slots.keys()]) {
      slots.delete(box);
      if (box.isConnected) syncSlot(box);
    }
  }

  function reasonText(v) {
    return v.kind === "channel" ? t("reasonChannel", labelOf(v.entry)) : t("reasonWord", v.word);
  }

  function unhideEntry(box, v) {
    if (!alive()) return showReload(box);
    clearFailed(box);
    if (v.kind === "channel") {
      const key = L.entryKey(v.entry);
      const r = L.removeChannel(list, key);
      if (!r.removed) return;
      removed.set(box, { name: labelOf(r.removed), focus: true, undo: () => {
        localChange(L.restoreChannel(list, r.removed, r.index));
        write({ type: "restore", entry: r.removed, index: r.index }, box);
      } });
      localChange(r.list);
      write({ type: "unhide", key }, box);
    } else {
      const index = list.words.findIndex((w) => L.norm(w) === L.norm(v.word));
      if (index < 0) return;
      const word = list.words[index];
      removed.set(box, { name: word, focus: true, undo: () => {
        localChange(L.restoreWord(list, word, index));
        write({ type: "restoreWord", word, index }, box);
      } });
      localChange(L.removeWord(list, word));
      write({ type: "removeWord", word }, box);
    }
  }

  function removedLine(box, state, extraClass = "") {
    const undo = button(t("undo"), () => {
      if (!alive()) return showReload(box);
      removed.delete(box);
      state.undo();
    });
    const line = stopAll(el("div", { class: `shoo-line shoo-removed ${extraClass}`.trim(), role: "status" }, el("span", { class: "shoo-text" }, t("listRemoved", state.name)), undo));
    line.dataset.name = state.name;
    if (state.focus) {
      state.focus = false;
      queueMicrotask(() => undo.focus({ preventScroll: true }));
    }
    return line;
  }

  function syncRemoved(box) {
    const state = revealed ? removed.get(box) : null;
    const line = box.querySelector(":scope > .shoo-removed");
    if (!state || box.hasAttribute(HIDE)) {
      line?.remove();
      return;
    }
    if (line?.dataset.name === state.name) return;
    line?.remove();
    box.append(removedLine(box, state));
  }

  function syncReason(box, v) {
    const current = box.querySelector(":scope > .shoo-reason");
    const state = removed.get(box);
    const label = `${reasonText(v)}|${v.kind === "channel" ? L.entryKey(v.entry) : ""}|${state?.name ?? ""}`;
    if (current?.dataset.label === label) return;
    current?.remove();
    const action = button(v.kind === "channel" ? t("unhideChannel") : t("unhideWord"), () => unhideEntry(box, v));
    const line = stopAll(el("div", { class: "shoo-reason" }, el("div", { class: "shoo-row" }, el("span", {}, reasonText(v)), action)));
    if (state) line.append(removedLine(box, state));
    line.dataset.label = label;
    box.append(line);
  }

  function setReveal(on) {
    if (on === revealed) return;
    revealed = on;
    if (on) {
      clearSlots();
      root.setAttribute("data-shoo-reveal", "");
      for (const box of document.querySelectorAll(`[${HIDE}]`)) {
        const v = verdicts.get(box);
        if (v) syncReason(box, v);
      }
    } else {
      root.removeAttribute("data-shoo-reveal");
      removed.clear();
      for (const node of document.querySelectorAll(".shoo-reason, .shoo-removed")) node.remove();
    }
    syncAllHidden(true);
  }

  const inActivePage = (node) => !node.closest("ytd-search[hidden], ytd-browse[hidden], ytd-watch-flexy[hidden], ytd-watch-grid[hidden]");

  function hiddenOnPage() {
    return [...document.querySelectorAll(`[${HIDE}]`)].filter((box) => inActivePage(box) && Boolean(box.parentElement?.checkVisibility()));
  }

  function syncAllHidden(force = false) {
    if (!allDirty && !force) return;
    allDirty = false;
    const current = document.getElementById("shoo-all");
    let total = 0;
    let hidden = 0;
    let anchor = null;
    if (ready && page === "search" && !revealed && alive()) {
      anchor = document.querySelector("ytd-search:not([hidden]) ytd-section-list-renderer");
      if (anchor) {
        for (const card of anchor.querySelectorAll(CARD)) {
          if (card.matches(SHORT) || skipCard(card)) continue;
          total++;
          if (outerOf(card).hasAttribute(HIDE)) hidden++;
        }
      }
    }
    if (!total || hidden !== total) {
      current?.remove();
      return;
    }
    if (current && current.dataset.count === String(hidden) && current.nextElementSibling === anchor) return;
    current?.remove();
    const line = el("div", { id: "shoo-all", class: "shoo-all", role: "status" }, el("span", {}, t("allHidden", hidden)), button(t("showThem"), () => setReveal(true)));
    line.dataset.count = String(hidden);
    anchor.before(line);
  }

  function ownerInfo() {
    if (page === "watch") {
      const owner = document.querySelector(":is(ytd-watch-flexy, ytd-watch-grid):not([hidden]) ytd-watch-metadata #owner");
      const renderer = owner?.querySelector("ytd-video-owner-renderer");
      if (!renderer) return null;
      const links = linksOf(renderer);
      const { nameText, collab } = nameOf(renderer);
      const name = collab ? L.collabNames(nameText).parts[0] : nameText;
      if (!name) return null;
      const row = owner.closest("#top-row") || owner.parentElement;
      return { host: owner, place: (node) => owner.append(node), line: (node) => node.previousElementSibling === row || row.after(node), slot: { ...(links[0] || {}), ...(name ? { name } : {}) }, source: "watch" };
    }
    if (page === "channel") {
      const header = document.querySelector(`${CHANNEL_PAGE}:not([hidden]) yt-page-header-view-model`);
      const actions = header?.querySelector("yt-flexible-actions-view-model");
      const c = pageChannel();
      if (!actions || !c) return null;
      const own = [...header.querySelectorAll("yt-content-metadata-view-model [role=text]")].map(text).find((s) => /^@\S+$/.test(s)) || "";
      const { slot, verified } = L.headerSlot(c, { name: text(header.querySelector("h1")), handle: own });
      return { host: actions.parentElement, place: (node) => actions.after(node), slot, verified, source: "channel" };
    }
    return null;
  }

  function placePage(box, info, wide) {
    const asLine = wide && Boolean(info.line);
    const cls = asLine ? "shoo-line shoo-page-line" : "shoo-page";
    if (box.className !== cls) box.className = cls;
    if (asLine) info.line(box);
    else if (box.parentElement !== info.host) info.place(box);
  }

  function syncPage() {
    let box = document.getElementById("shoo-page");
    const failed = pageFailed === location.href && box?.dataset.sig === "reload";
    const info = ready && (alive() || failed) ? ownerInfo() : null;
    if (!info) {
      box?.remove();
      return;
    }
    if (failed) return placePage(box, info, true);
    if (!box) box = stopAll(el("div", { id: "shoo-page", class: "shoo-page", role: "status" }));
    const just = pageState && pageState.href === location.href ? pageState : null;
    const listed = just ? null : L.matchSlot(matcher, info.slot);
    const sig = just ? `just:${just.key}:${cameFromResults}` : listed ? `listed:${L.entryKey(listed.entry)}` : `button:${JSON.stringify(info.slot)}`;
    placePage(box, info, Boolean(just || listed));
    if (listed && info.source === "channel" && info.verified) {
      const patch = L.learnFrom(listed.entry, info.slot, listed.by);
      if (patch) learn({ entry: listed.entry, learn: patch });
    }
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    if (just) {
      const kids = [el("span", { class: "shoo-text" }, t("cardHidden", just.name))];
      if (cameFromResults) kids.push(button(t("pageBack"), () => history.back()));
      kids.push(button(t("undo"), () => {
        if (!alive()) return showReload(box);
        pageState = null;
        undoBlock(just, box);
        document.querySelector("#shoo-page button")?.focus();
      }));
      box.replaceChildren(...kids);
      return;
    }
    if (listed) {
      const key = L.entryKey(listed.entry);
      box.replaceChildren(el("span", { class: "shoo-text" }, t("pageHidden")), button(t("unhideChannel"), () => {
        if (!alive()) return showReload(box);
        localChange(L.removeChannel(list, key).list);
        write({ type: "unhide", key }, box);
        document.querySelector("#shoo-page button")?.focus();
      }));
      return;
    }
    box.replaceChildren(button(t("pageHide"), () => {
      if (!alive()) return showReload(box);
      const slot = info.slot;
      const sentAt = Date.now();
      const local = L.addChannel(list, slot, info.source, sentAt);
      if (!local.key) return;
      pageState = { href: location.href, key: local.key, prev: local.prev, index: local.index, name: labelOf(slot) };
      const state = pageState;
      localChange(local.list);
      document.querySelector("#shoo-page button")?.focus();
      write({ type: "block", slot, source: info.source }, box).then((res) => {
        const settled = L.settleBlock(local, res, sentAt);
        if (settled) Object.assign(state, settled);
      });
    }, { class: "shoo-main", title: t("cardHideTip", labelOf(info.slot)) }));
    box.querySelector("button.shoo-main")?.prepend(glyph());
  }

  let syncTimer = 0;
  function scheduleSync() {
    if (syncTimer) return;
    syncTimer = setTimeout(() => {
      syncTimer = 0;
      syncPage();
      syncAllHidden();
    }, 250);
  }

  const dirty = new Set();
  const targets = new Map();
  const late = new Set();
  const onScreen = new Set();
  const seenCards = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.target.isConnected) forget(e.target);
      else if (e.isIntersecting) onScreen.add(e.target);
      else onScreen.delete(e.target);
    }
  });
  const observed = new WeakSet();
  function watchCard(card, on) {
    if (on === observed.has(card)) return;
    if (on) {
      observed.add(card);
      seenCards.observe(card);
    } else {
      observed.delete(card);
      seenCards.unobserve(card);
      onScreen.delete(card);
    }
  }
  function forget(card) {
    watchCard(card, false);
    applied.delete(card);
  }
  const nearInfo = new WeakMap();
  function infoOf(near) {
    let info = nearInfo.get(near);
    if (!info) {
      if (near.matches(CARD)) info = { kind: 1, card: near };
      else if (near.matches(ZONE)) {
        const card = near.parentElement?.closest(CARD) || null;
        info = card ? { kind: 3, card } : { kind: 0, card: null };
      } else if (near.matches(NO_CARDS)) info = { kind: 2, card: null };
      else {
        const card = near.parentElement?.closest(CARD) || null;
        info = card ? { kind: 4, card } : { kind: 2, card: null };
      }
      nearInfo.set(near, info);
    }
    return info;
  }
  const NONE = {};
  const ownNode = (n) => n.nodeType === 1 && n.matches(OWN);
  function ownOnly(r) {
    if (r.type !== "childList") return false;
    let any = false;
    for (const n of r.addedNodes) {
      if (!ownNode(n)) return false;
      any = true;
    }
    for (const n of r.removedNodes) {
      if (n !== shared) return false;
      any = true;
    }
    return any;
  }
  const observer = new MutationObserver((records) => {
    if (!ready) return;
    depth++;
    const t0 = performance.now();
    for (const r of records) {
      if (ownOnly(r)) continue;
      const node = r.target;
      let info = targets.get(node);
      if (info === undefined) {
        let near = nearest.get(node);
        if (near === undefined || (near === NONE ? !node.isConnected : !near.contains(node))) {
          near = (node.nodeType === 1 && node.closest(NEAREST)) || NONE;
          nearest.set(node, near);
        }
        info = near === NONE ? null : infoOf(near);
        targets.set(node, info);
      }
      const kind = info ? info.kind : 0;
      if (kind === 0) {
        if (r.type === "childList") {
          for (const n of r.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.matches(CARD)) dirty.add(n);
            else if (n.firstElementChild) for (const c of n.querySelectorAll(CARD)) dirty.add(c);
          }
        }
        continue;
      }
      if (kind === 2) continue;
      const card = info.card;
      if (kind === 3 || r.type === "attributes" || node === card) {
        dirty.add(card);
        continue;
      }
      if (kind === 1) {
        let structural = false;
        for (const n of r.addedNodes) if (n.nodeType === 1) {
          structural = true;
          break;
        }
        if (structural) {
          dirty.add(card);
          continue;
        }
      }
      late.add(card);
    }
    targets.clear();
    if (dirty.size) healthDirty = true;
    for (const card of dirty) if (card.isConnected) apply(card);
    dirty.clear();
    if (page === "watch" || page === "channel" || page === "search") scheduleSync();
    const dt = performance.now() - t0;
    depth--;
    stats.calls++;
    stats.ms += dt;
    if (dt > stats.maxMs) stats.maxMs = dt;
  });

  const SCOPE = { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] };
  const WATCH_EXPECT = ["#secondary", "#related", "ytd-watch-metadata #owner", "ytd-watch-next-secondary-results-renderer"];
  const WATCH_PARTS = WATCH_EXPECT.join(", ");
  const watched = new WeakSet();
  let manager = null;

  function watchNode(node) {
    if (!node || watched.has(node)) return;
    watched.add(node);
    observer.observe(node, SCOPE);
    healthDirty = true;
    if (!ready) return;
    for (const card of node.querySelectorAll(CARD)) apply(card);
  }

  const pageParts = new WeakMap();
  function attachPage(pageEl) {
    const tag = pageEl.localName;
    if (tag === "ytd-search" || tag === "ytd-browse") return watchNode(pageEl);
    if (tag !== "ytd-watch-flexy" && tag !== "ytd-watch-grid") return;
    const known = pageParts.get(pageEl);
    const live = (part) => part.isConnected && pageEl.contains(part);
    if (known && WATCH_EXPECT.every((sel) => known.some((part) => part.matches(sel) && live(part)))) return;
    const parts = [...pageEl.querySelectorAll(WATCH_PARTS)];
    pageParts.set(pageEl, parts);
    for (const part of parts) {
      watchNode(part);
      const holder = part.parentElement;
      if (holder && !held.has(holder)) {
        held.add(holder);
        holders.observe(holder, { childList: true });
      }
    }
  }

  const held = new WeakSet();
  const holders = new MutationObserver(
    timed((records) => {
      const pages = new Set();
      for (const r of records) {
        if (![...r.addedNodes].some((n) => n.nodeType === 1)) continue;
        const pageEl = r.target.closest("ytd-watch-flexy, ytd-watch-grid");
        if (pageEl) pages.add(pageEl);
      }
      for (const pageEl of pages) attachPage(pageEl);
    }),
  );

  const managerObserver = new MutationObserver(
    timed((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) attachPage(n);
    }),
  );

  const attachAll = timed(function attachAll() {
    if (!manager?.isConnected) {
      manager = document.querySelector("ytd-page-manager");
      if (!manager) return false;
      managerObserver.observe(manager, { childList: true });
    }
    for (const pageEl of manager.children) attachPage(pageEl);
    return true;
  });

  const bootstrap = new MutationObserver(() => {
    if (attachAll()) bootstrap.disconnect();
  });
  if (!attachAll()) bootstrap.observe(document, { childList: true, subtree: true });
  for (const delay of [500, 2000, 6000]) setTimeout(attachAll, delay);
  syncPage = timed(syncPage);
  syncAllHidden = timed(syncAllHidden);

  document.addEventListener("yt-navigate-start", timed(() => {
    closeMenus();
    clearSlots();
    setReveal(false);
    pageState = null;
  }));

  document.addEventListener("yt-navigate-finish", timed(() => {
    const before = page;
    page = L.pageOf(location.pathname);
    if (before !== page || page !== "watch") cameFromResults = before === "search" && (page === "watch" || page === "channel");
    const wasExempt = exempt;
    exempt = computeExempt();
    pending = null;
    healthDirty = true;
    attachAll();
    setTimeout(attachAll, 1000);
    if (!ready) return;
    if (exempt !== wasExempt || (before === "playlist") !== (page === "playlist")) sweepActive();
    else {
      syncPage();
      syncAllHidden(true);
    }
  }));

  chrome.storage.local.get("list").then(timed(({ list: stored }) => {
    ready = true;
    setList(stored);
  }));

  chrome.storage.onChanged.addListener(timed((changes, area) => {
    if (area === "local" && changes.list) setList(changes.list.newValue);
  }));

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === "count") respond({ count: hiddenOnPage().length, revealed });
    if (message.type === "reveal" || message.type === "hide") {
      setReveal(message.type === "reveal");
      respond({ ok: true });
    }
  });

  document.addEventListener("shoo:stats", () => root.setAttribute("data-shoo-stats", JSON.stringify({ ...stats, size: matcher.size })));

  const AREAS = {
    search: "ytd-search:not([hidden]) ytd-section-list-renderer",
    subs: 'ytd-browse[page-subtype="subscriptions"]:not([hidden])',
    home: 'ytd-browse[page-subtype="home"]:not([hidden])',
    sidebar: ":is(ytd-watch-flexy, ytd-watch-grid):not([hidden]) :is(#secondary, #related)",
  };
  const SURFACE_OF = { search: "search", subs: "subs", home: "home", watch: "sidebar" };
  const HEADERS = "h2, #title-container, yt-section-header-view-model, ytd-shelf-renderer #title";
  const visible = (node) => node.getClientRects().length > 0 && node.checkVisibility({ opacityProperty: true, visibilityProperty: true });

  const IDENTITY = `${CHANNEL_LINK}, ytd-channel-name #text, #attributed-channel-name, yt-content-metadata-view-model [role=group] > [role=text], #author-text`;

  function identityCounts(area) {
    let cards = 0;
    for (const card of area.querySelectorAll(CARD)) {
      if (card.matches(SHORT) || skipCard(card)) continue;
      const video = card.querySelector('a[href^="/watch?v="]:not([href*="list="]), a[href^="/watch?v="][href*="list=PL"]');
      if (!video && !card.matches("ytd-channel-renderer")) continue;
      cards++;
      for (const node of card.querySelectorAll(IDENTITY)) if (node.tagName === "A" ? !node.closest(NOT_IDENTITY) : text(node)) return { cards, identified: 1 };
    }
    return { cards, identified: 0 };
  }

  function leaks(area, surface) {
    for (const a of area.querySelectorAll(CHANNEL_LINK)) {
      const href = a.getAttribute("href");
      let hit = listedHref.get(href);
      if (hit === undefined) {
        const c = L.parseChannelHref(href);
        hit = Boolean(c && L.matchSlot(matcher, c));
        listedHref.set(href, hit);
      }
      if (!hit) continue;
      if (a.closest(`${AD}, ${OWN}, ${LEFT_ALONE}, ytd-comments, ${HEADERS}`)) continue;
      if (visible(a)) return true;
    }
    if (surface !== "sidebar" || !matcher.names.size) return false;
    for (const node of area.querySelectorAll("yt-content-metadata-view-model [role=group]:first-child > [role=text]:first-child")) {
      if (node.hasAttribute("aria-label") || !L.matchSlot(matcher, { name: text(node) })) continue;
      if (node.closest(`${AD}, ${OWN}, ${LEFT_ALONE}`)) continue;
      if (visible(node)) return true;
    }
    return false;
  }

  function safetyNet() {
    const cards = new Set(late);
    late.clear();
    for (const card of onScreen) {
      if (card.isConnected) cards.add(card);
      else forget(card);
    }
    for (const card of cards) if (card.isConnected) apply(card);
    if (cards.size) healthDirty = true;
  }

  function healthTick() {
    if (!ready || document.hidden) return;
    safetyNet();
    attachAll();
    const surface = SURFACE_OF[page];
    healthTicks++;
    const fresh = (healthDirty && healthTicks % 2 === 0) || lastPage !== page || revealed || healthTicks % 3 === 0;
    if (fresh) healthDirty = false;
    lastPage = page;
    const area = fresh && surface && document.querySelector(AREAS[surface]);
    const missing = [];
    if (area) {
      const counts = identityCounts(area);
      if (L.identityMissing({ [surface]: counts }).length) missing.push(surface);
      else if (!revealed && matcher.size && leaks(area, surface)) missing.push(surface);
    }
    const r = L.healthStep(pending, fresh, missing);
    pending = r.state;
    if (!r.report) return;
    const sig = `${page}:${r.report.join(",")}`;
    if (sig === lastSent) return;
    lastSent = sig;
    send({ type: "health", page, missing: r.report });
  }
  setInterval(timed(healthTick), L.HEALTH_DELAY_MS);
  document.addEventListener("visibilitychange", timed(() => {
    if (ready && !document.hidden) safetyNet();
  }));
})();
