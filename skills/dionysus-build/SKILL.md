---
name: dionysus-build
description: Build or rebuild the Dionysus Program site outputs (HTML/PDF/Markdown) using ./build.sh. Use when asked to build, rebuild, regenerate outputs, update the PDF/HTML, or verify generated artifacts in this repo.
---

# Dionysus Build

## Overview

Run the repo build pipeline and validate the generated artifacts without editing outputs by hand.

## Workflow

1. Confirm you are at the repo root.
2. Run `./build.sh`.
3. If the build fails, note missing requirements (pandoc and ideally xelatex).
4. Verify artifacts:
   - `index.html`
   - `dist/essay.md`
   - `dist/dionysus-program.pdf`
5. Avoid manual edits to generated files (`index.html`, `dist/*`); edit `essay.md` or templates instead.
6. Offer optional previews (`open index.html`, `open dist/dionysus-program.pdf`) but do not run them unless asked.
