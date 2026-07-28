const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { setupTempSocialWorkspace } = require('./helpers');
const { paths } = require('../lib/paths');
const { writeJson, readJson } = require('../lib/fs');
const { readJsonl } = require('../lib/jsonl');
const { loadStrategy } = require('../lib/config');
const { rebuildMemory } = require('../lib/memory');
const {
  ensureResearchBundleForItem,
  developNovelCalendarItem,
  memoryHistoryFingerprint,
  ResearchUnavailableError,
  NovelIdeaUnavailableError,
} = require('../lib/pipeline');
const {
  loadResearchJobs,
  upsertResearchJob,
  findPendingJob,
} = require('../lib/research-jobs');
const { prepareCalendarItem, preparationFailures } = require('../cli/prepare-upcoming');
const {
  main: publishDueMain,
  handlePreparedScheduledItem,
  requiresDeliveryAttention,
} = require('../cli/publish-due');
const { prepareCanonicalNote } = require('../lib/notes');
const { preparedPackageStatus } = require('../lib/publication-package');

function plannedItem(overrides = {}) {
  return {
    id: 'item-prepare',
    scheduled_date: '2026-07-27',
    scheduled_time: '05:30',
    scheduled_at: '2026-07-27T12:30:00.000Z',
    timezone: 'America/Los_Angeles',
    weekday: 'monday',
    slot_type: 'baseline',
    status: 'planned',
    content_type: 'decoder_ring',
    pillar: 'Decoder Ring',
    topic_thesis: 'Severability and reversibility make criticism cheaper and therefore more honest.',
    seed_topic_thesis: 'Severability and reversibility make criticism cheaper and therefore more honest.',
    idea_status: 'pending',
    angle: 'Diagnose the pattern underneath the news.',
    hook: 'The visible event is not the real diagnosis.',
    source_bundle_id: null,
    timely_subject: null,
    publish_payload: null,
    ...overrides,
  };
}

test('research jobs older than the retry window are never reused', (t) => {
  setupTempSocialWorkspace(t);
  upsertResearchJob({
    id: 'stale-job',
    job_key: 'stale-topic',
    status: 'in_progress',
    submitted_at: '2026-07-20T00:00:00.000Z',
  });

  const found = findPendingJob('stale-topic', {
    referenceDate: new Date('2026-07-27T00:00:00.000Z'),
  });

  assert.equal(found, null);
});

test('scheduled preparation fails readiness when the planner supplied no upcoming item', () => {
  assert.deepEqual(preparationFailures([], { requireItem: false }), []);
  assert.deepEqual(preparationFailures([], { requireItem: true }), [{
    status: 'failed',
    reason: 'no_upcoming_item',
    error: 'No planned item was available inside the preparation horizon.',
  }]);
});

test('partial downstream delivery is surfaced for operator attention', () => {
  assert.equal(requiresDeliveryAttention({
    status: 'published',
    x: { status: 'failed', reason: 'publish_failed' },
  }), true);
  assert.equal(requiresDeliveryAttention({
    status: 'published',
    note: { status: 'failed', reason: 'note_materialization_failed' },
    x: { status: 'published' },
  }), true);
  assert.equal(requiresDeliveryAttention({
    status: 'published',
    note: { sourceMode: 'canonical_package' },
    x: { status: 'published' },
  }), false);
});

