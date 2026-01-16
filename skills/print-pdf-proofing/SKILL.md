---
name: print-pdf-proofing
description: Review print-ready PDF page images for professional book-quality layout. Use when asked to proof, QA, or visually review the print PDF for spacing, page breaks, running heads, margins, widows/orphans, and other production-quality issues.
---

# Print PDF Proofing

## Quick start

- Ensure the print PDF exists at `dist/dionysus-program-print.pdf`. If missing, run `./build.sh`.
- Render pages to images for visual review. Example:

```bash
mkdir -p /tmp/dionysus-proof
pdftoppm -png -r 150 dist/dionysus-program-print.pdf /tmp/dionysus-proof/page
```

- Review representative pages: title/TOC, each section opener, dense text pages, lists, appendices, index, and any special layouts.

## Review checklist (print quality)

- **Margins & gutter**: Consistent margins, text not crowding inner gutter.
- **Running heads/page numbers**: Correct placement, consistency, missing numbers, no heads on section-title pages.
- **Headings**: H2/H3 spacing consistency, section title pages balanced.
- **Paragraph flow**: No double gaps, no awkward spacing before/after lists or block elements.
- **Widows/orphans**: Avoid single lines at top/bottom of pages.
- **Hyphenation & rivers**: Excessive hyphenation or visible rivers.
- **Lists**: Bullet/number indentation and spacing consistent.
- **Links/URLs**: No link styling (boxes/colors/underlines) in print PDF.
- **Index**: Page references visible and aligned.

## Reporting format

Provide a concise list of issues with:
- Page number
- Short description
- Severity (high/medium/low)
- Suggested fix (if obvious)

If no issues are found, explicitly state that the review found no layout issues.

## Notes

- Do not edit `dist/*` directly. Apply fixes in source files/filters/templates and rebuild.
- Prefer using `pdftotext -layout` to locate specific sections if page numbers are unknown.
