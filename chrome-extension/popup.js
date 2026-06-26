// ScholarClip popup.js v12
// Key architecture: form renders immediately with template defaults.
// API data fills in auto-fields asynchronously. Tags are always populated.

'use strict';

const $  = id  => document.getElementById(id);
const qs = sel => document.querySelector(sel);

let currentData    = null; // filled when API responds
let articleTabId   = null; // the tab the user is reading
let detectedPdfUrl = null; // PDF URL found on the article page

// ── Default template fields ────────────────────────────────────────────────

const DEFAULT_TEMPLATE = [
  { label: "tags",      default: "#literature"  },
  { label: "Status",    default: "reading list"  },
  { label: "Comments",  default: ""              },
  { label: "Relevance", default: ""              },
];

// ── IndexedDB: store FileSystemDirectoryHandles ───────────────────────────

const DB = { name: "scholarclip", store: "handles" };

function openDB() {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB.name, 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore(DB.store);
    r.onsuccess = e => ok(e.target.result);
    r.onerror   = e => fail(e.target.error);
  });
}
async function dbPut(key, val) {
  const db = await openDB();
  return new Promise((ok, fail) => {
    const tx = db.transaction(DB.store, "readwrite");
    tx.objectStore(DB.store).put(val, key);
    tx.oncomplete = ok;
    tx.onerror    = e => fail(e.target.error);
  });
}
async function dbGet(key) {
  const db = await openDB();
  return new Promise((ok, fail) => {
    const tx = db.transaction(DB.store, "readonly");
    const r  = tx.objectStore(DB.store).get(key);
    r.onsuccess = e => ok(e.target.result ?? null);
    r.onerror   = e => fail(e.target.error);
  });
}
async function getHandle(key) {
  const h = await dbGet(key);
  if (!h) return null;
  const opts = { mode: "readwrite" };
  if (await h.queryPermission(opts) === "granted") return h;
  if (await h.requestPermission(opts) === "granted") return h;
  return null;
}

// ── Template field storage ─────────────────────────────────────────────────

async function loadTemplateFields() {
  try {
    const { templateFields } = await chrome.storage.sync.get(["templateFields"]);
    if (templateFields) return JSON.parse(templateFields);
  } catch {}
  return DEFAULT_TEMPLATE;
}

async function saveTemplateFields(fields) {
  await chrome.storage.sync.set({ templateFields: JSON.stringify(fields) });
}

// ── Session state: persist form data per tab ──────────────────────────────
// chrome.storage.session survives popup close/reopen within a browser session.
// Keyed by tabId so switching tabs works correctly.

async function saveTabState(tabId, data) {
  try {
    await chrome.storage.session.set({ [`sc_${tabId}`]: JSON.stringify(data) });
  } catch {}
}

async function loadTabState(tabId) {
  try {
    const key = `sc_${tabId}`;
    const r = await chrome.storage.session.get([key]);
    return r[key] ? JSON.parse(r[key]) : null;
  } catch { return null; }
}

// ── Settings ───────────────────────────────────────────────────────────────

$("openSettings").addEventListener("click", showSettings);
$("goToSettings")?.addEventListener("click", showSettings);
$("backBtn").addEventListener("click", () => {
  $("settings-view").style.display = "none";
  $("main-view").style.display     = "block";
});

async function showSettings() {
  $("main-view").style.display     = "none";
  $("settings-view").style.display = "block";
  const { vaultName } = await chrome.storage.sync.get(["vaultName"]);
  setFolderDisplay("vaultFolderName", "selectVaultBtn", vaultName);
  renderTemplateEditor(await loadTemplateFields());
}

function setFolderDisplay(nameElId, btnId, name) {
  const el = $(nameElId);
  if (name) {
    el.textContent = name;
    el.classList.add("set");
    $(btnId).textContent = "Change";
  } else {
    el.textContent = "No folder selected";
    el.classList.remove("set");
    $(btnId).textContent = "Select Folder";
  }
}

