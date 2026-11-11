# Reproducing the audiobook

## Edition record

The finished November 2026 edition is in `editorial/audiobook/delivery/` on the production machine. Raw audio, the complete source snapshot, 209 selected narration segments, independent transcripts, 92 chapter masters, and review ledgers remain under `editorial/audiobook/`. That directory is deliberately ignored by Git; preserve it in a private backup if the original takes must survive moving machines. A Git checkout alone contains the reusable code and directions, not the lossless masters or credentials.

- Source revision: `be94df4cea9a33cfcbd535b186e9cfc4e3305e4e`; 62 source files were hashed.
- Text: 76,258 words before pronunciation/acronym expansion; 209 segments, 92 sections including credits, appendices, 58 imagined letters, and sources.
- Duration: 33,088.877687 seconds (9:11:28.878).
- Voice: `iYng6Ie859Dxu5Nstki4`, **Sean Devine**, newer instant clone, source recording `sean-devine-voice-90s.mp3`.
- Archived voice: `y2yD0oD2lqjwAaFAcEQZ`, **Sean Devine — ARCHIVED (older clone)**, source `Recording 2.mp3`, collection **Archived Voices**. Retained, not deleted.
- Model: `eleven_v4`; stability `0.5`; similarity boost `0.75`; default speed `1`; normalization on; language `en`. Lossless API output `pcm_44100`, wrapped as 16-bit mono WAV.
- Context: up to 1,200 characters of previous/next text within each chapter. Target segments 2,900 characters, maximum 3,200; split only between paragraphs. Seeds derive from text hash plus take number. API/model changes can prevent bit-identical regeneration.
- Dedication: **Esthergen → Esther Jen** (explicit author confirmation). `scripts/audiobook/pronunciations.json` preserves reviewed name pronunciations. Per-segment phoneme patches belong to their edition’s `review/phoneme-overrides.json`, not future editions blindly.
- Production consumed 562,421 credits, including auditions and pickups. The previous key had a 750,000-credit cap and seven-day expiry, and was disabled after production. These figures are historical, not a current price quote or spending authorization.

## Prepare a new edition without API charges

Dependencies: Python 3.11+ (standard library only), Node, pinned Pandoc 3.6.4, FFmpeg with libmp3lame/AAC, FFprobe. The production used FFmpeg n9.0.1; check `ffmpeg -version` on the target machine. Do not update the pinned book toolchain for an audiobook task.

```bash
# Use a new directory; never overwrite an earlier edition.
export DIONYSUS_AUDIOBOOK_DIR="$PWD/editorial/audiobook-YYYY-MM-DD"
python3 scripts/audiobook/prepare.py
python3 scripts/audiobook/produce.py plan
```

`prepare.py` snapshots the source, invokes the canonical letters builder, generates Pandoc ASTs, converts them to spoken chapters, records source hashes, and writes `review/adaptations.json`. It refuses to prepare over a directory containing raw audio. `PANDOC_BIN` can identify the pinned executable. The default working directory is `editorial/audiobook`, used by the original production.

Review `narration-draft.txt`, `manifest.json`, the spoken equations/table, `review/adaptations.json`, and the chapter map. Unknown math or semantic AST nodes fail closed. The transformations intentionally omit the print index and navigation; the letters introduction retains its fiction disclaimer. Check new source structures rather than relaxing failures globally.

The opening/closing credits and copyright in `prepare.py` and `source/edition.json` describe 2026. For a later edition, review and update these explicit strings before rendering. After approved edits to chapter text, update its SHA-256 in `manifest.json` and regenerate the plan. Do not edit the book manuscript just to influence pronunciation.

The generated plan expands XBE, BCMI, AGI, AI, API, WIP, R&D, M&A, e.g., i.e., and vs. for speech. Review expansion in context. Word spelling remains unchanged in the canonical book.

## Access and audition

Obtain current authorization for any new credential and production spending. Reuse an already authorized key if available. Use only TTS, STT, voice-read, model-read, and account-read permissions; cap usage and set a short expiry. Never log or paste the key into a command, script, Git file, or report. Supply `ELEVENLABS_API_KEY` through the process environment or a mode-0600 `.env` in the ignored working directory.

