---
name: dionysus-build
description: Build or rebuild the Dionysus Program site outputs (HTML/PDF/Markdown) using ./build.sh. Use when asked to build, rebuild, regenerate outputs, update the PDF/HTML, or verify generated artifacts in this repo.
---

# Dionysus Build

## Overview

Run the repo build pipeline and validate the generated artifacts without editing outputs by hand.

## Workflow

For local HTML presentation review, use `./build.sh --preview`. This builds both
sides under `.cache/site-preview`, reuses existing book downloads, and leaves
published artifacts untouched. Serve that directory over HTTP to review the
flip and reading-position restoration. Use the full workflow below when book
artifacts or publication outputs are requested.

1. Confirm you are at the repo root.
2. Run `./build.sh` (strict full publication; use `./build.sh --check` for preflight).
3. If the build fails, read the retained staging diagnostics; run `./scripts/setup-build-tools.sh` for pinned Pandoc 3.6.4 and verify XeLaTeX, Poppler, Playwright, and Kindle Previewer.
4. Verify artifacts:
   - `index.html`
   - `dist/essay.md`
   - `dist/dionysus-program.pdf`
   - `dist/dionysus-program.epub`
   - `dist/dionysus-program.kpf` (required unless explicitly excluded with `--skip-kpf`)
5. Avoid manual edits to generated files (`index.html`, `dist/*`); edit `essay.md` or templates instead.
6. Offer optional previews (`open index.html`, `open dist/dionysus-program.pdf`) but do not run them unless asked.
