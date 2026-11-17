(function (root) {
  const FEEDBACK_FORM = "https://docs.google.com/forms/d/e/1FAIpQLScyBVju13aygKeL1ZQQ8LSB8UHkBHkBR1n0mu_yN1a-jZzmig/viewform?usp=pp_url&entry.1038899811=VERSION&entry.1100498239=BROWSER&entry.820481797=PAGE&entry.593235433=FILTERS";
  const BREAKAGE_URL = "https://somestay07.github.io/errand-for-youtube/breakage/";
  const BREAKAGE_LISTS_SHOO = false;
  const SURFACES = ["search", "subs", "home", "sidebar"];
  const HEALTH_DELAY_MS = 6000;
  const IDENTITY_MIN_CARDS = 4;
  const EXPORT_FORMAT = "shoo-list";
  const IMPORT_MAX_CHARS = 5_000_000;
  const IMPORT_MAX_ENTRIES = 20_000;
  const UC = /^UC[\w-]{22}$/;

  function norm(s) {
    return String(s ?? "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function normHandle(h) {
    let s = String(h ?? "").trim();
    try {
      s = decodeURIComponent(s);
    } catch {}
    return norm(s.replace(/^@/, ""));
  }

  function parseChannelHref(href) {
    const m = /^(?:https?:\/\/(?:www\.|m\.)?youtube\.com)?\/(?:(@[^/?#\s]+)|channel\/(UC[\w-]{22}))(?=$|[/?#])/.exec(String(href ?? "").trim());
    if (!m) return null;
    if (m[2]) return { id: m[2] };
    let handle = m[1];
    try {
      handle = decodeURIComponent(handle);
    } catch {}
    return { handle };
  }

  const hasLink = (e) => Boolean(e && (e.handle || e.id));

  function entryKey(e) {
    if (e.handle) return `h:${normHandle(e.handle)}`;
    if (e.id) return `i:${e.id}`;
    return `n:${norm(e.name)}`;
  }

  function emptyList() {
    return { v: 1, channels: [], words: [] };
  }

  function cleanEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const e = {};
    if (typeof raw.handle === "string" && normHandle(raw.handle)) e.handle = raw.handle.startsWith("@") ? raw.handle.trim() : `@${raw.handle.trim()}`;
    if (typeof raw.id === "string" && UC.test(raw.id)) e.id = raw.id;
    if (typeof raw.name === "string" && norm(raw.name)) e.name = raw.name.trim();
    if (!e.handle && !e.id && !e.name) return null;
    e.added = Number.isFinite(raw.added) ? raw.added : 0;
    e.source = typeof raw.source === "string" ? raw.source : "import";
    return e;
  }

  function readList(stored) {
    const s = stored && typeof stored === "object" ? stored : {};
    const channels = Array.isArray(s.channels) ? s.channels.map(cleanEntry).filter(Boolean) : [];
    const words = Array.isArray(s.words) ? s.words.filter((w) => typeof w === "string" && norm(w)) : [];
    return { v: 1, channels, words };
  }

  const NO_SPACE_SCRIPTS = "\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}\\p{sc=Thai}\\p{sc=Lao}\\p{sc=Khmer}\\p{sc=Myanmar}";
  const WORD_CHAR = `[[\\p{L}\\p{N}\\p{M}]--[${NO_SPACE_SCRIPTS}]]`;
  const NO_SPACE_RE = new RegExp(`[${NO_SPACE_SCRIPTS}]`, "v");
  const SHORT_WORD = 3;

  function escapeWord(w) {
    return w
      .split(" ")
      .map((part) => part.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&"))
      .join("\\s+");
  }

  function wordKind(w) {
    if (NO_SPACE_RE.test(w)) return "sub";
    const letters = [...w].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length;
    const start = /^[\p{L}\p{N}\p{M}]/u.test(w);
    const end = letters <= SHORT_WORD && /[\p{L}\p{N}\p{M}]$/u.test(w);
    return `${start ? "s" : ""}${end ? "e" : ""}` || "sub";
  }

  function wordsRegex(keys) {
    const groups = { se: [], s: [], e: [], sub: [] };
    for (const k of keys) groups[wordKind(k)].push(escapeWord(k));
    const pre = `(?<!${WORD_CHAR})`;
    const post = `(?!${WORD_CHAR})`;
    const parts = [];
    if (groups.se.length) parts.push(`${pre}(?:${groups.se.join("|")})${post}`);
    if (groups.s.length) parts.push(`${pre}(?:${groups.s.join("|")})`);
    if (groups.e.length) parts.push(`(?:${groups.e.join("|")})${post}`);
    if (groups.sub.length) parts.push(`(?:${groups.sub.join("|")})`);
    return new RegExp(parts.join("|"), "v");
  }

  function compileWords(words) {
    const byNorm = new Map();
    for (const w of words || []) {
      if (typeof w !== "string") continue;
      const n = norm(w);
      if (n && !byNorm.has(n)) byNorm.set(n, w);
    }
    if (!byNorm.size) return () => null;
    const keys = [...byNorm.keys()].sort((a, b) => b.length - a.length);
    const re = wordsRegex(keys);
    return (title) => {
      const t = norm(title);
      if (!t) return null;
      const m = re.exec(t);
      if (!m) return null;
      const hit = m[0].replace(/\s+/g, " ");
      return byNorm.get(hit) ?? byNorm.get(keys.find((k) => wordsRegex([k]).test(hit))) ?? hit;
    };
  }

  function compile(stored) {
    const list = readList(stored);
    const handles = new Map();
    const ids = new Map();
    const names = new Map();
    for (const e of list.channels) {
      if (e.handle) handles.set(normHandle(e.handle), e);
      if (e.id) ids.set(e.id, e);
      if (e.name) {
        const n = norm(e.name);
        if (!names.has(n)) names.set(n, []);
        names.get(n).push(e);
      }
    }
    return { list, handles, ids, names, words: compileWords(list.words), size: list.channels.length + list.words.length };
  }

  function comparable(entry, slot) {
    return Boolean((entry.handle && slot.handle) || (entry.id && slot.id));
  }

  function matchSlot(m, slot) {
    if (!slot) return null;
    if (slot.handle) {
      const e = m.handles.get(normHandle(slot.handle));
      if (e) return { entry: e, by: "handle" };
    }
    if (slot.id) {
      const e = m.ids.get(slot.id);
      if (e) return { entry: e, by: "id" };
    }
    const n = norm(slot.name);
    if (!n) return null;
    for (const e of m.names.get(n) || []) {
      if (!hasLink(e) || !hasLink(slot) || !comparable(e, slot)) return { entry: e, by: "name" };
    }
    return null;
  }

  function learnFrom(entry, slot, by) {
    if (by !== "handle" && by !== "id") return null;
    const patch = {};
    if (slot.name && norm(slot.name) && !/^@\S+$/.test(slot.name.trim()) && norm(slot.name) !== norm(entry.name)) patch.name = slot.name.trim();
    if (slot.handle && !entry.handle) patch.handle = slot.handle;
    if (slot.id && !entry.id) patch.id = slot.id;
    return Object.keys(patch).length ? patch : null;
  }

  const SEPARATOR = /\s*,\s*|\s+(?:and|und|и|y|e)\s+/u;
  const MORE = /^(?:\d+\s+(?:more|weitere|más|mas|mais|autres?|altri)|(?:ещё|еще|mais)\s+\d+|more)$/iu;

  function collabNames(text) {
    const whole = String(text ?? "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim();
    let more = false;
    const parts = [];
    for (const raw of whole ? whole.split(SEPARATOR) : []) {
      const part = raw.trim().replace(/^(?:and|und|и|y|e)\s+/u, "");
      if (!part) continue;
      if (MORE.test(part)) {
        more = true;
        continue;
      }
      parts.push(part);
    }
    return { whole, parts, more };
  }

  function cardChannels(card) {
    const links = card.links || [];
    const { whole, parts } = collabNames(card.nameText);
    const collab = Boolean(card.collab);
    const firstName = collab ? parts[0] : whole;
    const out = [];
    if (links[0]) out.push({ ...links[0], ...(firstName ? { name: firstName } : {}) });
    else if (firstName) out.push({ name: firstName });
    if (collab) for (const name of parts.slice(1)) out.push({ name });
    return out;
  }

  function cardVerdict(m, card, { exempt = null } = {}) {
    const links = card.links || [];
    const { whole, parts } = collabNames(card.nameText);
    const collab = Boolean(card.collab);
    const skip = (r) => r && exempt && entryKey(r.entry) === exempt;
    const firstSlot = links[0] ? { ...links[0], ...(whole ? { name: whole } : {}) } : null;
    const handles = links.filter((l) => l.handle);
    const ids = links.filter((l) => l.id);
    const merged = !collab && handles.length <= 1 && ids.length <= 1 && links.length > 1 ? { ...handles[0], ...ids[0], ...(whole ? { name: whole } : {}) } : null;
    const learnOf = (r, slot) => (collab ? null : merged ? learnFrom(r.entry, merged, r.by) : slot === firstSlot ? learnFrom(r.entry, slot, r.by) : null);
    const found = (r, slot) => ({ kind: "channel", entry: r.entry, by: r.by, slot, learn: learnOf(r, slot) });
    for (const [i, link] of links.entries()) {
      const slot = i === 0 ? firstSlot : link;
      const r = matchSlot(m, { handle: slot.handle, id: slot.id });
      if (r && !skip(r)) return found(r, slot);
    }
    const names = collab ? [...new Set([whole, ...parts])] : [whole];
    for (const [i, name] of names.entries()) {
      if (!name) continue;
      const slot = i === 0 || (collab && name === parts[0]) ? { ...(links[0] || {}), name } : { name };
      const r = matchSlot(m, slot);
      if (r && !skip(r)) return found(r, i === 0 && firstSlot ? firstSlot : slot);
    }
    const word = card.title ? m.words(card.title) : null;
    if (word) return { kind: "word", word };
    return null;
  }

  function keyMatches(e, key) {
    if (typeof key !== "string") return false;
    if (key.startsWith("h:")) return Boolean(e.handle) && normHandle(e.handle) === key.slice(2);
    if (key.startsWith("i:")) return Boolean(e.id) && e.id === key.slice(2);
    return entryKey(e) === key;
  }

  function findIndex(list, key) {
    const exact = list.channels.findIndex((e) => entryKey(e) === key);
    return exact >= 0 ? exact : list.channels.findIndex((e) => keyMatches(e, key));
  }

  function keyIndex(keys) {
    const byHandle = new Map();
    const byId = new Map();
    const byKey = new Map();
    for (const key of keys) {
      if (typeof key !== "string") continue;
      if (key.startsWith("h:")) byHandle.set(key.slice(2), key);
      else if (key.startsWith("i:")) byId.set(key.slice(2), key);
      else byKey.set(key, key);
    }
    return (e) => (e.handle && byHandle.get(normHandle(e.handle))) || (e.id && byId.get(e.id)) || byKey.get(entryKey(e)) || null;
  }

  const SAME_FIELDS = ["handle", "id", "name", "source"];
  function settleBlock(local, res, sentAt) {
    if (!res?.key) return null;
    const mine = local?.list?.channels?.[local.index];
    const own = Boolean(res.prev && mine && SAME_FIELDS.every((k) => res.prev[k] === mine[k]) && (local.prev || Number(res.prev.added) >= sentAt));
    return own ? { key: res.key, prev: local.prev, index: local.index } : { key: res.key, prev: res.prev, index: res.index };
  }

  function findDuplicate(channels, c) {
    if (c.handle) {
      const h = normHandle(c.handle);
      const i = channels.findIndex((e) => e.handle && normHandle(e.handle) === h);
      if (i >= 0) return i;
    }
    if (c.id) {
      const i = channels.findIndex((e) => e.id === c.id);
      if (i >= 0) return i;
    }
    if (c.name) {
      const n = norm(c.name);
      return channels.findIndex((e) => e.name && norm(e.name) === n && (!hasLink(e) || !hasLink(c)));
    }
    return -1;
  }

  function fillEntry(e, c) {
    const out = { ...e };
    if (c.handle && !out.handle) out.handle = c.handle;
    if (c.id && !out.id) out.id = c.id;
    if (c.name && !out.name) out.name = c.name;
    return orderEntry(out);
  }

  function orderEntry(e) {
    const out = {};
    for (const k of ["handle", "id", "name", "added", "source"]) if (e[k] !== undefined) out[k] = e[k];
    return out;
  }

  function addChannel(stored, slot, source, now) {
    const list = readList(stored);
    const c = cleanEntry({ ...slot, added: now, source });
    if (!c) return { list, key: null, prev: null };
    const channels = [...list.channels];
    const i = findDuplicate(channels, c);
    if (i >= 0) {
      const prev = channels[i];
      channels[i] = fillEntry(prev, c);
      if (slot.name && norm(slot.name) && norm(slot.name) !== norm(prev.name)) channels[i] = orderEntry({ ...channels[i], name: slot.name.trim() });
      return { list: { ...list, channels }, key: entryKey(channels[i]), prev, index: i };
    }
    const entry = orderEntry(c);
    channels.push(entry);
    return { list: { ...list, channels }, key: entryKey(entry), prev: null, index: channels.length - 1 };
  }

  function removeChannel(stored, key) {
    const list = readList(stored);
    const index = findIndex(list, key);
    if (index < 0) return { list, removed: null, index: -1 };
    const channels = [...list.channels];
    const [removed] = channels.splice(index, 1);
    return { list: { ...list, channels }, removed, index };
  }

  function restoreChannel(stored, entry, index) {
    const list = readList(stored);
    const clean = cleanEntry(entry);
    if (!clean) return list;
    const channels = list.channels.filter((e) => entryKey(e) !== entryKey(clean));
    const at = Number.isInteger(index) && index >= 0 && index <= channels.length ? index : channels.length;
    channels.splice(at, 0, orderEntry(clean));
    return { ...list, channels };
  }

  function patchChannel(stored, key, patch) {
    const list = readList(stored);
    const i = findIndex(list, key);
    if (i < 0 || !patch) return list;
    const next = { ...list.channels[i] };
    if (typeof patch.name === "string" && norm(patch.name)) next.name = patch.name.trim();
    if (typeof patch.handle === "string" && !next.handle) next.handle = patch.handle;
    if (typeof patch.id === "string" && UC.test(patch.id) && !next.id) next.id = patch.id;
    const channels = [...list.channels];
    channels[i] = orderEntry(next);
    return { ...list, channels };
  }

  function addWord(stored, word) {
    const list = readList(stored);
    const w = String(word ?? "").trim();
    if (!norm(w) || list.words.some((x) => norm(x) === norm(w))) return list;
    return { ...list, words: [...list.words, w] };
  }

  function removeWord(stored, word) {
    const list = readList(stored);
    return { ...list, words: list.words.filter((x) => norm(x) !== norm(word)) };
  }

  function restoreWord(stored, word, index) {
    const list = readList(stored);
    const w = String(word ?? "").trim();
    if (!norm(w) || list.words.some((x) => norm(x) === norm(w))) return list;
    const words = [...list.words];
    words.splice(Number.isInteger(index) && index >= 0 && index <= words.length ? index : words.length, 0, w);
    return { ...list, words };
  }

  function editWord(stored, from, to) {
    const list = readList(stored);
    const w = String(to ?? "").trim();
    if (!norm(w)) return removeWord(list, from);
    if (norm(w) !== norm(from) && list.words.some((x) => norm(x) === norm(w))) return removeWord(list, from);
    return { ...list, words: list.words.map((x) => (norm(x) === norm(from) ? w : x)) };
  }

  function channelFromText(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return null;
    if (/^(?:https?:\/\/)?(?:www\.|m\.)?youtu\.be\//i.test(s)) return { skip: true };
    const url = /(?:^|\/\/)(?:www\.|m\.)?youtube\.com(\/[^\s?#]*)/i.exec(s);
    if (url) return parseChannelHref(url[1]) || { skip: true };
    if (UC.test(s)) return { id: s };
    if (/^@[^\s/]+$/.test(s)) return parseChannelHref(`/${s}`) || { handle: s };
    return { name: s };
  }

  const isSlashRegex = (s) => /^\/.*\/[a-z]*$/.test(s);
  const looksRegex = (s) => /[\\^$*+?()[\]{}|]/.test(s) || /\.[*+?]/.test(s);

  const JSON_START = /^\s*(?:[{[]\s*(?:["{[\]}]|$)|\[\s*(?:-?\d[\d.eE+-]*|true|false|null)\s*(?:,|\]\s*$))/;
  const BINARY = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/g;
  function looksBinary(src) {
    const head = src.slice(0, 8000);
    if (head.includes("\u0000")) return true;
    return (head.match(BINARY)?.length || 0) > head.length * 0.1;
  }

  function parseImport(text) {
    const out = { format: null, channels: [], words: [], skipped: { patterns: 0, other: 0 } };
    const src = String(text ?? "").replace(/^﻿/, "");
    if (src.length > IMPORT_MAX_CHARS) {
      out.format = looksBinary(src) ? "unknown" : "too-big";
      return out;
    }
    let json = null;
    let parsed = false;
    try {
      json = JSON.parse(src);
      parsed = true;
    } catch {}
    const object = Boolean(json && typeof json === "object" && !Array.isArray(json));
    const pushChannel = (c, extra = {}) => {
      if (!c) return;
      if (c.skip) {
        out.skipped.other++;
        return;
      }
      out.channels.push({ ...c, ...extra });
    };
    if (object && json.format === EXPORT_FORMAT) {
      out.format = "shoo";
      for (const e of Array.isArray(json.channels) ? json.channels : []) {
        const c = cleanEntry(e);
        if (c) out.channels.push(orderEntry(c));
      }
      for (const w of Array.isArray(json.words) ? json.words : []) if (typeof w === "string" && norm(w)) out.words.push(w);
    } else if (object && json.filterData) {
      out.format = "blocktube";
      const f = json.filterData;
      const lines = (v) => (Array.isArray(v) ? v : []).map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
      let lastName = null;
      for (const t of lines(f.channelId)) {
        const m = /^\/\/ Blocked by context menu \((.*)\) \([^)]*\)$/.exec(t);
        if (m) {
          lastName = m[1];
          continue;
        }
        if (t.startsWith("//")) continue;
        if (UC.test(t)) pushChannel({ id: t }, lastName ? { name: lastName } : {});
        else if (isSlashRegex(t)) out.skipped.patterns++;
        else out.skipped.other++;
        lastName = null;
      }
      for (const t of lines(f.channelName)) {
        if (t.startsWith("//")) continue;
        if (isSlashRegex(t)) out.skipped.patterns++;
        else pushChannel(channelFromText(t));
      }
      for (const t of lines(f.title)) {
        if (t.startsWith("//")) continue;
        if (isSlashRegex(t)) out.skipped.patterns++;
        else out.words.push(t);
      }
      for (const key of ["videoId", "comment"]) out.skipped.other += lines(f[key]).filter((t) => !t.startsWith("//")).length;
      if (typeof f.javascript === "string" && /return\s+(?!false\s*;?\s*\}?\s*$)/m.test(f.javascript.replace(/\/\/.*$/gm, ""))) out.skipped.other++;
    } else if (object && (Array.isArray(json.blockedChannels) || (json["0"] && typeof json["0"] === "object"))) {
      const old = !json.version;
      out.format = old ? "channelblocker-old" : "channelblocker";
      const keys = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.keys(v) : []).filter((x) => typeof x === "string" && x.trim());
      for (const c of keys(old ? json["0"] : json.blockedChannels)) pushChannel(channelFromText(c));
      for (const t of keys(old ? json["1"] : json.blockedVideoTitles)) {
        if (looksRegex(t)) out.skipped.patterns++;
        else out.words.push(t.trim());
      }
      out.skipped.patterns += keys(old ? json["2"] : json.blockedChannelsRegExp).length;
      out.skipped.other += keys(old ? json["3"] : json.blockedComments).length;
      out.skipped.other += keys(old ? json["4"] : json.excludedChannels).length;
    } else if ((parsed && json && typeof json === "object") || JSON_START.test(src) || looksBinary(src)) {
      out.format = "unknown";
    } else {
      out.format = "lines";
      for (const line of src.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        pushChannel(channelFromText(/^"[^"]+"$/.test(t) ? t.slice(1, -1) : t));
        if (out.channels.length > IMPORT_MAX_ENTRIES) break;
      }
    }
    if (out.channels.length + out.words.length > IMPORT_MAX_ENTRIES) return { format: "too-big", channels: [], words: [], skipped: { patterns: 0, other: 0 } };
    return out;
  }

  function mergeImport(stored, parsed, now) {
    const list = readList(stored);
    const channels = [...list.channels];
    const known = channels.length;
    const byHandle = new Map();
    const byId = new Map();
    const byName = new Map();
    const index = (e, i) => {
      if (e.handle && !byHandle.has(normHandle(e.handle))) byHandle.set(normHandle(e.handle), i);
      if (e.id && !byId.has(e.id)) byId.set(e.id, i);
      if (e.name) {
        const n = norm(e.name);
        const at = byName.get(n);
        if (!at) byName.set(n, [i]);
        else if (!at.includes(i)) at.push(i);
      }
    };
    channels.forEach(index);
    const find = (c) => {
      if (c.handle) {
        const i = byHandle.get(normHandle(c.handle));
        if (i !== undefined) return i;
      }
      if (c.id) {
        const i = byId.get(c.id);
        if (i !== undefined) return i;
      }
      let best = -1;
      if (c.name) for (const i of byName.get(norm(c.name)) || []) if ((best < 0 || i < best) && (!hasLink(channels[i]) || !hasLink(c))) best = i;
      return best;
    };
    const added = { channels: 0, words: 0 };
    const addedAt = [];
    const filled = new Map();
    let idOnly = 0;
    for (const raw of parsed.channels || []) {
      const c = cleanEntry({ added: now, source: "import", ...raw });
      if (!c) continue;
      const i = find(c);
      if (i >= 0) {
        const next = fillEntry(channels[i], c);
        if (JSON.stringify(next) !== JSON.stringify(channels[i])) {
          if (i < known && !filled.has(i)) filled.set(i, channels[i]);
          channels[i] = next;
          index(next, i);
        }
        continue;
      }
      const entry = orderEntry(c);
      channels.push(entry);
      index(entry, channels.length - 1);
      addedAt.push(channels.length - 1);
      added.channels++;
      if (c.id && !c.handle && !c.name) idOnly++;
    }
    const words = [...list.words];
    const seen = new Set(words.map(norm));
    const addedWords = [];
    for (const w of parsed.words || []) {
      const t = String(w).trim();
      const n = norm(t);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      words.push(t);
      addedWords.push(t);
      added.words++;
    }
    const undo = { channels: addedAt.map((i) => entryKey(channels[i])), words: addedWords, filled: [...filled].map(([i, before]) => ({ key: entryKey(channels[i]), before })) };
    return { list: { v: 1, channels, words }, added, idOnly, undo };
  }

  function undoImport(stored, undo) {
    const list = readList(stored);
    const drop = keyIndex(Array.isArray(undo?.channels) ? undo.channels : []);
    const restore = new Map((Array.isArray(undo?.filled) ? undo.filled : []).map((f) => [f?.key, cleanEntry(f?.before)]).filter(([k, e]) => typeof k === "string" && e));
    const restoreKey = keyIndex([...restore.keys()]);
    const dropWords = new Set((Array.isArray(undo?.words) ? undo.words : []).map(norm));
    const channels = [];
    for (const e of list.channels) {
      if (drop(e)) continue;
      const key = restoreKey(e);
      channels.push(key ? orderEntry(restore.get(key)) : e);
    }
    return { ...list, channels, words: list.words.filter((w) => !dropWords.has(norm(w))) };
  }

  function exportList(stored) {
    const list = readList(stored);
    return { format: EXPORT_FORMAT, version: 1, channels: list.channels, words: list.words };
  }

  function listBytes(list) {
    return new TextEncoder().encode(JSON.stringify(list)).length;
  }

  function healthStep(pending, fresh, missing) {
    if (!fresh) return { report: null, state: pending };
    const r = confirmHealth(pending, missing);
    return { report: r.report, state: r.pending };
  }

  function confirmHealth(pending, missing) {
    if (!missing.length) return { report: [], pending: null };
    const confirmed = (pending || []).filter((name) => missing.includes(name));
    return confirmed.length ? { report: confirmed, pending: null } : { report: null, pending: missing };
  }

  function identityMissing(counts) {
    return SURFACES.filter((s) => counts?.[s] && counts[s].cards >= IDENTITY_MIN_CARDS && counts[s].identified === 0);
  }

  function reportUrl({ version, browser, page = "", missing = [] }, form = FEEDBACK_FORM) {
    if (!form) return "";
    const values = { VERSION: version, BROWSER: browser, PAGE: page, FILTERS: missing.join(", ") };
    const url = new URL(form);
    for (const [key, value] of [...url.searchParams]) if (Object.hasOwn(values, value)) url.searchParams.set(key, values[value]);
    return url.toString();
  }

  function pageOf(pathname) {
    const p = String(pathname || "/");
    if (p === "/results") return "search";
    if (p === "/watch") return "watch";
    if (p === "/" || p === "") return "home";
    if (p.startsWith("/feed/subscriptions")) return "subs";
    if (p.startsWith("/hashtag/")) return "hashtag";
    if (p === "/playlist") return "playlist";
    if (/^\/(@[^/]+|channel\/UC[\w-]{22}|c\/[^/]+|user\/[^/]+)(\/|$)/.test(p)) return "channel";
    if (p.startsWith("/shorts/")) return "shorts";
    return "other";
  }

  function channelOfPath(pathname) {
    const m = /^\/(@[^/]+|channel\/UC[\w-]{22})(?=\/|$)/.exec(String(pathname || ""));
    return m ? parseChannelHref(`/${m[1]}`) : null;
  }

  function channelRoot(pathname) {
    const m = /^\/(@[^/]+|channel\/UC[\w-]{22}|c\/[^/]+|user\/[^/]+)(?=\/|$)/.exec(String(pathname || ""));
    return m ? m[1].toLowerCase() : null;
  }

  function headerSlot(channel, { name = "", handle = "" } = {}) {
    const { fromHeader, ...rest } = channel;
    const own = String(handle).trim();
    const label = String(name).trim();
    const same = Boolean(rest.handle && own && normHandle(own) === normHandle(rest.handle));
    const stale = Boolean(rest.handle && own && !same);
    return { slot: { ...rest, ...(label && !stale ? { name: label } : {}) }, verified: same && !fromHeader };
  }

  const NAV_MAX_MS = 5000;
  const HEADER_SAME_MS = 1000;
  const HEADER_OTHER_MS = 3000;
  function pageWait(nav, { now = 0, pathname = "", headerHandle = "" } = {}) {
    if (!nav) return 0;
    const started = now - nav.start;
    if (nav.finish == null && started < NAV_MAX_MS) return NAV_MAX_MS - started;
    const since = now - (nav.finish ?? nav.start + NAV_MAX_MS);
    const root = channelRoot(pathname);
    if (!root || root === nav.root) return 0;
    const own = normHandle(headerHandle);
    const fromPath = channelOfPath(pathname)?.handle;
    if (fromPath && own && normHandle(fromPath) !== own && since < HEADER_OTHER_MS) return HEADER_OTHER_MS - since;
    if ((!own || (nav.handles || []).includes(own)) && since < HEADER_SAME_MS) return HEADER_SAME_MS - since;
    return 0;
  }

  function channelOfPage(pathname, { docPath = "", metaId = "", headerHandle = "" } = {}) {
    const fromPath = channelOfPath(pathname);
    if (fromPath?.id) return fromPath;
    const root = channelRoot(pathname);
    const id = root && root === channelRoot(docPath) && UC.test(String(metaId)) ? String(metaId) : null;
    if (!fromPath && !id) {
      const own = String(headerHandle).trim();
      const c = root && /^@\S+$/.test(own) ? parseChannelHref(`/${own}`) : null;
      return c ? { ...c, fromHeader: true } : null;
    }
    return { ...fromPath, ...(id ? { id } : {}) };
  }

  function translator(i18n) {
    return (key, ...subs) => i18n.getMessage(key, subs.map(String));
  }

  function localizeDocument(doc, t, lang) {
    doc.documentElement.lang = lang;
    doc.documentElement.dir = t("@@bidi_dir");
    for (const node of doc.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
    for (const node of doc.querySelectorAll("[data-i18n-placeholder]")) node.placeholder = t(node.dataset.i18nPlaceholder);
    for (const node of doc.querySelectorAll("[data-i18n-label]")) node.setAttribute("aria-label", t(node.dataset.i18nLabel));
  }

  function browserLabel(nav, lang) {
    let brand = "";
    try {
      const list = Array.isArray(nav?.userAgentData?.brands) ? nav.userAgentData.brands : [];
      const named = list.filter((b) => typeof b?.brand === "string" && !/Not.?A.?Brand|Chromium/i.test(b.brand));
      const ua = typeof nav?.userAgent === "string" ? nav.userAgent : "";
      brand = named[0] ? `${named[0].brand} ${named[0].version}` : (ua.match(/(Edg|OPR|YaBrowser|Chrome)\/[\d]+/)?.[0] ?? "");
    } catch {}
    return `${brand} / ${lang}`;
  }

  const api = {
    FEEDBACK_FORM,
    BREAKAGE_URL,
    BREAKAGE_LISTS_SHOO,
    SURFACES,
    HEALTH_DELAY_MS,
    IDENTITY_MIN_CARDS,
    EXPORT_FORMAT,
    IMPORT_MAX_CHARS,
    IMPORT_MAX_ENTRIES,
    norm,
    normHandle,
    parseChannelHref,
    entryKey,
    emptyList,
    readList,
    compile,
    compileWords,
    matchSlot,
    learnFrom,
    collabNames,
    cardChannels,
    cardVerdict,
    addChannel,
    removeChannel,
    restoreChannel,
    settleBlock,
    patchChannel,
    addWord,
    removeWord,
    restoreWord,
    editWord,
    parseImport,
    looksBinary,
    mergeImport,
    undoImport,
    exportList,
    listBytes,
    confirmHealth,
    healthStep,
    identityMissing,
    reportUrl,
    pageOf,
    channelOfPath,
    channelOfPage,
    headerSlot,
    channelRoot,
    pageWait,
    translator,
    localizeDocument,
    browserLabel,
  };

  root.ShooLib = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
