---
name: dionysus-audiobook
description: Generate, revise, quality-check, package, or add The Dionysus Program audiobook to its website using Sean Devine’s newer saved ElevenLabs voice. Use for audiobook editions, narration pickups, pronunciations, mastering, chapter downloads, or reproducing the production workflow.
---

# Dionysus audiobook

Read [the production procedure](references/production.md) before generating or changing audio. The working scripts are in `scripts/audiobook/`; the scripts, this skill, and `content/audiobook.json` are tracked. Audio takes, credentials, review decisions, and masters stay in ignored `editorial/`.

Use the **newer Sean Devine voice**, ID `iYng6Ie859Dxu5Nstki4`, trained from `sean-devine-voice-90s.mp3`. The old voice `y2yD0oD2lqjwAaFAcEQZ` is archived and must not be used. The dedication’s **Esthergen** is pronounced **Esther + Jen**, per the author.

Preserve `essay.md` and other canonical text. Adapt equations, tables, navigation, and pronunciation in the audio script, retaining an adaptation ledger. Stop on unknown semantic content rather than silently dropping it.

The 2026 edition used `eleven_v4`, stability `0.5`, similarity `0.75`, default speed, and PCM 44.1 kHz mono. Verify those capabilities against the current ElevenLabs API before a new production. Never silently substitute a different voice or model. A changed model requires a new audition.

Use approved, capped API access. No key is stored in tracked files. The original temporary production key was disabled and removed. Existing render authorization does not authorize creating new credentials or upgrading a plan.

Run one render controller per working directory. Complete transcript review and listen to disputed passages before mastering. ASR agreement and signal tests do not establish a complete human listening pass; describe the actual review performed.

Website audio is hosted as GitHub release assets, outside Git history. Uploads publish the book externally and require authorization. Do not commit or push without direction. The site’s source is `templates/audiobook.html`, `audiobook.js`, `audiobook.css`, `assets/audiobook/`, and `content/audiobook.json`; regenerate the HTML with the site build.
