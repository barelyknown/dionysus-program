---
name: skill-candidate-miner
description: Analyze Codex session logs or history.jsonl to propose new skills. Use when asked to mine past sessions, identify repeated workflows, or generate a shortlist of candidate skills and required resources.
---

# Skill Candidate Miner

## Overview
Scan Codex logs to find repeated workflows, commands, and file patterns, then propose skill candidates using the rubric.

## Workflow
1. Ask for explicit permission and scope before reading logs.
2. Run `scripts/scan_codex_logs.py` with the provided paths, `--skills` roots, and optional `--cwd` filter.
3. Summarize findings (top commands, files, repeated requests) without quoting sensitive content.
4. Deduplicate against existing skills listed in the report.
5. Propose skill candidates using `references/rubric.md`, merging or extending existing skills where appropriate.
5. For each candidate, specify name, triggers, workflow, and suggested resources.

## Resources
- `scripts/scan_codex_logs.py` for log scanning.
- `references/rubric.md` for candidate selection criteria and output format.
