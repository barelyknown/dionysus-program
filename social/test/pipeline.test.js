const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { setupTempSocialWorkspace } = require('./helpers');
const { paths } = require('../lib/paths');
const { writeJson } = require('../lib/fs');
const { loadStrategy } = require('../lib/config');
const { getResearchRecencyPolicy, researchBundleMeetsRecencyPolicy } = require('../lib/research-policy');
const { createAdapters, scoreCandidatesForItem, createPublishPayload, createPublishedRecord, prepareBrief, ensureResearchBundleForItem, ResearchPendingError } = require('../lib/pipeline');

test('fixture generation and scoring produce a publishable winner', async (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const adapters = createAdapters({ args: { 'use-fixtures': true }, strategy });

  const item = {
    id: 'item-1',
    scheduled_at: '2026-03-17T15:30:00.000Z',
    timezone: 'America/Los_Angeles',
    weekday: 'wednesday',
    slot_type: 'baseline',
    status: 'planned',
    content_type: 'decoder_ring',
    pillar: 'Decoder Ring',
    topic_thesis: 'Organizations fail socially before they fail technically.',
    angle: 'Use an adjacent company story to show the social bottleneck.',
    hook: 'Most people are misreading what this failure is actually about.',
    source_bundle_id: null,
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
  };

  const result = await scoreCandidatesForItem({ calendarItem: item, strategy, adapters, memory });
  assert.equal(result.candidates.length, 2);
  assert.ok(result.researchBundle);
  assert.ok(result.researchBundle.primary_source);
  assert.ok(result.calendarItem.source_bundle_id);
  assert.equal(result.calendarItem.seed_topic_thesis, item.topic_thesis);
  assert.equal(result.calendarItem.topic_thesis, item.topic_thesis);
  assert.ok(result.calendarItem.timely_subject);
  assert.ok(result.winnerCandidate);
  assert.ok(result.winnerScore.pass);

  const payload = createPublishPayload({
    calendarItem: item,
    winnerCandidate: result.winnerCandidate,
    winnerScore: result.winnerScore,
    researchBundle: null,
    strategy,
  });
  const record = createPublishedRecord({
    publishPayload: payload,
    publishResult: {
      external_post_id: 'fixture-123',
      delivered_at: '2026-03-17T15:30:00.000Z',
      linkedin_post_url: 'https://www.linkedin.com/feed/update/urn:li:activity:123',
      linkedin_activity_urn: 'urn:li:activity:123',
    },
    calendarItem: item,
  });

  assert.equal(record.post_id, 'fixture-123');
  assert.equal(record.linkedin_post_url, 'https://www.linkedin.com/feed/update/urn:li:activity:123');
  assert.equal(record.linkedin_activity_urn, 'urn:li:activity:123');
  assert.equal(record.content_type, 'decoder_ring');
  assert.ok(record.final_text_hash);
  assert.equal(payload.body_text, result.winnerCandidate.post_text);
  assert.match(payload.final_text, /\n\n---\n\n/);
  assert.ok(payload.footer_text);
});

test('prepared extracted insight brief includes full context and grounding rules', async (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const item = {
    id: 'item-2',
    scheduled_at: '2026-03-17T15:30:00.000Z',
    timezone: 'America/Los_Angeles',
    weekday: 'monday',
    slot_type: 'baseline',
    status: 'planned',
    content_type: 'extracted_insight',
    pillar: 'Extracted Insights',
    topic_thesis: 'Trust burns faster than organizations know how to rebuild it.',
    angle: 'Name the concept, explain it plainly, and show why it matters now.',
    hook: 'Trust burns faster than it builds.',
    source_bundle_id: null,
    timely_subject: null,
  };

  const prepared = prepareBrief({ calendarItem: item, strategy });
  assert.ok(prepared.brief.source_grounding_rules.length > 0);
  assert.equal(prepared.brief.book_context.title, 'The Dionysus Program');
  assert.match(prepared.brief.prompt, /Full compressed source context:/);
  assert.match(prepared.brief.prompt, /Do not invent named concepts unless they appear verbatim/);
  assert.match(prepared.brief.prompt, /If you mention the book, note that it is free/);
});

