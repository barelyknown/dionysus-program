const test = require('node:test');
const assert = require('node:assert/strict');

const { setupTempSocialWorkspace } = require('./helpers');
const { isDue, nextCalendarItemState } = require('../lib/publish-due-state');
const { handleItem } = require('../cli/publish-due');

test('publish-due retries previously research-pending items', () => {
  const currentTime = new Date('2026-03-16T13:30:00.000Z');

  assert.equal(isDue({
    status: 'planned',
    scheduled_at: '2026-03-16T12:30:00.000Z',
  }, currentTime), true);

  assert.equal(isDue({
    status: 'skipped',
    skip_reason: 'research_pending',
    scheduled_at: '2026-03-16T12:30:00.000Z',
  }, currentTime), true);

  assert.equal(isDue({
    status: 'skipped',
    skip_reason: 'memory_conflict',
    scheduled_at: '2026-03-16T12:30:00.000Z',
  }, currentTime), true);
});

test('research-pending outcomes remain planned for retry', () => {
  const item = {
    id: 'item-1',
    status: 'skipped',
    skip_reason: 'research_pending',
    scheduled_at: '2026-03-16T12:30:00.000Z',
    topic_thesis: 'Rectification of Names matters.',
  };

  const next = nextCalendarItemState(item, {
    status: 'deferred',
    reason: 'research_pending',
    calendarItem: item,
  });

  assert.equal(next.status, 'planned');
  assert.equal(next.skip_reason, null);
});

test('published outcomes clear stale skip reasons', () => {
  const item = {
    id: 'item-1',
    status: 'skipped',
    skip_reason: 'research_pending',
  };

  const next = nextCalendarItemState(item, {
    status: 'published',
    calendarItem: item,
    winnerCandidate: { id: 'winner-1' },
    payload: { item_id: 'item-1' },
    publishResult: {
      delivered_at: '2026-03-16T13:18:47.586Z',
      external_post_id: 'external-1',
    },
    note: null,
    x: null,
  });

  assert.equal(next.status, 'published');
  assert.equal(next.skip_reason, null);
});

test('handleItem rewrites a duplicated angle instead of skipping', async (t) => {
  setupTempSocialWorkspace(t);

  const strategy = {
    voice: { description: 'Direct and concrete.' },
    book_context: { title: 'The Dionysus Program' },
    publishing: {
      linkedin_footer_divider: '---',
      linkedin_footer_options: ['Footer copy.'],
    },
    generation: {
      prompt_variants: ['hook_forward'],
      best_of_n: 1,
    },
    content_types: {
      extracted_insight: { rolling_max: 8 },
    },
    x: { enabled: false },
  };

  const item = {
    id: 'item-angle',
    scheduled_at: '2026-03-25T12:30:00.000Z',
    slot_type: 'baseline',
    content_type: 'extracted_insight',
    pillar: 'Extracted Insights',
    topic_thesis: 'Waiting for organic trust in a fast-melt environment can be negligence dressed as virtue.',
    angle: 'Name the concept, explain it plainly, and show why it matters now.',
    hook: 'The mistake leaders keep making is thinking waiting is prudent.',
    timely_subject: null,
  };

  const memory = {
    published_count: 1,
    typeCounts: {},
    recent_hooks: [],
    recent_angles: [
      { angle: 'Name the concept, explain it plainly, and show why it matters now.' },
    ],
    recent_topics: [],
    recent_subjects: [],
    recent_sources: [],
  };

  const adapters = {
    writer: {
      generateCandidates: async () => ([
        {
          id: 'candidate-1',
          post_text: 'Waiting for organic trust in a fast-melt environment can be negligence dressed as virtue.\n\nTrust does not become sufficient just because leaders wait longer.',
        },
      ]),
    },
    scorer: {
      scoreCandidates: async () => ([
        {
          candidate_id: 'candidate-1',
          overall_score: 8.7,
          pass: true,
          pass_fail_reasons: [],
        },
      ]),
    },
  };

  const outcome = await handleItem({
    item,
    strategy,
    adapters,
    memory,
    dryRun: true,
  });

  assert.equal(outcome.status, 'dry_run');
  assert.notEqual(outcome.calendarItem.angle, item.angle);
  assert.equal(outcome.calendarItem.angle, 'Start with the false virtue, then show the operating cost it hides.');
  assert.deepEqual(outcome.conflicts, []);
});

test('handleItem publishes best effort instead of skipping on memory conflict', async (t) => {
  setupTempSocialWorkspace(t);

  const strategy = {
    voice: { description: 'Direct and concrete.' },
    book_context: { title: 'The Dionysus Program' },
    publishing: {
      linkedin_footer_divider: '---',
      linkedin_footer_options: ['Footer copy.'],
    },
    generation: {
      prompt_variants: ['hook_forward'],
      best_of_n: 1,
    },
    content_types: {
      extracted_insight: { rolling_max: 8 },
    },
    x: { enabled: false },
  };

  const item = {
    id: 'item-hook',
    scheduled_at: '2026-03-25T12:30:00.000Z',
    slot_type: 'baseline',
    content_type: 'extracted_insight',
    pillar: 'Extracted Insights',
    topic_thesis: 'Trust burns faster than organizations know how to rebuild it.',
    angle: 'State the principle directly.',
    hook: 'Trust burns faster than organizations know how to rebuild it.',
    timely_subject: null,
  };

  const duplicateHook = 'Trust burns faster than organizations know how to rebuild it.';
  const memory = {
    published_count: 1,
    typeCounts: {},
    recent_hooks: [
      { hook: duplicateHook },
    ],
    recent_angles: [],
    recent_topics: [],
    recent_subjects: [],
    recent_sources: [],
  };

  const adapters = {
    writer: {
      generateCandidates: async () => ([
        {
          id: 'candidate-1',
          post_text: `${duplicateHook}\n\nIf you keep spending trust as if it replenishes on command, the system learns silence faster than it learns truth.`,
        },
      ]),
    },
    scorer: {
      scoreCandidates: async () => ([
        {
          candidate_id: 'candidate-1',
          overall_score: 8.1,
          pass: true,
          pass_fail_reasons: [],
        },
      ]),
    },
  };

  const outcome = await handleItem({
    item,
    strategy,
    adapters,
    memory,
    dryRun: true,
  });

  assert.equal(outcome.status, 'dry_run');
  assert.deepEqual(outcome.conflicts, ['hook_duplication']);
  assert.equal(outcome.selection_reason, 'memory_override_top_choice');
});
