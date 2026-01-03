---
name: dionysus-pull-quotes
description: Generate short, memorable pull quotes from `essay.md` and `letters_to_editor/*.txt` in The Dionysus Program repo, and output a JSON file with quote/author/source attribution. Use when asked to curate pull quotes, quote lists, or pull-quote JSON for the essay or letters to the editor.
---

# Dionysus Pull Quotes

## Overview

Generate curated pull quotes tied to the core ideas of The Dionysus Program, then deliver a JSON file with quote text, author, and source.

## Workflow

1. Identify sources.
   - Default sources are `essay.md` and one or more files in `letters_to_editor/`.
   - Read `dist/about-the-program.md` (preferred) or the “About the Program” section to anchor what counts as a core idea.

2. Generate candidate sentences.
   - Use `scripts/find_pull_quote_candidates.py` to extract short sentences.
   - Example:
     - `python3 skills/dionysus-pull-quotes/scripts/find_pull_quote_candidates.py --file essay.md --min-words 8 --max-words 24`
     - `python3 skills/dionysus-pull-quotes/scripts/find_pull_quote_candidates.py --file essay.md --section \"About the Program\" --min-words 8 --max-words 24`
     - `python3 skills/dionysus-pull-quotes/scripts/find_pull_quote_candidates.py --file letters_to_editor/dionysus.txt --min-words 8 --max-words 24`

3. Curate the final list.
   - Consider the entire essay; do not over-index on early sections.
   - Keep quotes short, memorable, and directly connected to the program’s ideas.
   - Avoid anything generic or replacement-level.
   - Prefer single sentences; avoid lists, metadata, or URLs.
   - Ensure each quote stands on its own without missing context (avoid unclear “it/this/that”).
   - If a strong line is ambiguous, replace it with a self-contained alternative or include the adjacent sentence(s) verbatim if still short.
   - Keep them verbatim; do not paraphrase or rewrite.
   - Remove redundancy; each quote should earn its slot.
   - Include at least two quotes that clearly communicate the program’s why (purpose/urgency), and rank the best ones.

4. Output JSON.
   - Follow `references/pull-quote-format.md`.
   - Set `author` to `Sean Devine` for essay quotes and to `Not ___` for letter quotes (for example, `Not Karl Popper`).
   - Set `source` to the file path, optionally with a section label.
   - Write the final file to the repo root as `pull-quotes.json`.
   - Default output is the top 20 essay quotes and top 10 letter quotes, ordered best to weakest.
   - Rank using memorability, clarity, and centrality to the program’s ideas, prioritizing quotes tied to the program’s mechanics.

## Resources

- `scripts/find_pull_quote_candidates.py`: Extract candidate sentences by word count and optional markdown section.
- `references/pull-quote-format.md`: JSON structure and quality filters.
