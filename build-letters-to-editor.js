#!/usr/bin/env node
/**
 * Build letters-to-editor markdown outputs from letters_to_editor/*.txt.
 *
 * Usage: node build-letters-to-editor.js [outputDir]
 * Outputs:
 *   - <outputDir>/letters-to-editor.md
 *   - <outputDir>/letters-to-editor-appendix.md
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PEOPLE_PATH = path.join(ROOT, 'people.csv');
const LETTERS_DIR = path.join(ROOT, 'letters_to_editor');

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\"') {
      const next = line[i + 1];
      if (inQuotes && next === '\"') {
        current += '\"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]).map((cell) => cell.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < header.length; j += 1) {
      row[header[j]] = values[j] ? values[j].trim() : '';
    }
    rows.push(row);
  }
  return rows;
}

function slugify(name) {
  const ascii = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'unknown';
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadLetter(slug, name) {
  const filePath = path.join(LETTERS_DIR, `${slug}.txt`);
  if (!fs.existsSync(filePath)) {
    console.warn(`Missing letter file for ${name} (${filePath})`);
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
}

function buildLettersMarkdown(names, options = {}) {
  const {
    htmlPageBreaks = false,
    pdfPageBreaks = false,
    htmlDividers = false,
    htmlDividerBeforeAppendix = false,
    prefixNot = true,
  } = options;
  const lines = [];
  if (htmlDividerBeforeAppendix) {
    lines.push('<hr class="letter-divider">');
    lines.push('');
  }
  lines.push('## Appendix C: Letters to the Editor');
  lines.push('');
  lines.push(
    "These letters are fictional. They were generated to explore the Dionysus Program's ideas from the perspectives of the source thinkers and the archetypes named in the essay. I greatly enjoyed the letters, and learned much from them too."
  );
  lines.push('');
  lines.push('I hope you do as well,');
  lines.push('');
  lines.push('Sean Devine');
  lines.push('');
  if (htmlDividers) {
    lines.push('<hr class="letter-divider">');
  }
  if (pdfPageBreaks) {
    lines.push('');
    lines.push('```{=latex}');
    lines.push('\\newpage');
    lines.push('```');
  }
  lines.push('');

  names.forEach((name, index) => {
    if (index > 0 && htmlDividers) {
      lines.push('<hr class="letter-divider">');
      lines.push('');
    }
    if (index > 0 && htmlPageBreaks) {
      lines.push('<div class="letter-page-break"></div>');
      lines.push('');
    }
    if (index > 0 && pdfPageBreaks) {
      lines.push('```{=latex}');
      lines.push('\\newpage');
      lines.push('```');
      lines.push('');
    }

    const heading = prefixNot ? `### *Not* ${name}` : `### ${name}`;
    lines.push(heading);
    lines.push('');

    const slug = slugify(name);
    const content = loadLetter(slug, name).replace(/\s+$/, '');
    if (content) {
      lines.push(content);
      lines.push('');
    } else {
      lines.push('');
    }

    if (!htmlPageBreaks && !pdfPageBreaks && index < names.length - 1) {
      lines.push('---');
      lines.push('');
    }
  });

  return lines.join('\n');
}

function main() {
  const outputDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(ROOT, 'dist');

  ensureDir(outputDir);

  const peopleCsv = fs.readFileSync(PEOPLE_PATH, 'utf8');
  const rows = parseCsv(peopleCsv);
  const names = rows
    .map((row) => row.name)
    .filter((name) => typeof name === 'string' && name.trim() !== '');

  names.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

  const downloadMarkdown = buildLettersMarkdown(names, {});
  const appendixMarkdown = buildLettersMarkdown(names, {
    htmlPageBreaks: false,
    pdfPageBreaks: true,
    htmlDividers: true,
    htmlDividerBeforeAppendix: true,
  });

  fs.writeFileSync(path.join(outputDir, 'letters-to-editor.md'), downloadMarkdown, 'utf8');
  fs.writeFileSync(
    path.join(outputDir, 'letters-to-editor-appendix.md'),
    appendixMarkdown,
    'utf8'
  );
}

main();
