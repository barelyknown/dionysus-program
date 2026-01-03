#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HTML_OUT="$ROOT_DIR/index.html"
DIST_DIR="$ROOT_DIR/dist"
PDF_OUT="$DIST_DIR/dionysus-program.pdf"
EPUB_OUT="$DIST_DIR/dionysus-program.epub"
TEMPLATE="$ROOT_DIR/templates/page.html"
EPUB_CSS="$ROOT_DIR/templates/epub.css"
EPUB_COVER="$ROOT_DIR/templates/dionysus-program-cover.jpg"
SOCIAL_COVER="$ROOT_DIR/templates/dionysus-program-cover-wide.jpg"
FAVICON_JPG="$ROOT_DIR/templates/dionysus-program-favicon.jpg"
FAVICON_32="$ROOT_DIR/templates/dionysus-program-favicon-32.png"
FAVICON_180="$ROOT_DIR/templates/dionysus-program-favicon-180.png"
ESSAY_MD="$ROOT_DIR/essay.md"
LETTERS_SCRIPT="$ROOT_DIR/build-letters-to-editor.js"
LETTERS_APPENDIX="$DIST_DIR/letters-to-editor-appendix.md"
SOURCES_MD="$ROOT_DIR/appendix-sources.md"
KEYWORDS_TXT="$ROOT_DIR/keywords.txt"
INDEX_SCRIPT="$ROOT_DIR/build-index.js"
INDEX_APPENDIX="$DIST_DIR/appendix-index.md"
ABOUT_PROGRAM_SCRIPT="$ROOT_DIR/extract-about-program.js"
ABOUT_PROGRAM_OUT="$DIST_DIR/about-the-program.md"

if ! command -v pandoc >/dev/null 2>&1; then
  echo "pandoc is required but not installed" >&2
  exit 1
fi

mkdir -p "$DIST_DIR"

node "$LETTERS_SCRIPT" "$DIST_DIR"
node "$INDEX_SCRIPT" "$DIST_DIR" "$ESSAY_MD" "$KEYWORDS_TXT" "$LETTERS_APPENDIX" "$SOURCES_MD"

pandoc "$ESSAY_MD" "$LETTERS_APPENDIX" "$SOURCES_MD" \
  "$INDEX_APPENDIX" \
  --from=markdown \
  --toc \
  --toc-depth=3 \
  --metadata=toc-title:"Contents" \
  --to=html5 \
  --template="$TEMPLATE" \
  --standalone \
  --lua-filter="$ROOT_DIR/filters/add-classes.lua" \
  --lua-filter="$ROOT_DIR/filters/remove-simulation-links.lua" \
  --lua-filter="$ROOT_DIR/filters/remove-title.lua" \
  --output="$HTML_OUT"

echo "Wrote HTML to $HTML_OUT"

node "$ROOT_DIR/reorder-about-program.js" "$HTML_OUT"

cp "$ESSAY_MD" "$DIST_DIR/essay.md"
echo "Copied Markdown to $DIST_DIR/essay.md"

node "$ABOUT_PROGRAM_SCRIPT" "$ESSAY_MD" "$ABOUT_PROGRAM_OUT"
echo "Copied About the Program to $ABOUT_PROGRAM_OUT"

cp "$SOURCES_MD" "$DIST_DIR/appendix-sources.md"
echo "Copied sources to $DIST_DIR/appendix-sources.md"

cp "$EPUB_COVER" "$DIST_DIR/dionysus-program-cover.jpg"
echo "Copied cover to $DIST_DIR/dionysus-program-cover.jpg"

if [[ -f "$SOCIAL_COVER" ]]; then
  cp "$SOCIAL_COVER" "$DIST_DIR/dionysus-program-cover-wide.jpg"
  echo "Copied social cover to $DIST_DIR/dionysus-program-cover-wide.jpg"
fi

if [[ -f "$FAVICON_JPG" ]]; then
  cp "$FAVICON_JPG" "$DIST_DIR/dionysus-program-favicon.jpg"
  echo "Copied favicon source to $DIST_DIR/dionysus-program-favicon.jpg"
fi

if [[ -f "$FAVICON_32" ]]; then
  cp "$FAVICON_32" "$DIST_DIR/dionysus-program-favicon-32.png"
  echo "Copied favicon 32px to $DIST_DIR/dionysus-program-favicon-32.png"
fi

if [[ -f "$FAVICON_180" ]]; then
  cp "$FAVICON_180" "$DIST_DIR/dionysus-program-favicon-180.png"
  echo "Copied favicon 180px to $DIST_DIR/dionysus-program-favicon-180.png"
fi

pandoc "$ESSAY_MD" "$LETTERS_APPENDIX" "$SOURCES_MD" \
  "$INDEX_APPENDIX" \
  --from=markdown \
  --toc \
  --toc-depth=3 \
  --metadata=toc-title:"Contents" \
  --to=epub3 \
  --split-level=3 \
  --css="$EPUB_CSS" \
  --epub-cover-image="$EPUB_COVER" \
  --lua-filter="$ROOT_DIR/filters/add-classes.lua" \
  --lua-filter="$ROOT_DIR/filters/remove-simulation-links.lua" \
  --lua-filter="$ROOT_DIR/filters/remove-title.lua" \
  --output="$EPUB_OUT"

echo "Wrote EPUB to $EPUB_OUT"

PDF_ENGINE=""
if command -v xelatex >/dev/null 2>&1; then
  PDF_ENGINE="xelatex"
fi

if [[ -n "$PDF_ENGINE" ]]; then
  pandoc "$ESSAY_MD" "$LETTERS_APPENDIX" "$SOURCES_MD" \
    "$INDEX_APPENDIX" \
    --from=markdown \
    --toc \
    --toc-depth=3 \
    --metadata=toc-title:"Contents" \
    --pdf-engine="$PDF_ENGINE" \
    --standalone \
    --lua-filter="$ROOT_DIR/filters/add-classes.lua" \
    --lua-filter="$ROOT_DIR/filters/remove-simulation-links.lua" \
    --lua-filter="$ROOT_DIR/filters/remove-title.lua" \
    --lua-filter="$ROOT_DIR/filters/pdf.lua" \
    --template="$ROOT_DIR/templates/pdf.tex" \
    --output="$PDF_OUT"
  echo "Wrote PDF to $PDF_OUT (via $PDF_ENGINE)"
else
  echo "Skipping PDF build (install xelatex to enable)"
fi
