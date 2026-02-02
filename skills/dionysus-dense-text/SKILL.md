---
name: dionysus-dense-text
description: Generate dense plain-text versions of the Dionysus Program for LLM context windows or ultra-compact reading, including LLM-compressed outputs. Use when asked to compress the program into plain text, produce dense outputs, or update dist/dionysus-program-dense.txt or dist/dionysus-program-llm.txt.
---

# Dionysus Dense Text

## Workflow

1. Confirm you are at the repo root.
2. Run `node build-dense-text.js` (or `./build-dense-text.js`) for lossless whitespace compaction.
3. Run `node build-llm-compressed.js` for LLM compression (uses OpenAI Responses API and includes a final merge pass by default).
4. Provide OpenAI env vars as needed: `OPENAI_API_KEY`, `OPENAI_MODEL` (defaults to `gpt-5.2`), `OPENAI_API_URL` (defaults to `https://api.openai.com/v1/responses`).
5. If the build fails, note missing requirements (pandoc or missing OpenAI env vars).
6. Verify outputs at `dist/dionysus-program-dense.txt` and `dist/dionysus-program-llm.txt`.
7. Avoid manual edits to generated files in `dist/`; edit `essay.md` or appendix sources instead.
