(function (root) {
  function el(tag, attrs = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v !== false) node.setAttribute(k, v === true ? "" : v);
    }
    node.append(...kids);
    return node;
  }

  function createImporter(t, result) {
    async function run(text) {
      if (!String(text ?? "").trim()) return null;
      const res = await chrome.runtime.sendMessage({ type: "import", text }).catch(() => null);
      render(res);
      return res;
    }

    async function runFile(file) {
      const { IMPORT_MAX_CHARS, looksBinary } = globalThis.ShooLib;
      if (file.size > IMPORT_MAX_CHARS) {
        const mid = Math.floor(file.size / 2) - 4000;
        const parts = await Promise.all([0, mid, file.size - 8000].map((at) => file.slice(at, at + 8000).text())).catch(() => ["\u0000"]);
        if (parts.some((part) => looksBinary(part))) return render({ format: "unknown", found: 0 });
        if (file.size > IMPORT_MAX_CHARS * 4) return render({ format: "too-big", found: 0 });
      }
      return run(await file.text());
    }

    let numbers = null;
    const n = (v) => {
      try {
        numbers ||= new Intl.NumberFormat(chrome.i18n.getUILanguage());
      } catch {
        numbers = new Intl.NumberFormat();
      }
      return numbers.format(v);
    };
    const taken = (res) => Boolean(res && res.format !== "too-big" && res.found);

    function render(res) {
      if (!res) {
        result.replaceChildren(el("p", {}, t("cardNotSaved")));
        return;
      }
      if (res.format === "too-big") {
        result.replaceChildren(el("p", {}, t("importTooBig")));
        return;
      }
      if (!res.found) {
        result.replaceChildren(el("p", {}, t("importNothing")));
        return;
      }
      const lines = [el("p", { class: "import-added" }, t("importResult", n(res.added.channels), n(res.added.words)))];
      if (res.skipped.patterns) lines.push(el("p", { class: "muted" }, t("importSkippedPatterns", n(res.skipped.patterns))));
      if (res.skipped.other) lines.push(el("p", { class: "muted" }, t("importSkippedOther", n(res.skipped.other))));
      if (res.idOnly) lines.push(el("p", { class: "muted" }, t("importIdOnly", n(res.idOnly))));
      if (res.added.channels || res.added.words) {
        lines.push(
          el("button", { type: "button", class: "link import-undo", onclick: async () => {
            await chrome.runtime.sendMessage({ type: "undoImport", undo: res.undo, hadList: res.hadList }).catch(() => null);
            result.replaceChildren();
          } }, t("importUndo")),
        );
      }
      result.replaceChildren(...lines);
    }

    function fileButton(label) {
      const input = el("input", { type: "file", accept: ".json,.save,.txt,application/json,text/plain", hidden: true, onchange: async () => {
        const file = input.files?.[0];
        if (file) await runFile(file);
        input.value = "";
      } });
      const btn = el("button", { type: "button", class: "secondary", onclick: () => input.click() }, label);
      return el("span", { class: "file" }, btn, input);
    }

    function dropOn(zone) {
      zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        zone.classList.add("over");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("over"));
      zone.addEventListener("drop", async (e) => {
        e.preventDefault();
        zone.classList.remove("over");
        const file = e.dataTransfer?.files?.[0];
        if (file) await runFile(file);
        else await run(e.dataTransfer?.getData("text/plain"));
      });
    }

    function pasteBox() {
      const area = el("textarea", { rows: "3", placeholder: t("importBox"), "aria-label": t("importBox"), spellcheck: "false" });
      const add = el("button", { type: "button", class: "secondary", disabled: true, onclick: async () => {
        if (taken(await run(area.value))) clear();
      } }, t("importAdd"));
      const sync = () => (add.disabled = !area.value.trim());
      const clear = () => {
        area.value = "";
        if (document.activeElement === add) area.focus();
        sync();
      };
      area.addEventListener("input", sync);
      area.addEventListener("paste", () => setTimeout(async () => {
        sync();
        if (taken(await run(area.value))) clear();
      }, 0));
      const box = el("div", { class: "paste" }, area, add);
      dropOn(box);
      return { box, area };
    }

    return { run, render, fileButton, dropOn, pasteBox };
  }

  root.ShooImport = { createImporter, el };
})(globalThis);