async function pickFolder(dbKey, storageKey, nameElId, btnId) {
  try {
    const h = await window.showDirectoryPicker({ mode: "readwrite" });
    await dbPut(dbKey, h);
    await chrome.storage.sync.set({ [storageKey]: h.name });
    setFolderDisplay(nameElId, btnId, h.name);
  } catch (e) {
    if (e.name !== "AbortError") showSettingsErr("Could not access folder: " + e.message);
  }
}

$("selectVaultBtn").addEventListener("click", () => pickFolder("vaultDir", "vaultName", "vaultFolderName", "selectVaultBtn"));

// ── Template editor ────────────────────────────────────────────────────────

function renderTemplateEditor(fields) {
  const c = $("tplFields");
  c.innerHTML = "";
  fields.forEach(f => appendTplRow(c, f.label, f.default));
  enableDragSort(c);
}

function appendTplRow(container, label, defaultVal) {
  const row = document.createElement("div");
  row.className = "tpl-row";
  row.draggable = true;

  // Drag handle
  const handle = document.createElement("span");
  handle.className = "tpl-drag";
  handle.textContent = "⠿";
  handle.title = "Drag to reorder";

  const li = document.createElement("input");
  li.type = "text"; li.className = "tpl-label"; li.value = label; li.placeholder = "Field name";

  const di = document.createElement("input");
  di.type = "text"; di.className = "tpl-default"; di.value = defaultVal; di.placeholder = "Default";

  const rm = document.createElement("button");
  rm.className = "tpl-rm"; rm.textContent = "×"; rm.title = "Remove";
  rm.addEventListener("click", () => row.remove());

  row.append(handle, li, di, rm);
  container.appendChild(row);
}

// HTML5 drag-and-drop reordering for template rows.
function enableDragSort(container) {
  let dragging = null;

  container.addEventListener("dragstart", e => {
    dragging = e.target.closest(".tpl-row");
    if (dragging) {
      e.dataTransfer.effectAllowed = "move";
      setTimeout(() => dragging.classList.add("dragging"), 0);
    }
  });

  container.addEventListener("dragend", () => {
    if (dragging) dragging.classList.remove("dragging");
    dragging = null;
    container.querySelectorAll(".tpl-row").forEach(r => r.classList.remove("drag-over"));
  });

  container.addEventListener("dragover", e => {
    e.preventDefault();
    if (!dragging) return;
    const target = e.target.closest(".tpl-row");
    if (!target || target === dragging) return;
    container.querySelectorAll(".tpl-row").forEach(r => r.classList.remove("drag-over"));
    target.classList.add("drag-over");
    // Insert before or after based on pointer position
    const rect = target.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    container.insertBefore(dragging, after ? target.nextSibling : target);
  });

  container.addEventListener("dragleave", e => {
    const target = e.target.closest(".tpl-row");
    if (target) target.classList.remove("drag-over");
  });

  container.addEventListener("drop", e => {
    e.preventDefault();
    container.querySelectorAll(".tpl-row").forEach(r => r.classList.remove("drag-over"));
  });
}

$("addFieldBtn").addEventListener("click", () => {
  appendTplRow($("tplFields"), "", "");
  $("tplFields").lastElementChild.querySelector(".tpl-label").focus();
});

function collectTplFields() {
  return [...$("tplFields").querySelectorAll(".tpl-row")].map(r => ({
    label:   r.querySelector(".tpl-label").value.trim(),
    default: r.querySelector(".tpl-default").value,
  })).filter(f => f.label);
}

$("saveSettings").addEventListener("click", async () => {
  const { vaultName } = await chrome.storage.sync.get(["vaultName"]);
  if (!vaultName) { showSettingsErr("Please select your vault folder first."); return; }
  await saveTemplateFields(collectTplFields());
  $("saveSettings").textContent = "Saved";
  setTimeout(() => {
    $("saveSettings").textContent = "Save Settings";
    $("settings-view").style.display = "none";
    $("main-view").style.display     = "block";
    init();
  }, 700);
});

