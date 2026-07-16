const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { setupTempSocialWorkspace } = require('./helpers');
const { paths } = require('../lib/paths');
const { loadNoteFile } = require('../../lib/notes');
const {
  isDue,
  baselineCadenceSkipReason,
  nextCalendarItemState,
} = require('../lib/publish-due-state');
const { handleItem, main: publishDueMain } = require('../cli/publish-due');

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

test('cadence guard skips legacy baseline weekdays removed from the schedule', () => {
  const reason = baselineCadenceSkipReason({
    item: { slot_type: 'baseline', weekday: 'thursday', status: 'planned' },
    calendar: { items: [] },
    strategy: {
      publishing: {
        baseline_slots: [
          { weekday: 'monday' },
          { weekday: 'wednesday' },
          { weekday: 'friday' },
        ],
      },
    },
  });

  assert.equal(reason, 'schedule_disabled');
});

test('cadence guard caps legacy calendars at the configured weekly frequency', () => {
  const reason = baselineCadenceSkipReason({
    item: { slot_type: 'baseline', weekday: 'friday', status: 'planned' },
    calendar: {
      items: [
        { slot_type: 'baseline', status: 'published' },
        { slot_type: 'baseline', status: 'published' },
        { slot_type: 'baseline', status: 'published' },
        { slot_type: 'baseline', status: 'planned' },
      ],
    },
    strategy: {
      publishing: {
        baseline_slots: [
          { weekday: 'monday' },
          { weekday: 'wednesday' },
          { weekday: 'friday' },
        ],
      },
    },
  });

  assert.equal(reason, 'weekly_cadence_limit');
});

test('cadence guard allows an enabled slot while weekly capacity remains', () => {
  const reason = baselineCadenceSkipReason({
    item: { slot_type: 'baseline', weekday: 'friday', status: 'planned' },
    calendar: {
      items: [
        { slot_type: 'baseline', status: 'published' },
        { slot_type: 'baseline', status: 'published' },
        { slot_type: 'baseline', status: 'skipped' },
      ],
    },
    strategy: {
      publishing: {
        baseline_slots: [
          { weekday: 'monday' },
          { weekday: 'wednesday' },
          { weekday: 'friday' },
        ],
      },
    },
  });

  assert.equal(reason, null);
});

