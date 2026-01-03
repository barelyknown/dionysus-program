#!/usr/bin/env python3
"""Scan Codex logs to surface repeated patterns for skill candidates.

Outputs a concise markdown report with top commands, files, and user request phrases.
"""
import argparse
import json
import os
import re
from collections import Counter
from pathlib import Path

FILE_EXT_RE = re.compile(r"(/[A-Za-z0-9._\-]+)+\.(md|js|ts|css|html|json|yaml|yml|pdf|epub)")
WORD_RE = re.compile(r"[a-z0-9]+")


def _strip_quotes(value):
    if not value:
        return value
    value = value.strip()
    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        return value[1:-1]
    return value


def iter_strings(obj, key_hint=None):
    """Yield string values from nested dict/list structures."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, str):
                yield k, v
            else:
                yield from iter_strings(v, k)
    elif isinstance(obj, list):
        for v in obj:
            yield from iter_strings(v, key_hint)


def load_jsonl(path):
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def contains_cwd(obj, cwd_filter):
    if isinstance(obj, dict):
        if obj.get("cwd") == cwd_filter:
            return True
        for value in obj.values():
            if contains_cwd(value, cwd_filter):
                return True
    elif isinstance(obj, list):
        for value in obj:
            if contains_cwd(value, cwd_filter):
                return True
    return False


def session_file_matches_cwd(path, cwd_filter):
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                payload = obj.get("payload", {})
                if isinstance(payload, dict) and payload.get("cwd") == cwd_filter:
                    return True
    except Exception:
        return False
    return False


def load_json_files(root, cwd_filter=None):
    for p in Path(root).rglob("*"):
        if p.suffix not in {".json", ".jsonl"}:
            continue
        if p.suffix == ".jsonl":
            if cwd_filter and not session_file_matches_cwd(p, cwd_filter):
                continue
            try:
                with open(p, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            yield json.loads(line)
                        except json.JSONDecodeError:
                            continue
            except Exception:
                continue
        else:
            try:
                obj = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue
            if cwd_filter and not contains_cwd(obj, cwd_filter):
                continue
            yield obj


def find_skills(roots):
    skills = []
    for root in roots:
        for path in Path(root).rglob("SKILL.md"):
            try:
                text = path.read_text(encoding="utf-8")
            except Exception:
                continue
            if not text.lstrip().startswith("---"):
                continue
            parts = text.split("---", 2)
            if len(parts) < 3:
                continue
            front = parts[1]
            name = None
            desc = None
            for line in front.splitlines():
                if line.startswith("name:"):
                    name = _strip_quotes(line.split(":", 1)[1].strip())
                elif line.startswith("description:"):
                    desc = _strip_quotes(line.split(":", 1)[1].strip())
            if name:
                skills.append({"name": name, "description": desc or "", "path": str(path)})
    return skills


def token_set(*values):
    tokens = set()
    for value in values:
        if not value:
            continue
        if isinstance(value, (list, tuple)):
            for v in value:
                tokens.update(WORD_RE.findall(str(v).lower()))
        else:
            tokens.update(WORD_RE.findall(str(value).lower()))
    return tokens


def extract(report, data, repo_root=None, cwd_filter=None):
    commands = report["commands"]
    files = report["files"]
    user_phrases = report["user_phrases"]

    if isinstance(data, dict):
        payload = data.get("payload", {})
        if isinstance(payload, dict):
            if cwd_filter and "cwd" in payload and payload.get("cwd") != cwd_filter:
                return
            if payload.get("type") == "function_call" and payload.get("name") == "shell_command":
                args_raw = payload.get("arguments")
                if isinstance(args_raw, str):
                    try:
                        args = json.loads(args_raw)
                    except Exception:
                        args = None
                    if isinstance(args, dict):
                        cmd = args.get("command")
                        if cmd:
                            commands[cmd.strip()] += 1
                            for m in FILE_EXT_RE.findall(cmd):
                                path = f"{m[0]}.{m[1]}"
                                if repo_root and path.startswith(repo_root + "/"):
                                    path = path.replace(repo_root + "/", "")
                                files[path] += 1

    for k, s in iter_strings(data):
        if not s:
            continue
        if k == "command":
            commands[s.strip()] += 1
        if k in {"text", "content", "message"} and isinstance(s, str):
            # naive user-phrase capture; avoid long strings
            if 4 <= len(s) <= 200:
                user_phrases[s.strip()] += 1
        for m in FILE_EXT_RE.findall(s):
            path = f"{m[0]}.{m[1]}"
            if repo_root:
                if repo_root in path:
                    path = path.replace(repo_root + "/", "")
            files[path] += 1


def write_report(report, limit=20):
    def top(counter):
        return counter.most_common(limit)

    lines = []
    lines.append("# Codex Log Scan Summary\n")
    if report.get("cwd_filter"):
        lines.append(f"Filtered to cwd: `{report['cwd_filter']}`\n")

    lines.append("## Top commands")
    for cmd, n in top(report["commands"]):
        lines.append(f"- {n}× `{cmd}`")

    lines.append("\n## Top files")
    for path, n in top(report["files"]):
        lines.append(f"- {n}× `{path}`")

    lines.append("\n## Repeated request phrases")
    for phrase, n in top(report["user_phrases"]):
        lines.append(f"- {n}× {phrase}")

    if report.get("skills"):
        lines.append("\n## Existing skills")
        for skill in report["skills"]:
            desc = skill.get("description") or ""
            if len(desc) > 140:
                desc = desc[:137] + "..."
            lines.append(f"- `{skill['name']}` — {desc}")

    if report.get("skill_overlaps"):
        lines.append("\n## Potential overlaps with existing skills")
        for score, name, overlaps in report["skill_overlaps"]:
            overlap_text = ", ".join(overlaps)
            lines.append(f"- {score}× `{name}` (tokens: {overlap_text})")

    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--history", help="Path to history.jsonl", default=None)
    ap.add_argument("--sessions", help="Path to sessions directory", default=None)
    ap.add_argument("--repo", help="Repo root to shorten paths", default=None)
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--cwd", help="Only include sessions with this cwd", default=None)
    ap.add_argument(
        "--skills",
        action="append",
        help="Path(s) to skills roots to scan for SKILL.md",
        default=[],
    )
    args = ap.parse_args()

    report = {
        "commands": Counter(),
        "files": Counter(),
        "user_phrases": Counter(),
        "skills": [],
        "skill_overlaps": [],
        "cwd_filter": args.cwd,
    }

    if args.history and os.path.exists(args.history):
        for entry in load_jsonl(args.history):
            if args.cwd and args.cwd not in json.dumps(entry, ensure_ascii=False):
                continue
            extract(report, entry, repo_root=args.repo, cwd_filter=args.cwd)

    if args.sessions and os.path.exists(args.sessions):
        for entry in load_json_files(args.sessions, cwd_filter=args.cwd):
            extract(report, entry, repo_root=args.repo, cwd_filter=args.cwd)

    if args.skills:
        report["skills"] = find_skills(args.skills)
        observed_tokens = token_set(
            list(report["commands"].keys()),
            list(report["files"].keys()),
        )
        overlaps = []
        for skill in report["skills"]:
            skill_tokens = token_set(skill["name"], skill.get("description", ""))
            common = sorted(observed_tokens & skill_tokens)
            if common:
                overlaps.append((len(common), skill["name"], common[:6]))
        overlaps.sort(reverse=True)
        report["skill_overlaps"] = overlaps[: args.limit]

    print(write_report(report, limit=args.limit))


if __name__ == "__main__":
    main()