```bash
python3 scripts/audiobook/produce.py preflight
# Example IDs from the November 2026 manifest: credits, Preface, and equation.
python3 scripts/audiobook/produce.py render --chapters 0,5,20 --workers 2
python3 scripts/audiobook/produce.py transcribe --chapters 0,5,20 --workers 2
python3 scripts/audiobook/produce.py check --chapters 0,5,20
```

Choose the mathematical section from the new manifest, rather than assuming its number. Listen for author identity, natural phrasing, rhythm, names, equation delivery, and dedication pronunciation. The saved voice ID must match exactly and its name must not contain ARCHIVED. If `eleven_v4` or the voice is unavailable, stop and audition an explicitly approved alternative; do not silently fall back.

Current endpoint contracts should be checked against official ElevenLabs documentation before paid work:

- [TTS with timestamps](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)
- [Speech to text](https://elevenlabs.io/docs/api-reference/speech-to-text/convert)
- [Models](https://elevenlabs.io/docs/api-reference/models/list)

## Render and review

```bash
python3 scripts/audiobook/render_all.py
python3 scripts/audiobook/review_audio.py
```

One controller uses six chapter workers; units within a chapter run sequentially. The controller renders, independently transcribes with Scribe v2, and compares each segment. A working-directory lock protects the renderer/ledger. Do not run other scripts that mutate takes concurrently. Resume the same command after inspecting a failure; completed takes are reused only when text, rendered pronunciation, and audio checksums match. Ambiguous HTTP failures are not retried automatically, to avoid duplicate charges. Ledger reservations are conservative; inspect account usage before adjusting them.

Inspect omissions, substitutions, long gaps, clipping, pacing outside 100–205 words/minute, and pronunciation. ASR can mishear names and homophones, and can also agree with incorrectly generated speech. Listen to flagged passages and spot-check unflagged passages, starts, ends, and joins. For a second independent transcript of a disputed passage:

```bash
python3 scripts/audiobook/verify_clip.py 014-01 'limen' --before 4 --after 8
```

Use actual unit IDs and phrases from the new plan/alignment. `verify_clip.py` uses Scribe v3 and records the source audio hash. If the API model changes, verify support before using it. Short clips can lose helpful context; retrying a word alone is not proof of a defect.

For a confirmed issue, create `review/phoneme-overrides.json` mapping unit IDs to literal-word/IPA replacements, or make an approved spoken-script correction. Example:

```json
{"014-01": {"Limen": "/ˈlaɪmən/", "limen": "/ˈlaɪmən/"}}
```

Regenerate only the affected chapter (the CLI selects chapters, not individual units), then transcribe and review again:

```bash
python3 scripts/audiobook/produce.py render --chapters 14 --retake --workers 1
python3 scripts/audiobook/produce.py transcribe --chapters 14 --workers 1
python3 scripts/audiobook/review_audio.py
```

This retakes every segment of the selected chapter and costs credits for those segments. For a unit-only pickup, call `produce.render_unit(unit, retake=True)` from a small local script while holding `produce.operation_lock()`, then transcribe/check that unit. Preserve old takes.

`review/editorial-decisions.json` accepts review-key entries from the report only when their `audio_sha256` matches the selected take:

```json
{"014-01:HASH_FROM_REPORT": {"review":"accepted_after_listening", "reason":"Describe the passage and evidence.", "audio_sha256":"FULL_SELECTED_AUDIO_SHA256"}}
```

The built-in spelling-equivalence list reduces ASR noise. Review that list for each edition, particularly contractions and transliterations. It does not certify pronunciation. Gap/pace/clipping flags remain unresolved until corrected or explicitly investigated in the code/report; do not remove quality gates merely to finish packaging.

## Master and package

Place a reviewed square JPEG at `$DIONYSUS_AUDIOBOOK_DIR/delivery/cover.jpg` (3000×3000 for distribution). The original cover adaptation prompt is in [cover-prompt.txt](cover-prompt.txt). Reuse the approved existing cover for the same edition. Use the image-generation tool for a new visual adaptation; preserve the original art separately. Copy the production cover prompt into `review/cover-prompt.txt` for packaging.

```bash
python3 scripts/audiobook/master.py --workers 3
python3 scripts/audiobook/optimize_tags.py
python3 scripts/audiobook/package.py
```

Wait for each command to finish. Do not run overlapping master/tag/package processes. Mastering trims only exterior near-digital silence (threshold 18/32768), retains 120 ms breathing room, adds 400 ms between units, 650 ms lead and 1.3 s tail. Two-pass loudness normalization targets −20 LUFS, −3.5 dBTP, LRA 7. Lossless chapter masters: 24-bit mono WAV, 44.1 kHz. MP3: 192 kbps CBR, mono, 44.1 kHz. Compact embedded cover: 1000×1000; tag optimization verifies unchanged audio packets. M4B: AAC 128 kbps target, mono, 44.1 kHz, chapters and cover, with another −0.7 dB of headroom before encoding.

Gates: every selected segment reviewed; master matches selected take hashes; final MP3 RMS −23 to −18 dBFS and true peak at or below −3 dBTP; duration/format checks; M4B chapter count and duration; final decoded AAC levels; ZIP CRC; SHA-256 delivery manifest. `package.py` scans the entire M4B and can take several minutes. It fails if the encoded result misses a gate.

The original final M4B measured −20.8 LUFS, −3.42 dBTP, −20.953 dBFS RMS. Package contents include M4B, 92 MP3s, ZIP, preview, cover, metadata, chapters CSV, listening/distribution guide, and quality report. No retailer submission occurred. State the actual review performed; the original production had automated/ASR-assisted review, not a complete human listening certification.

After final API work, disable the temporary credential in ElevenLabs, remove its local secret, and verify the disabled state. Retain usage totals without retaining the key.

## Website and external hosting

`content/audiobook.json` is the website chapter/download manifest. `templates/audiobook.html`, `audiobook.css`, and `audiobook.js` implement the player. `assets/audiobook/` contains only compact cover art and the short preview. The long audio files must stay outside Git: the M4B is 578 MB, the MP3 ZIP 833 MB. GitHub recommends release assets for large binary distribution ([source](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)).

Upload requires explicit authorization to export the finished audiobook to GitHub. This script first creates a draft, verifies uploaded SHA-256 digests, and publishes only with `--publish`:

```bash
python3 scripts/audiobook/upload_release.py --work "$DIONYSUS_AUDIOBOOK_DIR" --tag audiobook-YYYY-MM-DD
# After the draft is reviewed/authorized for public distribution:
python3 scripts/audiobook/upload_release.py --work "$DIONYSUS_AUDIOBOOK_DIR" --tag audiobook-YYYY-MM-DD --publish
```

It uploads only M4B, ZIP, numbered MP3s, preview, cover, metadata, chapter map, listener guide, and checksums. Credentials, raw takes, review ledgers, and account records are excluded. Once a release is public, use a new tag for changes; do not overwrite listening URLs. Update `content/audiobook.json` with the approved edition’s URLs and exact chapter durations, and update the compact cover/preview as needed.

The November 2026 website manifest targets `audiobook-2026-11-11`. Verify the public release assets before deploying a manifest that references a new tag. Upload authorization was explicitly provided by the author for this edition.

```bash
./build.sh --preview
node --test scripts/audiobook-site.test.js
npx playwright test e2e/audiobook.spec.js
```

The player uses individual MP3s, loads no chapter audio until playback, saves per-edition progress locally, and does not autoplay. Check release URLs, MIME types, and byte-range playback after public upload. If the host cannot serve browser audio reliably, keep downloads working and choose an authorized media host before enabling streaming.

For an HTML-only change, `bash ./build-site.sh` regenerates the site with existing book downloads. For a full publication, follow `dionysus-build` and `dionysus-publish`; do not commit or push without the user’s direction.