function showSettingsErr(msg) {
  const el = $("settingsError");
  el.textContent = msg; el.style.display = "block";
  setTimeout(() => el.style.display = "none", 4000);
}

// ── Main flow ──────────────────────────────────────────────────────────────
// Form is built immediately with template defaults so tags are always populated.
// Auto-fields (Title, Citation, Url, pdf) fill in when the API responds.

async function init() {
  detectedPdfUrl = null;
  const { vaultName } = await chrome.storage.sync.get(["vaultName"]);

  if (!vaultName) {
    $("not-configured").style.display = "block";
    $("status-row").style.display     = "none";
    $("form-view").style.display      = "none";
    return;
  }

  $("not-configured").style.display = "none";
  $("status-row").style.display     = "flex";

  // Step 1: Build form with template defaults immediately
  const tplFields = await loadTemplateFields();
  buildForm(tplFields);
  $("form-view").style.display = "block";

  setStatus("detecting", "Detecting paper...");

  // Step 2: Extract identifiers from current page
  let pageData;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    articleTabId = tab.id; // remember for PDF fetch later
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractIdentifiers,
    });
    pageData = result?.result;
  } catch {
    setStatus("error", "Cannot access this page.");
    return;
  }

  if (!pageData) { setStatus("error", "Could not read page."); return; }

  // Store PDF URL found on the article page
  detectedPdfUrl = pageData.pdfUrl || null;
  updatePdfSection();

  // Step 3: Restore saved state for this tab if available (survives popup close/reopen)
  const saved = await loadTabState(articleTabId);
  if (saved) {
    currentData = saved;
    populateAutoFields(currentData);
    setStatus("found", "Ready to clip");
    return;
  }

  const hasId = pageData.doi || pageData.arxivId || pageData.pubmedId;
  if (!hasId) {
    setField("url", pageData.url || "");
    setStatus("warn", "No DOI or arXiv ID found. Fill fields manually.");
    return;
  }

  const badge = pageData.doi ? "DOI" : pageData.arxivId ? "arXiv" : "PubMed";
  setStatus("detecting", "Fetching from " + badge + "...", badge);

  // Step 4: Fetch metadata from background service worker
  chrome.runtime.sendMessage({ action: "fetchMeta", data: pageData }, response => {
    if (!response) {
      setStatus("error", "Background script not responding. Try reloading the extension.");
      return;
    }
    if (!response.success) {
      setStatus("error", "Metadata error: " + (response.error || "unknown"));
      setField("url", pageData.url || "");
      return;
    }
    currentData = response.data;
    populateAutoFields(currentData);
    setStatus("found", "Ready to clip");
    saveTabState(articleTabId, currentData); // persist so popup reopen restores this
  });
}

// ── Form builder ───────────────────────────────────────────────────────────

function buildForm(tplFields) {
  const form = $("mainForm");
  form.innerHTML = "";

  // Fixed auto-fields first
  addRow(form, "Title",    "", "text");
  addRow(form, "Citation", "", "textarea");
  addRow(form, "Url",      "", "text");

  // Custom template fields (pre-filled with defaults)
  for (const f of tplFields) {
    addRow(form, f.label, f.default, f.label.toLowerCase() === "tags" ? "tags" : "text");
  }

  // PDF section last
  addPdfSection(form);

  // Clip button — disabled until user checks Downloaded or Skip PDF
  const btn = document.createElement("button");
  btn.className = "clip-btn"; btn.id = "clipBtn"; btn.textContent = "Clip to Obsidian";
  btn.disabled = true;
  btn.addEventListener("click", onClip);
  form.appendChild(btn);
}

