# Repository Guidelines

## Project Structure & Module Organization
- `essay.md` holds the canonical Markdown source with YAML metadata (title, description, author, date, rights).
- `build.sh` orchestrates builds, emitting HTML/PDF/Markdown into the repo root and `dist/`.
- `templates/` and `filters/` contain the Pandoc templates and Lua filters that shape HTML/PDF output.
- `styles.css` defines the site typography; `index.html` is generated, not hand-edited.
- `dist/` ships generated artifacts: `dionysus-program.pdf` and a copy of the Markdown (`essay.md`).
- `skills/` holds repo-specific Codex skills for build/publish/proofing workflows.

## Build, Test, and Development Commands
- `./build.sh` — Regenerates `index.html`, copies `dist/essay.md`, and rebuilds `dist/dionysus-program.pdf`. Requires pinned Pandoc 3.6.4 (`./scripts/setup-build-tools.sh`), XeLaTeX, Poppler, Playwright, and Kindle Previewer. Run `./build.sh --check` to exercise the toolchain before publication.
- `open index.html` — Quick local preview in a browser (macOS). Use any static file server if preferred.
- `open dist/dionysus-program.pdf` — Spot-check the PDF output after a build.

## Coding Style & Naming Conventions
- Keep edits in `essay.md`; avoid manual tweaks to generated `index.html` or `dist/*`.
- Never directly edit files in `dist/`; regenerate them via `./build.sh`.
- CSS sticks to semantic class names (`.page-header`, `.page-download`) and prefers serif typography; maintain indentation at two spaces.
- Lua filters follow concise naming (`remove-title.lua`, `pdf.lua`); continue dispatching logic by Pandoc element type.

## Writing & Editing
Apply these author-calibrated preferences (2026-10-13) when drafting or editing the manuscript, letters, Side B, and book-facing copy:

- Keep everything essential and nothing extra. Make surgical edits that preserve the claim, qualifications, speaker, and rhythm.
- State the effect or instruction directly. Avoid importance announcements such as “The ___ matters,” “mattered to the work,” and “the central lesson.” Prefer “Names anchor attention” to “Names matter; they anchor attention.”
- Describe care through conduct. Replace flourishes such as “hospitality must survive,” “warmth can hold,” and “nobody owes the room” with what the Host does and what participants may do. Preserve warmth, protection, silence, seriousness, grief, and optional humor.
- Name people and their actions directly. Avoid “fully exhausted substrate” and “bounded unit” for people doing work. Keep technical distinctions such as substrate-neutral systems, bounded rationality, and bounded agency where they serve the argument.
- Match the speaker's register. In conversational or satirical prose, prefer “Three fluent answers won’t get the order delivered” to “Three fluent answers do not constitute a delivery.” Review formal scientific uses separately.
- Replace vague emotional instructions such as “make the stakes felt” with the particular consequences or intended effect. Do not substitute another vague phrase.
- Preserve effective abstraction, metaphor, contrast, fragments, and aphorisms. Author-approved examples include “Common became normal. Normal became moral.”; “In messy systems, waste is often not an error. It is an insurance policy.”; and “Anomie is not a mood; it is a vacuum of valuation.” These devices are not defects by themselves.
- Author feedback takes precedence over generic writing heuristics. Preserve approved wording by default, read edited passages in context, and keep factual or theoretical revisions separate from style edits.
- Keep raw ratings, research, review apps, backups, and edit ledgers local under the ignored `editorial/` directory. Maintain the distilled writing guidance here so future checkouts do not depend on those local files.

## Testing Guidelines
- `node --test scripts/build-safeguards.test.js` checks tool rejection, KPF failure handling, and publication rollback.
- `./build.sh --check` runs real PDF, EPUB-to-KPF, and browser probes without changing published artifacts.

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
- dionysus-dense-text: Build the LLM-compressed context text used by the site, and optionally the legacy dense plaintext artifact. Use when asked to rebuild `dist/dionysus-program-context.txt`, refresh the context download, or regenerate compressed plain-text context outputs. (file: skills/dionysus-dense-text/SKILL.md)
- dionysus-publish: Publish The Dionysus Program from a committed source revision so the stamped SHA and UTC publish time match the source commit that produced the book artifacts. Use when asked to publish the site/book, cut a release build, or generate stamped artifacts from a clean commit. (file: skills/dionysus-publish/SKILL.md)
- dionysus-pull-quotes: Generate short, memorable pull quotes from `essay.md` and `letters_to_editor/*.txt`, then output a JSON file with quote/author/source attribution. Use when asked to curate pull quotes, quote lists, or pull-quote JSON for the essay or letters to the editor. (file: skills/dionysus-pull-quotes/SKILL.md)
- print-pdf-proofing: Review print-ready PDF page images for professional book-quality layout. Use when asked to proof, QA, or visually review the print PDF for spacing, page breaks, running heads, margins, widows/orphans, and other production-quality issues. (file: skills/print-pdf-proofing/SKILL.md)
