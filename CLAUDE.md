# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Command

```bash
./build.sh
```

Generates `index.html`, `dist/dionysus-program.pdf`, and `dist/essay.md` from the source. Requires `pandoc` (install via `brew install pandoc`). PDF generation requires `xelatex` (install via `brew install mactex-no-gui`); builds skip PDF with a notice if unavailable.

## Architecture

This is a static essay publishing pipeline using Pandoc:

- **`essay.md`** — Single source of truth. All content edits happen here. YAML frontmatter provides metadata (title, author, date, description, rights).
- **`index.html`** — Generated output, never edit manually.
- **`dist/`** — Generated artifacts (PDF and Markdown copy).
- **`templates/page.html`** — Pandoc HTML template.
- **`templates/pdf.tex`** — Pandoc LaTeX template for PDF.
- **`filters/remove-title.lua`** — Removes duplicate H1 for both HTML and PDF.
- **`filters/pdf.lua`** — PDF-only tweaks (title paragraph, page breaks).
- **`styles.css`** — Site typography and styling.

## Conventions

- Conventional Commit prefixes: `feat:`, `fix:`, `docs:`, etc.
- CSS uses semantic class names (`.page-header`, `.page-download`) with two-space indentation.
- Commit generated assets alongside source changes to keep deployment in sync.
- Do not commit or push unless directed.