test('createPublishPayload chooses a deterministic footer and keeps body text separate', (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const payloadA = createPublishPayload({
    calendarItem: {
      id: 'item-footer',
      scheduled_at: '2026-03-19T12:30:00.000Z',
      content_type: 'extracted_insight',
      pillar: 'Extracted Insights',
      topic_thesis: 'Trust burns faster than it builds.',
      angle: 'State the principle directly.',
      timely_subject: null,
    },
    winnerCandidate: {
      id: 'winner-footer',
      post_text: 'Trust burns faster than it builds.\n\nLower the social cost of criticism before the distortion hardens.',
    },
    winnerScore: { overall_score: 9.2 },
    researchBundle: null,
    strategy,
  });

  const payloadB = createPublishPayload({
    calendarItem: {
      id: 'item-footer',
      scheduled_at: '2026-03-19T12:30:00.000Z',
      content_type: 'extracted_insight',
      pillar: 'Extracted Insights',
      topic_thesis: 'Trust burns faster than it builds.',
      angle: 'State the principle directly.',
      timely_subject: null,
    },
    winnerCandidate: {
      id: 'winner-footer',
      post_text: 'Trust burns faster than it builds.\n\nLower the social cost of criticism before the distortion hardens.',
    },
    winnerScore: { overall_score: 9.2 },
    researchBundle: null,
    strategy,
  });

  assert.equal(payloadA.footer_index, payloadB.footer_index);
  assert.equal(payloadA.footer_text, payloadB.footer_text);
  assert.equal(payloadA.body_text, payloadB.body_text);
  assert.equal(payloadA.final_text, payloadB.final_text);
});

test('stale decoder-ring research bundles are regenerated instead of reused', async (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const adapters = createAdapters({ args: { 'use-fixtures': true }, strategy });
  const staleBundleId = 'stale-bundle';
  writeJson(path.join(paths.researchCacheDir, `${staleBundleId}.json`), {
    id: staleBundleId,
    summary: 'Old bundle.',
    sources: [
      {
        title: 'Old Reuters case',
        url: 'https://example.com/old-case',
        published_at: '2023-11-20T00:00:00Z',
        relevance: 'Old',
        claim: 'Old claim.',
      },
    ],
    candidate_angles: [],
  });

  const item = {
    id: 'item-stale',
    scheduled_at: '2026-03-17T15:30:00.000Z',
    timezone: 'America/Los_Angeles',
    weekday: 'wednesday',
    slot_type: 'baseline',
    status: 'planned',
    content_type: 'decoder_ring',
    pillar: 'Decoder Ring',
    topic_thesis: 'Organizations fail socially before they fail technically.',
    angle: 'Use an adjacent company story to show the social bottleneck.',
    hook: 'Most people are misreading what this failure is actually about.',
    source_bundle_id: staleBundleId,
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
  };

  const result = await scoreCandidatesForItem({ calendarItem: item, strategy, adapters, memory });
  assert.notEqual(result.calendarItem.source_bundle_id, staleBundleId);
  assert.ok(result.researchBundle);
  assert.ok(result.researchBundle.primary_source);
  assert.equal(result.calendarItem.seed_topic_thesis, item.topic_thesis);
  assert.equal(result.calendarItem.topic_thesis, item.topic_thesis);
  assert.ok(result.calendarItem.timely_subject);
  assert.equal(
    researchBundleMeetsRecencyPolicy(
      result.researchBundle,
      getResearchRecencyPolicy({ watchlists: { research: { recent_window_days: 30, min_recent_sources: 1 } } }),
    ),
    true,
  );
});

