const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { setupTempSocialWorkspace } = require('./helpers');
const { paths } = require('../lib/paths');
const { writeJson } = require('../lib/fs');
const { loadStrategy } = require('../lib/config');
const { getResearchRecencyPolicy, researchBundleMeetsRecencyPolicy } = require('../lib/research-policy');
const { createAdapters, scoreCandidatesForItem, createPublishPayload, createPublishedRecord, prepareBrief } = require('../lib/pipeline');

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
