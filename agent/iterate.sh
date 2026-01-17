#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

iteration_dir="${ITERATION_DIR:-}";
notes_file="${ITERATION_NOTES:-}"
log_file="${ITERATION_LOG:-}"

if [[ -z "$iteration_dir" ]]; then
  echo "ITERATION_DIR is required." >&2
  exit 1
fi

if [[ -z "$notes_file" ]]; then
  notes_file="$iteration_dir/notes.md"
fi

codex_cmd="${CODEX_CMD:-codex}"
if ! command -v "$codex_cmd" >/dev/null 2>&1; then
  echo "codex CLI not found on PATH." >&2
  exit 127
fi

prompt_file="$iteration_dir/codex-prompt.md"

inspect_format="${INSPECT_FORMAT:-png}"
case "$inspect_format" in
  jpg|jpeg)
    inspect_ext="jpg"
    ;;
  png|"")
    inspect_ext="png"
    ;;
  *)
    inspect_ext="png"
    ;;
esac

inspect_image="$iteration_dir/inspect.${inspect_ext}"
inspect_manifest="$iteration_dir/inspect-manifest.json"
inspect_config="${INSPECT_CONFIG:-$repo_root/agent/inspect.json}"

inspect_status="skipped"
if command -v node >/dev/null 2>&1 && node -e "require('playwright')" >/dev/null 2>&1; then
  if [[ -f "$inspect_config" ]]; then
    if node "$repo_root/agent/inspect.js" "$iteration_dir" "$inspect_config" >/dev/null 2>&1; then
      inspect_status="ok"
    else
      inspect_status="failed"
    fi
  elif node "$repo_root/agent/inspect.js" "$iteration_dir" >/dev/null 2>&1; then
    inspect_status="ok"
  else
    inspect_status="failed"
  fi
fi

{
  echo "You are Codex running in: $repo_root"
  echo "Goal: make ONE cohesive improvement (design or functionality) per iteration."
  echo "Consult agent/rubric.md for the 50/50 design/functionality rubric."
  echo "Do NOT edit generated files in dist/ or index.html directly; edit sources like essay.md, styles.css, templates/, filters/."
  echo "Do NOT run ./agent/check.sh; the loop handles checks."
  echo "Record what you changed in: $notes_file"
  echo "If an image is attached, use it to identify issues."
  echo
  if [[ -f "$repo_root/agent/iterate.md" ]]; then
    cat "$repo_root/agent/iterate.md"
  fi
} > "$prompt_file"

exec_flags="${CODEX_EXEC_FLAGS:---dangerously-bypass-approvals-and-sandbox}"
read -r -a exec_flag_array <<< "$exec_flags"

args=(exec "${exec_flag_array[@]}" -C "$repo_root" --output-last-message "$iteration_dir/codex-message.txt")

if [[ -n "${CODEX_MODEL:-}" ]]; then
  args+=(--model "$CODEX_MODEL")
fi

if [[ -n "${CODEX_PROFILE:-}" ]]; then
  args+=(--profile "$CODEX_PROFILE")
fi

if [[ -n "${CODEX_OSS_PROVIDER:-}" ]]; then
  args+=(--oss --local-provider "$CODEX_OSS_PROVIDER")
fi

if [[ -n "${CODEX_CONFIG:-}" ]]; then
  args+=(-c "$CODEX_CONFIG")
fi

if [[ -n "${CODEX_ARGS:-}" ]]; then
  # shellcheck disable=SC2206
  extra_args=($CODEX_ARGS)
  args+=("${extra_args[@]}")
fi

if [[ "$inspect_status" == "ok" && -f "$inspect_manifest" ]]; then
  while IFS= read -r image_path; do
    if [[ -n "$image_path" && -f "$image_path" ]]; then
      args+=(-i "$image_path")
    fi
  done < <(node -e "const m=require('${inspect_manifest}');(m.captures||[]).forEach(c=>console.log(c.path));")
elif [[ "$inspect_status" == "ok" && -f "$inspect_image" ]]; then
  args+=(-i "$inspect_image")
fi

if [[ -n "$log_file" ]]; then
  echo "Iterate: running codex CLI (inspect=${inspect_status})." | tee -a "$log_file"
fi

"$codex_cmd" "${args[@]}" - < "$prompt_file"