test('live research submits and defers by default when a new job is created', async (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const item = {
    id: 'item-live-defer',
    scheduled_at: '2026-03-23T12:30:00.000Z',
    timezone: 'America/Los_Angeles',
    weekday: 'monday',
    slot_type: 'baseline',
    status: 'planned',
    content_type: 'decoder_ring',
    pillar: 'Decoder Ring',
    topic_thesis: 'Epimetabolic Rate is the only scoreboard that really matters in periods of fast change.',
    angle: 'Diagnose the pattern underneath the news.',
    hook: 'Most people are misreading what this story is actually about.',
    source_bundle_id: null,
    timely_subject: null,
  };
  const adapters = {
    mode: 'live',
    gemini: {
      pollAttempts: 2,
      pollIntervalMs: 0,
      publishPollAttempts: 2,
      publishPollIntervalMs: 0,
      submitResearchJob: async () => ({
        interaction_id: 'interaction-1',
        status: 'in_progress',
        submitted_at: '2026-03-23T13:00:00.000Z',
        watchlist_inputs: {},
      }),
      pollResearchJob: async () => {
        throw new Error('pollResearchJob should not be called for default deferred behavior');
      },
    },
    scorer: {},
  };

  await assert.rejects(
    ensureResearchBundleForItem({ calendarItem: item, strategy, adapters }),
    (error) => {
      assert.equal(error instanceof ResearchPendingError, true);
      assert.equal(error.details.pending_job.interaction_id, 'interaction-1');
      return true;
    },
  );
});

test('live research can block for a newly submitted publish-time job', async (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const item = {
    id: 'item-live-block',
    scheduled_at: '2026-03-23T12:30:00.000Z',
    timezone: 'America/Los_Angeles',
    weekday: 'monday',
    slot_type: 'baseline',
    status: 'planned',
    content_type: 'decoder_ring',
    pillar: 'Decoder Ring',
    topic_thesis: 'Epimetabolic Rate is the only scoreboard that really matters in periods of fast change.',
    angle: 'Diagnose the pattern underneath the news.',
    hook: 'Most people are misreading what this story is actually about.',
    source_bundle_id: null,
    timely_subject: null,
  };
  const pollCalls = [];
  const adapters = {
    mode: 'live',
    gemini: {
      pollAttempts: 1,
      pollIntervalMs: 0,
      publishPollAttempts: 3,
      publishPollIntervalMs: 0,
      submitResearchJob: async () => ({
        interaction_id: 'interaction-2',
        status: 'in_progress',
        submitted_at: '2026-03-23T13:00:00.000Z',
        watchlist_inputs: {},
      }),
      pollResearchJob: async ({ pollAttempts, pollIntervalMs }) => {
        pollCalls.push({ pollAttempts, pollIntervalMs });
        return {
          status: 'completed',
          outputs: [],
        };
      },
      normalizeCompletedResearch: async () => ({
        id: 'bundle-1',
        summary: 'Completed research report',
        sources: [
          {
            title: 'Recent company case',
            url: 'https://example.com/recent-case',
            published_at: '2026-03-22',
            excerpt: 'Recent reported case.',
            claim: 'Fresh claim.',
          },
        ],
        candidate_angles: [
          {
            topic_thesis: item.topic_thesis,
            angle: 'Use the recent case to show the hidden pattern.',
            hook: 'The visible event is not the real diagnosis.',
            subject: 'Recent company case',
          },
        ],
        primary_source: {
          title: 'Recent company case',
          url: 'https://example.com/recent-case',
          published_at: '2026-03-22',
        },
      }),
    },
    scorer: {},
  };

  const result = await ensureResearchBundleForItem({
    calendarItem: item,
    strategy,
    adapters,
    options: { waitForResearch: true },
  });

  assert.equal(pollCalls.length, 1);
  assert.deepEqual(pollCalls[0], { pollAttempts: 3, pollIntervalMs: 0 });
  assert.equal(result.researchBundle.id, 'bundle-1');
  assert.equal(result.calendarItem.source_bundle_id, 'bundle-1');
  assert.equal(result.calendarItem.timely_subject, 'Recent company case');
});
