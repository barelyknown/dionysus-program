#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
CHECK_ONLY=0
SKIP_KPF=0
PREVIEW=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=1 ;;
    --skip-kpf) SKIP_KPF=1 ;;
    --preview) PREVIEW=1 ;;
    --help) echo "Usage: ./build.sh [--check] [--skip-kpf] [--preview]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done
if [[ $PREVIEW == 1 ]]; then
  [[ $CHECK_ONLY == 0 && $SKIP_KPF == 0 ]] || { echo "Use --preview on its own." >&2; exit 1; }
  exec bash "$ROOT_DIR/build-site.sh" --preview
fi
source "$ROOT_DIR/scripts/build-tools.sh"
mkdir -p "$ROOT_DIR/.cache"
LOCK_DIR="$ROOT_DIR/.cache/publication.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another build holds $LOCK_DIR. If a build was killed, remove this lock after confirming it has stopped." >&2
  exit 1
fi
BUILD_DIR=""
cleanup_build() {
  local status=$?
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR"
  if [[ -n "$BUILD_DIR" ]]; then
    if [[ $status == 0 ]]; then rm -rf "$BUILD_DIR";
    else echo "Build failed; published files were not replaced. Diagnostics: $BUILD_DIR" >&2; fi
  fi
}
trap cleanup_build EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf '%s\n' "$$" > "$LOCK_DIR/pid"
BUILD_DIR="$(mktemp -d "$ROOT_DIR/.cache/publication.XXXXXX")"
OUTPUT_DIR="$BUILD_DIR/output"
WORK_DIR="$BUILD_DIR/work"
mkdir -p "$OUTPUT_DIR/dist" "$WORK_DIR"
HTML_OUT="$OUTPUT_DIR/index.html"
DIST_DIR="$OUTPUT_DIR/dist"
PDF_OUT="$DIST_DIR/dionysus-program.pdf"
PRINT_PDF_OUT="$DIST_DIR/dionysus-program-print.pdf"
EPUB_OUT="$DIST_DIR/dionysus-program.epub"
KPF_OUT="$DIST_DIR/dionysus-program.kpf"
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
PULL_QUOTES_SCRIPT="$ROOT_DIR/build-pull-quotes.js"
PULL_QUOTES_JSON="$ROOT_DIR/pull-quotes.json"
PULL_QUOTES_HTML="$OUTPUT_DIR/pull-quotes.html"
PULL_QUOTES_RENDER_SCRIPT="$ROOT_DIR/render-pull-quotes-images.js"
PULL_QUOTES_IMAGES_DIR="$DIST_DIR/pull-quotes"
PRAISE_SCRIPT="$ROOT_DIR/build-praise.js"
PRAISE_JSON="$ROOT_DIR/praise.json"
PRAISE_MD="$DIST_DIR/praise.md"
PRAISE_HTML="$OUTPUT_DIR/praise.html"
PRAISE_META="$DIST_DIR/praise-rotator.yaml"
NOTES_SCRIPT="$ROOT_DIR/build-notes.js"
NOTES_CONTENT_DIR="$ROOT_DIR/content/notes"
NOTES_TEMPLATE="$ROOT_DIR/templates/notes-page.html"
NOTES_OUT_DIR="$OUTPUT_DIR/notes"
NOTES_TEASER_META="$DIST_DIR/notes-teaser.yaml"
PRINT_FILTER="$ROOT_DIR/filters/print.lua"
PUBLICATION_DETAILS_FILTER="$ROOT_DIR/filters/publication-details.lua"
LLM_CONTEXT_TXT="$ROOT_DIR/dist/dionysus-program-context.txt"
LLM_CONTEXT_SCRIPT="$ROOT_DIR/build-llm-context.js"
LLM_CONTEXT_JS="$DIST_DIR/llm-context.js"
PUBLISH_META="$DIST_DIR/.publish-metadata.yaml"
REVISION_DETAILS="$DIST_DIR/source-revision.txt"

PUBLISH_REVISION_FULL=""
PUBLISH_REVISION_SHORT=""
PUBLISHED_AT_UTC=""
PUBLISHED_AT_ISO=""
check_rights_year() {
  local current_year line start_year end_year new_rights
  current_year="$(date +%Y)"
  line="$(grep -m1 '^rights:' "$ESSAY_MD" || true)"
  if [[ -z "$line" ]]; then
    return
  fi
  if [[ "$line" =~ ([0-9]{4})([–-]([0-9]{4}))? ]]; then
    start_year="${BASH_REMATCH[1]}"
    end_year="${BASH_REMATCH[3]}"
    if [[ -z "$end_year" ]]; then
      end_year="$start_year"
    fi
    if (( current_year > end_year )); then
      end_year="$current_year"
    fi
    if [[ "$start_year" == "$end_year" ]]; then
      new_rights="rights: \"© ${start_year}. All rights reserved.\""
    else
      new_rights="rights: \"© ${start_year}–${end_year}. All rights reserved.\""
    fi
    if [[ "$line" != "$new_rights" ]]; then
      echo "Update essay.md rights metadata to $new_rights and commit the source before publishing." >&2
      exit 1
    fi
  fi
}