function addRow(container, label, value, type) {
  const row = document.createElement("div");
  row.className = "prop-row";

  const lbl = document.createElement("div");
  lbl.className = "prop-label"; lbl.textContent = label;
  row.appendChild(lbl);

  let el;
  if (type === "textarea") {
    el = document.createElement("textarea"); el.rows = 3;
  } else {
    el = document.createElement("input"); el.type = "text";
  }
  el.className = "prop-input";
  el.id        = fieldId(label);
  el.value     = value;
  row.appendChild(el);
  container.appendChild(row);
  return el;
}

function addPdfSection(container) {
  const row = document.createElement("div");
  row.className = "prop-row";

  const lbl = document.createElement("div");
  lbl.className = "prop-label"; lbl.textContent = "pdf";
  row.appendChild(lbl);

  const body = document.createElement("div");
  body.style.flex = "1";

  // Instruction line — populated by updatePdfSection() once we have a filename
  const instr = document.createElement("div");
  instr.className = "pdf-instr";
  instr.id = "pdfInstr";
  body.appendChild(instr);

  // Checkboxes
  const checks = document.createElement("div");
  checks.className = "pdf-checks";

  const mkCheck = (id, labelText) => {
    const wrap = document.createElement("label");
    wrap.className = "pdf-check-label";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.id = id;
    cb.addEventListener("change", onPdfCheck);
    wrap.append(cb, " ", labelText);
    return wrap;
  };

  checks.append(mkCheck("pdfDownloaded", "Downloaded"), mkCheck("pdfSkipped", "Skip PDF"));
  body.appendChild(checks);
  row.appendChild(body);
  container.appendChild(row);
}

// Called whenever currentData or detectedPdfUrl changes.
function updatePdfSection() {
  const instr = $("pdfInstr");
  if (!instr) return;

  const filename    = currentData?.pdfFilename || null;
  const pdfUrl      = detectedPdfUrl || currentData?.pdfUrl || null;
  // Copy name without extension — user names the file, e.g. "Kallis et al., 2025"
  const copyName    = filename ? filename.replace(/\.pdf$/i, "") : null;

  instr.innerHTML = "";

  if (pdfUrl) {
    const link = document.createElement("a");
    link.href = pdfUrl; link.target = "_blank"; link.className = "pdf-find-link";
    link.textContent = "Found PDF (link)";
    instr.append(link, ", open and save it as ");
  } else {
    instr.append("Find PDF (no link), open and save it as ");
  }

  if (copyName) {
    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-name-btn";
    copyBtn.textContent = copyName;
    copyBtn.title = "Copy to clipboard";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(copyName).catch(() => {});
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = copyName; }, 1500);
    });
    instr.append(copyBtn);
  } else {
    const em = document.createElement("em");
    em.textContent = "loading…";
    em.style.color = "#aaa";
    instr.append(em);
  }
}

// Mutual-exclusion checkboxes; unlocks Clip button when either is checked.
function onPdfCheck(e) {
  if (e.target.id === "pdfDownloaded" && e.target.checked) {
    const s = $("pdfSkipped"); if (s) s.checked = false;
  } else if (e.target.id === "pdfSkipped" && e.target.checked) {
    const d = $("pdfDownloaded"); if (d) d.checked = false;
  }
  const clipBtn = $("clipBtn");
  if (clipBtn) clipBtn.disabled = !($("pdfDownloaded")?.checked || $("pdfSkipped")?.checked);
}

// ── Populate auto fields when API responds ────────────────────────────────

function populateAutoFields(data) {
  setField("title",    data.title    || "");
  setField("citation", data.citation || "");
  setField("url",      data.url      || "");
  // Use API pdf URL as fallback if page didn't detect one
  if (!detectedPdfUrl && data.pdfUrl) detectedPdfUrl = data.pdfUrl;
  updatePdfSection();
}

function setField(label, value) {
  const el = $(fieldId(label));
  if (el) el.value = value;
}

function fieldId(label) {
  return "field_" + label.toLowerCase().replace(/[\s-]+/g, "_");
}


// ── Clip / save note ──────────────────────────────────────────────────────