test('failed recent-source normalization removes the bad research job and becomes a typed preparation failure', async (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const item = plannedItem();
  const adapters = {
    mode: 'live',
    gemini: {
      publishPollAttempts: 2,
      publishPollIntervalMs: 0,
      submitDiscoveryJob: async () => ({
        interaction_id: 'interaction-missing-dates',
        status: 'in_progress',
        submitted_at: '2026-07-27T00:15:00.000Z',
        job_key: `item:${item.id}`,
        topic_options: strategy.topics,
        watchlist_inputs: {},
      }),
      pollResearchJob: async () => ({ status: 'completed', outputs: [] }),
      normalizeCompletedResearch: async () => ({
        id: 'undated-bundle',
        summary: 'Research with citations that did not resolve to dates.',
        sources: [],
        candidate_angles: [],
      }),
    },
    scorer: {
      normalizeResearchReport: async () => {
        throw new Error('Normalized research bundle missing recent sources (0/1 within 30 days).');
      },
    },
  };

  await assert.rejects(
    ensureResearchBundleForItem({
      calendarItem: item,
      strategy,
      adapters,
      options: { waitForResearch: true, referenceDate: new Date('2026-07-27T00:15:00.000Z') },
    }),
    (error) => {
      assert.equal(error instanceof ResearchUnavailableError, true);
      assert.equal(error.details.reason, 'research_normalization_failed');
      assert.match(error.details.error, /missing recent sources/);
      return true;
    },
  );
  assert.deepEqual(loadResearchJobs().jobs, []);
});

test('idea development rejects an exact historical thesis even when the model claims the idea is novel', async (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const historicalThesis = 'The Crossing is the protected threshold where truth becomes common knowledge.';
  const memory = {
    recent_content: [{
      post_id: 'historical-post',
      published_at: '2026-03-24T13:00:00.000Z',
      content_type: 'ritual_recipe',
      topic_thesis: historicalThesis,
      hook: 'Old hook.',
      summary: 'An older argument.',
      text: 'An older argument with a distinct body.',
      x_summary: null,
    }],
    recent_x_posts: [],
  };
  const item = plannedItem({
    content_type: 'ritual_recipe',
    pillar: 'Ritual Recipe',
    topic_thesis: historicalThesis,
    seed_topic_thesis: historicalThesis,
  });
  const adapters = {
    mode: 'live',
    scorer: {
      model: 'gpt-5.6-sol',
      developNovelIdea: async () => ({
        pass: true,
        topic_thesis: historicalThesis,
        angle: 'A supposedly new angle.',
        hook: 'A supposedly new hook.',
        argument_summary: 'A supposedly new mechanism.',
        novelty_score: 9,
      }),
    },
  };

  await assert.rejects(
    developNovelCalendarItem({ calendarItem: item, strategy, adapters, memory, researchBundle: null }),
    (error) => {
      assert.equal(error instanceof NovelIdeaUnavailableError, true);
      assert.equal(error.details.deterministic_duplicate_post_id, 'historical-post');
      assert.equal(error.details.deterministic_duplicate_field, 'topic_thesis');
      return true;
    },
  );
});

test('advance preparation falls back from broken research to a fully approved non-research package', async (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  strategy.x.enabled = false;
  strategy.generation.best_of_n = 1;
  strategy.generation.prompt_variants = ['hook_forward'];
  const memory = rebuildMemory({
    strategy,
    referenceDate: new Date('2026-07-26T23:00:00.000Z'),
    write: false,
  });
  const events = [];
  const adapters = {
    mode: 'fixture',
    gemini: {
      discoverNews: async () => {
        events.push('research-failed');
        throw new Error('Research provider returned no dated sources.');
      },
    },
    scorer: {
      model: 'gpt-5.6-sol',
      developNovelIdea: async ({ calendarItem }) => ({
        pass: true,
        topic_thesis: `A new operator decision derived from ${calendarItem.content_type}.`,
        angle: 'Show the mechanism through one concrete operating choice.',
        hook: 'The meeting looked efficient until the real decision moved into the hallway.',
        argument_summary: 'Moving dissent outside the operating record makes speed look better while learning gets worse.',
        novelty_score: 9,
      }),
      scoreCandidates: async ({ candidates }) => candidates.map((candidate) => ({
        candidate_id: candidate.id,
        overall_score: 9,
        novelty_score: 9,
        engagement_score: 8.5,
        pass: true,
        pass_fail_reasons: [],
      })),
    },
    writer: {
      generateCandidates: async () => [{
        id: 'fallback-candidate',
        post_text: 'The meeting looked efficient until the real decision moved into the hallway.\n\nThat is what happens when a team makes dissent procedurally expensive. The dashboard gets cleaner while the learning system goes dark.\n\nMeasure how much truth stays inside the operating record.',
      }],
    },
    xWriter: {},
    xScorer: {},
  };

  const outcome = await prepareCalendarItem({
    item: plannedItem(),
    strategy,
    adapters,
    memory,
    currentTime: new Date('2026-07-26T23:00:00.000Z'),
  });

  assert.equal(outcome.status, 'ready');
  assert.equal(outcome.used_fallback, true);
  assert.equal(outcome.calendarItem.content_type === 'decoder_ring', false);
  assert.equal(outcome.calendarItem.preparation.status, 'ready');
  assert.equal(outcome.calendarItem.preparation.package.package_gate.pass, true);
  assert.equal(outcome.calendarItem.preparation.package.x_preflight.status, 'disabled');
  assert.deepEqual(events, ['research-failed']);
  assert.equal(outcome.attempts[0].status, 'failed');
  assert.equal(outcome.attempts[1].status, 'prepared');
});

