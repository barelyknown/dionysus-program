const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { setupTempSocialWorkspace } = require('./helpers');
const { loadStrategy } = require('../lib/config');
const { buildMemoryIndex, getMemoryConflicts, deriveSubjectEntities, findXDuplicate } = require('../lib/memory');
const { paths } = require('../lib/paths');
const { writeText } = require('../lib/fs');

test('memory index catches duplicate hook, angle, topic, and timely subject', (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const memory = buildMemoryIndex({
    strategy,
    publishedRecords: [
      {
        published_at: '2026-03-01T16:00:00Z',
        content_type: 'decoder_ring',
        hook: 'Most people are misreading what this reorg is actually about.',
        angle: 'The visible move is not the real diagnosis.',
        topic_thesis: 'Most management systems become theater before leaders notice.',
        timely_subject: 'big-reorg',
        source_refs: ['https://example.com/reorg'],
      },
    ],
    referenceDate: new Date('2026-03-14T12:00:00Z'),
  });

  const conflicts = getMemoryConflicts({
    strategy,
    memory,
    record: {
      content_type: 'decoder_ring',
      hook: 'Most people are misreading what this reorg is actually about.',
      angle: 'The visible move is not the real diagnosis.',
      topic_thesis: 'Most management systems become theater before leaders notice.',
      timely_subject: 'big-reorg',
      source_refs: ['https://example.com/reorg'],
    },
  });

  assert.deepEqual(conflicts.sort(), [
    'angle_duplication',
    'hook_duplication',
    'source_overuse',
    'timely_subject_duplication',
    'topic_duplication',
  ]);
});

test('deriveSubjectEntities finds lead companies from post text', (t) => {
  setupTempSocialWorkspace(t);

  assert.deepEqual(
    deriveSubjectEntities({
      timely_subject: 'Klarna CEO says company went too far in cutting customer service staff with AI',
      hook: 'Sebastian Siemiatkowski said Klarna went too far cutting customer service with AI.',
      summary: 'Klarna made cost the dominant metric.',
    }),
    ['Klarna'],
  );
});

test('memory conflicts catch duplicate lead companies', (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const memory = buildMemoryIndex({
    strategy,
    publishedRecords: [
      {
        published_at: '2026-03-23T14:26:02.045Z',
        content_type: 'decoder_ring',
        hook: 'Klarna cut deeply into customer service with AI, then had to bring humans back.',
        summary: 'Klarna did not prove AI failed.',
        timely_subject: 'Why Today\'s AI-Driven Layoffs Are Becoming Tomorrow’s Rehiring Crisis',
        source_refs: ['https://example.com/klarna'],
      },
    ],
    referenceDate: new Date('2026-03-30T12:30:00Z'),
  });

  const conflicts = getMemoryConflicts({
    strategy,
    memory,
    record: {
      content_type: 'decoder_ring',
      hook: 'Sebastian Siemiatkowski said Klarna went too far cutting customer service with AI.',
      summary: 'Klarna made cost the dominant metric.',
      timely_subject: 'Klarna CEO says company went too far in cutting customer service staff with AI',
      source_refs: ['https://example.com/reuters-klarna'],
    },
  });

  assert.ok(conflicts.includes('entity_duplication'));
});

test('memory index retains published X history regardless of age and drops failed posts', (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const memory = buildMemoryIndex({
    strategy,
    publishedRecords: [
      {
        post_id: 'old',
        published_at: '2026-01-01T16:00:00Z',
        content_type: 'extracted_insight',
        x_status: 'published',
        x_summary: 'This old post should age out.',
      },
      {
        post_id: 'failed',
        published_at: '2026-03-10T16:00:00Z',
        content_type: 'extracted_insight',
        x_status: 'failed',
        x_summary: 'This text was never published.',
      },
      {
        post_id: 'recent',
        published_at: '2026-03-12T16:00:00Z',
        x_published_at: '2026-03-12T16:05:00Z',
        content_type: 'extracted_insight',
        x_status: 'published',
        x_summary: 'A recent published X post belongs in memory.',
      },
    ],
    referenceDate: new Date('2026-03-14T12:00:00Z'),
  });

  assert.deepEqual(memory.recent_x_posts.map((record) => record.post_id), ['old', 'recent']);
});

