#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$ROOT_DIR/scripts/build-tools.sh"
SITE_OUT="$ROOT_DIR"
if [[ "${1:-}" == --preview && $# == 1 ]]; then
  SITE_OUT="$ROOT_DIR/.cache/site-preview"
  mkdir -p "$SITE_OUT/dist"
  # Existing book downloads are available in the preview; only HTML is rebuilt.
  cp -R "$ROOT_DIR/dist/." "$SITE_OUT/dist/"
  for asset in styles.css edition.css edition.js praise-rotator.js simulation.html pull-quotes.html archetypes.json; do
    cp "$ROOT_DIR/$asset" "$SITE_OUT/"
  done
elif [[ $# != 0 ]]; then
  echo "Usage: ./build-site.sh [--preview]" >&2
  exit 1
fi
HTML_OUT="$SITE_OUT/index.html"
DIST_DIR="$SITE_OUT/dist"
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
PRAISE_HTML="$SITE_OUT/praise.html"
PRAISE_META="$DIST_DIR/praise-rotator.yaml"
NOTES_SCRIPT="$ROOT_DIR/build-notes.js"
NOTES_CONTENT_DIR="$ROOT_DIR/content/notes"
NOTES_TEMPLATE="$ROOT_DIR/templates/notes-page.html"
NOTES_OUT_DIR="$SITE_OUT/notes"
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

node "$ROOT_DIR/build-plan-of-attack.js" "$SITE_OUT"

pandoc "${BOOK_INPUTS[@]}" \
  --from=markdown \
  --toc \
  --toc-depth=3 \
  --metadata=toc-title:"Contents" \
  --metadata-file="$PRAISE_META" \
  --metadata-file="$NOTES_TEASER_META" \
  --metadata=two-sided:true \
  --variable=side-a-cover:"$(cat "$DIST_DIR/side-a-cover.html")" \
  --variable=edition-bar:"$(cat "$DIST_DIR/side-a-bar.html")" \
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
