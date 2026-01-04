# Repository Guidelines

## Project Structure & Module Organization
- `essay.md` holds the canonical Markdown source with YAML metadata (title, description, author, date, rights).
- `build.sh` orchestrates builds, emitting HTML/PDF/Markdown into the repo root and `dist/`.
- `templates/` and `filters/` contain the Pandoc templates and Lua filters that shape HTML/PDF output.
- `styles.css` defines the site typography; `index.html` is generated, not hand-edited.
- `dist/` ships generated artifacts: `dionysus-program.pdf` and a copy of the Markdown (`essay.md`).

## Build, Test, and Development Commands
- `./build.sh` — Regenerates `index.html`, copies `dist/essay.md`, and rebuilds `dist/dionysus-program.pdf`. Requires `pandoc` and ideally `xelatex` for PDFs.
- `open index.html` — Quick local preview in a browser (macOS). Use any static file server if preferred.
- `open dist/dionysus-program.pdf` — Spot-check the PDF output after a build.

## Coding Style & Naming Conventions
- Keep edits in `essay.md`; avoid manual tweaks to generated `index.html` or `dist/*`.
- Never directly edit files in `dist/`; regenerate them via `./build.sh`.
- CSS sticks to semantic class names (`.page-header`, `.page-download`) and prefers serif typography; maintain indentation at two spaces.
- Lua filters follow concise naming (`remove-title.lua`, `pdf.lua`); continue dispatching logic by Pandoc element type.

## Testing Guidelines
- No automated test suite exists.

## Commit & Pull Request Guidelines
- Prefer Conventional Commit prefixes (e.g., `feat: add Markdown download link`, `fix: correct PDF title page`) while staying concise.
- Group related file changes (template + generated outputs + README note) in the same commit for traceability.
- Pull requests should include: summary of content changes, confirmation that `./build.sh` ran cleanly, and screenshots/PDF snippets if typography or layout shifted.

## Deployment Notes
- Pushing to `main` triggers GitHub Pages; ensure `.nojekyll` and `CNAME` remain in the root.
- For domain or SSL issues, re-run `./build.sh`, push, then re-check Pages settings before altering DNS.
- Do not commit or push unless directed to do so.

## Skills
- dionysus-build: Build or rebuild the Dionysus Program site outputs (HTML/PDF/Markdown) using `./build.sh`. Use when asked to build, rebuild, regenerate outputs, update the PDF/HTML, or verify generated artifacts in this repo. (file: skills/dionysus-build/SKILL.md)
- dionysus-pull-quotes: Generate short, memorable pull quotes from `essay.md` and `letters_to_editor/*.txt`, then output a JSON file with quote/author/source attribution. Use when asked to curate pull quotes, quote lists, or pull-quote JSON for the essay or letters to the editor. (file: skills/dionysus-pull-quotes/SKILL.md)