function readyPackageForItem({ item, strategy, memory, body }) {
  const payload = {
    item_id: item.id,
    scheduled_at: item.scheduled_at,
    content_type: item.content_type,
    pillar: item.pillar,
    topic_thesis: item.topic_thesis,
    angle: item.angle,
    hook: body.split(/\n/)[0],
    body_text: body,
    footer_text: null,
    footer_index: null,
    footer_divider: null,
    final_text: body,
    winning_candidate_id: 'canonical-ready',
    winning_score: 9,
    source_refs: [],
    research_bundle_id: null,
    timely_subject: null,
  };
  const fingerprint = memoryHistoryFingerprint(memory, strategy.generation.idea_history_prompt_limit);
  return {
    status: 'ready',
    prepared_at: '2026-07-26T23:00:00.000Z',
    history_fingerprint: fingerprint,
    attempts: [{ status: 'prepared' }],
    package: {
      version: 1,
      prepared_at: '2026-07-26T23:00:00.000Z',
      history_fingerprint: fingerprint,
      payload,
      prepared_note: prepareCanonicalNote({ publishPayload: payload }),
      x_preflight: {
        status: 'dry_run',
        payload: {
          text: 'The meeting looked efficient. The real decision had already moved into the hallway.',
          winning_candidate_id: 'x-ready',
          winning_score: 9,
        },
        winnerCandidate: { id: 'x-ready' },
        winnerScore: { overall_score: 9 },
      },
      winner_candidate: { id: 'canonical-ready', post_text: body },
      winner_score: { overall_score: 9, novelty_score: 9, engagement_score: 8.5 },
      package_gate: { pass: true },
      selection_reason: 'memory_safe_top_choice',
      research_bundle: null,
    },
  };
}

test('scheduled delivery uses only the stored package and never invokes generation or scoring', async (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const currentTime = new Date('2026-07-27T12:30:00.000Z');
  const memory = rebuildMemory({ strategy, referenceDate: currentTime, write: false });
  const item = plannedItem({
    id: 'delivery-only-item',
    content_type: 'ritual_recipe',
    pillar: 'Ritual Recipe',
  });
  const body = 'The approved note was prepared before its delivery slot.\n\nIts evidence, novelty, engagement, and channel variants are already frozen.';
  item.preparation = readyPackageForItem({ item, strategy, memory, body });
  const forbidden = async () => {
    throw new Error('scheduled delivery attempted to generate or score content');
  };
  const events = [];
  const adapters = {
    writer: { generateCandidates: forbidden },
    scorer: { scoreCandidates: forbidden, developNovelIdea: forbidden },
    gemini: { discoverNews: forbidden },
    claude: { rewriteForNotes: forbidden },
    xWriter: { generateCandidates: forbidden },
    xScorer: { scoreCandidates: forbidden },
    zapier: {
      publish: async () => {
        events.push('linkedin');
        return {
          status: 'delivered',
          external_post_id: 'linkedin-delivery-only',
          delivered_at: currentTime.toISOString(),
        };
      },
    },
    x: {
      publish: async () => {
        events.push('x');
        return {
          status: 'delivered',
          external_post_id: 'x-delivery-only',
          delivered_at: currentTime.toISOString(),
        };
      },
    },
  };

  const dryRunOutcome = await handlePreparedScheduledItem({
    item,
    strategy,
    adapters,
    memory,
    currentTime,
    dryRun: true,
  });
  assert.equal(dryRunOutcome.status, 'dry_run');
  assert.deepEqual(events, []);

  const outcome = await handlePreparedScheduledItem({
    item,
    strategy,
    adapters,
    memory,
    currentTime,
  });

  assert.equal(outcome.status, 'published');
  assert.equal(outcome.note.sourceMode, 'canonical_package');
  assert.equal(outcome.x.status, 'published');
  assert.deepEqual(events, ['linkedin', 'x']);
});