write_publish_metadata() {
  local revision_full revision_short published_at_utc published_at_iso

  if ! git -C "$ROOT_DIR" rev-parse HEAD >/dev/null 2>&1; then
    : > "$PUBLISH_META"
    : > "$REVISION_DETAILS"
    return
  fi

  revision_full="$(git -C "$ROOT_DIR" rev-parse HEAD)"
  revision_short="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
  published_at_utc="$(date -u '+%Y-%m-%d %H:%M UTC')"
  published_at_iso="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

  PUBLISH_REVISION_FULL="$revision_full"
  PUBLISH_REVISION_SHORT="$revision_short"
  PUBLISHED_AT_UTC="$published_at_utc"
  PUBLISHED_AT_ISO="$published_at_iso"

  cat > "$PUBLISH_META" <<EOF
source-revision: "$revision_full"
source-revision-short: "$revision_short"
published-at-utc: "$published_at_utc"
published-at-iso: "$published_at_iso"
EOF

  cat > "$REVISION_DETAILS" <<EOF
commit=${revision_full}
short=${revision_short}
published_at_utc=${published_at_utc}
published_at_iso=${published_at_iso}
EOF
}

copy_published_markdown() {
  local target_file="$1"

  cp "$ESSAY_MD" "$target_file"

  if [[ ! -s "$PUBLISH_META" ]]; then
    return
  fi

  awk \
    -v revision_full="$PUBLISH_REVISION_FULL" \
    -v revision_short="$PUBLISH_REVISION_SHORT" \
    -v published_at_utc="$PUBLISHED_AT_UTC" \
    -v published_at_iso="$PUBLISHED_AT_ISO" \
    'NR == 1 && $0 == "---" { in_frontmatter = 1; print; next }
     in_frontmatter && $0 == "---" {
       print "source-revision: \"" revision_full "\""
       print "source-revision-short: \"" revision_short "\""
       print "published-at-utc: \"" published_at_utc "\""
       print "published-at-iso: \"" published_at_iso "\""
       print
       in_frontmatter = 0
       next
     }
     { print }' "$target_file" > "$target_file.tmp" && mv "$target_file.tmp" "$target_file"
}

# Exercise the actual toolchain before generating any publication outputs.
for tool_name in node xelatex unzip pdftotext; do
  command -v "$tool_name" >/dev/null || { echo "Required tool missing: $tool_name" >&2; exit 1; }
done
check_rights_year
printf '%s\n' '---' 'title: Build preflight' 'lang: en-US' '---' '' '## Probe' '' '| Left | Right |' '| --- | --- |' '| Reality | Correction |' > "$WORK_DIR/probe.md"
pandoc "$WORK_DIR/probe.md" --standalone --pdf-engine=xelatex \
  --template="$ROOT_DIR/templates/pdf.tex" --output="$WORK_DIR/probe.pdf" >"$WORK_DIR/pdf-preflight.log" 2>&1 || {
    cat "$WORK_DIR/pdf-preflight.log" >&2; exit 1;
  }
pdftotext "$WORK_DIR/probe.pdf" "$WORK_DIR/probe.txt"
if [[ $SKIP_KPF == 0 ]]; then
  find_kindle_previewer
  kindle_help="$("$KINDLE_PREVIEWER_BIN" -help 2>&1)" || { echo "$kindle_help" >&2; exit 1; }
  if [[ "$kindle_help" == *--convert* ]]; then
    KINDLE_CONVERT_FLAG=--convert; KINDLE_OUTPUT_FLAG=--output
  else
    KINDLE_CONVERT_FLAG=-convert; KINDLE_OUTPUT_FLAG=-output
  fi
  KINDLE_VERSION="$(printf '%s\n' "$kindle_help" | sed -n 's/.*Kindle Previewer \([0-9][0-9.]*\).*/\1/p' | head -1)"
  pandoc "$WORK_DIR/probe.md" --to=epub3 --output="$WORK_DIR/probe.epub"
  convert_kpf "$WORK_DIR/probe.epub" "$WORK_DIR/probe.kpf" "$WORK_DIR/kindle-preflight"
else
  KINDLE_VERSION=skipped
  echo "KPF explicitly excluded. On success, any old published KPF will be removed."
fi
node "$PULL_QUOTES_RENDER_SCRIPT" --check
echo "Preflight passed: Pandoc $PANDOC_VERSION, XeLaTeX, browser, Kindle $KINDLE_VERSION."
if [[ $CHECK_ONLY == 1 ]]; then exit 0; fi
write_publish_metadata

node "$PRAISE_SCRIPT" "$PRAISE_JSON" "$PRAISE_MD" "$PRAISE_META"
echo "Wrote praise markdown to $PRAISE_MD"

node "$NOTES_SCRIPT" "$NOTES_CONTENT_DIR" "$NOTES_OUT_DIR" "$NOTES_TEMPLATE" "$NOTES_TEASER_META"
echo "Wrote notes site to $NOTES_OUT_DIR"

