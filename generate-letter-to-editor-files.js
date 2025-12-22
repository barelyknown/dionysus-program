#!/usr/bin/env node
/**
 * Generate letter-to-editor prompts and empty letter files for each person.
 *
 * Usage: node generate-letter-to-editor-files.js
 * Output:
 *   - prompts/letters_to_editor/<slug>.txt (prompt per person)
 *   - letters_to_editor/<slug>.txt (empty file per person, if missing)
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PEOPLE_PATH = path.join(ROOT, 'people.csv');
const ESSAY_PATH = path.join(ROOT, 'essay.md');
const TEMPLATE_PATH = path.join(ROOT, 'prompts', 'letter_to_editor_template.txt');
const PROMPTS_DIR = path.join(ROOT, 'prompts', 'letters_to_editor');
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

function main() {
  const peopleCsv = fs.readFileSync(PEOPLE_PATH, 'utf8');
  const essay = fs.readFileSync(ESSAY_PATH, 'utf8');
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

  const rows = parseCsv(peopleCsv);
  const names = rows
    .map((row) => row.name)
    .filter((name) => typeof name === 'string' && name.trim() !== '');

  ensureDir(PROMPTS_DIR);
  ensureDir(LETTERS_DIR);

  const slugCounts = new Map();

  for (const name of names) {
    let slug = slugify(name);
    const current = slugCounts.get(slug) || 0;
    slugCounts.set(slug, current + 1);
    if (current > 0) {
      slug = `${slug}_${current + 1}`;
    }

    const promptText = template
      .replaceAll('{person}', name)
      .replaceAll('{essay}', essay);
    const promptPath = path.join(PROMPTS_DIR, `${slug}.txt`);
    fs.writeFileSync(promptPath, promptText, 'utf8');

    const letterPath = path.join(LETTERS_DIR, `${slug}.txt`);
    if (!fs.existsSync(letterPath)) {
      fs.writeFileSync(letterPath, '', 'utf8');
    }
  }
}

main();
