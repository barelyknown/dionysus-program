---
name: essay-formatting
description: Review and edit the dionysus-program essay for emphasis/formatting consistency. Use when asked to apply the emphasis policy, clean up bold/italics, or make the essay.md scan-friendly per the formatting rules.
---

# Essay Formatting

## Overview
Apply the emphasis policy to `essay.md` so bold/italics are rare, consistent, and used only for definitions, labels, and titles/foreign terms.

## Workflow
1. Read `references/formatting-policy.md` and scan `essay.md`.
2. Fix emphasis violations:
   - Remove rhetorical bold/italics.
   - Enforce one bold and one italic per paragraph (except allowed diagnostic/list cases).
   - Convert rules/tests to **Label:** format.
   - Italicize titles and foreign terms on first use; plain afterward.
3. Keep edits confined to `essay.md`. Do not edit generated files (`index.html`, `dist/*`).
4. Rebuild only if the user explicitly asks to build.
5. Report any deliberate exceptions and any paragraphs that required structural rewrites.

## References
- `references/formatting-policy.md` for the full emphasis rules.
