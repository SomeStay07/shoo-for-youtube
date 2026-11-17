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
