#!/usr/bin/env bash
# Install the tested native Pandoc without changing the system installation.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="${DIONYSUS_TOOLS_DIR:-$ROOT_DIR/.tools}"
VERSION=3.6.4
SHA256=88af17f1885afacb25f70ce4c8c44428feb6da860b6cf690e30da77998456c7f
TARGET="$TOOLS_DIR/pandoc-$VERSION"
if [[ -x "$TARGET/bin/pandoc" ]] && [[ "$("$TARGET/bin/pandoc" --version | head -1)" == "pandoc $VERSION" ]]; then
  echo "Pandoc $VERSION is ready at $TARGET/bin/pandoc"
  exit 0
fi
if [[ "$(uname -s)-$(uname -m)" != Darwin-arm64 ]]; then
  echo "Automatic setup supports Apple Silicon macOS. Install native Pandoc $VERSION and set PANDOC_BIN to its absolute path." >&2
  exit 1
fi
mkdir -p "$TOOLS_DIR"
TEMP_DIR="$(mktemp -d "$TOOLS_DIR/.pandoc-install.XXXXXX")"
trap 'rm -rf "$TEMP_DIR"' EXIT
curl --fail --location --retry 3 --output "$TEMP_DIR/pandoc.zip" \
  "https://github.com/jgm/pandoc/releases/download/$VERSION/pandoc-$VERSION-arm64-macOS.zip"
printf '%s  %s\n' "$SHA256" "$TEMP_DIR/pandoc.zip" | shasum -a 256 -c -
unzip -q "$TEMP_DIR/pandoc.zip" -d "$TEMP_DIR"
"$TEMP_DIR/pandoc-$VERSION-arm64/bin/pandoc" --version
# Keep an existing installation intact unless the replacement has been verified.
if [[ -e "$TARGET" ]]; then
  mv "$TARGET" "$TEMP_DIR/previous"
fi
mv "$TEMP_DIR/pandoc-$VERSION-arm64" "$TARGET"
echo "Installed Pandoc $VERSION at $TARGET/bin/pandoc"
