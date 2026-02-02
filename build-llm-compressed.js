#!/usr/bin/env node
/**
 * Build an LLM-compressed, ultra-dense plain-text version of the Dionysus Program.
 *
 * Smart pipeline:
 * 1) Build appendices (letters).
 * 2) Use pandoc + Lua filter to emit plain text with TOC markers.
 * 3) Split by TOC (H1/H2) into sections; split Appendix B per archetype and Letters appendix per letter.
 * 4) Use "About the Program" as anchor context to derive a global lexicon.
 * 5) Compress each section with GPT-5.2 (Responses API, reasoning high), aggressive targets.
 * 6) Final merge pass to tighten output (single-pass if it fits).
 *
 * Usage:
 *   node build-llm-compressed.js
 *   node build-llm-compressed.js --model gpt-5.2 --reasoning high
 *   node build-llm-compressed.js --max-chars 14000
 *
 * Env vars:
 *   OPENAI_API_KEY, OPENAI_MODEL, OPENAI_API_URL
 *   OPENAI_REASONING_EFFORT, OPENAI_MAX_CHARS, OPENAI_ABOUT_MAX_CHARS
 *   OPENAI_OUT_FILE
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const DIST_DIR = path.join(ROOT, 'dist');
const ESSAY_MD = path.join(ROOT, 'essay.md');
const LETTERS_SCRIPT = path.join(ROOT, 'build-letters-to-editor.js');
const LETTERS_APPENDIX = path.join(DIST_DIR, 'letters-to-editor-appendix.md');
const SOURCES_MD = path.join(ROOT, 'appendix-sources.md');
const KEYWORDS_TXT = path.join(ROOT, 'keywords.txt');

const DEFAULT_API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-5.2';
const DEFAULT_REASONING = 'high';
const DEFAULT_ABOUT_MAX_CHARS = 8000;
const DEFAULT_MERGE_MAX_CHARS = 24000;
const DEFAULT_MERGE_MAX_PASSES = 1;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_TARGET_RATIO = 0.25;
const DEFAULT_TARGET_RATIO_LOSSY = 0.07;
const DEFAULT_MERGE_TARGET_RATIO = 1.0;
const DEFAULT_MAX_REFINES = 2;
const DEFAULT_MIN_TARGET_TOKENS_CORE = 512;
const DEFAULT_MIN_TARGET_TOKENS_LOSSY = 192;
const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_MERGE_TIMEOUT_MS = 600000;
const DEFAULT_CANONICAL_URL = 'https://www.dionysusprogram.com';
const DEFAULT_CTX_MAX_CHARS = 600;
const DEFAULT_CTX_MAX_TOKENS = 400;
const DEFAULT_CTX_INPUT_MAX_CHARS = 60000;
const DEFAULT_MERGE_CHUNK_TOKENS = 12000;
const CACHE_DIR = path.join(ROOT, '.cache');
const CACHE_PATH = path.join(CACHE_DIR, 'llm-compress-cache.json');

const MARKER_PREFIX = '[[[SECTION|';
const MARKER_REGEX = /^\[\[\[SECTION\|(\d+)\|(.+)\]\]\]$/;

const BASE_SYMBOLS = [
  { sym: '&', full: 'and' },
  { sym: 'w/', full: 'with' },
  { sym: 'w/o', full: 'without' },
  { sym: 'b/c', full: 'because' },
  { sym: '->', full: 'leads to' },
  { sym: '<-', full: 'caused by' },
  { sym: '=>', full: 'implies' },
  { sym: '<=', full: 'less than or equal to' },
  { sym: '>=', full: 'greater than or equal to' },
  { sym: '!=', full: 'not equal' },
  { sym: '~', full: 'approximately' },
];

function parseArgs(argv) {
  const out = { flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') {
      out.flags.add('help');
      continue;
    }
    if (arg === '--dry-run') {
      out.flags.add('dry-run');
      continue;
    }
    if (arg === '--no-merge') {
      out.flags.add('no-merge');
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function usage() {
  console.log(`Usage:
  node build-llm-compressed.js [options]

Options:
  --model <id>            Model (default ${DEFAULT_MODEL})
  --reasoning <level>     Reasoning effort (default ${DEFAULT_REASONING})
  --max-chars <n>         Max chars per TOC section (hard limit, default auto)
  --about-max-chars <n>   Max chars used from About the Program (default ${DEFAULT_ABOUT_MAX_CHARS})
  --target-ratio <n>      Target token ratio per chunk (default ${DEFAULT_TARGET_RATIO})
  --target-ratio-lossy <n> Target token ratio for lossy chunks (default ${DEFAULT_TARGET_RATIO_LOSSY})
  --min-target-tokens-core <n> Minimum target tokens for core sections (default ${DEFAULT_MIN_TARGET_TOKENS_CORE})
  --min-target-tokens-lossy <n> Minimum target tokens for lossy sections (default ${DEFAULT_MIN_TARGET_TOKENS_LOSSY})
  --max-refines <n>       Max compression refinement passes (default ${DEFAULT_MAX_REFINES})
  --merge-max-chars <n>   Max chars per merge chunk (default ${DEFAULT_MERGE_MAX_CHARS})
  --merge-max-passes <n>  Max merge passes (default ${DEFAULT_MERGE_MAX_PASSES})
  --merge-target-ratio <n> Target ratio for merge tightening (default ${DEFAULT_MERGE_TARGET_RATIO})
  --out <path>            Output file path (default dist/dionysus-program-context.txt)
  --dry-run               Build sections, show counts, do not call the API
  --no-merge              Skip the final merge pass

Env vars:
  OPENAI_API_KEY, OPENAI_MODEL, OPENAI_API_URL
  OPENAI_REASONING_EFFORT, OPENAI_MAX_CHARS, OPENAI_ABOUT_MAX_CHARS
  OPENAI_TARGET_RATIO, OPENAI_TARGET_RATIO_LOSSY, OPENAI_MAX_REFINES
  OPENAI_HARD_TARGET, OPENAI_ALLOW_LOSSY
  OPENAI_MIN_TARGET_TOKENS_CORE, OPENAI_MIN_TARGET_TOKENS_LOSSY
  OPENAI_MERGE_MAX_CHARS, OPENAI_MERGE_MAX_PASSES, OPENAI_MERGE_TARGET_RATIO
  OPENAI_MERGE_HARD_TARGET, OPENAI_MERGE_OUTPUT_TOKENS
  OPENAI_TIMEOUT_MS, OPENAI_MERGE_TIMEOUT_MS
  OPENAI_CONTEXT_TOKENS
  OPENAI_CANONICAL_URL
  OPENAI_CONCURRENCY
  OPENAI_OUT_FILE
`);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashObject(value) {
  const serialized = stableStringify(value);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

function loadCache() {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      lexicon: parsed.lexicon || {},
      compress: parsed.compress || {},
      merge: parsed.merge || {},
      ctx: parsed.ctx || {},
    };
  } catch (err) {
    return { lexicon: {}, compress: {}, merge: {}, ctx: {} };
  }
}

function writeCache(cache) {
  ensureDir(CACHE_DIR);
  const tmpPath = `${CACHE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(tmpPath, CACHE_PATH);
}

function formatCount(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function clampRatio(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(parsed, 0.02), 1);
}

function computeTargetTokens(rawTokens, ratio, minTokens) {
  if (!Number.isFinite(rawTokens) || rawTokens <= 0) return minTokens;
  const target = Math.floor(rawTokens * ratio);
  return Math.max(minTokens, target);
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function ensureCommand(cmd) {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' });
  } catch (err) {
    console.error(`${cmd} is required but not installed`);
    process.exit(1);
  }
}

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' });
}

function normalizeWhitespace(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dedupeAdjacentLines(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const out = [];
  let prev = null;
  for (const line of lines) {
    if (prev !== null && line === prev) continue;
    out.push(line);
    prev = line;
  }
  return out.join('\n');
}

function postProcessContent(text) {
  if (!text) return '';
  let cleaned = normalizeWhitespace(text);
  cleaned = stripSimulationReferences(cleaned);
  cleaned = dedupeAdjacentLines(cleaned);
  cleaned = normalizeWhitespace(cleaned);
  return cleaned;
}

function stripSimulationReferences(text) {
  if (!text) return '';
  const pattern = /\s*[:\-–—]*\s*see\s+simulation\s*[·\-\|\u00b7]\s*historical\s+cases\.?/i;
  return text
    .split('\n')
    .map((line) => {
      if (!pattern.test(line)) return line;
      return line.replace(pattern, '');
    })
    .join('\n');
}

function extractSectionHeaders(text) {
  if (!text) return [];
  const headers = [];
  const seen = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.startsWith('## ')) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    headers.push(line);
  }
  return headers;
}

function cleanLetterOutput(text, sectionTitle) {
  if (!text) return '';
  const lines = text.split('\n');
  const cleaned = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      cleaned.push(line);
      continue;
    }
    if (trimmed === sectionTitle) continue;
    if (trimmed.startsWith('SECTION_TITLE:')) continue;
    if (/^#+\s+/.test(trimmed)) continue;
    cleaned.push(line);
  }
  return normalizeWhitespace(cleaned.join('\n'));
}

function cleanArchetypeOutput(text, sectionTitle) {
  if (!text) return '';
  const lines = text.split('\n');
  const cleaned = [];
  const placeholderRe = /see\s+simulation\s*[·\-\|\u00b7]\s*historical\s+cases/i;
  const archetypeName = sectionTitle ? sectionTitle.split(' - ').slice(1).join(' - ').trim() : '';
  const redundantHeadingRe = archetypeName
    ? new RegExp(`^#{2,6}\\s+${escapeRegExp(archetypeName)}\\s*$`)
    : null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      cleaned.push(line);
      continue;
    }
    if (placeholderRe.test(trimmed)) continue;
    if (sectionTitle && trimmed === sectionTitle) continue;
    if (redundantHeadingRe && redundantHeadingRe.test(trimmed)) continue;
    cleaned.push(line);
  }
  return normalizeWhitespace(cleaned.join('\n'));
}

function hasNonHeadingContent(text) {
  if (!text) return false;
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    return true;
  }
  return false;
}

function sliceContentForCtx(content, maxChars) {
  if (!content) return '';
  const limit = Math.max(2000, Number(maxChars) || DEFAULT_CTX_INPUT_MAX_CHARS);
  if (content.length <= limit) return content;
  const sliceSize = Math.max(500, Math.floor((limit - 16) / 3));
  const head = content.slice(0, sliceSize);
  const midStart = Math.max(0, Math.floor((content.length - sliceSize) / 2));
  const mid = content.slice(midStart, midStart + sliceSize);
  const tail = content.slice(-sliceSize);
  return [head, '...', mid, '...', tail].join('\n');
}

function ensureSectionHeader(text, title) {
  const header = `## ${title}`;
  if (!text) return header;
  const trimmed = text.trimStart();
  if (trimmed.startsWith(header)) return text;
  return `${header}\n${text}`;
}

function stripInjectedLegend(content) {
  if (!content) return '';
  const lines = content.split('\n');
  const dropPrefixes = [
    '=== META ===',
    '=== LEGEND ===',
    '=== CONTENT ===',
    'ABBR:',
    'SYMS:',
    'KEEP:',
    'CTX:',
  ];
  const cleaned = lines.filter((line) => {
    const trimmed = line.trim();
    return !dropPrefixes.some((prefix) => trimmed.startsWith(prefix));
  });
  return normalizeWhitespace(cleaned.join('\n'));
}

function findMissingSectionHeaders(content, titles) {
  if (!content) return titles.map((title) => `## ${title}`);
  const missing = [];
  for (const title of titles) {
    const header = `## ${title}`;
    if (!content.includes(header)) missing.push(header);
  }
  return missing;
}

function normalizeRights(text) {
  if (!text) return '';
  return text
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFrontMatter(text) {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('---')) return {};
  const end = trimmed.indexOf('\n---', 3);
  if (end === -1) return {};
  const body = trimmed.slice(3, end).trim();
  const lines = body.split(/\r?\n/);
  const data = {};
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) data[key] = value;
  }
  return data;
}

function buildMetadataBlock({ frontMatter, canonicalUrl, githubUrl }) {
  const lines = [];
  lines.push('=== META ===');
  lines.push('VARIANT: compressed version for LLM context windows');
  if (frontMatter.title) lines.push(`TITLE: ${frontMatter.title}`);
  if (frontMatter.description) lines.push(`SUBTITLE: ${frontMatter.description}`);
  if (frontMatter.author) lines.push(`AUTHOR: ${frontMatter.author}`);
  if (frontMatter.rights) lines.push(`RIGHTS: ${normalizeRights(frontMatter.rights)}`);
  if (canonicalUrl) lines.push(`CANONICAL_URL: ${canonicalUrl}`);
  if (githubUrl) lines.push(`GITHUB_URL: ${githubUrl}`);
  return lines.join('\n');
}

function createMarkerFilter() {
  return `local function sanitize(text)
  text = text:gsub("|", "/")
  text = text:gsub("\\n", " ")
  return text
end

function Header(el)
  local title = pandoc.utils.stringify(el.content)
  title = sanitize(title)
  local marker = pandoc.Para({pandoc.Str("${MARKER_PREFIX}" .. el.level .. "|" .. title .. "]]]")})
  local hashes = string.rep("#", el.level)
  local heading = pandoc.Para({pandoc.Str(hashes .. " " .. title)})
  return {marker, heading}
end
`;
}

function buildMarkedPlainText() {
  const filterPath = path.join(os.tmpdir(), `dionysus-section-marker-${Date.now()}.lua`);
  fs.writeFileSync(filterPath, createMarkerFilter(), 'utf8');
  try {
    const inputs = [ESSAY_MD, LETTERS_APPENDIX, SOURCES_MD];
    const pandocArgs = [
      ...inputs,
      '--from=markdown',
      '--to=plain',
      '--wrap=none',
      `--lua-filter=${filterPath}`,
    ];
    return execFileSync('pandoc', pandocArgs, { encoding: 'utf8' });
  } finally {
    try {
      fs.unlinkSync(filterPath);
    } catch (err) {
      // Ignore cleanup errors.
    }
  }
}

function parseSections(markedText) {
  const lines = markedText.replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  const headings = [];
  let current = { title: 'Front Matter', level: 0, lines: [] };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(MARKER_REGEX);
    if (match) {
      const level = Number(match[1]);
      const title = match[2].trim();
      headings.push({ level, title });
      if (level <= 2) {
        if (current.lines.length > 0) {
          sections.push(current);
        }
        current = { title, level, lines: [] };
      }
      continue;
    }
    current.lines.push(rawLine);
  }

  if (current.lines.length > 0) {
    sections.push(current);
  }

  return { sections, headings };
}

function buildSectionText(section) {
  const text = normalizeWhitespace(section.lines.join('\n'));
  return text;
}

function isLettersAppendix(title) {
  return /letters to the editor/i.test(title);
}

function isArchetypesAppendix(title) {
  return /appendix b:\s*archetypes in history/i.test(title);
}

function isLossySection(title) {
  if (!title) return false;
  const normalized = title.toLowerCase();
  return (
    normalized.startsWith('appendix b:') ||
    normalized.startsWith('appendix c:') ||
    normalized.startsWith('appendix d:')
  );
}

function getSectionMode(title) {
  if (!title) return 'core';
  if (isLettersAppendix(title)) return 'letters';
  if (isArchetypesAppendix(title)) return 'archetypes';
  if (isLossySection(title)) return 'lossy';
  return 'core';
}

function splitAppendixBSection(section) {
  const lines = section.text.split('\n');
  const chunks = [];
  let currentLines = [];
  let currentTitle = `${section.title} - Intro`;
  let sawSubsection = false;

  const flush = () => {
    if (currentLines.length === 0) return;
    const text = normalizeWhitespace(currentLines.join('\n'));
    if (!text) return;
    chunks.push({
      title: currentTitle,
      level: section.level,
      text,
    });
  };

  for (const line of lines) {
    if (/^####\s+/.test(line)) {
      flush();
      sawSubsection = true;
      currentTitle = `${section.title} - ${line.replace(/^####\s+/, '').trim()}`;
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  flush();

  if (!sawSubsection) return [section];
  return chunks;
}

function splitLettersAppendixSection(section) {
  const lines = section.text.split('\n');
  const chunks = [];
  let currentLines = [];
  let currentTitle = `${section.title} - Intro`;
  let sawLetter = false;

  const flush = () => {
    if (currentLines.length === 0) return;
    const text = normalizeWhitespace(currentLines.join('\n'));
    if (!text) return;
    chunks.push({
      title: currentTitle,
      level: section.level,
      text,
    });
  };

  for (const line of lines) {
    if (/^####\s+/.test(line)) {
      flush();
      sawLetter = true;
      currentTitle = `${section.title} - ${line.replace(/^####\s+/, '').trim()}`;
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  flush();

  if (!sawLetter) return [section];
  return chunks;
}

function expandSections(sectionTexts) {
  const expanded = [];
  for (const section of sectionTexts) {
    if (isLettersAppendix(section.title)) {
      expanded.push(...splitLettersAppendixSection(section));
    } else if (isArchetypesAppendix(section.title)) {
      expanded.push(...splitAppendixBSection(section));
    } else {
      expanded.push(section);
    }
  }
  return expanded;
}

function isOmittedSection(title) {
  if (!title) return false;
  const normalized = title.trim().toLowerCase();
  return (
    normalized === 'front matter' ||
    normalized === 'the dionysus program' ||
    normalized === 'about the program'
  );
}

function filterOmittedSections(sectionTexts) {
  return sectionTexts.filter((section) => !isOmittedSection(section.title));
}

function chunkSection(text, maxChars, title) {
  if (text.length > maxChars) {
    const label = title ? ` "${title}"` : '';
    throw new Error(
      `Section${label} exceeds OPENAI_MAX_CHARS (${maxChars}). ` +
        'Increase --max-chars or OPENAI_MAX_CHARS to avoid sub-chunking.'
    );
  }
  return [text];
}

function chunkByParagraphs(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const paras = text.includes('\n\n') ? text.split(/\n{2,}/) : text.split('\n');
  const chunks = [];
  let current = '';

  for (const para of paras) {
    const next = current ? `${current}\n\n${para}` : para;
    if (next.length > maxChars && current) {
      chunks.push(current);
      current = para;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function chunkByParagraphTokens(text, maxTokens, countTokens) {
  if (!countTokens) return [text];
  if (countTokens(text) <= maxTokens) return [text];
  const paras = text.includes('\n\n') ? text.split(/\n{2,}/) : text.split('\n');
  const chunks = [];
  let current = '';

  for (const para of paras) {
    const next = current ? `${current}\n\n${para}` : para;
    const nextTokens = countTokens(next);
    if (nextTokens > maxTokens && current) {
      chunks.push(current);
      current = para;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function pickEncodingForModel(model) {
  const lower = String(model || '').toLowerCase();
  if (lower.includes('gpt-5') || lower.includes('gpt-4o') || lower.includes('o1') || lower.includes('o200k')) {
    return 'o200k_base';
  }
  return 'cl100k_base';
}

function getModelLimits(model) {
  const id = String(model || '').toLowerCase();
  if (id.includes('gpt-5.2-chat')) {
    return { contextTokens: 128000, maxOutputTokens: 16384 };
  }
  if (id.includes('gpt-5.2-pro')) {
    return { contextTokens: 400000, maxOutputTokens: 128000 };
  }
  if (id.includes('gpt-5.2')) {
    return { contextTokens: 400000, maxOutputTokens: 128000 };
  }
  if (id.startsWith('gpt-5') || id.includes('gpt-5-')) {
    return { contextTokens: 400000, maxOutputTokens: 128000 };
  }
  if (id.includes('gpt-4o-mini')) {
    return { contextTokens: 128000, maxOutputTokens: 16384 };
  }
  if (id.includes('gpt-4o')) {
    return { contextTokens: 128000, maxOutputTokens: 16384 };
  }
  return null;
}

function getMergeBudgetTokens({ model, contextOverride, outputOverride }) {
  const limits = getModelLimits(model) || {};
  const contextTokens = Number(contextOverride || limits.contextTokens) || null;
  if (!contextTokens) return null;
  const maxOutputTokens = Number(outputOverride || limits.maxOutputTokens) || 16384;
  const reserve = Math.min(maxOutputTokens, Math.floor(contextTokens * 0.25));
  return {
    contextTokens,
    maxOutputTokens,
    inputBudgetTokens: Math.max(1000, contextTokens - reserve),
  };
}

async function loadTokenCounter(model) {
  const encoding = pickEncodingForModel(model);
  try {
    const mod = await import(`gpt-tokenizer/encoding/${encoding}`);
    if (typeof mod.countTokens === 'function') {
      return { countTokens: mod.countTokens, encoding };
    }
  } catch (err) {
    // Fall through to default tokenizer.
  }
  try {
    const mod = await import('gpt-tokenizer');
    if (typeof mod.countTokens === 'function') {
      return { countTokens: mod.countTokens, encoding: 'cl100k_base', warning: 'Defaulted to cl100k_base.' };
    }
  } catch (err) {
    return { countTokens: null, encoding, warning: 'Token counter unavailable; skipping token counts.' };
  }
  return { countTokens: null, encoding, warning: 'Token counter unavailable; skipping token counts.' };
}

function validateSectionSizes(sectionTexts, maxChars) {
  const overs = sectionTexts.filter((section) => section.text.length > maxChars);
  if (overs.length === 0) return;
  const details = overs.map((section) => `${section.title}: ${section.text.length} chars`).join('\n');
  throw new Error(
    `Section(s) exceed OPENAI_MAX_CHARS (${maxChars}). ` +
      'Increase --max-chars or OPENAI_MAX_CHARS to avoid sub-chunking.\n' +
      details
  );
}

async function mapLimit(items, limit, worker) {
  const concurrency = Math.max(1, Number(limit) || 1);
  const results = new Array(items.length);
  let nextIndex = 0;
  let active = 0;

  return new Promise((resolve, reject) => {
    const launchNext = () => {
      if (nextIndex >= items.length && active === 0) {
        resolve(results);
        return;
      }
      while (active < concurrency && nextIndex < items.length) {
        const current = nextIndex;
        const item = items[nextIndex];
        nextIndex += 1;
        active += 1;
        Promise.resolve(worker(item, current))
          .then((result) => {
            results[current] = result;
            active -= 1;
            launchNext();
          })
          .catch((err) => reject(err));
      }
    };
    launchNext();
  });
}

function loadKeywords() {
  if (!fs.existsSync(KEYWORDS_TXT)) return [];
  const raw = fs.readFileSync(KEYWORDS_TXT, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function extractFrequentPhrases(text, maxPhrases = 60) {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = normalized.split(' ').filter(Boolean);
  const freq = new Map();
  const maxN = 5;
  const minN = 2;

  for (let i = 0; i < words.length; i += 1) {
    for (let n = minN; n <= maxN; n += 1) {
      if (i + n > words.length) break;
      const phrase = words.slice(i, i + n).join(' ');
      if (phrase.length < 10) continue;
      const count = freq.get(phrase) || 0;
      freq.set(phrase, count + 1);
    }
  }

  const sorted = [...freq.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);

  return sorted.slice(0, maxPhrases).map(([phrase]) => phrase);
}

function buildHeadingLine(title, level) {
  const hashes = '#'.repeat(Math.max(1, Math.min(6, level || 2)));
  return `${hashes} ${title}`.trim();
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildOpenAIRequest({
  model,
  reasoningEffort,
  instructions,
  input,
  textFormat,
  textVerbosity,
  temperature,
  maxOutputTokens,
}) {
  const payload = {
    model,
    reasoning: { effort: reasoningEffort },
    input,
  };
  if (typeof temperature === 'number') {
    payload.temperature = temperature;
  }
  if (typeof maxOutputTokens === 'number') {
    payload.max_output_tokens = maxOutputTokens;
  }
  if (instructions) payload.instructions = instructions;
  if (textFormat || textVerbosity) {
    payload.text = {};
    if (textFormat) payload.text.format = textFormat;
    if (textVerbosity) payload.text.verbosity = textVerbosity;
  }
  return payload;
}

async function requestOpenAI({ apiUrl, apiKey, payload, timeoutMs = 120000 }) {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is not available. Use Node 18+ or polyfill fetch.');
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  const maxAttempts = 4;
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const details = err && err.message ? err.message : String(err);
      const cause = err && err.cause ? ` | cause: ${err.cause}` : '';
      console.warn(`OpenAI request failed at network layer: ${details}${cause}`);
      console.warn(`OpenAI request URL: ${apiUrl}`);
      console.warn(`OpenAI request timeout: ${timeoutMs}ms`);
      if (err.name === 'AbortError') {
        console.warn(`OpenAI request timed out after ${timeoutMs}ms. Retrying...`);
        await sleep(1500 * attempt);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      return response.json();
    }

    const text = await response.text();
    if (response.status >= 500 || response.status === 429) {
      const backoff = Math.min(2000 * attempt, 8000);
      console.warn(`OpenAI error ${response.status}. Retrying in ${backoff}ms...`);
      await sleep(backoff);
      continue;
    }

    throw new Error(`OpenAI request failed (${response.status}): ${text}`);
  }

  throw new Error('OpenAI request failed after retries.');
}

function extractOutputText(response) {
  if (response && typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }
  let text = '';
  if (response && Array.isArray(response.output)) {
    for (const item of response.output) {
      if (item && item.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part && part.type === 'output_text' && typeof part.text === 'string') {
            text += part.text;
          }
        }
      }
    }
  }
  return text.trim();
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw err;
  }
}

function normalizeLexicon(parsed) {
  const lexicon = parsed && typeof parsed === 'object' ? parsed : {};
  const contextBrief = typeof lexicon.context_brief === 'string' ? lexicon.context_brief : '';
  const abbreviations = Array.isArray(lexicon.abbreviations) ? lexicon.abbreviations : [];
  const symbols = Array.isArray(lexicon.symbols) ? lexicon.symbols : [];
  const keepTerms = Array.isArray(lexicon.keep_terms) ? lexicon.keep_terms : [];
  let normalizedBrief = contextBrief.trim();
  if (normalizedBrief && !/[.!?]$/.test(normalizedBrief)) {
    normalizedBrief = `${normalizedBrief}.`;
  }
  return {
    context_brief: normalizedBrief,
    abbreviations: abbreviations
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        abbr: typeof entry.abbr === 'string' ? entry.abbr : '',
        full: typeof entry.full === 'string' ? entry.full : '',
      }))
      .filter((entry) => entry.abbr && entry.full),
    symbols: symbols
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        sym: typeof entry.sym === 'string' ? entry.sym : '',
        full: typeof entry.full === 'string' ? entry.full : '',
      }))
      .filter((entry) => entry.sym && entry.full),
    keep_terms: keepTerms.filter((term) => typeof term === 'string' && term.trim() !== ''),
  };
}

function applyBaseSymbols(lexicon) {
  const current = Array.isArray(lexicon.symbols) ? lexicon.symbols : [];
  const seen = new Set(current.map((entry) => entry.sym));
  const merged = [...current];
  for (const entry of BASE_SYMBOLS) {
    if (!seen.has(entry.sym)) {
      merged.push(entry);
      seen.add(entry.sym);
    }
  }
  return {
    ...lexicon,
    symbols: merged,
  };
}

async function buildLexicon({
  apiUrl,
  apiKey,
  model,
  reasoningEffort,
  aboutProgram,
  toc,
  keywords,
  phrases,
  timeoutMs,
}) {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      context_brief: { type: 'string' },
      abbreviations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            abbr: { type: 'string' },
            full: { type: 'string' },
          },
          required: ['abbr', 'full'],
        },
      },
      symbols: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sym: { type: 'string' },
            full: { type: 'string' },
          },
          required: ['sym', 'full'],
        },
      },
      keep_terms: { type: 'array', items: { type: 'string' } },
    },
    required: ['context_brief', 'abbreviations', 'symbols', 'keep_terms'],
  };

  const instructions = [
    'You are an expert compression planner.',
    'Goal: produce a compact context brief and an aggressive lexicon for maximal compression.',
    'Rules:',
    '- Abbreviations must be 2-8 chars, uppercase, unique, and unambiguous.',
    '- Symbols must be 1-4 chars and map to extremely common connectors (and, with, without, because, implies, equals).',
    '- Prefer abbreviating recurring proper names, core concepts, and long phrases.',
    '- context_brief must be 2-4 complete sentences, <= 600 chars, end with a period, and never truncate mid-sentence.',
    '- Keep terms should include critical terms that must remain verbatim.',
    '- Return only JSON that matches the provided schema.',
  ].join('\n');

  const input = [
    {
      role: 'user',
      content: [
        'ABOUT_PROGRAM:',
        aboutProgram,
        '',
        'TOC_TITLES:',
        toc.join(' | '),
        '',
        'KEYWORDS:',
        keywords.join(' | '),
        '',
        'FREQUENT_PHRASES:',
        phrases.join(' | '),
      ].join('\n'),
    },
  ];

  try {
    const payload = buildOpenAIRequest({
      model,
      reasoningEffort,
      instructions,
      input,
      textFormat: {
        type: 'json_schema',
        name: 'compression_lexicon',
        strict: true,
        schema,
      },
    });

    const response = await requestOpenAI({ apiUrl, apiKey, payload, timeoutMs });
    const text = extractOutputText(response);
    const parsed = parseJsonSafe(text);
    return normalizeLexicon(parsed);
  } catch (err) {
    console.warn(`Structured outputs failed; retrying lexicon with JSON mode. (${err.message || err})`);
    const jsonInstructions = [
      instructions,
      'Output must be a single JSON object with keys: context_brief (string), abbreviations (array of {abbr, full}), symbols (array of {sym, full}), keep_terms (array of strings).',
      'Ensure the response is valid JSON.',
    ].join('\n');

    const payload = buildOpenAIRequest({
      model,
      reasoningEffort,
      instructions: jsonInstructions,
      input,
      textFormat: {
        type: 'json_object',
      },
    });

    const response = await requestOpenAI({ apiUrl, apiKey, payload, timeoutMs });
    const text = extractOutputText(response);
    const parsed = parseJsonSafe(text);
    return normalizeLexicon(parsed);
  }
}

function buildLegend(lexicon) {
  const abbreviations = Array.isArray(lexicon.abbreviations) ? lexicon.abbreviations : [];
  const symbols = Array.isArray(lexicon.symbols) ? lexicon.symbols : [];
  const keepTerms = Array.isArray(lexicon.keep_terms) ? lexicon.keep_terms : [];
  const parts = [];

  if (abbreviations.length > 0) {
    const abbrLine = abbreviations
      .map((entry) => `${entry.abbr}=${entry.full}`)
      .join('; ');
    parts.push(`ABBR: ${abbrLine}`);
  }

  if (symbols.length > 0) {
    const symLine = symbols
      .map((entry) => `${entry.sym}=${entry.full}`)
      .join('; ');
    parts.push(`SYMS: ${symLine}`);
  }

  if (keepTerms.length > 0) {
    parts.push(`KEEP: ${keepTerms.join('; ')}`);
  }

  if (lexicon.context_brief) {
    parts.push(`CTX: ${lexicon.context_brief}`);
  }

  return parts.join('\n');
}

function normalizeContextBrief(text, maxChars = DEFAULT_CTX_MAX_CHARS) {
  if (!text) return '';
  const cleaned = normalizeWhitespace(text).replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  const out = [];
  for (const sentence of sentences) {
    if (out.length >= 4) break;
    const candidate = out.length ? `${out.join(' ')} ${sentence}` : sentence;
    if (candidate.length > maxChars) break;
    out.push(sentence);
  }
  let result = '';
  if (out.length === 0) {
    result = cleaned.slice(0, maxChars).trim();
  } else {
    result = out.join(' ').trim();
  }
  if (result && !/[.!?]$/.test(result)) result += '.';
  return result;
}

async function buildContextBrief({ apiUrl, apiKey, model, reasoningEffort, legend, content, timeoutMs }) {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      context_brief: { type: 'string' },
    },
    required: ['context_brief'],
  };

  const instructions = [
    'You are writing the CTX header for a compressed LLM context.',
    'Rules:',
    '- Output 2-4 complete sentences, <= 600 chars.',
    '- Use ABBR/SYMS/KEEP; do not invent new abbreviations or symbols.',
    '- Capture the core thesis + mechanism + key constructs so the content is interpretable.',
    '- Do not output labels or metadata; only JSON matching schema.',
  ].join('\n');

  const input = [
    {
      role: 'user',
      content: ['JSON requested.', 'LEGEND:', legend, '', 'CONTENT:', sliceContentForCtx(content, DEFAULT_CTX_INPUT_MAX_CHARS)].join('\n'),
    },
  ];

  try {
    const payload = buildOpenAIRequest({
      model,
      reasoningEffort,
      instructions,
      input,
      textFormat: {
        type: 'json_schema',
        name: 'context_brief',
        strict: true,
        schema,
      },
      textVerbosity: 'low',
    });

    const response = await requestOpenAI({ apiUrl, apiKey, payload, timeoutMs });
    const text = extractOutputText(response);
    const parsed = parseJsonSafe(text);
    return normalizeContextBrief(parsed.context_brief);
  } catch (err) {
    console.warn(`CTX structured output failed; retrying JSON mode. (${err.message || err})`);
    const jsonInstructions = [
      instructions,
      'Output must be a single JSON object with key: context_brief (string).',
      'Ensure the response is valid JSON.',
    ].join('\n');

    const payload = buildOpenAIRequest({
      model,
      reasoningEffort,
      instructions: jsonInstructions,
      input,
      textFormat: { type: 'json_object' },
      textVerbosity: 'low',
    });

    const response = await requestOpenAI({ apiUrl, apiKey, payload, timeoutMs });
    const text = extractOutputText(response);
    const parsed = parseJsonSafe(text);
    return normalizeContextBrief(parsed.context_brief);
  }
}

function buildCompressionPrompt({
  legend,
  sectionTitle,
  sectionText,
  targetTokens,
  lossy,
  hardCap,
  mode,
}) {
  const targetLine = targetTokens ? `TARGET_TOKENS: <= ${targetTokens}` : 'TARGET_TOKENS: N/A';
  const lossLine = lossy
    ? 'LOSSY_OK: YES (summarize narrative; keep unique claims, names, numbers, definitions, and attributions; quotes may be paraphrased unless they carry unique claims).'
    : 'LOSSY_OK: NO (lossless; keep all claims, names, numbers, definitions, and quotes).';
  const preserveLine = lossy
    ? '- Preserve key unique claims, names, numbers, definitions, and attributions; drop examples and repetition.'
    : '- Preserve ALL program-specific information: claims, names, numbers, definitions, lists, equations.';
  const letterLine =
    mode === 'letters'
      ? '- Letters: output format: Summary: <one sentence/paragraph>. Quotes: "<quote1>" ; "<quote2>" ; "<quote3>" (up to 3 quotes, <=15 words each). Keep speaker attribution and unique claims/names/numbers. Do not add extra headings or repeat the section title.'
      : null;
  const archetypeLine =
    mode === 'archetypes'
      ? '- Archetypes: include 2-4 distinguishing traits + 1-2 concrete historical examples. Do not repeat the section title or output placeholder lines like "See simulation · Historical cases."'
      : null;
  const headingLine =
    mode === 'letters'
      ? '- Do not include extra headings or repeat the section title; the section header will be added separately.'
      : '- Preserve section headings; if the section starts with a heading, keep it.';
  const hardLine = hardCap ? 'HARD_LIMIT: YES (must be <= TARGET_TOKENS).' : 'HARD_LIMIT: NO.';
  return [
    'Task: Compress the SECTION into the most token-efficient plain text.',
    'Rules:',
    lossLine,
    preserveLine,
    ...(letterLine ? [letterLine] : []),
    ...(archetypeLine ? [archetypeLine] : []),
    '- Remove filler, redundancy, and non-informative phrasing.',
    lossy
      ? '- Audience: LLMs. Optimize for compactness + clarity; prefer canonical terms. You may omit non-unique details, but do not omit unique claims, definitions, numbers, or attributions.'
      : '- Audience: LLMs. Optimize for compactness + clarity; prefer canonical terms over long explanations. You may rely on widely known background knowledge to shorten phrasing, but do not omit any program-specific claims or details.',
    '- Use ABBR and SYMS exactly; do not invent new abbreviations or symbols.',
    '- Keep all KEEP terms verbatim.',
    headingLine,
    '- Style: telegraphic, omit articles/aux verbs, compress to fact tuples; use short labels and ";" separators.',
    '- Preserve list markers and headings; prefer short labels.',
    '- Output must include at least one non-heading line; do not output only the heading.',
    '- If compression would lose required information, keep the original wording for that span.',
    '- Do not output prompt labels or metadata (e.g., LEGEND, SECTION_TITLE, SECTION_TEXT, TARGET_TOKENS, LOSSY_OK, HARD_LIMIT).',
    targetLine,
    hardLine,
    '',
    'LEGEND:',
    legend,
    '',
    `SECTION_TITLE: ${sectionTitle}`,
    'SECTION_TEXT:',
    sectionText,
  ].join('\n');
}

function buildMergePrompt({ legend, toc, requiredHeaders, pass, chunkIndex, chunkTotal, content, targetTokens, hardCap }) {
  const targetLine = targetTokens ? `TARGET_TOKENS: <= ${targetTokens}` : 'TARGET_TOKENS: N/A';
  const hardLine = hardCap ? 'HARD_LIMIT: YES (must be <= TARGET_TOKENS).' : 'HARD_LIMIT: NO.';
  const headersBlock =
    requiredHeaders && requiredHeaders.length ? requiredHeaders.join('\n') : 'N/A';
  return [
    'Task: Final merge pass: merge and normalize compressed content. Preserve information; remove only obvious duplication.',
    'Rules:',
    '- Preserve ALL information: claims, names, numbers, definitions, quotes, lists, equations.',
    '- Audience: LLMs. Optimize for compactness + clarity; prefer canonical terms over long explanations. You may rely on widely known background knowledge to shorten phrasing, but do not omit any program-specific claims or details.',
    '- Do not change ABBR/SYMS mappings. Use ABBR and SYMS exactly; do not invent new abbreviations or symbols.',
    '- Keep KEEP terms verbatim.',
    '- Maintain the original order of information.',
    '- Style: telegraphic; light cleanup only. Do not aggressively compress beyond removing duplicates and obvious verbosity.',
    '- Preserve list markers; do not drop any headings.',
    '- Keep every line that starts with "## " (section headers). Do not remove or reorder them.',
    '- All REQUIRED_HEADERS must appear exactly once, in order. If unsure, output the CONTENT verbatim.',
    '- Output plain text only (no preamble).',
    '- Do not output prompt labels or metadata (e.g., LEGEND, TOC, PASS, CHUNK, TARGET_TOKENS, HARD_LIMIT).',
    targetLine,
    hardLine,
    '',
    'LEGEND:',
    legend || 'N/A',
    '',
    'TOC:',
    toc.length ? toc.join(' | ') : 'N/A',
    '',
    'REQUIRED_HEADERS:',
    headersBlock,
    '',
    `PASS: ${pass}, CHUNK: ${chunkIndex}/${chunkTotal}`,
    'CONTENT:',
    content,
  ].join('\n');
}

async function compressChunk({
  apiUrl,
  apiKey,
  model,
  reasoningEffort,
  legend,
  sectionTitle,
  sectionText,
  targetTokens,
  lossy,
  mode,
  maxOutputTokens,
  hardCap,
  timeoutMs,
}) {
  const input = [
    {
      role: 'user',
      content: buildCompressionPrompt({
        legend,
        sectionTitle,
        sectionText,
        targetTokens,
        lossy,
        hardCap,
        mode,
      }),
    },
  ];

  const payload = buildOpenAIRequest({
    model,
    reasoningEffort,
    instructions: 'You are a compression engine. Output plain text only.',
    input,
    textVerbosity: 'low',
    maxOutputTokens,
  });

  const response = await requestOpenAI({ apiUrl, apiKey, payload, timeoutMs });
  return extractOutputText(response);
}

async function mergeChunk({
  apiUrl,
  apiKey,
  model,
  reasoningEffort,
  legend,
  toc,
  requiredHeaders,
  pass,
  chunkIndex,
  chunkTotal,
  content,
  targetTokens,
  maxOutputTokens,
  hardCap,
  timeoutMs,
}) {
  const input = [
    {
      role: 'user',
      content: buildMergePrompt({
        legend,
        toc,
        requiredHeaders,
        pass,
        chunkIndex,
        chunkTotal,
        content,
        targetTokens,
        hardCap,
      }),
    },
  ];

  const payload = buildOpenAIRequest({
    model,
    reasoningEffort,
    instructions: 'You are a global compression engine. Output plain text only.',
    input,
    textVerbosity: 'low',
    maxOutputTokens,
  });

  const response = await requestOpenAI({ apiUrl, apiKey, payload, timeoutMs });
  return extractOutputText(response);
}

async function mergeContent({
  apiUrl,
  apiKey,
  model,
  reasoningEffort,
  legend,
  toc,
  requiredHeaders,
  content,
  maxChars,
  maxPasses,
  concurrency,
  cache,
  onCacheWrite,
  tokenCounter,
  mergeBudgetTokens,
  mergeTargetRatio,
  mergeHardTarget,
  mergeMinTokens,
  mergeTimeoutMs,
  mergeMaxOutputTokens,
}) {
  let current = normalizeWhitespace(content);
  let pass = 0;
  let lastChunkCount = Infinity;

  const countTokens = tokenCounter && typeof tokenCounter.countTokens === 'function' ? tokenCounter.countTokens : null;
  const inputBudgetTokens = mergeBudgetTokens ? mergeBudgetTokens.inputBudgetTokens : null;

  if (countTokens && inputBudgetTokens) {
    const currentTokens = countTokens(current);
    if (currentTokens > DEFAULT_MERGE_CHUNK_TOKENS) {
      console.log(
        `Merge pass 1: content ${formatCount(currentTokens)} tokens exceeds safe single-chunk cap (${formatCount(
          DEFAULT_MERGE_CHUNK_TOKENS
        )}); forcing chunked merge.`
      );
    } else {
      const initialTargetTokens = computeTargetTokens(countTokens(current), mergeTargetRatio, mergeMinTokens);
      const currentHeaders = extractSectionHeaders(current);
      const singlePrompt = buildMergePrompt({
        legend,
        toc,
        requiredHeaders: currentHeaders,
        pass: 1,
        chunkIndex: 1,
        chunkTotal: 1,
        content: current,
        targetTokens: initialTargetTokens,
        hardCap: mergeHardTarget,
      });
      const singleTokens = countTokens(singlePrompt);
      if (singleTokens <= inputBudgetTokens) {
        console.log(`Merge pass 1: single chunk (${formatCount(singleTokens)} tokens <= ${formatCount(inputBudgetTokens)})`);
        const merged = await mergeChunk({
          apiUrl,
          apiKey,
        model,
        reasoningEffort,
        legend,
        toc,
        requiredHeaders: currentHeaders,
        pass: 1,
        chunkIndex: 1,
        chunkTotal: 1,
          content: current,
          targetTokens: initialTargetTokens,
          maxOutputTokens: mergeHardTarget ? initialTargetTokens : mergeMaxOutputTokens,
          hardCap: mergeHardTarget,
          timeoutMs: mergeTimeoutMs,
        });
        return normalizeWhitespace(merged);
      }
    }
  }

  while (pass < maxPasses) {
    pass += 1;
    let chunks;
    if (countTokens && inputBudgetTokens) {
      const basePrompt = buildMergePrompt({
        legend,
        toc,
        requiredHeaders,
        pass,
        chunkIndex: 1,
        chunkTotal: 1,
        content: '',
        targetTokens: null,
        hardCap: mergeHardTarget,
      });
      const baseTokens = countTokens(basePrompt);
      let contentBudget = Math.max(500, inputBudgetTokens - baseTokens);
      contentBudget = Math.min(contentBudget, DEFAULT_MERGE_CHUNK_TOKENS);
      chunks = chunkByParagraphTokens(current, contentBudget, countTokens);
      console.log(
        `Merge pass ${pass}: ${chunks.length} chunk(s) (budget ${formatCount(contentBudget)} tokens)`
      );
    } else {
      chunks = chunkByParagraphs(current, maxChars);
      console.log(`Merge pass ${pass}: ${chunks.length} chunk(s)`);
    }
    const chunkTotal = chunks.length;

    const mergedChunks = await mapLimit(chunks, concurrency, async (chunk, idx) => {
      console.log(`Merging chunk ${idx + 1}/${chunkTotal} (pass ${pass})`);
      const chunkTokens = countTokens ? countTokens(chunk) : estimateTokens(chunk);
      const chunkTargetTokens = computeTargetTokens(chunkTokens, mergeTargetRatio, mergeMinTokens);
      const cacheKey = hashObject({
        model,
        reasoningEffort,
        legend,
        toc,
        pass,
        chunkIndex: idx + 1,
        chunkTotal,
        content: chunk,
        targetTokens: chunkTargetTokens,
        mergeHardTarget,
      });
      if (cache && cache.merge && cache.merge[cacheKey]) {
        return cache.merge[cacheKey];
      }
      const merged = await mergeChunk({
        apiUrl,
        apiKey,
        model,
        reasoningEffort,
        legend,
        toc,
        requiredHeaders: extractSectionHeaders(chunk),
        pass,
        chunkIndex: idx + 1,
        chunkTotal,
        content: chunk,
        targetTokens: chunkTargetTokens,
        maxOutputTokens: mergeHardTarget ? chunkTargetTokens : mergeMaxOutputTokens,
        hardCap: mergeHardTarget,
        timeoutMs: mergeTimeoutMs,
      });
      const normalized = normalizeWhitespace(merged);
      if (cache && cache.merge) {
        cache.merge[cacheKey] = normalized;
        if (typeof onCacheWrite === 'function') onCacheWrite();
      }
      return normalized;
    });

    current = normalizeWhitespace(mergedChunks.join('\n\n'));
    if (mergedChunks.length === 1) return current;
    if (mergedChunks.length >= lastChunkCount) break;
    lastChunkCount = mergedChunks.length;
  }

  return current;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.has('help')) {
    usage();
    return;
  }

  const apiUrl = args.url || process.env.OPENAI_API_URL || DEFAULT_API_URL;
  const apiKey = args.key || process.env.OPENAI_API_KEY || '';
  const model = args.model || process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const reasoningEffort = args.reasoning || process.env.OPENAI_REASONING_EFFORT || DEFAULT_REASONING;
  const maxCharsInput = args['max-chars'] || process.env.OPENAI_MAX_CHARS;
  let maxChars = maxCharsInput ? Number(maxCharsInput) : null;
  const aboutMaxChars = Number(args['about-max-chars'] || process.env.OPENAI_ABOUT_MAX_CHARS || DEFAULT_ABOUT_MAX_CHARS);
  const targetRatio = clampRatio(
    args['target-ratio'] || process.env.OPENAI_TARGET_RATIO,
    DEFAULT_TARGET_RATIO
  );
  const targetRatioLossy = clampRatio(
    args['target-ratio-lossy'] || process.env.OPENAI_TARGET_RATIO_LOSSY,
    DEFAULT_TARGET_RATIO_LOSSY
  );
  const mergeTargetRatio = clampRatio(
    args['merge-target-ratio'] || process.env.OPENAI_MERGE_TARGET_RATIO,
    DEFAULT_MERGE_TARGET_RATIO
  );
  const maxRefines = Math.max(
    0,
    Number(args['max-refines'] || process.env.OPENAI_MAX_REFINES || DEFAULT_MAX_REFINES)
  );
  const hardTarget = String(process.env.OPENAI_HARD_TARGET || '0').toLowerCase() === '1';
  const mergeHardTarget = String(process.env.OPENAI_MERGE_HARD_TARGET || '0').toLowerCase() === '1';
  const minTargetTokensCore = Number(
    args['min-target-tokens-core'] || process.env.OPENAI_MIN_TARGET_TOKENS_CORE || DEFAULT_MIN_TARGET_TOKENS_CORE
  );
  const minTargetTokensLossy = Number(
    args['min-target-tokens-lossy'] || process.env.OPENAI_MIN_TARGET_TOKENS_LOSSY || DEFAULT_MIN_TARGET_TOKENS_LOSSY
  );
  const allowLossy = String(process.env.OPENAI_ALLOW_LOSSY || '1').toLowerCase() !== '0';
  const mergeMaxChars = Number(args['merge-max-chars'] || process.env.OPENAI_MERGE_MAX_CHARS || DEFAULT_MERGE_MAX_CHARS);
  const mergeMaxPasses = Number(args['merge-max-passes'] || process.env.OPENAI_MERGE_MAX_PASSES || DEFAULT_MERGE_MAX_PASSES);
  const concurrency = Number(process.env.OPENAI_CONCURRENCY || DEFAULT_CONCURRENCY);
  const outPath = args.out || process.env.OPENAI_OUT_FILE || path.join(DIST_DIR, 'dionysus-program-context.txt');
  const mergeEnabled = false;
  const dryRun = args.flags.has('dry-run');
  const mergeMinTokens = Math.max(128, Math.floor(Math.min(minTargetTokensCore, minTargetTokensLossy) / 2));
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const mergeTimeoutMs = Number(process.env.OPENAI_MERGE_TIMEOUT_MS || DEFAULT_MERGE_TIMEOUT_MS);
  const canonicalUrl = process.env.OPENAI_CANONICAL_URL || DEFAULT_CANONICAL_URL;

  if (!apiKey && !dryRun) {
    console.error('Missing OPENAI_API_KEY (or --key).');
    process.exit(1);
  }

  ensureCommand('pandoc');
  ensureDir(DIST_DIR);

  run('node', [LETTERS_SCRIPT, DIST_DIR]);

  const essayRaw = fs.readFileSync(ESSAY_MD, 'utf8');
  const frontMatter = parseFrontMatter(essayRaw);

  const markedText = buildMarkedPlainText();
  const { sections, headings } = parseSections(markedText);

  const sectionTexts = sections.map((section) => ({
    ...section,
    text: buildSectionText(section),
  }));

  const expandedSections = filterOmittedSections(expandSections(sectionTexts));

  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    maxChars = expandedSections.reduce((max, section) => Math.max(max, section.text.length), 0);
    console.log(`Max chars not set; using largest TOC section size: ${maxChars}`);
  }

  const aboutSection = sectionTexts.find((section) => section.title.toLowerCase() === 'about the program');
  const aboutText = aboutSection ? aboutSection.text.slice(0, aboutMaxChars) : '';

  const toc = headings
    .filter((h) => h.level <= 2)
    .map((h) => `${'#'.repeat(Math.min(h.level, 6))} ${h.title}`);

  const keywords = loadKeywords();
  const allText = expandedSections.map((s) => s.text).join('\n');
  const phrases = extractFrequentPhrases(allText);

  console.log(`Sections: ${expandedSections.length}`);
  console.log(`Headings: ${headings.length}`);
  console.log(`About the Program chars: ${aboutText.length}`);

  validateSectionSizes(expandedSections, maxChars);

  if (dryRun) {
    expandedSections.forEach((section, idx) => {
      const header = `[[[CHUNK ${idx + 1}/${expandedSections.length} | ${section.title} | ${section.text.length} chars]]]`;
      console.log(header);
    });
    return;
  }

  if (!aboutText) {
    console.warn('Warning: About the Program section not found. Continuing without anchor context.');
  }

  const cache = loadCache();
  let cacheDirty = false;
  let cacheWrites = 0;
  const flushCache = () => {
    if (cacheDirty) {
      writeCache(cache);
    }
  };
  process.on('exit', flushCache);
  process.on('SIGINT', () => {
    flushCache();
    process.exit(1);
  });
  process.on('SIGTERM', () => {
    flushCache();
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    flushCache();
    throw err;
  });
  process.on('unhandledRejection', (err) => {
    flushCache();
    throw err;
  });
  const markCacheDirty = () => {
    cacheDirty = true;
    cacheWrites += 1;
    writeCache(cache);
  };

  const lexiconKey = hashObject({
    model,
    reasoningEffort,
    aboutText,
    toc,
    keywords,
    phrases,
  });

  let lexicon = cache.lexicon[lexiconKey];
  if (lexicon) {
    console.log('Lexicon cache hit.');
  } else {
    lexicon = await buildLexicon({
      apiUrl,
      apiKey,
      model,
      reasoningEffort,
      aboutProgram: aboutText || 'N/A',
      toc,
      keywords,
      phrases,
      timeoutMs,
    });
    cache.lexicon[lexiconKey] = lexicon;
    markCacheDirty();
  }

  lexicon = applyBaseSymbols(lexicon);
  const legend = buildLegend(lexicon);
  const legendNoCtx = buildLegend({ ...lexicon, context_brief: '' });
  const tokenCounter = await loadTokenCounter(model);
  if (tokenCounter.warning) {
    console.warn(`Token counter warning: ${tokenCounter.warning}`);
  }
  const mergeBudgetTokens = getMergeBudgetTokens({
    model,
    contextOverride: process.env.OPENAI_CONTEXT_TOKENS,
    outputOverride: process.env.OPENAI_MERGE_OUTPUT_TOKENS,
  });
  const mergeMaxOutputTokens = mergeBudgetTokens ? mergeBudgetTokens.maxOutputTokens : undefined;

  const countTokens = tokenCounter && typeof tokenCounter.countTokens === 'function' ? tokenCounter.countTokens : null;

  const tasks = expandedSections.map((section) => {
    chunkSection(section.text, maxChars, section.title);
    const rawTokens = countTokens ? countTokens(section.text) : estimateTokens(section.text);
    const mode = getSectionMode(section.title);
    const lossy = allowLossy && mode !== 'core';
    const ratio = lossy ? targetRatioLossy : targetRatio;
    const minTokens =
      mode === 'letters'
        ? Math.max(minTargetTokensLossy, 256)
        : lossy
          ? minTargetTokensLossy
          : minTargetTokensCore;
    const targetTokens = computeTargetTokens(rawTokens, ratio, minTokens);
    const hardCap = hardTarget;
    return {
      label: section.title,
      sectionTitle: section.title,
      chunkText: section.text,
      rawTokens,
      targetTokens,
      lossy,
      hardCap,
      mode,
    };
  });

  const compressedSections = await mapLimit(tasks, concurrency, async (task) => {
    const cacheKey = hashObject({
      model,
      reasoningEffort,
      legend,
      sectionTitle: task.sectionTitle,
      chunkText: task.chunkText,
      targetTokens: task.targetTokens,
      lossy: task.lossy,
      hardCap: task.hardCap,
      mode: task.mode,
      maxRefines,
    });
    const looseCacheKey = hashObject({
      model,
      reasoningEffort,
      legend,
      sectionTitle: task.sectionTitle,
      chunkText: task.chunkText,
      lossy: task.lossy,
      hardCap: task.hardCap,
      mode: task.mode,
    });
    const cached = cache.compress[cacheKey];
    if (cached) {
      console.log(`Compressing: ${task.label} (cache hit)`);
      const withHeader = ensureSectionHeader(cached, task.sectionTitle);
      if (withHeader !== cached) {
        cache.compress[cacheKey] = withHeader;
        cache.compress[looseCacheKey] = withHeader;
        markCacheDirty();
      }
      return withHeader;
    }
    const looseCached = cache.compress[looseCacheKey];
    if (looseCached) {
      const tokenCount = countTokens ? countTokens(looseCached) : estimateTokens(looseCached);
      if (!task.hardCap || tokenCount <= task.targetTokens) {
        console.log(`Compressing: ${task.label} (cache hit, relaxed)`);
        const withHeader = ensureSectionHeader(looseCached, task.sectionTitle);
        cache.compress[cacheKey] = withHeader;
        cache.compress[looseCacheKey] = withHeader;
        markCacheDirty();
        return withHeader;
      }
    }
    const targetInfo = task.targetTokens ? `target ${formatCount(task.targetTokens)} tok` : 'target N/A';
    console.log(`Compressing: ${task.label} (${targetInfo}${task.lossy ? ', lossy' : ''})`);
    let attempt = 0;
    let current = task.chunkText;
    let normalized = '';
    while (attempt <= maxRefines) {
      const compressed = await compressChunk({
        apiUrl,
        apiKey,
        model,
        reasoningEffort,
        legend,
        sectionTitle: task.sectionTitle,
        sectionText: current,
        targetTokens: task.targetTokens,
        lossy: task.lossy,
        mode: task.mode,
        maxOutputTokens: task.hardCap ? task.targetTokens : undefined,
        hardCap: task.hardCap,
        timeoutMs,
      });
    normalized = normalizeWhitespace(compressed);
    if (task.mode === 'letters') {
      normalized = cleanLetterOutput(normalized, task.sectionTitle);
    } else if (task.mode === 'archetypes') {
      normalized = cleanArchetypeOutput(normalized, task.sectionTitle);
    }
      if (!countTokens) break;
      const tokenCount = countTokens(normalized);
      if (tokenCount <= task.targetTokens) break;
      if (attempt >= maxRefines) break;
      current = normalized;
      attempt += 1;
    }
    if (task.lossy && !hasNonHeadingContent(normalized)) {
      console.warn(`Lossy compression empty for "${task.label}". Retrying with higher budget.`);
      const retryTargetTokens = Math.max(task.targetTokens * 2, minTargetTokensLossy * 2);
      const compressed = await compressChunk({
        apiUrl,
        apiKey,
        model,
        reasoningEffort,
        legend,
        sectionTitle: task.sectionTitle,
        sectionText: task.chunkText,
        targetTokens: retryTargetTokens,
        lossy: task.lossy,
        mode: task.mode,
        maxOutputTokens: undefined,
        hardCap: false,
        timeoutMs,
      });
      normalized = normalizeWhitespace(compressed);
      if (task.mode === 'letters') {
        normalized = cleanLetterOutput(normalized, task.sectionTitle);
      } else if (task.mode === 'archetypes') {
        normalized = cleanArchetypeOutput(normalized, task.sectionTitle);
      }
    }
    normalized = ensureSectionHeader(normalized, task.sectionTitle);
    cache.compress[cacheKey] = normalized;
    cache.compress[looseCacheKey] = normalized;
    markCacheDirty();
    return normalized;
  });

  const requiredTitles = tasks.map((task) => task.sectionTitle);
  const requiredHeaders = requiredTitles.map((title) => `## ${title}`);
  let mergedContent = normalizeWhitespace(compressedSections.join('\n\n'));
  mergedContent = stripInjectedLegend(mergedContent);
  if (mergeEnabled) {
    mergedContent = await mergeContent({
      apiUrl,
      apiKey,
      model,
      reasoningEffort,
      legend,
      toc,
      requiredHeaders,
      content: mergedContent,
      maxChars: mergeMaxChars,
      maxPasses: mergeMaxPasses,
      concurrency,
      cache,
      onCacheWrite: markCacheDirty,
      tokenCounter,
      mergeBudgetTokens,
      mergeTargetRatio,
      mergeHardTarget,
      mergeMinTokens,
      mergeTimeoutMs,
      mergeMaxOutputTokens,
    });
  }
  mergedContent = stripInjectedLegend(mergedContent);
  if (mergeEnabled) {
    const missingHeaders = findMissingSectionHeaders(mergedContent, requiredTitles);
    if (missingHeaders.length > 0) {
      throw new Error(
        `Merge output missing ${missingHeaders.length} section header(s):\n${missingHeaders.join('\n')}`
      );
    }
  }
  mergedContent = postProcessContent(mergedContent);

  let finalLegend = legend;
  try {
    const contentHash = crypto.createHash('sha256').update(mergedContent).digest('hex');
    const ctxKey = hashObject({
      model,
      reasoningEffort,
      legend: legendNoCtx,
      contentHash,
    });
    let contextBrief = cache.ctx[ctxKey];
    if (contextBrief) {
      console.log('CTX cache hit.');
    } else {
      console.log('Building CTX from merged content...');
      contextBrief = await buildContextBrief({
        apiUrl,
        apiKey,
        model,
        reasoningEffort,
        legend: legendNoCtx,
        content: mergedContent,
        timeoutMs: mergeTimeoutMs,
      });
      if (contextBrief) {
        cache.ctx[ctxKey] = contextBrief;
        markCacheDirty();
      }
    }
    if (contextBrief) {
      finalLegend = buildLegend({ ...lexicon, context_brief: contextBrief });
    }
  } catch (err) {
    console.warn(`CTX build failed; using lexicon context. (${err.message || err})`);
  }

  const metaBlock = buildMetadataBlock({
    frontMatter,
    canonicalUrl,
    githubUrl: 'https://github.com/barelyknown/dionysus-program',
  });
  const legendBlock = ['=== LEGEND ===', finalLegend].join('\n');
  const contentBlock = ['=== CONTENT ===', mergedContent].join('\n');
  const finalText = `${normalizeWhitespace(
    [metaBlock, legendBlock, '---', contentBlock].join('\n\n')
  )}\n`;
  fs.writeFileSync(outPath, finalText, 'utf8');
  if (cacheDirty) {
    writeCache(cache);
  }
  console.log(`Wrote LLM-compressed text to ${outPath}`);

  const rawText = normalizeWhitespace(expandedSections.map((section) => section.text).join('\n\n'));
  const rawChars = rawText.length;
  const finalChars = finalText.length;
  const charReduction = rawChars > 0 ? ((1 - finalChars / rawChars) * 100).toFixed(2) : '0.00';
  console.log(`Chars: ${formatCount(rawChars)} -> ${formatCount(finalChars)} (${charReduction}% reduction)`);

  if (typeof countTokens === 'function') {
    const rawTokens = countTokens(rawText);
    const finalTokens = countTokens(finalText);
    const tokenReduction = rawTokens > 0 ? ((1 - finalTokens / rawTokens) * 100).toFixed(2) : '0.00';
    console.log(
      `Tokens (${tokenCounter.encoding}): ${formatCount(rawTokens)} -> ${formatCount(finalTokens)} (${tokenReduction}% reduction)`
    );
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
