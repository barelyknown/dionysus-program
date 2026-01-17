#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

build_mode="auto"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build)
      build_mode="always"
      shift
      ;;
    --no-build)
      build_mode="off"
      shift
      ;;
    --auto-build)
      build_mode="auto"
      shift
      ;;
    -h|--help)
      echo "Usage: ./agent/check.sh [--build|--no-build|--auto-build]" >&2
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: ./agent/check.sh [--build|--no-build|--auto-build]" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f package.json ]]; then
  echo "package.json not found; cannot run checks." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to run checks. Install Node.js first." >&2
  exit 1
fi

has_script() {
  local script_name="$1"
  node -e "const pkg=require('./package.json');process.exit(pkg.scripts && pkg.scripts[\"${script_name}\"] ? 0 : 1)" >/dev/null 2>&1
}

run_build_if_enabled() {
  if [[ "$build_mode" == "off" ]]; then
    echo "Skipping build (disabled)."
    return
  fi

  if [[ ! -x ./build.sh ]]; then
    if [[ "$build_mode" == "always" ]]; then
      echo "build.sh not found or not executable." >&2
      exit 1
    fi
    echo "Skipping build (build.sh not found)."
    return
  fi

  if ! command -v pandoc >/dev/null 2>&1; then
    if [[ "$build_mode" == "always" ]]; then
      echo "pandoc is required to run build.sh but is not installed." >&2
      exit 1
    fi
    echo "Skipping build (pandoc not installed)."
    return
  fi

  echo "Running build.sh..."
  ./build.sh
}

run_if_present() {
  local script_name="$1"
  if has_script "$script_name"; then
    echo "Running ${script_name}..."
    npm run -s "$script_name"
  else
    echo "Skipping ${script_name} (script not defined)."
  fi
}

run_build_if_enabled

run_if_present "lint"
run_if_present "typecheck"

if has_script "test:unit"; then
  run_if_present "test:unit"
elif has_script "test"; then
  run_if_present "test"
else
  echo "Skipping unit tests (no test or test:unit script)."
fi

if has_script "test:e2e"; then
  run_if_present "test:e2e"
else
  echo "Missing test:e2e script; Playwright tests are required." >&2
  exit 1
fi