test('rolling type counts exclude old posts while complete argument history retains them', (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const memory = buildMemoryIndex({
    strategy,
    publishedRecords: [
      {
        post_id: 'old',
        published_at: '2020-01-01T16:00:00Z',
        content_type: 'decoder_ring',
        summary: 'An old argument remains relevant to duplicate detection.',
      },
      {
        post_id: 'recent',
        published_at: '2026-03-12T16:00:00Z',
        content_type: 'extracted_insight',
        summary: 'A recent argument counts toward rotation.',
      },
    ],
    referenceDate: new Date('2026-03-14T12:00:00Z'),
  });

  assert.equal(memory.published_count, 2);
  assert.equal(memory.rolling_published_count, 1);
  assert.equal(memory.typeCounts.decoder_ring, undefined);
  assert.equal(memory.typeCounts.extracted_insight, 1);
  assert.deepEqual(memory.recent_content.map((record) => record.post_id), ['old', 'recent']);
});

test('X duplicate detection catches exact and practically identical wording', () => {
  const recentPosts = [{
    post_id: 'x-1',
    x_summary: 'A healthy team can look disciplined while becoming less honest. The dashboard stays green because bad news moved into private channels.',
  }];

  assert.equal(findXDuplicate(recentPosts[0].x_summary, recentPosts)?.reason, 'x_exact_duplicate');
  assert.equal(findXDuplicate(
    'A healthy team can look disciplined while becoming less honest. Its dashboard stays green because the bad news moved into private channels.',
    recentPosts,
    0.72,
  )?.reason, 'x_near_duplicate');
  assert.equal(findXDuplicate('A post about an unrelated customer-service failure.', recentPosts, 0.72), null);
});

test('content memory catches a practically identical LinkedIn or Notes body across the full ledger', (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const memory = buildMemoryIndex({
    strategy,
    publishedRecords: [{
      post_id: 'old-post',
      published_at: '2020-01-01T16:00:00Z',
      content_type: 'extracted_insight',
      summary: 'A healthy team can look disciplined while becoming less honest. The dashboard stays green because bad news moved into private channels.',
    }],
    referenceDate: new Date('2026-03-14T12:00:00Z'),
  });
  const conflicts = getMemoryConflicts({
    strategy,
    memory,
    record: {
      content_type: 'extracted_insight',
      summary: 'A healthy team can look disciplined while becoming less honest. Its dashboard stays green because the bad news moved into private channels.',
      source_refs: [],
    },
  });

  assert.ok(conflicts.includes('content_duplication'));
});

test('content memory reads the complete note body instead of relying on the 280-character ledger summary', (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const notePath = path.join(paths.notesContentDir, 'complete-note.md');
  writeText(notePath, [
    '---',
    'title: Complete note',
    '---',
    '',
    'The ledger only retained the opener.',
    '',
    'The distinctive argument appears later: rotation without a memory-bearing handoff converts anti-capture into institutional amnesia.',
    '',
  ].join('\n'));
  const memory = buildMemoryIndex({
    strategy,
    publishedRecords: [{
      post_id: 'complete-note-post',
      published_at: '2020-01-01T16:00:00Z',
      content_type: 'extracted_insight',
      summary: 'The ledger only retained the opener.',
      note_source_path: 'content/notes/complete-note.md',
    }],
    referenceDate: new Date('2026-03-14T12:00:00Z'),
  });

  assert.match(memory.recent_content[0].text, /institutional amnesia/);
  assert.ok(memory.recent_content[0].text.length > memory.recent_content[0].summary.length);
});

test('content memory retains the complete argument after a redundant site note is removed', (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const memory = buildMemoryIndex({
    strategy,
    publishedRecords: [{
      post_id: 'removed-site-note',
      published_at: '2026-03-12T16:00:00Z',
      content_type: 'extracted_insight',
      summary: 'The public note was removed.',
      site_status: 'removed_redundant',
      note_source_path: null,
      publication_memory_text: 'The complete removed argument remains available for future novelty checks.',
    }],
    referenceDate: new Date('2026-03-14T12:00:00Z'),
  });

  assert.equal(memory.published_count, 1);
  assert.equal(memory.site_published_count, 0);
  assert.equal(memory.site_removed_count, 1);
  assert.match(memory.recent_content[0].text, /complete removed argument/);
});
