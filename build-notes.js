#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const YAML = require('yaml');
const {
  deriveNoteExcerpt,
  formatDisplayDate,
  listNoteFiles,
  loadNoteFile,
} = require('./lib/notes');

const ROOT = __dirname;
const DEFAULT_INPUT_DIR = path.join(ROOT, 'content', 'notes');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'notes');
const DEFAULT_TEMPLATE_PATH = path.join(ROOT, 'templates', 'notes-page.html');
const DEFAULT_TEASER_META_PATH = path.join(ROOT, 'dist', 'notes-teaser.yaml');
const SITE_URL = 'https://www.dionysusprogram.com';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function renderTemplate(template, replacements) {
  return Object.entries(replacements).reduce((output, [key, value]) => {
    return output.split(`{{${key}}}`).join(String(value));
  }, template);
}

function markdownToHtml(markdown) {
  const result = spawnSync('pandoc', ['--from=markdown', '--to=html5'], {
    input: markdown,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || 'Pandoc failed while rendering notes markdown.');
  }

  return result.stdout.trim();
}

function validateNoteData(note) {
  const required = [
    'title',
    'date',
    'slug',
    'content_type',
    'pillar',
    'topic_thesis',
    'social_item_id',
    'external_post_id',
    'source_mode',
  ];

  for (const field of required) {
    if (!note.data[field] || !String(note.data[field]).trim()) {
      throw new Error(`Note ${note.filePath} is missing required field "${field}".`);
    }
  }

  if (!note.body || !String(note.body).trim()) {
    throw new Error(`Note ${note.filePath} is missing body content.`);
  }
}

function loadNotes(inputDir) {
  ensureDir(inputDir);
  return listNoteFiles(inputDir)
    .map((filePath) => loadNoteFile(filePath))
    .map((note) => {
      validateNoteData(note);
      const excerpt = note.data.excerpt ? String(note.data.excerpt) : deriveNoteExcerpt(note.body);
      return {
        ...note,
        title: String(note.data.title),
        date: String(note.data.date),
        slug: String(note.data.slug),
        pillar: String(note.data.pillar),
        topicThesis: String(note.data.topic_thesis),
        excerpt,
        displayDate: formatDisplayDate(note.data.date),
        archiveHref: `${note.data.slug}/index.html`,
        homeHref: `notes/${note.data.slug}/index.html`,
      };
    })
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
}

function renderArchiveContent(notes) {
  if (notes.length === 0) {
    return [
      '<section class="notes-archive">',
      '  <p class="notes-empty">Published notes will appear here once the social workflow starts minting site versions.</p>',
      '</section>',
    ].join('\n');
  }

  const cards = notes.map((note) => [
    `  <a class="note-card" href="${escapeAttribute(note.archiveHref)}" aria-label="${escapeAttribute(note.title)}">`,
    `    <p class="note-card-meta"><span>${escapeHtml(note.pillar)}</span><span aria-hidden="true">·</span><time datetime="${escapeAttribute(note.date)}">${escapeHtml(note.displayDate)}</time></p>`,
    `    <h2><span class="note-card-title-link">${escapeHtml(note.title)}</span></h2>`,
    `    <p class="note-card-excerpt">${escapeHtml(note.excerpt)}</p>`,
    '  </a>',
  ].join('\n'));

  return [
    '<section class="notes-archive">',
    cards.join('\n'),
    '</section>',
  ].join('\n');
}

function renderDetailContent(note, bodyHtml) {
  return [
    '<article class="note-entry">',
    `  <p class="note-entry-meta"><span>${escapeHtml(note.pillar)}</span><span aria-hidden="true">·</span><time datetime="${escapeAttribute(note.date)}">${escapeHtml(note.displayDate)}</time></p>`,
    `  <div class="note-entry-body">${bodyHtml}</div>`,
    '</article>',
  ].join('\n');
}