test('publication dry runs do not write cadence skips to the ledger or calendar', async (t) => {
  setupTempSocialWorkspace(t);
  const calendarPath = path.join(paths.calendarDir, 'week-2026-07-13.json');
  const calendar = {
    week_of: '2026-07-13',
    items: [
      { id: 'published-1', slot_type: 'baseline', status: 'published' },
      { id: 'published-2', slot_type: 'baseline', status: 'published' },
      { id: 'published-3', slot_type: 'baseline', status: 'published' },
      {
        id: 'friday-item',
        slot_type: 'baseline',
        weekday: 'friday',
        status: 'planned',
        scheduled_at: '2026-07-17T12:30:00.000Z',
      },
    ],
  };
  fs.writeFileSync(calendarPath, `${JSON.stringify(calendar, null, 2)}\n`);
  const calendarBefore = fs.readFileSync(calendarPath, 'utf8');
  const skippedBefore = fs.readFileSync(paths.skippedLedger, 'utf8');
  const argvBefore = process.argv;
  process.argv = [
    'node',
    'social/cli/publish-due.js',
    '--dry-run',
    '--use-fixtures',
    '--now',
    '2026-07-18T00:00:00.000Z',
  ];
  t.after(() => {
    process.argv = argvBefore;
  });

  await publishDueMain();

  assert.equal(fs.readFileSync(paths.skippedLedger, 'utf8'), skippedBefore);
  assert.equal(fs.readFileSync(calendarPath, 'utf8'), calendarBefore);
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
          novelty_score: 9,
          engagement_score: 8.5,
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

test('handleItem skips instead of publishing a repeated hook', async (t) => {
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
          novelty_score: 9,
          engagement_score: 8.5,
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

  assert.equal(outcome.status, 'skipped');
  assert.equal(outcome.reason, 'memory_conflict');
  assert.deepEqual(outcome.conflicts, ['hook_duplication']);
  assert.equal(outcome.selection_reason, 'blocked_by_memory_conflict');
});

test('handleItem skips repeated lead-company posts', async (t) => {
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
      decoder_ring: { rolling_max: 10, requires_research: false },
    },
    x: { enabled: false },
  };

  const item = {
    id: 'item-klarna-repeat',
    scheduled_at: '2026-03-30T12:30:00.000Z',
    slot_type: 'baseline',
    content_type: 'decoder_ring',
    pillar: 'Decoder Ring',
    topic_thesis: 'The Apollo Program is necessary but insufficient because optimization cannot metabolize meaning.',
    angle: 'Open on Klarna CEO says company went too far in cutting customer service staff with AI.',
    hook: 'Klarna spent two years becoming the poster child for AI labor replacement.',
    timely_subject: 'Klarna CEO says company went too far in cutting customer service staff with AI',
  };

  const memory = {
    published_count: 1,
    typeCounts: {},
    recent_hooks: [],
    recent_angles: [],
    recent_topics: [],
    recent_subjects: [],
    recent_sources: [],
    recent_entities: [
      { subject_entities: ['Klarna'] },
    ],
  };

  const adapters = {
    writer: {
      generateCandidates: async () => ([
        {
          id: 'candidate-1',
          post_text: 'Sebastian Siemiatkowski said Klarna went too far cutting customer service with AI, and quality suffered.\n\nOptimization cannot metabolize meaning.',
        },
      ]),
    },
    scorer: {
      scoreCandidates: async () => ([
        {
          candidate_id: 'candidate-1',
          overall_score: 8.9,
          novelty_score: 9,
          engagement_score: 8.5,
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

  assert.equal(outcome.status, 'skipped');
  assert.equal(outcome.reason, 'entity_duplication');
  assert.deepEqual(outcome.conflicts, ['entity_duplication']);
  assert.equal(outcome.selection_reason, 'blocked_by_memory_conflict');
});

test('handleItem never publishes a scorer-rejected candidate as best effort', async (t) => {
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
    id: 'item-rejected',
    scheduled_at: '2026-03-25T12:30:00.000Z',
    slot_type: 'baseline',
    content_type: 'extracted_insight',
    pillar: 'Extracted Insights',
    topic_thesis: 'A fresh thesis.',
    angle: 'State the principle directly.',
    hook: 'A fresh hook.',
    timely_subject: null,
  };
  const memory = {
    published_count: 0,
    typeCounts: {},
    recent_hooks: [],
    recent_angles: [],
    recent_topics: [],
    recent_subjects: [],
    recent_sources: [],
    recent_entities: [],
    recent_content: [],
  };
  const adapters = {
    writer: {
      generateCandidates: async () => ([{
        id: 'candidate-rejected',
        post_text: 'This candidate sounds polished but repeats an old idea semantically.',
      }]),
    },
    scorer: {
      scoreCandidates: async () => ([{
        candidate_id: 'candidate-rejected',
        overall_score: 8.5,
        novelty_score: 4,
        engagement_score: 8.5,
        pass: false,
        pass_fail_reasons: ['semantic_duplication'],
      }]),
    },
  };

  const outcome = await handleItem({ item, strategy, adapters, memory, dryRun: true });

  assert.equal(outcome.status, 'skipped');
  assert.equal(outcome.reason, 'no_passing_candidate');
  assert.equal(outcome.selection_reason, 'no_publishable_candidate');
});

function packageGateFixture({ canonicalScore = {}, xPass = true, events = [] } = {}) {
  const canonicalText = [
    'A system can execute yesterday perfectly.',
    '',
    'That is why permissions should expire when the doctrine that granted them expires.',
  ].join('\n');
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
      minimum_draft_novelty_score: 8,
      minimum_draft_engagement_score: 7.5,
    },
    content_types: {
      extracted_insight: { rolling_max: 8 },
    },
    x: { enabled: true, best_of_n: 1, near_duplicate_threshold: 0.72 },
  };
  const item = {
    id: 'item-package-gate',
    scheduled_at: '2026-07-20T12:30:00.000Z',
    slot_type: 'baseline',
    content_type: 'extracted_insight',
    pillar: 'Extracted Insights',
    topic_thesis: 'AI permissions should expire with the doctrine that granted them.',
    angle: 'Show how faithful execution becomes dangerous when its premise ages.',
    hook: 'A system can execute yesterday perfectly.',
    timely_subject: null,
  };
  const memory = {
    published_count: 0,
    typeCounts: {},
    recent_hooks: [],
    recent_angles: [],
    recent_topics: [],
    recent_subjects: [],
    recent_sources: [],
    recent_entities: [],
    recent_content: [],
    recent_x_posts: [],
  };
  const adapters = {
    writer: {
      generateCandidates: async () => ([{
        id: 'canonical-candidate',
        post_text: canonicalText,
      }]),
    },
    claude: {
      rewriteForNotes: async () => {
        throw new Error('Canonical package notes must not be rewritten after scoring.');
      },
    },
    scorer: {
      scoreCandidates: async () => ([{
        candidate_id: 'canonical-candidate',
        overall_score: 9,
        novelty_score: 9,
        engagement_score: 8.8,
        pass: true,
        pass_fail_reasons: [],
        ...canonicalScore,
      }]),
    },
    xWriter: {
      generateCandidates: async () => {
        events.push('x-generate');
        return [{
          id: 'x-candidate',
          post_text: 'Permissions should expire with the doctrine that granted them.',
        }];
      },
    },
    xScorer: {
      scoreCandidates: async () => {
        events.push('x-score');
        return [{
          candidate_id: 'x-candidate',
          overall_score: xPass ? 9 : 5,
          novelty_score: xPass ? 9 : 3,
          engagement_score: 8.5,
          pass: xPass,
          pass_fail_reasons: xPass ? [] : ['semantic_duplication'],
        }];
      },
    },
    zapier: {
      publish: async () => {
        events.push('linkedin-publish');
        return {
          external_post_id: 'linkedin-package-1',
          delivered_at: '2026-07-20T12:31:00.000Z',
          linkedin_post_url: 'https://www.linkedin.com/feed/update/urn:li:activity:package-1',
          linkedin_activity_urn: 'urn:li:activity:package-1',
        };
      },
    },
    x: {
      publish: async () => {
        events.push('x-publish');
        return {
          external_post_id: 'x-package-1',
          delivered_at: '2026-07-20T12:32:00.000Z',
        };
      },
    },
  };

  return { strategy, item, memory, adapters, canonicalText };
}

test('package gate blocks Note, LinkedIn, and X before publishing when X fails novelty', async (t) => {
  setupTempSocialWorkspace(t);
  const events = [];
  const fixture = packageGateFixture({ xPass: false, events });

  const outcome = await handleItem({ ...fixture, dryRun: false });

  assert.equal(outcome.status, 'skipped');
  assert.equal(outcome.reason, 'package_gate_failed');
  assert.equal(outcome.failed_channel, 'x');
  assert.equal(outcome.package_gate.pass, false);
  assert.equal(outcome.x.reason, 'no_passing_candidate');
  assert.deepEqual(events, ['x-generate', 'x-score']);
  assert.deepEqual(fs.readdirSync(paths.notesContentDir), []);
});

test('package gate blocks all channels when the canonical Note and LinkedIn body lacks engagement', async (t) => {
  setupTempSocialWorkspace(t);
  const events = [];
  const fixture = packageGateFixture({
    canonicalScore: { engagement_score: 6.5 },
    events,
  });

  const outcome = await handleItem({ ...fixture, dryRun: false });

  assert.equal(outcome.status, 'skipped');
  assert.equal(outcome.reason, 'no_passing_candidate');
  assert.deepEqual(events, []);
  assert.deepEqual(fs.readdirSync(paths.notesContentDir), []);
});

test('complete package preflights every channel before publishing the scored canonical note', async (t) => {
  const { tempRoot } = setupTempSocialWorkspace(t);
  const events = [];
  const fixture = packageGateFixture({ xPass: true, events });

  const outcome = await handleItem({ ...fixture, dryRun: false });

  assert.equal(outcome.status, 'published');
  assert.equal(outcome.package_gate.pass, true);
  assert.equal(outcome.note.sourceMode, 'canonical_package');
  assert.equal(outcome.x.status, 'published');
  assert.deepEqual(events, ['x-generate', 'x-score', 'linkedin-publish', 'x-publish']);

  const note = loadNoteFile(path.join(tempRoot, outcome.note.sourcePath));
  assert.equal(note.data.source_mode, 'canonical_package');
  assert.equal(note.body, fixture.canonicalText);
});

test('package gate tries the next approved canonical candidate before skipping the slot', async (t) => {
  setupTempSocialWorkspace(t);
  const events = [];
  const fixture = packageGateFixture({ xPass: true, events });
  fixture.adapters.writer.generateCandidates = async () => ([
    { id: 'canonical-first', post_text: `${fixture.canonicalText}\n\nFirst framing.` },
    { id: 'canonical-second', post_text: `${fixture.canonicalText}\n\nSecond framing.` },
  ]);
  fixture.adapters.scorer.scoreCandidates = async () => ([
    {
      candidate_id: 'canonical-first',
      overall_score: 9.2,
      novelty_score: 9,
      engagement_score: 9,
      pass: true,
      pass_fail_reasons: [],
    },
    {
      candidate_id: 'canonical-second',
      overall_score: 8.9,
      novelty_score: 9,
      engagement_score: 8.8,
      pass: true,
      pass_fail_reasons: [],
    },
  ]);
  let xAttempt = 0;
  fixture.adapters.xWriter.generateCandidates = async () => {
    xAttempt += 1;
    events.push(`x-generate-${xAttempt}`);
    return [{ id: `x-candidate-${xAttempt}`, post_text: `Fresh short-form candidate ${xAttempt}.` }];
  };
  fixture.adapters.xScorer.scoreCandidates = async ({ candidates }) => {
    events.push(`x-score-${xAttempt}`);
    const pass = xAttempt === 2;
    return [{
      candidate_id: candidates[0].id,
      overall_score: pass ? 9 : 4,
      novelty_score: pass ? 9 : 2,
      engagement_score: 8.5,
      pass,
      pass_fail_reasons: pass ? [] : ['semantic_duplication'],
    }];
  };

  const outcome = await handleItem({ ...fixture, dryRun: false });

  assert.equal(outcome.status, 'published');
  assert.equal(outcome.winnerCandidate.id, 'canonical-second');
  assert.equal(outcome.package_gate.attempted_candidates, 2);
  assert.deepEqual(events, [
    'x-generate-1',
    'x-score-1',
    'x-generate-2',
    'x-score-2',
    'linkedin-publish',
    'x-publish',
  ]);
});
