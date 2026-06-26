# Obsidian Scholar Clip

A Chrome extension that clips academic papers directly into your [Obsidian](https://obsidian.md) vault — no Obsidian plugin required.

It detects the DOI, arXiv ID, or PubMed ID on the page, fetches full citation metadata (APA format), and writes a formatted note with YAML frontmatter straight to your vault folder.

![Scholar Clip screenshot](icons/icon128.png)

---

## Features

- Auto-detects DOI, arXiv, and PubMed IDs
- Fetches title, authors, year, and APA citation via CrossRef / arXiv / PubMed APIs
- Detects the PDF download link on the page
- Writes the note file directly to your Obsidian vault (no plugin needed)
- Customisable frontmatter fields with drag-to-reorder
- Opens the clipped note in Obsidian automatically

---

## Installation

Chrome Web Store listing coming soon. In the meantime, install manually:

1. [Download the latest release](../../releases/latest) and unzip it, **or** clone this repository.
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked**
5. Select the `chrome-extension` folder

---

## Setup

1. Click the Scholar Clip icon in your Chrome toolbar
2. Click the settings gear (⚙)
3. Click **Select Folder** and choose your Obsidian vault folder
4. Optionally customise the note template fields and their order
5. Click **Save Settings**

Chrome will ask for permission to access the folder the first time — click Allow.

---

## Usage

1. Navigate to any academic paper (journal article, arXiv preprint, PubMed entry)
2. Click the Scholar Clip icon
3. The extension detects the paper and fetches its metadata automatically
4. Edit any fields if needed
5. **PDF:** the extension shows the detected PDF link and the filename to save it as. Download the PDF and save it with that name to your vault's PDF folder, then check **Downloaded** (or **Skip PDF** if you don't need it)
6. Click **Clip to Obsidian** — the note is saved and opens in Obsidian

---

## Note format

Notes are saved as `(Author et al., Year).md` with YAML frontmatter, for example:

```markdown
---
Title: "Degrowth: new directions for science and society"
Citation: "Kallis, G., et al. (2025). ..."
Url: "https://..."
tags: literature
Status: "reading list"
pdf: "[[Kallis et al., 2025.pdf]]"
Date added: 2025-06-26
---
```

---

## Supported sites

Works on any site that exposes a DOI, arXiv ID, or PubMed ID — including Nature, Springer, Elsevier, Wiley, PLoS, bioRxiv, arXiv, PubMed, and most journal publishers.

---

## License

MIT
