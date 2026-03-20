const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { setupTempSocialWorkspace } = require('./helpers');
const { loadStrategy } = require('../lib/config');
const { paths } = require('../lib/paths');
const { materializePublishedNote } = require('../lib/notes');
const { ClaudeWriterAdapter } = require('../providers/claude-writer');
const { OpenAIWriterAdapter } = require('../providers/openai-writer');
const { loadNoteFile, stringifyMarkdownWithFrontmatter } = require('../../lib/notes');
const { buildNotesSite } = require('../../build-notes');

const NOTES_TEMPLATE_PATH = path.join(__dirname, '..', '..', 'templates', 'notes-page.html');

test('materializePublishedNote creates an AI-rewritten note source file with deterministic metadata', async (t) => {
  const { tempRoot } = setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const writer = new ClaudeWriterAdapter({ mode: 'fixture' });

  const calendarItem = {
    id: 'item-1',
    content_type: 'decoder_ring',
    pillar: 'Decoder Ring',
    topic_thesis: 'Organizations fail socially before they fail technically.',
  };

  const publishPayload = {
    final_text: [
      'Most people are misreading what this failure is actually about.',
      '',
      'Organizations fail socially before they fail technically.',
      '',
      'The visible bug is often just the place where a trust problem finally becomes measurable.',
    ].join('\n'),
  };

  const publishResult = {
    delivered_at: '2026-03-17T15:30:00.000Z',
    external_post_id: 'fixture-123',
    linkedin_post_url: 'https://www.linkedin.com/feed/update/urn:li:activity:123',
    linkedin_activity_urn: 'urn:li:activity:123',
  };

  const result = await materializePublishedNote({
    calendarItem,
    publishPayload,
    publishResult,
    writer,
    strategy,
  });

  assert.equal(result.slug, '2026-03-17-organizations-fail-socially-before-they-fail-technically');
  assert.equal(result.sourceMode, 'ai_rewrite');
  assert.equal(result.sourcePath, 'content/notes/2026-03-17-organizations-fail-socially-before-they-fail-technically.md');

  const note = loadNoteFile(path.join(tempRoot, result.sourcePath));
  assert.equal(note.data.social_item_id, 'item-1');
  assert.equal(note.data.external_post_id, 'fixture-123');
  assert.equal(note.data.linkedin_post_url, 'https://www.linkedin.com/feed/update/urn:li:activity:123');
  assert.equal(note.data.linkedin_activity_urn, 'urn:li:activity:123');
  assert.equal(note.data.source_mode, 'ai_rewrite');
  assert.match(note.body, /trust problem/i);
  assert.doesNotMatch(note.body, /Most people are misreading/i);
});

test('materializePublishedNote uses OpenAI writer rewrite path in fixture mode', async (t) => {
  const { tempRoot } = setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const writer = new OpenAIWriterAdapter({ mode: 'fixture' });

  const calendarItem = {
    id: 'item-openai',
    content_type: 'decoder_ring',
    pillar: 'Decoder Ring',
    topic_thesis: 'Naming failures make accountability rituals unserious.',
  };

  const publishPayload = {
    final_text: [
      'Most people are misreading what this backlash is actually about.',
      '',
      'Naming failures make accountability rituals unserious.',
      '',
      'Once the public story stops tracking the real choice, every cleanup ritual becomes theater.',
    ].join('\n'),
  };

  const publishResult = {
    delivered_at: '2026-03-17T16:00:00.000Z',
    external_post_id: 'fixture-openai-123',
  };

  const result = await materializePublishedNote({
    calendarItem,
    publishPayload,
    publishResult,
    writer,
    strategy,
  });

  assert.equal(result.sourceMode, 'ai_rewrite');
  const note = loadNoteFile(path.join(tempRoot, result.sourcePath));
  assert.equal(note.data.source_mode, 'ai_rewrite');
  assert.match(note.body, /cleanup ritual becomes theater/i);
  assert.doesNotMatch(note.body, /Most people are misreading/i);
});

test('materializePublishedNote falls back to normalized published text and is idempotent', async (t) => {
  const { tempRoot } = setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const writer = {
    rewriteForNotes: async () => {
      throw new Error('rewrite failed');
    },
  };

  const calendarItem = {
    id: 'item-2',
    content_type: 'extracted_insight',
    pillar: 'Extracted Insights',
    topic_thesis: 'Trust burns faster than organizations know how to rebuild it.',
  };

  const publishPayload = {
    final_text: 'Trust burns faster than organizations know how to rebuild it.\n\nhttps://example.com/post',
  };

  const publishResult = {
    delivered_at: '2026-03-18T15:30:00.000Z',
    external_post_id: 'fixture-456',
  };

  const first = await materializePublishedNote({
    calendarItem,
    publishPayload,
    publishResult,
    writer,
    strategy,
  });
  const second = await materializePublishedNote({
    calendarItem,
    publishPayload: { final_text: 'This should not replace the existing note.' },
    publishResult,
    writer: new ClaudeWriterAdapter({ mode: 'fixture' }),
    strategy,
  });

  assert.equal(first.slug, second.slug);
  assert.equal(first.sourcePath, second.sourcePath);

  const note = loadNoteFile(path.join(tempRoot, first.sourcePath));
  assert.equal(note.data.source_mode, 'verbatim_fallback');
  assert.equal(note.body, 'Trust burns faster than organizations know how to rebuild it.\n\nhttps://example.com/post');
});

