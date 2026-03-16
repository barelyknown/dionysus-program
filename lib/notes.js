const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const TITLE_MAX_LENGTH = 88;
const EXCERPT_MAX_LENGTH = 200;

function collapseWhitespace(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function splitParagraphs(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((paragraph) => collapseWhitespace(paragraph))
    .filter(Boolean);
}

function normalizeNoteBody(text) {
  return splitParagraphs(text).join('\n\n');
}

function stripStandaloneLinks(text) {
  return splitParagraphs(text)
    .filter((paragraph) => !/^https?:\/\/\S+$/i.test(paragraph))
    .join('\n\n');
}

function stripHashtagParagraphs(text) {
  return splitParagraphs(text)
    .filter((paragraph) => !/^(#[\p{L}\p{N}_-]+\s*)+$/u.test(paragraph))
    .join('\n\n');
}

function trimPlatformNativeLead(text) {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length < 2) return paragraphs.join('\n\n');

  const first = paragraphs[0];
  const matchesLinkedInLead = [
    /^most people are misreading/i,
    /^the surface story is not the real story/i,
    /^the visible story is not the real diagnosis/i,
    /^if you run teams,/i,
    /^a lot of leaders think/i,
  ].some((pattern) => pattern.test(first));

  if (!matchesLinkedInLead) return paragraphs.join('\n\n');
  return paragraphs.slice(1).join('\n\n');
}

function lightlyRewriteForNotes(text) {
  return normalizeNoteBody(trimPlatformNativeLead(stripHashtagParagraphs(stripStandaloneLinks(text))));
}

function normalizeTitleCandidate(text) {
  return collapseWhitespace(text).replace(/[.?!:;]+$/, '').trim();
}

function looksLikeCleanTitle(text) {
  const candidate = normalizeTitleCandidate(text);
  if (!candidate) return false;
  if (candidate.length > TITLE_MAX_LENGTH) return false;
  if (candidate.includes('\n')) return false;
  if (/^(most people are misreading|the surface story is not the real story|if you run teams,|a lot of leaders think)/i.test(candidate)) {
    return false;
  }
  if ((candidate.match(/[.?!]/g) || []).length > 1) return false;
  return true;
}

function deriveNoteTitle({ text, topicThesis }) {
  const firstParagraph = splitParagraphs(text)[0] || '';
  if (looksLikeCleanTitle(firstParagraph)) {
    return normalizeTitleCandidate(firstParagraph);
  }
  const thesis = normalizeTitleCandidate(topicThesis);
  if (thesis) return thesis;
  if (firstParagraph) return normalizeTitleCandidate(firstParagraph).slice(0, TITLE_MAX_LENGTH) || 'Untitled Note';
  return 'Untitled Note';
}

function deriveNoteExcerpt(text, maxLength = EXCERPT_MAX_LENGTH) {
  const firstParagraph = splitParagraphs(text)[0] || '';
  if (!firstParagraph) return '';
  if (firstParagraph.length <= maxLength) return firstParagraph;
  const sliced = firstParagraph.slice(0, maxLength - 3);
  const breakpoint = sliced.lastIndexOf(' ');
  const trimmed = breakpoint >= 80 ? sliced.slice(0, breakpoint) : sliced;
  return `${trimmed.trim()}...`;
}

function slugify(text) {
  const normalized = String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return normalized || 'note';
}

function parseMarkdownWithFrontmatter(markdown) {
  const text = String(markdown || '');
  if (!text.startsWith('---\n')) {
    return { data: {}, body: text.trim() };
  }

  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('Invalid markdown frontmatter block.');
  }

  return {
    data: YAML.parse(match[1]) || {},
    body: match[2].trim(),
  };
}

function stringifyMarkdownWithFrontmatter(data, body) {
  const frontmatter = YAML.stringify(data).trimEnd();
  const trimmedBody = String(body || '').trim();
  return `---\n${frontmatter}\n---\n\n${trimmedBody}\n`;
}

function listNoteFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .map((name) => path.join(dirPath, name))
    .filter((filePath) => fs.statSync(filePath).isFile() && filePath.endsWith('.md'))
    .sort();
}

function loadNoteFile(filePath) {
  const { data, body } = parseMarkdownWithFrontmatter(fs.readFileSync(filePath, 'utf8'));
  return { filePath, data, body };
}

function findExistingNoteBySocialItemId(dirPath, socialItemId) {
  return listNoteFiles(dirPath)
    .map((filePath) => loadNoteFile(filePath))
    .find((note) => String(note.data.social_item_id || '') === String(socialItemId || '')) || null;
}

function resolveNoteSlug(dirPath, { title, date, itemId }) {
  const datePrefix = String(date || '').slice(0, 10) || 'undated';
  const baseSlug = `${datePrefix}-${slugify(title)}`;
  const desiredPath = path.join(dirPath, `${baseSlug}.md`);
  if (!fs.existsSync(desiredPath)) return baseSlug;
  return `${baseSlug}-${slugify(itemId).slice(0, 12) || 'item'}`;
}

function formatDisplayDate(dateInput) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return String(dateInput || '');
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

module.exports = {
  collapseWhitespace,
  splitParagraphs,
  normalizeNoteBody,
  lightlyRewriteForNotes,
  deriveNoteTitle,
  deriveNoteExcerpt,
  slugify,
  parseMarkdownWithFrontmatter,
  stringifyMarkdownWithFrontmatter,
  listNoteFiles,
  loadNoteFile,
  findExistingNoteBySocialItemId,
  resolveNoteSlug,
  formatDisplayDate,
};
