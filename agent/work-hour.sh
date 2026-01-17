#!/usr/bin/env bash
set -euo pipefail

minutes="${1:-60}"
pause_mode="no-pause"
interval_seconds=0
between_seconds=0
build_mode="auto"

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-pause)
      pause_mode="no-pause"
      shift
      ;;
    --pause)
      pause_mode="pause"
      shift
      ;;
    --interval)
      interval_seconds="${2:-0}"
      shift 2
      ;;
    --between)
      between_seconds="${2:-0}"
      shift 2
      ;;
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
      echo "Usage: ./agent/work-hour.sh [minutes] [--pause|--no-pause] [--interval seconds] [--between seconds] [--build|--no-build|--auto-build]" >&2
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: ./agent/work-hour.sh [minutes] [--pause|--no-pause] [--interval seconds] [--between seconds] [--build|--no-build|--auto-build]" >&2
      exit 1
      ;;
  esac
done

if ! [[ "$minutes" =~ ^[0-9]+$ ]]; then
  echo "Usage: ./agent/work-hour.sh [minutes] [--pause|--no-pause] [--interval seconds] [--between seconds] [--build|--no-build|--auto-build]" >&2
  exit 1
fi

if ! [[ "$interval_seconds" =~ ^[0-9]+$ ]]; then
  echo "--interval must be a whole number of seconds." >&2
  exit 1
fi

if ! [[ "$between_seconds" =~ ^[0-9]+$ ]]; then
  echo "--between must be a whole number of seconds." >&2
  exit 1
fi

build_flag="--auto-build"
case "$build_mode" in
  always)
    build_flag="--build"
    ;;
  off)
    build_flag="--no-build"
    ;;
  auto)
    build_flag="--auto-build"
    ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

start_epoch=$(date +%s)
deadline=$((start_epoch + minutes * 60))
iteration=1

mkdir -p agent/artifacts

echo "Starting ${minutes}-minute work loop at $(date)."
echo "Rubric: agent/rubric.md"

timestamp() {
  date +%Y%m%d-%H%M%S
}

handle_interrupt() {
  echo "Interrupted. Exiting work loop."
  exit 130
}

trap handle_interrupt INT TERM

while [[ $(date +%s) -lt $deadline ]]; do
  iter_stamp="$(timestamp)"
  iter_dir="agent/artifacts/${iter_stamp}-iter-${iteration}"
  mkdir -p "$iter_dir"

  echo "" | tee "$iter_dir/notes.md" >/dev/null
  echo "Iteration ${iteration} started at $(date)." | tee "$iter_dir/iteration.log"
  echo "Running pre-change checks..."
  if ./agent/check.sh "$build_flag" >"$iter_dir/check-pre.log" 2>&1; then
    echo "Pre-change checks: PASS" | tee -a "$iter_dir/iteration.log"
  else
    check_status=$?
    if [[ "$check_status" -eq 130 || "$check_status" -eq 143 ]]; then
      echo "Pre-change checks interrupted." | tee -a "$iter_dir/iteration.log"
      exit 130
    fi
    echo "Pre-change checks: FAIL (see $iter_dir/check-pre.log)" | tee -a "$iter_dir/iteration.log"
  fi

  echo "" | tee -a "$iter_dir/iteration.log" >/dev/null
  echo "Pick ONE high-leverage improvement (design or functionality)." | tee -a "$iter_dir/iteration.log"
  if [[ "$pause_mode" == "pause" ]]; then
    echo "Describe the improvement in $iter_dir/notes.md, then implement it." | tee -a "$iter_dir/iteration.log"
    read -r -p "Press Enter to continue once the improvement is implemented..." _
  else
    echo "Auto-run mode (no pause). Running Codex iteration if configured." | tee -a "$iter_dir/iteration.log"
    if [[ -x ./agent/iterate.sh ]]; then
      echo "Running agent/iterate.sh..." | tee -a "$iter_dir/iteration.log"
      if ITERATION_DIR="$iter_dir" \
        ITERATION_NOTES="$iter_dir/notes.md" \
        ITERATION_LOG="$iter_dir/iteration.log" \
        ITERATION_INDEX="$iteration" \
        ITERATION_MINUTES_REMAINING="$(( (deadline - $(date +%s) + 59) / 60 ))" \
        ./agent/iterate.sh >"$iter_dir/iterate.log" 2>&1; then
        echo "agent/iterate.sh completed." | tee -a "$iter_dir/iteration.log"
      else
        echo "agent/iterate.sh failed (see $iter_dir/iterate.log)." | tee -a "$iter_dir/iteration.log"
      fi
    else
      echo "No agent/iterate.sh found; no changes applied automatically." | tee -a "$iter_dir/iteration.log"
    fi
    if [[ "$between_seconds" -gt 0 ]]; then
      echo "Waiting ${between_seconds}s before post-change checks..." | tee -a "$iter_dir/iteration.log"
      sleep "$between_seconds"
    fi
  fi

  echo "Running post-change checks..."
  if ./agent/check.sh "$build_flag" >"$iter_dir/check-post.log" 2>&1; then
    echo "Post-change checks: PASS" | tee -a "$iter_dir/iteration.log"
  else
    check_status=$?
    if [[ "$check_status" -eq 130 || "$check_status" -eq 143 ]]; then
      echo "Post-change checks interrupted." | tee -a "$iter_dir/iteration.log"
      exit 130
    fi
    echo "Post-change checks: FAIL (see $iter_dir/check-post.log)" | tee -a "$iter_dir/iteration.log"
  fi

  echo "Iteration ${iteration} finished at $(date)." | tee -a "$iter_dir/iteration.log"
  iteration=$((iteration + 1))

  if [[ $(date +%s) -ge $deadline ]]; then
    break
  fi

  if [[ "$pause_mode" == "no-pause" && "$interval_seconds" -gt 0 ]]; then
    sleep "$interval_seconds"
  fi

done

echo "Work loop complete at $(date). Artifacts saved under agent/artifacts/."