test('materializePublishedNote uses publish body_text so LinkedIn footer does not leak into notes', async (t) => {
  const { tempRoot } = setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const writer = {
    rewriteForNotes: async () => {
      throw new Error('rewrite failed');
    },
  };

  const calendarItem = {
    id: 'item-footer',
    content_type: 'extracted_insight',
    pillar: 'Extracted Insights',
    topic_thesis: 'Truth gets more expensive before it gets unspeakable.',
  };

  const publishPayload = {
    body_text: 'Truth gets more expensive before it gets unspeakable.\n\nThat is when distortion starts looking like professionalism.',
    final_text: 'Truth gets more expensive before it gets unspeakable.\n\nThat is when distortion starts looking like professionalism.\n\n---\n\nThe Dionysus Program is free at dionysusprogram.com.',
  };

  const publishResult = {
    delivered_at: '2026-03-18T15:30:00.000Z',
    external_post_id: 'fixture-footer',
  };

  const result = await materializePublishedNote({
    calendarItem,
    publishPayload,
    publishResult,
    writer,
    strategy,
  });

  const note = loadNoteFile(path.join(tempRoot, result.sourcePath));
  assert.doesNotMatch(note.body, /The Dionysus Program is free at dionysusprogram\.com/i);
  assert.doesNotMatch(note.body, /^---$/m);
});

test('materializePublishedNote appends item id on slug collision', async (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const writer = new ClaudeWriterAdapter({ mode: 'fixture' });

  const publishPayload = {
    final_text: 'Trust burns faster than it builds.',
  };
  const publishResult = {
    delivered_at: '2026-03-19T15:30:00.000Z',
    external_post_id: 'fixture-collision',
  };

  const first = await materializePublishedNote({
    calendarItem: {
      id: 'item-a',
      content_type: 'extracted_insight',
      pillar: 'Extracted Insights',
      topic_thesis: 'Trust burns faster than it builds.',
    },
    publishPayload,
    publishResult,
    writer,
    strategy,
  });

  const second = await materializePublishedNote({
    calendarItem: {
      id: 'item-b',
      content_type: 'extracted_insight',
      pillar: 'Extracted Insights',
      topic_thesis: 'Trust burns faster than it builds.',
    },
    publishPayload,
    publishResult: {
      ...publishResult,
      external_post_id: 'fixture-collision-2',
    },
    writer,
    strategy,
  });

  assert.equal(first.slug, '2026-03-19-trust-burns-faster-than-it-builds');
  assert.equal(second.slug, '2026-03-19-trust-burns-faster-than-it-builds-item-b');
});

test('buildNotesSite renders notes archive, detail pages, and homepage teaser metadata', async (t) => {
  const { tempRoot } = setupTempSocialWorkspace(t);
  const notesDir = paths.notesContentDir;
  const outputDir = path.join(tempRoot, 'notes');
  const teaserMetaPath = path.join(tempRoot, 'dist', 'notes-teaser.yaml');

  fs.writeFileSync(path.join(notesDir, '2026-03-20-second-note.md'), stringifyMarkdownWithFrontmatter({
    title: 'Second Note',
    date: '2026-03-20T15:30:00.000Z',
    slug: '2026-03-20-second-note',
    content_type: 'decoder_ring',
    pillar: 'Decoder Ring',
    topic_thesis: 'Second thesis',
    social_item_id: 'item-20',
    external_post_id: 'post-20',
    source_mode: 'ai_rewrite',
    excerpt: 'Second excerpt',
  }, 'Second note body.'), 'utf8');

  fs.writeFileSync(path.join(notesDir, '2026-03-19-first-note.md'), stringifyMarkdownWithFrontmatter({
    title: 'First Note',
    date: '2026-03-19T15:30:00.000Z',
    slug: '2026-03-19-first-note',
    content_type: 'ritual_recipe',
    pillar: 'Ritual Recipes',
    topic_thesis: 'First thesis',
    social_item_id: 'item-19',
    external_post_id: 'post-19',
    source_mode: 'ai_rewrite',
    excerpt: 'First excerpt',
  }, 'First note body.'), 'utf8');

  const result = buildNotesSite({
    inputDir: notesDir,
    outputDir,
    teaserMetaPath,
    templatePath: NOTES_TEMPLATE_PATH,
  });

  assert.equal(result.notes.length, 2);
  const archiveHtml = fs.readFileSync(path.join(outputDir, 'index.html'), 'utf8');
  const detailHtml = fs.readFileSync(path.join(outputDir, '2026-03-20-second-note', 'index.html'), 'utf8');
  const teaserYaml = fs.readFileSync(teaserMetaPath, 'utf8');

  assert.match(archiveHtml, /Second Note/);
  assert.ok(archiveHtml.indexOf('Second Note') < archiveHtml.indexOf('First Note'));
  assert.match(detailHtml, /Second note body/);
  assert.match(teaserYaml, /recent_notes:/);
  assert.match(teaserYaml, /2026-03-20-second-note/);
});

test('buildNotesSite rejects notes with missing required frontmatter', (t) => {
  const { tempRoot } = setupTempSocialWorkspace(t);
  const notesDir = paths.notesContentDir;

  fs.writeFileSync(path.join(notesDir, 'broken.md'), stringifyMarkdownWithFrontmatter({
    title: 'Broken Note',
    date: '2026-03-21T15:30:00.000Z',
  }, 'Broken body.'), 'utf8');

  assert.throws(() => {
    buildNotesSite({
      inputDir: notesDir,
      outputDir: path.join(tempRoot, 'notes'),
      teaserMetaPath: path.join(tempRoot, 'dist', 'notes-teaser.yaml'),
      templatePath: NOTES_TEMPLATE_PATH,
    });
  }, /missing required field/);
});
