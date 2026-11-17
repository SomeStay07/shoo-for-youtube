(() => {
  if (window.top !== window) return;
  const L = window.ShooLib;
  const LIST = window.__SHOO_LIST;
  const CARD = "ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-rich-grid-media, yt-lockup-view-model, ytm-shorts-lockup-view-model, ytd-reel-item-renderer, ytd-channel-renderer";
  const norm = L.norm;
  const H = new Set(LIST.channels.filter((c) => c.handle).map((c) => L.normHandle(c.handle)));
  const I = new Set(LIST.channels.filter((c) => c.id).map((c) => c.id));
  const NALL = new Set(LIST.channels.filter((c) => c.name).map((c) => norm(c.name)));
  const NONLY = new Set(LIST.channels.filter((c) => c.name && !c.handle && !c.id).map((c) => norm(c.name)));
  const W = L.compileWords(LIST.words);
  const nameOf = (c) => {
    const a = c.querySelector("#attributed-channel-name:not([hidden])") || c.querySelector("ytd-channel-name #text");
    if (a && a.textContent.trim()) return a.textContent;
    const s = c.querySelector("yt-content-metadata-view-model [role=group] > [role=text]:first-child");
    return s && !s.hasAttribute("aria-label") ? s.textContent : "";
  };
  const blocked = (c) => {
    if (c.closest("ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer")) return null;
    const links = [...c.querySelectorAll('a[href^="/@"], a[href^="/channel/UC"]')].filter((a) => !a.closest("#description, #description-text, .metadata-snippet-container, #expandable-metadata"));
    for (const a of links) {
      const p = L.parseChannelHref(a.getAttribute("href"));
      if (p && (p.handle ? H.has(L.normHandle(p.handle)) : I.has(p.id))) return "link";
    }
    const stack = c.querySelector("yt-avatar-stack-view-model");
    const n = stack ? "" : norm(nameOf(c));
    if (n && (links.length ? NONLY.has(n) : NALL.has(n))) return "name";
    const t = c.matches("ytd-channel-renderer") ? null : c.querySelector("#video-title") || c.querySelector("h3");
    if (t && W(t.getAttribute("title") || t.textContent)) return "word";
    return null;
  };
  const S = (window.__flash = { frames: 0, flashFrames: 0, events: [], hides: 0, perScenario: {}, maxGap: 0 });
  let scenario = "init";
  window.__setScenario = (s) => {
    scenario = s;
    try {
      sessionStorage.setItem("__shooScenario", s);
    } catch {}
    S.perScenario[s] = S.perScenario[s] || { frames: 0, flashFrames: 0, hides: 0 };
  };
  let first = "init";
  try {
    first = sessionStorage.getItem("__shooScenario") || "init";
  } catch {}
  window.__setScenario(first);
  const seen = new WeakSet();
  const start = () => {
    new MutationObserver((recs) => {
      for (const r of recs) if (r.attributeName === "data-shoo-hide" && r.target.hasAttribute("data-shoo-hide")) {
        S.hides++;
        S.perScenario[scenario].hides++;
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-shoo-hide"] });
    let last = 0;
    const tick = (ts) => {
      S.frames++;
      S.perScenario[scenario].frames++;
      if (last) S.maxGap = Math.max(S.maxGap, ts - last);
      last = ts;
      let hit = 0;
      for (const c of document.querySelectorAll(CARD)) {
        if (c.parentElement?.closest(CARD)) continue;
        const r = c.getBoundingClientRect();
        if (r.height < 2 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
        if (!c.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
        const box = c.closest("ytd-rich-item-renderer") || c;
        if (box.hasAttribute("data-shoo-slot")) continue;
        const why = blocked(c);
        if (!why) continue;
        hit++;
        if (!seen.has(c)) {
          seen.add(c);
          S.events.push({ why, scenario, url: location.pathname + location.search.slice(0, 40), title: (c.querySelector("#video-title, h3")?.textContent || "").trim().slice(0, 60), name: nameOf(c).trim().slice(0, 40), tag: c.tagName.toLowerCase() });
        }
      }
      if (hit) {
        S.flashFrames++;
        S.perScenario[scenario].flashFrames++;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  if (document.documentElement) start();
  else new MutationObserver((_, o) => {
    if (document.documentElement) {
      o.disconnect();
      start();
    }
  }).observe(document, { childList: true });
})();
