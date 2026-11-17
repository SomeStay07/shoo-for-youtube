const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export function searchCard({ vid, title, handle = null, name = "", collab = null, stack = false, linkless = false, noName = false }) {
  const link = handle && !linkless ? `href="/${handle}"` : "";
  const nameHtml = noName ? "" : `<a class="yt-simple-endpoint" ${link}>${esc(name)}</a>`;
  return `<ytd-video-renderer data-qa="${vid}"><div id="dismissible">
  <ytd-thumbnail><a id="thumbnail" href="/watch?v=${vid}">thumb</a></ytd-thumbnail>
  <div class="text-wrapper"><div id="meta"><h3><a id="video-title" title="${esc(title)}" href="/watch?v=${vid}">${esc(title)}</a></h3></div>
  <div id="channel-info">
    <a id="channel-thumbnail" ${link} ${collab ? "hidden" : ""}>avatar</a>
    <div id="avatar" ${stack ? "" : "hidden"}>${stack ? '<yt-avatar-stack-view-model role="button" aria-label="Collaboration channels"></yt-avatar-stack-view-model>' : ""}</div>
    <div id="attributed-channel-name" ${collab ? "" : "hidden"}>${collab ? `<yt-text-view-model><span role="text"><span>${esc(collab)}</span></span></yt-text-view-model>` : ""}</div>
    <ytd-channel-name id="channel-name" ${collab ? "hidden" : ""}><div id="text-container"><yt-formatted-string id="text">${collab ? "" : nameHtml}</yt-formatted-string></div></ytd-channel-name>
  </div></div></div></ytd-video-renderer>`;
}

export function lockup({ vid, title, spans = [], stack = false }) {
  const row = spans.map((s, i) => (i ? `<span aria-hidden="true"></span>` : "") + `<span dir="auto" role="text">${esc(s)}</span>`).join("");
  return `<yt-lockup-view-model data-qa="${vid}"><div>
  <a href="/watch?v=${vid}" aria-hidden="true">thumb</a>
  <div><yt-lockup-metadata-view-model><div>${stack ? '<yt-avatar-stack-view-model role="button"></yt-avatar-stack-view-model>' : ""}</div>
  <div><h3 title="${esc(title)}"><a href="/watch?v=${vid}"><span role="text">${esc(title)}</span></a></h3>
  <div><yt-content-metadata-view-model><div role="group">${row}</div><div role="group"><span aria-label="1 thousand views" role="text">1K</span></div></yt-content-metadata-view-model></div></div>
  </yt-lockup-metadata-view-model></div></div></yt-lockup-view-model>`;
}

export function officialCard({ handle, name }) {
  return `<yt-official-card-view-model data-qa="official1aa"><div><yt-page-header-view-model><div><div><div><h1><span role="text">${esc(name)}</span></h1>
  <yt-content-metadata-view-model><div role="group"><span role="text">${esc(handle)}</span></div></yt-content-metadata-view-model></div>
  <yt-flexible-actions-view-model><div><button-view-model><a href="/${handle}">Visit channel</a></button-view-model></div></yt-flexible-actions-view-model></div></div></yt-page-header-view-model></div></yt-official-card-view-model>`;
}

const STYLE = `<style>ytd-video-renderer,yt-lockup-view-model,yt-official-card-view-model{display:block;min-height:120px;margin:8px;border:1px solid #888;font:14px Roboto,Arial}</style>`;

export function searchPage(cards) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${STYLE}</head><body><ytd-app><ytd-page-manager><ytd-search><ytd-two-column-search-results-renderer><div id="primary"><ytd-section-list-renderer><div id="contents"><ytd-item-section-renderer><div id="contents">${cards.join("\n")}</div></ytd-item-section-renderer></div></ytd-section-list-renderer></div></ytd-two-column-search-results-renderer></ytd-search></ytd-page-manager></ytd-app></body></html>`;
}

export function watchPage(cards) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${STYLE}</head><body><ytd-app><ytd-page-manager><ytd-watch-flexy><div id="columns"><div id="primary"><div id="player">player</div></div><div id="secondary"><div id="related">${cards.join("\n")}</div></div></div></ytd-watch-flexy></ytd-page-manager></ytd-app></body></html>`;
}

