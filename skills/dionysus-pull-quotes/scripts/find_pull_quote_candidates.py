#!/usr/bin/env python3
"""Find candidate pull-quote sentences in text or Markdown files."""

import argparse
import json
import re
from pathlib import Path


def strip_frontmatter(lines):
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                return lines[i + 1 :]
        return []
    return lines


def in_code_fence(line, in_fence):
    if line.strip().startswith("```"):
        return not in_fence
    return in_fence


def filter_section(lines, section_title):
    heading_re = re.compile(r"^(#{1,6})\s+(.*)\s*$")
    level = None
    collecting = False
    out = []
    for line in lines:
        match = heading_re.match(line)
        if match:
            current_level = len(match.group(1))
            title = match.group(2).strip().lower()
            if collecting and current_level <= level:
                break
            if title == section_title.lower():
                collecting = True
                level = current_level
                continue
        if collecting:
            out.append(line)
    return out


def clean_lines(lines):
    cleaned = []
    in_fence = False
    for line in lines:
        in_fence = in_code_fence(line, in_fence)
        if in_fence:
            continue
        stripped = line.strip()
        if not stripped:
            cleaned.append("")
            continue
        if stripped.startswith("#"):
            continue
        if stripped.startswith(":::"):
            continue
        cleaned.append(stripped)
    return cleaned


def to_paragraphs(lines):
    paragraphs = []
    current = []
    for line in lines:
        if line == "":
            if current:
                paragraphs.append(" ".join(current))
                current = []
            continue
        current.append(line)
    if current:
        paragraphs.append(" ".join(current))
    return paragraphs


def split_sentences(text):
    sentence_re = re.compile(r"(?<=[.!?])\s+")
    return [sentence.strip() for sentence in sentence_re.split(text) if sentence.strip()]


def word_count(sentence):
    return len(re.findall(r"[A-Za-z0-9']+", sentence))


def main():
    parser = argparse.ArgumentParser(description="Find candidate pull-quote sentences.")
    parser.add_argument("--file", required=True, help="Path to the source file")
    parser.add_argument("--section", help="Exact markdown heading title to scope to")
    parser.add_argument("--min-words", type=int, default=8)
    parser.add_argument("--max-words", type=int, default=28)
    parser.add_argument("--limit", type=int, default=80)
    parser.add_argument("--json", action="store_true", help="Output JSON array")
    args = parser.parse_args()

    path = Path(args.file)
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    lines = strip_frontmatter(lines)
    if args.section:
        lines = filter_section(lines, args.section)
    lines = clean_lines(lines)
    paragraphs = to_paragraphs(lines)

    candidates = []
    for paragraph in paragraphs:
        for sentence in split_sentences(paragraph):
            wc = word_count(sentence)
            if args.min_words <= wc <= args.max_words:
                candidates.append({"words": wc, "sentence": sentence})

    if args.limit > 0:
        candidates = candidates[: args.limit]

    if args.json:
        print(json.dumps(candidates, ensure_ascii=False, indent=2))
        return

    for idx, item in enumerate(candidates, start=1):
        print(f"{idx}\t{item['words']}\t{item['sentence']}")


if __name__ == "__main__":
    main()
