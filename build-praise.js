#!/usr/bin/env node
/**
 * Build praise markdown and homepage rotator metadata from praise.json.
 *
 * Usage: node build-praise.js [inputJson] [outputMd] [outputMeta]
 * Outputs:
 *   - <outputMd>
 *   - <outputMeta> (YAML for pandoc metadata)
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const inputPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'praise.json');
const outputMd = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(ROOT, 'dist', 'praise.md');
const outputMeta = process.argv[4]
  ? path.resolve(process.argv[4])
  : path.join(ROOT, 'dist', 'praise-rotator.yaml');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function collapseWhitespace(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeYaml(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function derivePull(text) {
  const cleaned = collapseWhitespace(text);
  if (!cleaned) return '';
  const sentence = cleaned.match(/^(.{0,200}?[.!?])\s/);
  if (sentence) return sentence[1];
  if (cleaned.length > 200) return `${cleaned.slice(0, 200).trim()}...`;
  return cleaned;
}

function appendEllipsis(text) {
  const trimmed = String(text).trim();
  if (!trimmed) return trimmed;
  if (trimmed.endsWith('...') || trimmed.endsWith('…')) return trimmed;
  if (trimmed.endsWith('.')) {
    return `${trimmed.slice(0, -1)}...`;
  }
  return `${trimmed}...`;
}

function toBlockquote(text) {
  const lines = String(text).split(/\r?\n/);
  return lines.map((line) => `> ${line}`).join('\n');
}

const raw = fs.readFileSync(inputPath, 'utf8');
let entries;
try {
  entries = JSON.parse(raw);
} catch (error) {
  console.error('Failed to parse praise JSON.');
  throw error;
}

if (!Array.isArray(entries)) {
  throw new Error('Praise JSON must be an array.');
}

entries.forEach((entry, index) => {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Praise entry ${index + 1} must be an object.`);
  }
  if (!entry.quote || !String(entry.quote).trim()) {
    throw new Error(`Praise entry ${index + 1} is missing a quote.`);
  }
  if (!entry.author || !String(entry.author).trim()) {
    throw new Error(`Praise entry ${index + 1} is missing an author.`);
  }
});

ensureDir(path.dirname(outputMd));
ensureDir(path.dirname(outputMeta));

const mdLines = [];
mdLines.push('---');
mdLines.push('title: "Praise"');
mdLines.push('description: "Endorsements for The Dionysus Program"');
mdLines.push('hide-copyright: true');
mdLines.push('---');
mdLines.push('');
mdLines.push('# Praise {#praise}');
mdLines.push('');
mdLines.push('::: praise-list');
mdLines.push('');

entries.forEach((entry) => {
  mdLines.push('::: praise-item');
  mdLines.push(toBlockquote(entry.quote));
  mdLines.push('');
  mdLines.push('::: praise-attribution');
  mdLines.push(`**${collapseWhitespace(entry.author)}**`);
  if (entry.role && String(entry.role).trim()) {
    mdLines.push(collapseWhitespace(entry.role));
  }
  mdLines.push(':::');
  mdLines.push(':::');
  mdLines.push('');
});

mdLines.push(':::');
mdLines.push('');

fs.writeFileSync(outputMd, `${mdLines.join('\n')}\n`, 'utf8');

const metaLines = [];
metaLines.push('praise:');

entries.forEach((entry) => {
  const pullText = entry.pull && String(entry.pull).trim()
    ? entry.pull
    : derivePull(entry.quote);
  const isExcerpt = collapseWhitespace(pullText) !== collapseWhitespace(entry.quote);
  const displayPull = isExcerpt ? appendEllipsis(pullText) : pullText;
  const quoteHtml = escapeYaml(escapeHtml(collapseWhitespace(displayPull)));
  const authorHtml = escapeYaml(escapeHtml(collapseWhitespace(entry.author)));
  const roleHtml = entry.role && String(entry.role).trim()
    ? escapeYaml(escapeHtml(collapseWhitespace(entry.role)))
    : '';
  metaLines.push('  - quote_html: "' + quoteHtml + '"');
  metaLines.push('    author_html: "' + authorHtml + '"');
  if (roleHtml) {
    metaLines.push('    role_html: "' + roleHtml + '"');
  }
});

fs.writeFileSync(outputMeta, `${metaLines.join('\n')}\n`, 'utf8');