export async function serve(context, url, html) {
  await context.route(url, (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
}

export function gridLockup({ vid, title, handle, name, rest = [], badge = true }) {
  const parts = rest.map((s, i) => `${i ? '<span aria-hidden="true" class="ytContentMetadataViewModelDelimiter"> • </span>' : '<span class="ytIconWrapperHost ytContentMetadataViewModelLeadingIcon"><svg viewBox="0 0 24 24"></svg></span>'}<span class="ytContentMetadataViewModelMetadataText" dir="auto" role="text">${esc(s)}</span>`).join("");
  return `<ytd-rich-item-renderer data-qa="${vid}"><div id="content"><yt-lockup-view-model><div>
  <a href="/watch?v=${vid}" aria-hidden="true" class="thumb">thumb</a>
  <div class="meta"><a class="avatar" href="/${handle}">av</a><yt-lockup-metadata-view-model><div class="text">
  <h3 title="${esc(title)}"><a href="/watch?v=${vid}"><span role="text">${esc(title)}</span></a></h3>
  <yt-content-metadata-view-model><div class="ytContentMetadataViewModelMetadataRow" role="group"><span class="ytContentMetadataViewModelMetadataText" dir="auto" role="text">${esc(name)}</span>${badge ? '<span class="ytIconWrapperHost ytContentMetadataViewModelIcon" aria-label="Verified"><svg viewBox="0 0 24 24"></svg></span>' : ""}${parts}</div></yt-content-metadata-view-model></div>
  <button class="kebab" aria-label="Action menu">⋮</button></yt-lockup-metadata-view-model></div></div></yt-lockup-view-model></div></ytd-rich-item-renderer>`;
}

const GRID_STYLE = `<style>
body{margin:0;font:14px Roboto,Arial}
ytd-rich-grid-renderer #contents{display:flex;flex-wrap:wrap;gap:16px;padding:16px}
ytd-rich-item-renderer{display:block;width:537px}
.thumb{display:block;height:200px;background:#333}
.meta{display:flex;gap:12px;padding-top:12px}
.avatar{flex:none;width:36px;height:36px;border-radius:50%;background:#666;font-size:0}
yt-lockup-metadata-view-model{position:relative;display:block;width:521px}
yt-lockup-metadata-view-model .text{width:481px}
h3{margin:0 0 4px;font-size:16px}
.ytContentMetadataViewModelMetadataRow{display:flex;flex-wrap:nowrap;overflow:hidden;align-items:center;height:20px}
.ytContentMetadataViewModelMetadataRow>span{display:block;white-space:nowrap;flex:none}
.ytIconWrapperHost{width:14px;height:14px;margin:0 4px}
.kebab{position:absolute;top:0;right:0;width:40px;height:40px;border:0;border-radius:50%;background:#444;color:#fff}
</style>`;

export function gridPage(cards, subtype = "subscriptions") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${GRID_STYLE}</head><body><ytd-app><ytd-page-manager><ytd-browse page-subtype="${subtype}"><ytd-rich-grid-renderer><div id="contents">${cards.join("\n")}</div></ytd-rich-grid-renderer></ytd-browse></ytd-page-manager></ytd-app></body></html>`;
}

const META = `<style>
body{margin:0;font:14px Roboto,Arial}
.grid{display:flex;flex-wrap:wrap;gap:16px;padding:16px;align-items:flex-start}
.thumb{display:block;background:#333}
yt-lockup-metadata-view-model{position:relative;display:flex}
.text{display:flex;flex-direction:column;min-width:0}
h3{margin:0 0 2px;font-size:16px;line-height:22px}
[role=group]{display:flex;flex-wrap:nowrap;overflow:hidden;align-items:center;height:20px;line-height:20px}
[role=group]>span{display:block;white-space:nowrap;flex:none}
[role=group]>.name{flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;min-width:0}
.badge{width:14px;height:14px;margin:0 4px;background:#999;border-radius:50%}
.menu{position:absolute}
.menu button{width:40px;height:40px;border:0;border-radius:50%;background:#444;color:#fff;padding:0}
</style>`;

function metaRows({ name, badge, rest }) {
  const first = `<div role="group"><span class="name">${esc(name)}</span>${badge ? '<span class="badge" aria-label="Verified"></span>' : ""}</div>`;
  return first + rest.map((s) => `<div role="group"><span role="text">${esc(s)}</span></div>`).join("");
}

export function shelfLockup({ vid, title, handle, name, badge = true, rest = ["Updated yesterday", "View full podcast"], width = 163, menu = true }) {
  return `<ytd-rich-item-renderer data-qa="${vid}" style="display:block;width:${width}px"><div id="content"><yt-lockup-view-model><div>
  <a href="/playlist?list=PL${vid}" class="thumb" style="height:${Math.round(width * 0.56)}px" aria-hidden="true">thumb</a>
  <a href="/${handle}" hidden>channel</a>
  <yt-lockup-metadata-view-model style="width:${width}px;margin-top:12px"><div class="text">
  <h3 title="${esc(title)}"><a href="/playlist?list=PL${vid}"><span role="text">${esc(title)}</span></a></h3>
  <yt-content-metadata-view-model>${metaRows({ name, badge, rest })}</yt-content-metadata-view-model></div>
  <div class="menu" style="right:-10px;top:-6px">${menu ? '<button class="kebab" aria-label="More actions">⋮</button>' : ""}</div></yt-lockup-metadata-view-model></div></yt-lockup-view-model></div></ytd-rich-item-renderer>`;
}

export function shelfPage(cards) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${META}</head><body><ytd-app><ytd-page-manager><ytd-browse><ytd-rich-shelf-renderer><div class="grid">${cards.join("\n")}</div></ytd-rich-shelf-renderer></ytd-browse></ytd-page-manager></ytd-app></body></html>`;
}

export function watchGridLockup({ vid, title, handle, name, badge = true, rest = ["1.2M views • 3 years ago"], width = 283 }) {
  return `<yt-lockup-view-model data-qa="${vid}" style="display:block;width:${width}px"><div>
  <a href="/watch?v=${vid}" class="thumb" style="height:${Math.round(width * 0.56)}px" aria-hidden="true">thumb</a>
  <a href="/${handle}" hidden>channel</a>
  <yt-lockup-metadata-view-model style="width:${width}px;margin-top:12px"><div class="text" style="width:${width - 45}px">
  <h3 title="${esc(title)}"><a href="/watch?v=${vid}"><span role="text">${esc(title)}</span></a></h3>
  <yt-content-metadata-view-model>${metaRows({ name, badge, rest })}</yt-content-metadata-view-model></div>
  <div class="menu" style="right:0;bottom:0"><button class="kebab" aria-label="More actions">⋮</button></div></yt-lockup-metadata-view-model></div></yt-lockup-view-model>`;
}

export function watchGridPage(cards) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${META}</head><body><ytd-app><ytd-page-manager><ytd-watch-grid><div id="primary"><div id="player" style="height:200px">player</div>
  <ytd-watch-next-secondary-results-renderer><div class="grid">${cards.join("\n")}</div></ytd-watch-next-secondary-results-renderer></div></ytd-watch-grid></ytd-page-manager></ytd-app></body></html>`;
}
