const test = require('node:test');
const assert = require('node:assert/strict');

const { setupTempSocialWorkspace } = require('./helpers');
const { loadStrategy } = require('../lib/config');
const { buildMemoryIndex, getMemoryConflicts, deriveSubjectEntities } = require('../lib/memory');

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