function renderPageHtml({
  template,
  metaTitle,
  ogTitle,
  metaDescription,
  ogType,
  ogUrl,
  assetPrefix,
  homeHref,
  breadcrumbs,
  eyebrow,
  pageTitle,
  pageSubtitle,
  content,
  mainClass,
}) {
  return renderTemplate(template, {
    META_TITLE: escapeHtml(metaTitle),
    OG_TITLE: escapeHtml(ogTitle),
    META_DESCRIPTION: escapeHtml(metaDescription),
    OG_TYPE: escapeHtml(ogType),
    OG_URL: escapeAttribute(ogUrl),
    ASSET_PREFIX: escapeAttribute(assetPrefix),
    HOME_HREF: escapeAttribute(homeHref),
    BREADCRUMBS: breadcrumbs,
    EYEBROW: escapeHtml(eyebrow),
    PAGE_TITLE: escapeHtml(pageTitle),
    PAGE_SUBTITLE: escapeHtml(pageSubtitle),
    MAIN_CLASS: escapeAttribute(mainClass),
    CONTENT: content,
  });
}

function pageContext(kind) {
  if (kind === 'detail') {
    return {
      assetPrefix: '../../',
      homeHref: '../../index.html',
      breadcrumbs: '<a href="../index.html">Notes</a>',
    };
  }

  return {
    assetPrefix: '../',
    homeHref: '../index.html',
    breadcrumbs: '',
  };
}

function writeTeaserMetadata(teaserMetaPath, notes) {
  ensureDir(path.dirname(teaserMetaPath));
  const payload = {
    notes_archive_url: 'notes/index.html',
    recent_notes_empty: notes.length === 0,
  };

  if (notes.length > 0) {
    payload.recent_notes = notes.slice(0, 3).map((note) => ({
      title: note.title,
      display_date: note.displayDate,
      url: note.homeHref,
      excerpt: note.excerpt,
      pillar: note.pillar,
    }));
  }

  fs.writeFileSync(teaserMetaPath, YAML.stringify(payload), 'utf8');
}

function buildNotesSite({
  inputDir = DEFAULT_INPUT_DIR,
  outputDir = DEFAULT_OUTPUT_DIR,
  templatePath = DEFAULT_TEMPLATE_PATH,
  teaserMetaPath = DEFAULT_TEASER_META_PATH,
} = {}) {
  const template = fs.readFileSync(templatePath, 'utf8');
  const notes = loadNotes(inputDir);

  fs.rmSync(outputDir, { recursive: true, force: true });
  ensureDir(outputDir);

  const archiveHtml = renderPageHtml({
    template,
    ...pageContext('index'),
    metaTitle: 'Notes | The Dionysus Program',
    ogTitle: 'Notes',
    metaDescription: 'Short published notes adapted from Sean Devine’s weekly social workflow.',
    ogType: 'website',
    ogUrl: `${SITE_URL}/notes/`,
    eyebrow: '',
    pageTitle: 'Notes',
    pageSubtitle: 'Short notes on leadership, ritual, trust, and organizational life.',
    content: renderArchiveContent(notes),
    mainClass: 'notes-index',
  });

  fs.writeFileSync(path.join(outputDir, 'index.html'), `${archiveHtml}\n`, 'utf8');

  for (const note of notes) {
    const noteOutputDir = path.join(outputDir, note.slug);
    ensureDir(noteOutputDir);
    const bodyHtml = markdownToHtml(note.body);
    const noteHtml = renderPageHtml({
      template,
      ...pageContext('detail'),
      metaTitle: `${note.title} | Notes | The Dionysus Program`,
      ogTitle: note.title,
      metaDescription: note.excerpt,
      ogType: 'article',
      ogUrl: `${SITE_URL}/notes/${note.slug}/`,
      eyebrow: '',
      pageTitle: note.title,
      pageSubtitle: note.displayDate,
      content: renderDetailContent(note, bodyHtml),
      mainClass: 'notes-detail',
    });
    fs.writeFileSync(path.join(noteOutputDir, 'index.html'), `${noteHtml}\n`, 'utf8');
  }

  writeTeaserMetadata(teaserMetaPath, notes);

  return {
    notes,
    archivePath: path.join(outputDir, 'index.html'),
    teaserMetaPath,
  };
}

if (require.main === module) {
  const inputDir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_INPUT_DIR;
  const outputDir = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUTPUT_DIR;
  const templatePath = process.argv[4] ? path.resolve(process.argv[4]) : DEFAULT_TEMPLATE_PATH;
  const teaserMetaPath = process.argv[5] ? path.resolve(process.argv[5]) : DEFAULT_TEASER_META_PATH;

  const result = buildNotesSite({ inputDir, outputDir, templatePath, teaserMetaPath });
  process.stdout.write(`Wrote notes archive to ${result.archivePath}\n`);
}

module.exports = {
  buildNotesSite,
  loadNotes,
};