async function onClip() {
  const clipBtn = $("clipBtn");
  clipBtn.disabled = true; clipBtn.textContent = "Saving...";
  showMsg("", "");

  try {
    const vaultHandle = await getHandle("vaultDir");
    if (!vaultHandle) throw new Error("Vault not accessible — re-select in Settings.");

    const { vaultName } = await chrome.storage.sync.get(["vaultName"]);
    const tplFields     = await loadTemplateFields();

    // Helper: get current value of any form field by label
    const val = label => ($(fieldId(label))?.value || "").trim();

    // Compute note name from API data (if available) or fall back to "(Unknown, n.d.)"
    const noteName = currentData?.noteName || "(Unknown, n.d.)";
    const filename  = `${noteName}.md`;
    const today     = new Date().toISOString().split("T")[0];

    // Build frontmatter — order matches the clipper UI display order
    const lines = ["---"];

    // 1. Auto fields (top of form)
    lines.push(`Title: "${esc(val("title"))}"`);
    lines.push(`Citation: "${esc(val("citation"))}"`);
    lines.push(`Url: "${esc(val("url"))}"`);

    // 2. Custom template fields (in user-defined order)
    for (const f of tplFields) {
      if (!f.label) continue;
      const v = val(f.label);
      if (f.label.toLowerCase() === "tags") {
        // YAML: # starts a comment — strip prefix and write as proper YAML list.
        const raw     = v || f.default || "";
        const tagList = raw.split(/[\s,]+/).map(t => t.replace(/^#/, "")).filter(Boolean);
        if (tagList.length === 0)      lines.push(`${f.label}:`);
        else if (tagList.length === 1) lines.push(`${f.label}: ${tagList[0]}`);
        else                           lines.push(`${f.label}: [${tagList.join(", ")}]`);
      } else {
        lines.push(`${f.label}: ${v ? `"${esc(v)}"` : ""}`);
      }
    }

    // 3. PDF wikilink (if user confirmed download)
    if ($("pdfDownloaded")?.checked) {
      const pdfFile = currentData?.pdfFilename || "paper.pdf";
      lines.push(`pdf: "[[${esc(pdfFile)}]]"`);
    }

    lines.push(`Date added: ${today}`);
    lines.push("---", "");

    // Write note
    const fh = await vaultHandle.getFileHandle(filename, { create: true });
    const w  = await fh.createWritable();
    await w.write(lines.join("\n"));
    await w.close();

    showMsg("success", `Saved: ${noteName}`);
    clipBtn.textContent = "Clipped";

    // Open in Obsidian
    if (vaultName) {
      setTimeout(() => {
        window.location.href = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(noteName)}`;
      }, 250);
    }
  } catch (e) {
    showMsg("error", e.message || "Save failed.");
    clipBtn.disabled = false; clipBtn.textContent = "Clip to Obsidian";
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────

function esc(s) {
  return (s || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function setStatus(type, text, badge) {
  $("statusDot").className    = "status-dot " + type;
  $("statusText").textContent = text;
  const b = $("statusBadge");
  if (badge) { b.textContent = badge; b.style.display = "inline"; }
  else        { b.style.display = "none"; }
}

function showMsg(type, text) {
  const el = $("msgRow");
  el.textContent = text;
  el.className   = text ? `msg-row ${type}` : "msg-row";
}

// ── Page identifier extraction ─────────────────────────────────────────────
// Only extracts DOI / arXiv ID / PubMed ID and page URL.
// Everything else comes from API — never from page meta tags.

function extractIdentifiers() {
  function getMeta(name) {
    return (
      document.querySelector(`meta[name="${name}"]`) ||
      document.querySelector(`meta[property="${name}"]`) ||
      document.querySelector(`meta[name="${name.toLowerCase()}"]`) ||
      document.querySelector(`meta[property="${name.toLowerCase()}"]`)
    )?.getAttribute("content") ?? null;
  }

  function findDOI() {
    // 1. DOI in current URL
    const urlMatch = window.location.href.match(/(10\.\d{4,9}\/[^\s&?#"'<>[\]]+)/);
    if (urlMatch) return urlMatch[1].replace(/[.)]+$/, ""); // strip trailing punctuation

    // 2. citation_doi / DC.Identifier meta tags
    const meta = getMeta("citation_doi") || getMeta("DC.Identifier")
              || getMeta("DC.identifier") || getMeta("prism.doi");
    if (meta) {
      const m = meta.match(/(10\.\d{4,9}\/[^\s]+)/);
      if (m) return m[1].replace(/[.)]+$/, "");
    }

    // 3. Any doi.org link on the page
    for (const a of document.querySelectorAll('a[href*="doi.org/"]')) {
      const m = a.href.match(/(10\.\d{4,9}\/[^\s&?#"'<>[\]]+)/);
      if (m) return m[1].replace(/[.)]+$/, "");
    }

    // 4. DOI text anywhere on page (last resort, well-formed only)
    const bodyText = document.body?.innerText || "";
    const bodyMatch = bodyText.match(/\bDOI:\s*(10\.\d{4,9}\/\S+)/i)
                   || bodyText.match(/\bdoi\.org\/(10\.\d{4,9}\/\S+)/i);
    if (bodyMatch) return bodyMatch[1].replace(/[.)]+$/, "");

    return null;
  }

  const url      = window.location.href;
  const arxiv    = url.match(/arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,})/);
  const pubmed   = url.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/);

  // PDF URL from page — user may be logged in, so session cookies apply here.
  // Layered detection: meta tag → link text → href pattern.
  function findPdfUrl() {
    // 1. citation_pdf_url meta tag (Google Scholar convention)
    //    Used by: Springer, Nature, Wiley, bioRxiv, PLoS, PubMed Central, and many others.
    const meta = getMeta("citation_pdf_url");
    if (meta) return meta;

    const SUPPL = /supplement|supporting|appendix|annex/i;

    // 2. Links whose visible text / aria-label / title explicitly reference a PDF download.
    //    Covers Elsevier and other sites that don't use the meta tag.
    //    Match: "Download PDF", "View PDF", "PDF Full Text", "Full Text PDF", bare "PDF", etc.
    //    Exclude anything labelled as supplementary material.
    const PDF_LABEL = /\b(?:download|view|get)\s+pdf\b|\bpdf\s+(?:download|full.?text)\b|\bfull.?text\s+pdf\b/i;
    const PDF_BARE  = /^\s*pdf\s*$/i;

    for (const a of document.querySelectorAll("a[href]")) {
      const href  = a.href || "";
      if (!href || href.startsWith("javascript")) continue;
      const text  = (a.textContent || "").trim();
      const label = a.getAttribute("aria-label") || a.title || "";
      const sig   = text || label;
      if (!sig) continue;
      if (SUPPL.test(sig) || SUPPL.test(href)) continue;
      if (PDF_LABEL.test(sig) || PDF_BARE.test(sig)) return href;
    }

    // 3. Last resort: any link whose href strongly suggests a PDF file
    //    (ends in .pdf, or contains /pdf/ as a path segment — common on Nature, ACS, IEEE, ACM).
    for (const a of document.querySelectorAll("a[href]")) {
      const href = a.href || "";
      if (!/\.pdf(\?|$)|\/pdf\//i.test(href)) continue;
      const text  = (a.textContent || "").trim();
      const label = a.getAttribute("aria-label") || a.title || "";
      if (SUPPL.test(href) || SUPPL.test(text + " " + label)) continue;
      return href;
    }

    return null;
  }

  const pdfUrl = findPdfUrl();

  return {
    doi:      findDOI(),
    arxivId:  arxiv  ? arxiv[1]  : null,
    pubmedId: pubmed ? pubmed[1] : null,
    pdfUrl,
    url,
  };
}

// Boot
init();
