(function () {
  "use strict";

  const source = document.querySelector("#source");
  const status = document.querySelector("#status");
  const statusText = document.querySelector("#status-text");
  const copyButton = document.querySelector("#copy-button");
  const downloadButton = document.querySelector("#download-button");
  const blockCount = document.querySelector("#block-count");
  const tree = document.querySelector("#json-tree");
  const treeSearch = document.querySelector("#tree-search");
  const fileInput = document.querySelector("#file-input");
  const form = document.querySelector("#formatter-form");
  const workspaceToolbar = document.querySelector("#workspace-toolbar");
  const toolbarToggle = document.querySelector("#toolbar-toggle");
  const jsonPlaceholder = source.placeholder;
  const jsonFileTypes = fileInput.accept;
  const treeLoaders = new WeakMap();
  let currentMode = "json";
  let outputMode = "json";
  let formattedBlocks = 0;
  let hasFormatted = false;
  let viewerSource = "";
  let currentView = "text";
  let viewerDirty = true;
  let lastAction = "format";
  let searchMatches = [];
  let searchIndex = -1;

  if (globalThis.lucide) globalThis.lucide.createIcons();

  function setStatus(message, tone = "ready") {
    statusText.textContent = message;
    status.dataset.tone = tone;
  }

  function updateToolbarSpace() {
    if (!workspaceToolbar.hidden) {
      form.style.removeProperty("--toolbar-space");
      return;
    }
    workspaceToolbar.hidden = false;
    const height = workspaceToolbar.getBoundingClientRect().height;
    workspaceToolbar.hidden = true;
    form.style.setProperty("--toolbar-space", height + "px");
  }

  function updateSourceCount() {
    document.querySelector("#source-count").textContent = source.value.length.toLocaleString("th-TH") + " ตัวอักษร";
    document.querySelector("#output-count").textContent = (source.value ? source.value.split("\n").length : 0).toLocaleString("th-TH") + " บรรทัด";
  }

  function resetResult() {
    hasFormatted = false;
    formattedBlocks = 0;
    tree.replaceChildren();
    treeSearch.value = "";
    document.querySelector("#search-count").textContent = "";
    searchMatches = [];
    searchIndex = -1;
    viewerDirty = true;
    copyButton.disabled = true;
    downloadButton.disabled = true;
    blockCount.hidden = true;
    source.removeAttribute("aria-invalid");
  }

  function format(action = "format") {
    lastAction = action;
    const input = hasFormatted ? viewerSource : source.value;
    resetResult();
    try {
      const indent = Number(document.querySelector("#indent").value);
      const validate = document.querySelector("#validate-json").checked;
      const api = globalThis.JSONFormatter;
      let result;
      if (document.querySelector("#format-scope").value === "whole") {
        if (validate) api.getDocuments(input);
        result = api.formatWholeText(input, action === "minify" ? 0 : indent);
      } else {
        result = !validate ? api.formatLooseText(input, action === "minify" ? 0 : indent) : action === "minify" ? api.minifyText(input) : api.formatText(input, indent);
      }
      source.value = result.text;
      viewerSource = input;
      hasFormatted = true;
      updateSourceCount();
      outputMode = result.mode;
      formattedBlocks = result.blocks;
      copyButton.disabled = false;
      downloadButton.disabled = false;
      blockCount.textContent = result.blocks + (result.mode === "object" ? " OBJECT" : validate ? " JSON" : " BLOCK");
      blockCount.hidden = !result.blocks;
      setStatus((action === "minify" ? "ย่อแล้ว" : "จัดรูปแบบแล้ว") + " · " + (validate ? (result.mode === "object" ? "Object / MongoDB " : "ข้อมูล ") + result.blocks + " ก้อน" : "ไม่ตรวจโครงสร้าง"), "success");
      if (currentView === "viewer") showView("viewer");
    } catch (error) {
      source.setAttribute("aria-invalid", "true");
      setStatus(source.value.trim() ? "จัดรูปแบบไม่ได้: " + error.message : "กรุณาวาง JSON หรือ log ก่อนจัดรูปแบบ", "error");
      showView("text");
      source.focus();
    }
  }

  function convertBase64(action) {
    const encode = action === "encode";
    if (!source.value || (!encode && !source.value.trim())) {
      setStatus(encode ? "กรุณาวางข้อความก่อน Encode" : "กรุณาวาง Base64 ก่อน Decode", "error");
      source.focus();
      return;
    }
    try {
      const api = globalThis.JSONFormatter;
      const result = encode ? api.encodeBase64(source.value) : api.decodeBase64(source.value);
      resetResult();
      source.value = result;
      outputMode = encode ? "base64" : "text";
      updateSourceCount();
      showView("text");
      copyButton.disabled = !result;
      downloadButton.disabled = !result;
      setStatus(encode ? "Encode Base64 แล้ว" : "Decode Base64 แล้ว", "success");
      source.focus();
    } catch {
      source.setAttribute("aria-invalid", "true");
      setStatus(encode ? "Encode Base64 ไม่ได้" : "Decode ไม่ได้: Base64 ไม่ถูกต้อง หรือข้อมูลไม่ใช่ข้อความ UTF-8", "error");
      source.focus();
    }
  }

  function setMode(mode) {
    currentMode = mode;
    const base64 = mode === "base64";
    document.body.dataset.mode = mode;
    document.title = base64 ? "Base64" : "JSON Format";
    document.querySelector("#brand-title").textContent = document.title;
    document.querySelector(".brand-mark").textContent = base64 ? "64" : "{ }";
    document.querySelector(".brand-caption").textContent = base64 ? "ENCODE / DECODE WORKSPACE" : "JSON / LOG WORKSPACE";
    document.querySelector(".workspace-tag").textContent = base64 ? "BASE64 / UTF-8" : "JSON / LOG / MONGO";
    document.querySelector("#json-controls").hidden = base64;
    document.querySelector("#base64-controls").hidden = !base64;
    document.querySelector("#view-navigation").hidden = base64;
    document.querySelector(".encoding").textContent = base64 ? "UTF-8 / BASE64" : "UTF-8";
    source.placeholder = base64 ? "สวัสดี Base64" : jsonPlaceholder;
    fileInput.accept = base64 ? ".b64,.base64,.txt,.json,text/plain,application/json" : jsonFileTypes;
    const importButton = document.querySelector("#import-button");
    importButton.title = base64 ? "เปิดไฟล์ข้อความหรือ Base64" : "เปิดไฟล์ JSON, log หรือ MongoDB";
    importButton.setAttribute("aria-label", importButton.title);
    blockCount.hidden = base64 || !hasFormatted || !formattedBlocks;
    copyButton.disabled = !source.value || (!base64 && !hasFormatted);
    downloadButton.disabled = copyButton.disabled;
    source.removeAttribute("aria-invalid");
    showView("text");
    updateToolbarSpace();
    setStatus("พร้อม");
  }

  function appendKey(row, key) {
    const label = document.createElement("span");
    label.className = "tree-key";
    label.textContent = key;
    row.append(label, document.createTextNode(": "));
  }

  function makeNode(value, key, path) {
    if (!value.entries) {
      const row = document.createElement("div");
      row.className = "tree-leaf";
      row.title = path;
      appendKey(row, key);
      const text = document.createElement("span");
      text.className = "tree-value tree-" + value.type;
      text.textContent = value.text;
      row.append(text);
      row.dataset.search = row.textContent.toLowerCase();
      return row;
    }

    const entries = value.entries;
    const details = document.createElement("details");
    details.className = "tree-node";
    const summary = document.createElement("summary");
    summary.title = path;
    appendKey(summary, key);
    const type = document.createElement("span");
    type.className = "tree-type";
    type.textContent = value.type === "array" ? "Array [" + entries.length + "]" : "Object {" + entries.length + "}";
    summary.append(type);
    summary.dataset.search = summary.textContent.toLowerCase();
    const children = document.createElement("div");
    children.className = "tree-children";
    details.append(summary, children);
    let loaded = false;
    const populate = () => {
      if (loaded) return;
      loaded = true;
      const fragment = document.createDocumentFragment();
      for (const [childKey, childValue] of entries) {
        const childPath = path + "[" + (value.type === "array" ? childKey : JSON.stringify(childKey)) + "]";
        fragment.append(makeNode(childValue, childKey, childPath));
      }
      children.append(fragment);
    };
    treeLoaders.set(details, populate);
    details.addEventListener("toggle", () => { if (details.open) populate(); });
    return details;
  }

  function renderViewer() {
    const documents = globalThis.JSONFormatter.getDocuments(viewerSource);
    const fragment = document.createDocumentFragment();
    documents.forEach((entry, index) => {
      const value = globalThis.JSONFormatter.getTree(entry.text);
      const section = document.createElement("div");
      section.className = "tree-document";
      const heading = document.createElement("h4");
      heading.className = "tree-document-title";
      const field = viewerSource.slice(0, entry.position).match(/\|([^|\r\n]+)\|\s*$/);
      heading.textContent = String(index + 1).padStart(2, "0") + " · " + (field ? field[1] : outputMode === "object" ? "Object / MongoDB" : "JSON");
      const root = makeNode(value, "$", "$");
      if (root.tagName === "DETAILS") {
        treeLoaders.get(root)();
        root.open = true;
      }
      section.append(heading, root);
      fragment.append(section);
    });
    tree.replaceChildren(fragment);
    viewerDirty = false;
  }

  function showView(view) {
    if (currentMode === "base64") view = "text";
    if (view === "viewer") {
      if (!hasFormatted) {
        format();
        if (!hasFormatted) return;
      }
      try {
        if (viewerDirty) renderViewer();
      } catch (error) {
        setStatus("เปิด Viewer ไม่ได้: " + error.message, "error");
        view = "text";
      }
    }
    currentView = view;
    for (const name of ["text", "viewer"]) {
      const active = name === view;
      const tab = document.querySelector("#" + name + "-tab");
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      document.querySelector("#" + name + "-panel").hidden = !active;
    }
  }

  function expandAll() {
    const pending = Array.from(tree.querySelectorAll(".tree-document > details"));
    while (pending.length) {
      const details = pending.pop();
      treeLoaders.get(details)();
      details.open = true;
      pending.push(...details.querySelectorAll(":scope > .tree-children > details"));
    }
  }

  function searchTree() {
    const query = treeSearch.value.trim().toLowerCase();
    if (query) expandAll();
    searchMatches = [];
    for (const row of tree.querySelectorAll("[data-search]")) {
      const matches = Boolean(query && row.dataset.search.includes(query));
      row.classList.toggle("search-match", matches);
      if (matches) searchMatches.push(row);
    }
    searchIndex = searchMatches.length ? 0 : -1;
    document.querySelector("#search-count").textContent = query ? String(searchMatches.length) : "";
    if (searchMatches.length) searchMatches[0].scrollIntoView({ block: "nearest" });
  }

  function replaceSource(text) {
    source.value = text;
    updateSourceCount();
    resetResult();
    showView("text");
    if (currentMode === "json") format();
    else {
      outputMode = "text";
      copyButton.disabled = !text;
      downloadButton.disabled = !text;
      setStatus("พร้อม");
    }
  }

  async function loadFile(file) {
    if (!file) return;
    try {
      replaceSource(await file.text());
    } catch {
      setStatus("อ่านไฟล์ไม่ได้", "error");
    }
  }

  toolbarToggle.addEventListener("click", () => {
    workspaceToolbar.hidden = !workspaceToolbar.hidden;
    toolbarToggle.setAttribute("aria-expanded", String(!workspaceToolbar.hidden));
    toolbarToggle.title = workspaceToolbar.hidden ? "แสดงแถบเครื่องมือ" : "ซ่อนแถบเครื่องมือ";
    toolbarToggle.setAttribute("aria-label", toolbarToggle.title);
    updateToolbarSpace();
  });
  globalThis.addEventListener("resize", updateToolbarSpace);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (currentMode === "base64") convertBase64("encode");
    else format();
  });

  source.addEventListener("input", () => {
    updateSourceCount();
    resetResult();
    if (currentMode === "base64") {
      outputMode = "text";
      copyButton.disabled = !source.value;
      downloadButton.disabled = !source.value;
    }
    setStatus("พร้อม");
  });

  source.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      document.querySelector("#formatter-form").requestSubmit();
    }
  });

  document.querySelector("#indent").addEventListener("change", () => {
    if (hasFormatted) format(lastAction);
  });

  document.querySelector("#validate-json").addEventListener("change", () => {
    if (source.value.trim()) format(lastAction);
  });
  document.querySelector("#format-scope").addEventListener("change", () => {
    if (source.value.trim()) format(lastAction);
  });
  document.querySelector("#minify-button").addEventListener("click", () => format("minify"));
  for (const radio of document.querySelectorAll('input[name="tool-mode"]')) {
    radio.addEventListener("change", () => { if (radio.checked) setMode(radio.value); });
  }
  for (const action of ["encode", "decode"]) {
    document.querySelector("#" + action + "-base64-button").addEventListener("click", () => convertBase64(action));
  }
  for (const name of ["text", "viewer"]) {
    const tab = document.querySelector("#" + name + "-tab");
    tab.addEventListener("click", () => showView(name));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? "text" : event.key === "End" ? "viewer" : name === "text" ? "viewer" : "text";
      showView(next);
      document.querySelector("#" + currentView + "-tab").focus();
    });
  }
  document.querySelector("#expand-button").addEventListener("click", expandAll);
  document.querySelector("#collapse-button").addEventListener("click", () => {
    for (const details of tree.querySelectorAll("details")) details.open = false;
  });
  treeSearch.addEventListener("input", searchTree);
  treeSearch.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!searchMatches.length) return;
    searchIndex = (searchIndex + (event.shiftKey ? -1 : 1) + searchMatches.length) % searchMatches.length;
    searchMatches[searchIndex].scrollIntoView({ block: "nearest" });
  });
  document.querySelector("#import-button").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    await loadFile(fileInput.files[0]);
    fileInput.value = "";
  });
  source.addEventListener("dragover", (event) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    document.querySelector(".input-pane").classList.add("is-dragging");
  });
  source.addEventListener("dragleave", () => document.querySelector(".input-pane").classList.remove("is-dragging"));
  source.addEventListener("drop", (event) => {
    document.querySelector(".input-pane").classList.remove("is-dragging");
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    loadFile(event.dataTransfer.files[0]);
  });
  document.querySelector("#paste-button").addEventListener("click", async () => {
    try {
      replaceSource(await navigator.clipboard.readText());
    } catch {
      showView("text");
      source.focus();
      setStatus("วางอัตโนมัติไม่ได้ กรุณากด Ctrl + V ในช่องข้อความ", "error");
    }
  });

  document.querySelector("#clear-button").addEventListener("click", () => {
    source.value = "";
    updateSourceCount();
    resetResult();
    showView("text");
    setStatus("พร้อม");
    source.focus();
  });

  document.querySelector("#example-button").addEventListener("click", () => {
    if (currentMode === "base64") {
      replaceSource("สวัสดี Base64");
      return;
    }
    replaceSource('2026-11-02T13:46:12.907+07:00 [INFO] [APIInterceptor] INCOMING|METHOD|POST|PATHNAME|/action/queryOrderInformation|BODY|{"transactionID":"demo","orderNo":"ORDER-001","mobileNo":"","referChannel":"WEB"}|HEADERS|{"host":"api.example.test","content-type":"application/json","x-request-id":"demo-request-001"}');
  });

  document.querySelector("#wrap-button").addEventListener("click", (event) => {
    const button = event.currentTarget;
    const enabled = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(enabled));
    source.wrap = enabled ? "soft" : "off";
  });

  copyButton.addEventListener("click", async () => {
    const text = source.value;
    if (!text) return;
    try {
      if (!navigator.clipboard || !globalThis.isSecureContext) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setStatus("คัดลอกผลลัพธ์แล้ว", "success");
    } catch {
      showView("text");
      source.focus();
      source.select();
      try {
        if (!document.execCommand("copy")) throw new Error("Copy unavailable");
        setStatus("คัดลอกผลลัพธ์แล้ว", "success");
      } catch {
        setStatus("คัดลอกอัตโนมัติไม่ได้ กรุณากด Ctrl + C เพื่อคัดลอกข้อความที่เลือก", "error");
      }
    }
  });

  downloadButton.addEventListener("click", () => {
    if (!source.value) return;
    const isJson = currentMode === "json" && outputMode === "json";
    const blob = new Blob([source.value], { type: isJson ? "application/json;charset=utf-8" : "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = currentMode === "base64" ? outputMode === "base64" ? "encoded-base64.txt" : "decoded-text.txt" : isJson ? "formatted.json" : outputMode === "object" ? "formatted-object.txt" : "formatted-log.txt";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("ดาวน์โหลดผลลัพธ์แล้ว", "success");
  });
})();