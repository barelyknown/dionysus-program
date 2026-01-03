# Pull Quote Output Format

Produce a single JSON array of objects with these keys, saved as `pull-quotes.json` in the repo root:

- `quote`: The exact pull-quote text (verbatim from source).
- `author`: The quote’s author (for the essay, use `Sean Devine`; for a letter, use `Not ___`).
- `source`: The source file path, optionally with a section label (example: `essay.md#About the Program` or `letters_to_editor/dionysus.txt`).

Example:

```json
[
  {
    "quote": "The program is indivisible.",
    "author": "Sean Devine",
    "source": "essay.md"
  }
]
```

Quality filters:

- Tie back to the program’s core ideas (epimetabolic rate, ritual/run time, renewal, cultural metabolism).
- Prioritize quotes tied to the program’s mechanics over general commentary.
- Prefer short, sharp, memorable sentences (generally 8–24 words).
- Avoid generic or replacement-level lines.
- Ensure each quote stands on its own without ambiguous pronouns or missing antecedents.
- If a standout line is ambiguous, replace it or expand to adjacent sentence(s) verbatim if still short.
- Avoid long lists, purely logistical sentences, or citations/URLs.
- Remove redundancy; each quote should earn its slot.
- Include at least two quotes that clearly communicate the program’s why (purpose/urgency).
- Default output is the top 20 essay quotes and top 10 letter quotes, ordered from strongest to weakest.
- Rank using memorability, clarity, and centrality to the program’s ideas.
