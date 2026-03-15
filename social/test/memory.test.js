const test = require('node:test');
const assert = require('node:assert/strict');

const { setupTempSocialWorkspace } = require('./helpers');
const { loadStrategy } = require('../lib/config');
const { buildMemoryIndex, getMemoryConflicts } = require('../lib/memory');

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

