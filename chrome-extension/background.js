// ScholarClip background.js v12
// All paper metadata comes from API (CrossRef / arXiv / PubMed).

// ── CrossRef ───────────────────────────────────────────────────────────────

async function fetchCrossRef(doi) {
  const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
    headers: { "User-Agent": "ScholarClip/4.0 (mailto:user@example.com)" },
  });
  if (!res.ok) throw new Error(`CrossRef ${res.status}`);
  return (await res.json()).message;
}

// ── arXiv (regex-based XML parse — no DOMParser needed) ───────────────────

async function fetchArxiv(arxivId) {
  const res = await fetch(`https://export.arxiv.org/api/query?id_list=${arxivId}`);
  if (!res.ok) throw new Error(`arXiv ${res.status}`);
  const text = await res.text();

  const entry = text.match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
  if (!entry) return null;

  const title = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]
    ?.replace(/\s+/g, " ").trim() || "";
  const year  = entry.match(/<published>([\d]{4})/)?.[1] || "n.d.";
  const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)]
    .map(m => m[1].trim());

  return { authors, year, title, pdfUrl: `https://arxiv.org/pdf/${arxivId}`, arxivId };
}

// ── PubMed ─────────────────────────────────────────────────────────────────

async function fetchPubMed(pmid) {
  const res = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`
  );
  if (!res.ok) throw new Error(`PubMed ${res.status}`);
  const r = (await res.json()).result?.[pmid];
  if (!r) return null;
  return {
    title:   r.title || "",
    authors: (r.authors || []).map(a => a.name),
    year:    r.pubdate?.substring(0, 4) || "n.d.",
    journal: r.fulljournalname || "",
    doi:     r.elocationid?.replace("doi: ", "") || "",
  };
}

// ── APA citation builder ───────────────────────────────────────────────────

function authorList(formatted) {
  if (!formatted.length)      return "Unknown";
  if (formatted.length === 1) return formatted[0];
  if (formatted.length === 2) return `${formatted[0]}, & ${formatted[1]}`;
  if (formatted.length <= 20) return formatted.slice(0, -1).join(", ") + ", & " + formatted[formatted.length - 1];
  return formatted.slice(0, 19).join(", ") + ", ... " + formatted[formatted.length - 1];
}

function crossRefToAPA(work) {
  const rawAuthors = work.author || [];
  const formatted  = rawAuthors.map(a => {
    if (a.family && a.given) {
      const inits = a.given.split(/[\s-]+/).map(n => n[0] + ".").join(" ");
      return `${a.family}, ${inits}`;
    }
    return a.name || a.family || "";
  }).filter(Boolean);

  const year    = work["published-print"]?.["date-parts"]?.[0]?.[0]
               || work["published-online"]?.["date-parts"]?.[0]?.[0]
               || work["created"]?.["date-parts"]?.[0]?.[0]
               || "n.d.";
  const title   = (work.title?.[0] || "").replace(/\s+/g, " ").trim();
  const journal = work["container-title"]?.[0] || "";
  const volume  = work.volume || "";
  const issue   = work.issue ? `(${work.issue})` : "";
  const pages   = work.page  || "";
  const doi     = work.DOI   || "";

  let citation  = `${authorList(formatted)} (${year}). ${title}.`;
  if (journal) {
    citation += ` ${journal}`;
    if (volume) citation += `, ${volume}${issue}`;
    if (pages)  citation += `, ${pages}`;
    citation += ".";
  }
  if (doi) citation += ` https://doi.org/${doi}`;

  const pdfUrl = (work.link || []).find(
    l => l["content-type"] === "application/pdf"
  )?.URL || "";

  return { citation, rawAuthors, year, title, doi, pdfUrl };
}

function arxivToAPA(data) {
  const fmt = name => {
    const p = name.trim().split(" ");
    return p.length < 2 ? name : `${p[p.length - 1]}, ${p.slice(0, -1).map(x => x[0] + ".").join(" ")}`;
  };
  const str = authorList(data.authors.map(fmt));
  return `${str} (${data.year}). ${data.title}. arXiv. https://arxiv.org/abs/${data.arxivId}`;
}

// ── Note / PDF naming ──────────────────────────────────────────────────────

function makeNoteTitle(authors, year) {
  // authors: CrossRef objects {family, given} or plain strings
  let lastNames;
  if (authors.length && typeof authors[0] === "object" && authors[0].family) {
    lastNames = authors.map(a => a.family).filter(Boolean);
  } else {
    lastNames = (authors || [])
      .filter(a => typeof a === "string" && a.trim())
      .map(a => a.trim().split(/\s+/).pop());
  }

  if (!lastNames.length) return `(Unknown, ${year || "n.d."})`;

  let part;
  if (lastNames.length === 1)      part = lastNames[0];
  else if (lastNames.length === 2) part = `${lastNames[0]} & ${lastNames[1]}`;
  else                             part = `${lastNames[0]} et al.`;

  return `(${part}, ${year || "n.d."})`;
}

const safe = s => s.replace(/[<>:"/\\|?*]/g, "").trim();

// ── Message handler ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "fetchMeta") {
    handleFetch(msg.data)
      .then(r  => sendResponse({ success: true,  data: r }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }
});

async function handleFetch({ doi, arxivId, pubmedId, url }) {
  const result = {
    title: "", citation: "", url: url || "",
    doi: doi || "", year: "n.d.",
    authors: [],    // raw objects or strings
    noteTitle: "", noteName: "", pdfFilename: "", pdfUrl: "",
  };

  // ── CrossRef via DOI ──────────────────────────────────────────────────
  if (doi) {
    try {
      const work = await fetchCrossRef(doi);
      const { citation, rawAuthors, year, title, pdfUrl } = crossRefToAPA(work);
      Object.assign(result, { citation, authors: rawAuthors, year, title, pdfUrl, doi: work.DOI || doi });
    } catch (e) { console.warn("CrossRef failed:", e.message); }
  }

  // ── arXiv ─────────────────────────────────────────────────────────────
  if (arxivId) {
    if (!result.citation) {
      try {
        const data = await fetchArxiv(arxivId);
        if (data) {
          result.citation = arxivToAPA(data);
          result.title    = data.title;
          result.year     = data.year;
          result.authors  = data.authors;
        }
      } catch (e) { console.warn("arXiv failed:", e.message); }
    }
    // arXiv PDF URL is always reliable — use it even if we have a CrossRef citation
    result.pdfUrl = `https://arxiv.org/pdf/${arxivId}`;
  }

  // ── PubMed ────────────────────────────────────────────────────────────
  if (pubmedId && !result.citation) {
    try {
      const pm = await fetchPubMed(pubmedId);
      if (pm) {
        result.authors = pm.authors;
        result.year    = pm.year;
        result.title   = pm.title;
        if (pm.doi) {
          try {
            const work = await fetchCrossRef(pm.doi);
            const { citation, rawAuthors, year, title, pdfUrl } = crossRefToAPA(work);
            Object.assign(result, { citation, authors: rawAuthors, year, title, pdfUrl });
          } catch {}
        }
        if (!result.citation) {
          result.citation = `${authorList(pm.authors)} (${pm.year}). ${pm.title}.${pm.journal ? " " + pm.journal + "." : ""}${pm.doi ? " https://doi.org/" + pm.doi : ""}`;
        }
      }
    } catch (e) { console.warn("PubMed failed:", e.message); }
  }

  result.noteTitle  = makeNoteTitle(result.authors, result.year);
  result.noteName   = safe(result.noteTitle);
  result.pdfFilename = safe(result.noteTitle.replace(/^\(|\)$/g, "")) + ".pdf";

  return result;
}
