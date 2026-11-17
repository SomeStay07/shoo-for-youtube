const L = globalThis.ShooLib;
const { createImporter, el } = globalThis.ShooImport;
const t = L.translator(chrome.i18n);
const YOUTUBE_TABS = "https://www.youtube.com/*";

const youtubeTabs = () => chrome.tabs.query({ url: YOUTUBE_TABS }).catch(() => null);

async function reloadStep() {
  const tabs = await youtubeTabs();
  const step = document.getElementById("reload");
  if (!tabs?.length) return step.remove();
  const button = el("button", { type: "button", id: "reloadTabs", class: "secondary" }, t("welcomeReloadTabs", tabs.length));
  button.addEventListener(
    "click",
    async () => {
      button.disabled = true;
      const open = (await youtubeTabs()) || [];
      await Promise.all(open.map((tab) => chrome.tabs.reload(tab.id).catch(() => {})));
      button.textContent = t("welcomeReloadDone");
    },
    { once: true },
  );
  step.replaceChildren(button);
  step.hidden = false;
}

function init() {
  L.localizeDocument(document, t, chrome.i18n.getUILanguage());
  const importer = createImporter(t, document.getElementById("result"));
  const { box, area } = importer.pasteBox();
  box.append(importer.fileButton(t("importChoose")));
  document.getElementById("box").replaceChildren(box);
  importer.dropOn(document.getElementById("import"));
  area.id = "paste";
  document.getElementById("openYouTube").href = "https://www.youtube.com/";
  reloadStep();
}

init();
