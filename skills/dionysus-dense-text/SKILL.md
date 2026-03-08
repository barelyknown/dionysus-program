---
name: dionysus-dense-text
description: Build the LLM-compressed context text used by the site, and optionally the legacy dense plaintext artifact. Use when asked to rebuild dist/dionysus-program-context.txt, refresh the context download, or regenerate compressed plain-text context outputs.
---

# Dionysus Dense Text

## Workflow

1. Confirm you are at the repo root.
2. Run `node build-llm-compressed.js` for the site-consumed context output (defaults to `dist/dionysus-program-context.txt` and uses OpenAI Responses API).
3. Provide OpenAI env vars as needed: `OPENAI_API_KEY`, `OPENAI_MODEL` (defaults to `gpt-5.4`), `OPENAI_API_URL` (defaults to `https://api.openai.com/v1/responses`).
4. If the build fails, note missing requirements (pandoc or missing OpenAI env vars).
5. Verify the output at `dist/dionysus-program-context.txt`.
6. Only run `node build-dense-text.js` (or `./build-dense-text.js`) if you explicitly need the legacy dense plaintext artifact at `dist/dionysus-program-dense.txt`; it is not used by the site build.
7. Avoid manual edits to generated files in `dist/`; edit `essay.md` or appendix sources instead.
