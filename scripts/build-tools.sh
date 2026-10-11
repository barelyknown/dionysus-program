#!/usr/bin/env bash
# Sourced by build scripts after ROOT_DIR has been set.
PANDOC_VERSION=3.6.4
PANDOC_BIN="${PANDOC_BIN:-${DIONYSUS_TOOLS_DIR:-$ROOT_DIR/.tools}/pandoc-$PANDOC_VERSION/bin/pandoc}"
if [[ "$PANDOC_BIN" != /* || "${PANDOC_BIN##*/}" != pandoc || ! -x "$PANDOC_BIN" ]]; then
  echo "Pinned Pandoc is missing. Run ./scripts/setup-build-tools.sh (or set PANDOC_BIN to an absolute path ending in /pandoc)." >&2
  exit 1
fi
if ! pandoc_version="$("$PANDOC_BIN" --version 2>&1)"; then
  echo "Pandoc cannot run: $PANDOC_BIN" >&2
  echo "$pandoc_version" >&2
  exit 1
fi
if [[ "${pandoc_version%%$'\n'*}" != "pandoc $PANDOC_VERSION" ]]; then
  echo "Expected Pandoc $PANDOC_VERSION; found ${pandoc_version%%$'\n'*}. Upgrade the pin only after verifying the book templates." >&2
  exit 1
fi
export PATH="$(dirname "$PANDOC_BIN"):$PATH"

find_kindle_previewer() {
  local candidate
  if [[ -n "${KINDLE_PREVIEWER_BIN:-}" ]]; then
    [[ -x "$KINDLE_PREVIEWER_BIN" ]] || { echo "KINDLE_PREVIEWER_BIN is not executable." >&2; return 1; }
    return
  fi
  # Prefer the current app over old wrappers pointing at Previewer 3.
  for candidate in \
    "$HOME/Applications/Kindle Previewer 4.app/Contents/MacOS/KindlePreviewer4CLI" \
    "/Applications/Kindle Previewer 4.app/Contents/MacOS/KindlePreviewer4CLI" \
    "$HOME/Applications/Kindle Previewer 3.app/Contents/MacOS/Kindle Previewer 3" \
    "/Applications/Kindle Previewer 3.app/Contents/MacOS/Kindle Previewer 3"
  do
    if [[ -x "$candidate" ]]; then KINDLE_PREVIEWER_BIN="$candidate"; return; fi
  done
  if command -v kindlepreviewer >/dev/null 2>&1; then
    KINDLE_PREVIEWER_BIN="$(command -v kindlepreviewer)"
    return
  fi
  echo "Kindle Previewer is required. Install Previewer 4, or use --skip-kpf explicitly." >&2
  return 1
}

convert_kpf() {
  local input="$1" output="$2" scratch="$3" result
  mkdir -p "$scratch"
  if ! "$KINDLE_PREVIEWER_BIN" "$input" "$KINDLE_CONVERT_FLAG" "$KINDLE_OUTPUT_FLAG" "$scratch" >"$scratch/conversion.log" 2>&1; then
    echo "Kindle conversion failed; see $scratch/conversion.log" >&2
    tail -20 "$scratch/conversion.log" >&2
    find "$scratch" -type f -name "*_log.csv" -exec cat {} \; >&2
    return 1
  fi
  result="$(find "$scratch" -type f -name '*.kpf' -print -quit)"
  if [[ -z "$result" || ! -s "$result" ]]; then
    echo "Kindle Previewer returned without a KPF; see $scratch/conversion.log" >&2
    tail -20 "$scratch/conversion.log" >&2
    find "$scratch" -type f -name "*_log.csv" -exec cat {} \; >&2
    return 1
  fi
  unzip -tq "$result" >/dev/null || { echo "Kindle Previewer produced an invalid KPF archive." >&2; return 1; }
  cp "$result" "$output"
}