test('a prepared package becomes ineligible when publication history changes', (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const emptyMemory = rebuildMemory({ strategy, write: false });
  const item = plannedItem({
    id: 'stale-package-item',
    content_type: 'ritual_recipe',
    pillar: 'Ritual Recipe',
  });
  const body = 'A prepared canonical body with a concrete operating consequence.';
  item.preparation = readyPackageForItem({ item, strategy, memory: emptyMemory, body });
  const changedMemory = {
    ...emptyMemory,
    recent_content: [{
      post_id: 'newer-post',
      published_at: '2026-07-27T12:00:00.000Z',
      topic_thesis: 'A newer argument.',
      text: 'A newer canonical body.',
      summary: 'A newer canonical body.',
    }],
  };

  const status = preparedPackageStatus({ item, strategy, memory: changedMemory });
  assert.equal(status.ready, false);
  assert.equal(status.reason, 'package_history_stale');
});

test('an expired unprepared item cannot block a later prepared item in the same publication run', async (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const currentTime = new Date('2026-07-27T13:00:00.000Z');
  const memory = rebuildMemory({ strategy, referenceDate: currentTime, write: false });
  const expired = plannedItem({
    id: 'expired-item',
    scheduled_date: '2026-07-20',
    scheduled_at: '2026-07-20T12:30:00.000Z',
  });
  const ready = plannedItem({
    id: 'ready-item',
    content_type: 'ritual_recipe',
    pillar: 'Ritual Recipe',
    topic_thesis: 'A novel ritual argument.',
    seed_topic_thesis: 'The Crossing.',
    idea_status: 'developed',
  });
  const body = 'The meeting looked efficient until the real decision moved into the hallway.\n\nA process that makes dissent costly does not eliminate disagreement. It removes disagreement from the record. The dashboard gets cleaner while the learning system goes dark.\n\nMeasure how much truth remains inside the operating system.';
  ready.preparation = readyPackageForItem({ item: ready, strategy, memory, body });
  const calendarPath = path.join(paths.calendarDir, 'week-2026-07-27.json');
  writeJson(calendarPath, { id: 'week-2026-07-27', items: [expired, ready] });

  const argvBefore = process.argv;
  process.argv = [
    'node',
    'social/cli/publish-due.js',
    '--use-fixtures',
    '--now',
    currentTime.toISOString(),
  ];
  t.after(() => {
    process.argv = argvBefore;
  });

  await publishDueMain();

  const calendar = readJson(calendarPath, {});
  assert.equal(calendar.items[0].status, 'skipped');
  assert.equal(calendar.items[0].skip_reason, 'package_preparation_expired');
  assert.equal(calendar.items[1].status, 'published');
  assert.equal(calendar.items[1].delivery.status, 'published');
  const published = readJsonl(paths.publishedLedger);
  assert.equal(published.length, 1);
  assert.equal(published[0].topic_thesis, ready.topic_thesis);
  assert.equal(fs.readdirSync(paths.notesContentDir).length, 1);
});