node "$LETTERS_SCRIPT" "$DIST_DIR"
node "$INDEX_SCRIPT" "$DIST_DIR" "$ESSAY_MD" "$KEYWORDS_TXT" "$LETTERS_APPENDIX" "$SOURCES_MD"
node "$PULL_QUOTES_SCRIPT" "$PULL_QUOTES_JSON" "$PULL_QUOTES_HTML"
echo "Wrote pull quotes HTML to $PULL_QUOTES_HTML"

node "$PULL_QUOTES_RENDER_SCRIPT" "$PULL_QUOTES_IMAGES_DIR" "$PULL_QUOTES_HTML"

BOOK_INPUTS=(
  "$ESSAY_MD"
  "$LETTERS_APPENDIX"
  "$SOURCES_MD"
  "$INDEX_APPENDIX"
)

BOOK_METADATA_ARGS=()
if [[ -s "$PUBLISH_META" ]]; then
  BOOK_METADATA_ARGS+=("--metadata-file=$PUBLISH_META")
fi

node "$ROOT_DIR/build-plan-of-attack.js" "$OUTPUT_DIR"

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
  "${BOOK_METADATA_ARGS[@]}" \
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

copy_published_markdown "$DIST_DIR/essay.md"
echo "Copied Markdown to $DIST_DIR/essay.md"

node "$ABOUT_PROGRAM_SCRIPT" "$ESSAY_MD" "$ABOUT_PROGRAM_OUT"
echo "Copied About the Program to $ABOUT_PROGRAM_OUT"

if [[ -f "$LLM_CONTEXT_TXT" ]]; then
  node "$LLM_CONTEXT_SCRIPT" "$LLM_CONTEXT_TXT" "$LLM_CONTEXT_JS"
fi

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

pandoc "${BOOK_INPUTS[@]}" \
  --from=markdown \
  --toc \
  --toc-depth=3 \
  --metadata=toc-title:"Contents" \
  "${BOOK_METADATA_ARGS[@]}" \
  --to=epub3 \
  --split-level=3 \
  --css="$EPUB_CSS" \
  --epub-cover-image="$EPUB_COVER" \
  --lua-filter="$ROOT_DIR/filters/add-classes.lua" \
  --lua-filter="$ROOT_DIR/filters/remove-simulation-links.lua" \
  --lua-filter="$ROOT_DIR/filters/remove-title.lua" \
  --lua-filter="$PUBLICATION_DETAILS_FILTER" \
  --output="$EPUB_OUT"

echo "Wrote EPUB to $EPUB_OUT"

if [[ $SKIP_KPF == 0 ]]; then
  convert_kpf "$EPUB_OUT" "$KPF_OUT" "$WORK_DIR/kindle-book"
  echo "Wrote KPF to $KPF_OUT"
fi

PDF_ENGINE=xelatex
pandoc "${BOOK_INPUTS[@]}" \
  --from=markdown \
  --toc \
  --toc-depth=3 \
  --metadata=toc-title:"Contents" \
  "${BOOK_METADATA_ARGS[@]}" \
  --pdf-engine="$PDF_ENGINE" \
  --standalone \
  --lua-filter="$ROOT_DIR/filters/add-classes.lua" \
  --lua-filter="$ROOT_DIR/filters/remove-simulation-links.lua" \
  --lua-filter="$ROOT_DIR/filters/remove-title.lua" \
  --lua-filter="$ROOT_DIR/filters/pdf.lua" \
  --template="$ROOT_DIR/templates/pdf.tex" \
  --output="$PDF_OUT"
echo "Wrote PDF to $PDF_OUT (via $PDF_ENGINE)"

pandoc "${BOOK_INPUTS[@]}" \
  --from=markdown \
  --toc \
  --toc-depth=3 \
  --metadata=toc-title:"Contents" \
  --metadata=print:true \
  "${BOOK_METADATA_ARGS[@]}" \
  --pdf-engine="$PDF_ENGINE" \
  --standalone \
  --lua-filter="$ROOT_DIR/filters/add-classes.lua" \
  --lua-filter="$ROOT_DIR/filters/remove-simulation-links.lua" \
  --lua-filter="$ROOT_DIR/filters/remove-title.lua" \
  --lua-filter="$ROOT_DIR/filters/pdf.lua" \
  --lua-filter="$PRINT_FILTER" \
  --template="$ROOT_DIR/templates/pdf.tex" \
  --output="$PRINT_PDF_OUT"
echo "Wrote print PDF to $PRINT_PDF_OUT (via $PDF_ENGINE)"

rm -f "$PUBLISH_META"
node "$ROOT_DIR/scripts/publish-artifacts.js" "$OUTPUT_DIR" "$ROOT_DIR" "$SKIP_KPF" "$PANDOC_VERSION" "$KINDLE_VERSION"
echo "Published validated outputs from $PUBLISH_REVISION_SHORT."
