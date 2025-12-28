#!/usr/bin/env node
/**
 * Build an index appendix from keywords.txt and essay.md.
 *
 * Usage: node build-index.js [outputDir] [inputMd] [keywordsPath]
 * Outputs:
 *   - <outputDir>/appendix-index.md
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = __dirname;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function ensureCommand(cmd) {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' });
  } catch (err) {
    console.error(`${cmd} is required but not installed`);
    process.exit(1);
  }
}

function collapseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeText(text) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inlinesToText(inlines) {
  if (!Array.isArray(inlines)) return '';
  let out = '';
  for (const inline of inlines) {
    if (!inline || typeof inline !== 'object') continue;
    switch (inline.t) {
      case 'Str':
        out += inline.c;
        break;
      case 'Space':
      case 'SoftBreak':
      case 'LineBreak':
        out += ' ';
        break;
      case 'Emph':
      case 'Strong':
      case 'Strikeout':
      case 'Superscript':
      case 'Subscript':
      case 'SmallCaps':
        out += inlinesToText(inline.c);
        break;
      case 'Span':
        out += inlinesToText(inline.c[1]);
        break;
      case 'Link':
        out += inlinesToText(inline.c[1]);
        break;
      case 'Quoted':
        out += inlinesToText(inline.c[1]);
        break;
      case 'Code':
      case 'Math':
      case 'RawInline':
      case 'Note':
        break;
      default:
        break;
    }
  }
  return out;
}

function loadKeywords(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const seen = new Set();
  const entries = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    const normalized = normalizeText(trimmed);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    entries.push({ raw: trimmed, normalized });
  }

  return entries;
}

function extractSections(doc) {
  const sections = [];
  let current = null;
  const appendText = (text) => {
    if (!current) return;
    const trimmed = collapseWhitespace(text);
    if (!trimmed) return;
    current.text = current.text ? `${current.text} ${trimmed}` : trimmed;
  };

  const walkBlocks = (blocks) => {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      switch (block.t) {
        case 'Header': {
          const [level, attr, inlines] = block.c;
          const [id] = attr;
          const title = collapseWhitespace(inlinesToText(inlines));
          const section = {
            id,
            level,
            title,
            text: '',
          };
          sections.push(section);
          current = section;
          break;
        }
        case 'Para':
        case 'Plain':
          appendText(inlinesToText(block.c));
          break;
        case 'BlockQuote':
          walkBlocks(block.c);
          break;
        case 'BulletList':
          block.c.forEach((item) => walkBlocks(item));
          break;
        case 'OrderedList':
          if (Array.isArray(block.c) && Array.isArray(block.c[1])) {
            block.c[1].forEach((item) => walkBlocks(item));
          }
          break;
        case 'DefinitionList':
          block.c.forEach(([term, defs]) => {
            appendText(inlinesToText(term));
            defs.forEach((defBlocks) => walkBlocks(defBlocks));
          });
          break;
        case 'Div':
          if (Array.isArray(block.c) && Array.isArray(block.c[1])) {
            walkBlocks(block.c[1]);
          }
          break;
        default:
          break;
      }
    }
  };

  walkBlocks(Array.isArray(doc.blocks) ? doc.blocks : []);

  return sections;
}

function groupKey(term) {
  const normalized = normalizeText(term);
  if (!normalized) return '#';
  const first = normalized[0];
  if (/[0-9]/.test(first)) return '0-9';
  return first.toUpperCase();
}

function buildIndexMarkdown(sections, keywords) {
  const sectionIndex = sections.map((section) => {
    const combined = `${section.title} ${section.text}`.trim();
    const normalized = normalizeText(combined);
    return {
      ...section,
      search: ` ${normalized} `,
    };
  });

  const hits = new Map();

  sectionIndex.forEach((section, sectionIdx) => {
    if (!section.search.trim()) return;
    for (const keyword of keywords) {
      const needle = ` ${keyword.normalized} `;
      if (section.search.includes(needle)) {
        let set = hits.get(keyword.raw);
        if (!set) {
          set = new Set();
          hits.set(keyword.raw, set);
        }
        set.add(sectionIdx);
      }
    }
  });

  const matched = keywords.filter((entry) => hits.has(entry.raw));
  const unmatched = keywords.filter((entry) => !hits.has(entry.raw));

  if (unmatched.length > 0) {
    const list = unmatched.map((entry) => entry.raw).join(', ');
    console.warn(`Unmatched keywords (${unmatched.length}): ${list}`);
  }

  matched.sort((a, b) => a.raw.localeCompare(b.raw, 'en', { sensitivity: 'base' }));

  const grouped = new Map();
  for (const entry of matched) {
    const key = groupKey(entry.raw);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  }

  const groupKeys = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
  const lines = [];
  lines.push('---');
  lines.push('');
  lines.push('\\newpage');
  lines.push('');
  lines.push('## Appendix E: Index');
  lines.push('');

  groupKeys.forEach((key) => {
    lines.push(`#### ${key}`);
    lines.push('');
    const entries = grouped.get(key);
    for (const entry of entries) {
      const set = hits.get(entry.raw);
      const sectionRefs = Array.from(set)
        .sort((a, b) => a - b)
        .map((idx) => sectionIndex[idx])
        .filter((section) => section && section.title);
      const links = sectionRefs.map((section) => {
        if (section.id) {
          return `[${section.title}](#${section.id})`;
        }
        return section.title;
      });
      if (links.length > 0) {
        lines.push(`- ${entry.raw} — ${links.join(', ')}`);
      } else {
        lines.push(`- ${entry.raw}`);
      }
    }
    lines.push('');
  });

  return lines.join('\n');
}

function renderPandocJson(inputFiles) {
  let tempDir;
  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dionysus-index-'));
    const jsonPath = path.join(tempDir, 'essay.json');
    const result = spawnSync(
      'pandoc',
      [...inputFiles, '--from=markdown', '--to=json', '-o', jsonPath],
      { stdio: 'inherit' }
    );
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`pandoc exited with status ${result.status}`);
    }
    return fs.readFileSync(jsonPath, 'utf8');
  } finally {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

function main() {
  const outputDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(ROOT, 'dist');
  const inputMd = process.argv[3]
    ? path.resolve(process.argv[3])
    : path.join(ROOT, 'essay.md');
  const keywordsPath = process.argv[4]
    ? path.resolve(process.argv[4])
    : path.join(ROOT, 'keywords.txt');
  const extraInputs = process.argv.slice(5).map((file) => path.resolve(file));

  ensureCommand('pandoc');

  if (!fs.existsSync(keywordsPath)) {
    console.error(`Keywords file not found: ${keywordsPath}`);
    process.exit(1);
  }

  ensureDir(outputDir);

  const keywords = loadKeywords(keywordsPath);
  if (keywords.length === 0) {
    console.error('No keywords found.');
    process.exit(1);
  }

  const inputFiles = [];
  const addInput = (filePath, required) => {
    if (!filePath) return;
    if (!fs.existsSync(filePath)) {
      if (required) {
        console.error(`Input file not found: ${filePath}`);
        process.exit(1);
      }
      return;
    }
    if (!inputFiles.includes(filePath)) {
      inputFiles.push(filePath);
    }
  };

  addInput(inputMd, true);

  if (extraInputs.length > 0) {
    extraInputs.forEach((filePath) => addInput(filePath, true));
  } else {
    addInput(path.join(ROOT, 'dist', 'letters-to-editor-appendix.md'), false);
    addInput(path.join(ROOT, 'appendix-sources.md'), false);
  }

  const json = renderPandocJson(inputFiles);
  const doc = JSON.parse(json);
  const sections = extractSections(doc);

  const indexMarkdown = buildIndexMarkdown(sections, keywords);
  const outputPath = path.join(outputDir, 'appendix-index.md');
  fs.writeFileSync(outputPath, indexMarkdown, 'utf8');
  console.log(`Wrote index appendix to ${outputPath}`);
}

main();
