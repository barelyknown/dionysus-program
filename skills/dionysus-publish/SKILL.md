---
name: dionysus-publish
description: Publish The Dionysus Program from a committed source revision. Use when asked to publish the site/book, cut a release build, or generate stamped artifacts that record the source commit and publish timestamp.
---

# Dionysus Publish

## Overview

Publish in two commits so the book artifacts record the source commit they were built from.

## Workflow

1. Confirm you are at the repo root and review `git status --short`.
2. Stage and commit the source changes first.
   - Include content, template, filter, script, or style changes.
   - Do not hand-edit generated files in `dist/` or `index.html`.
   - Use a Conventional Commit message when possible.
3. Run `./build.sh`.
   - The build stamps the current `HEAD` commit and a UTC publish timestamp into the published outputs.
   - Because the source commit already exists, the stamped revision reflects the content commit, not an in-progress worktree.
4. Verify the generated artifacts:
   - `index.html`
   - `dist/essay.md`
   - `dist/dionysus-program.pdf`
   - `dist/dionysus-program.epub`
5. Stage the generated outputs and commit them separately.
   - Prefer a message like `chore: publish <shortsha>`.
   - This publish commit ships artifacts built from the previous source commit.
6. Push only if the user explicitly asks.

## Notes

- The published outputs show `Revision: <shortsha> — <UTC timestamp>`.
- `dist/source-revision.txt` records the full commit SHA plus timestamp for tooling or spot checks.
- If `./build.sh` updates `essay.md` rights metadata, review and include that change in the source commit before publishing.
