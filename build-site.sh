#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HTML_OUT="$ROOT_DIR/index.html"
DIST_DIR="$ROOT_DIR/dist"
TEMPLATE="$ROOT_DIR/templates/page.html"
ESSAY_MD="$ROOT_DIR/essay.md"
LETTERS_SCRIPT="$ROOT_DIR/build-letters-to-editor.js"
LETTERS_APPENDIX="$DIST_DIR/letters-to-editor-appendix.md"
SOURCES_MD="$ROOT_DIR/appendix-sources.md"
KEYWORDS_TXT="$ROOT_DIR/keywords.txt"
INDEX_SCRIPT="$ROOT_DIR/build-index.js"
INDEX_APPENDIX="$DIST_DIR/appendix-index.md"
PRAISE_SCRIPT="$ROOT_DIR/build-praise.js"
PRAISE_JSON="$ROOT_DIR/praise.json"
PRAISE_MD="$DIST_DIR/praise.md"
PRAISE_HTML="$ROOT_DIR/praise.html"
PRAISE_META="$DIST_DIR/praise-rotator.yaml"
NOTES_SCRIPT="$ROOT_DIR/build-notes.js"
NOTES_CONTENT_DIR="$ROOT_DIR/content/notes"
NOTES_TEMPLATE="$ROOT_DIR/templates/notes-page.html"
NOTES_OUT_DIR="$ROOT_DIR/notes"
NOTES_TEASER_META="$DIST_DIR/notes-teaser.yaml"

if ! command -v pandoc >/dev/null 2>&1; then
  echo "pandoc is required but not installed" >&2
  exit 1
fi

mkdir -p "$DIST_DIR"

node "$PRAISE_SCRIPT" "$PRAISE_JSON" "$PRAISE_MD" "$PRAISE_META"
echo "Wrote praise markdown to $PRAISE_MD"

node "$NOTES_SCRIPT" "$NOTES_CONTENT_DIR" "$NOTES_OUT_DIR" "$NOTES_TEMPLATE" "$NOTES_TEASER_META"
echo "Wrote notes site to $NOTES_OUT_DIR"

node "$LETTERS_SCRIPT" "$DIST_DIR"
node "$INDEX_SCRIPT" "$DIST_DIR" "$ESSAY_MD" "$KEYWORDS_TXT" "$LETTERS_APPENDIX" "$SOURCES_MD"

BOOK_INPUTS=(
  "$ESSAY_MD"
  "$LETTERS_APPENDIX"
  "$SOURCES_MD"
  "$INDEX_APPENDIX"
)

pandoc "${BOOK_INPUTS[@]}" \
  --from=markdown \
  --toc \
  --toc-depth=3 \
  --metadata=toc-title:"Contents" \
  --metadata-file="$PRAISE_META" \
  --metadata-file="$NOTES_TEASER_META" \
  --to=html5 \
  --template="$TEMPLATE" \
  --standalone \
  --lua-filter="$ROOT_DIR/filters/add-classes.lua" \
  --lua-filter="$ROOT_DIR/filters/remove-simulation-links.lua" \
  --lua-filter="$ROOT_DIR/filters/remove-title.lua" \
  --output="$HTML_OUT"

echo "Wrote HTML to $HTML_OUT"

pandoc "$PRAISE_MD" \
  --from=markdown \
  --to=html5 \
  --template="$TEMPLATE" \
  --standalone \
  --lua-filter="$ROOT_DIR/filters/add-classes.lua" \
  --lua-filter="$ROOT_DIR/filters/remove-simulation-links.lua" \
  --output="$PRAISE_HTML"

echo "Wrote praise HTML to $PRAISE_HTML"

node "$ROOT_DIR/reorder-about-program.js" "$HTML_OUT"
