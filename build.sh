#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HTML_OUT="$ROOT_DIR/index.html"
DIST_DIR="$ROOT_DIR/dist"
PDF_OUT="$DIST_DIR/dionysus-program.pdf"
TEMPLATE="$ROOT_DIR/templates/page.html"
ESSAY_MD="$ROOT_DIR/essay.md"
LETTERS_SCRIPT="$ROOT_DIR/build-letters-to-editor.js"
LETTERS_APPENDIX="$DIST_DIR/letters-to-editor-appendix.md"
SOURCES_MD="$ROOT_DIR/appendix-sources.md"
KEYWORDS_TXT="$ROOT_DIR/keywords.txt"
INDEX_SCRIPT="$ROOT_DIR/build-index.js"
INDEX_APPENDIX="$DIST_DIR/appendix-index.md"

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
  --lua-filter="$ROOT_DIR/filters/remove-title.lua" \
  --output="$HTML_OUT"

echo "Wrote HTML to $HTML_OUT"

cp "$ESSAY_MD" "$DIST_DIR/essay.md"
echo "Copied Markdown to $DIST_DIR/essay.md"

cp "$SOURCES_MD" "$DIST_DIR/appendix-sources.md"
echo "Copied sources to $DIST_DIR/appendix-sources.md"

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
    --lua-filter="$ROOT_DIR/filters/remove-title.lua" \
    --lua-filter="$ROOT_DIR/filters/pdf.lua" \
    --template="$ROOT_DIR/templates/pdf.tex" \
    --output="$PDF_OUT"
  echo "Wrote PDF to $PDF_OUT (via $PDF_ENGINE)"
else
  echo "Skipping PDF build (install xelatex to enable)"
fi
