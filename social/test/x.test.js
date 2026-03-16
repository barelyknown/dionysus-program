const test = require('node:test');
const assert = require('node:assert/strict');

const { setupTempSocialWorkspace } = require('./helpers');
const { loadStrategy } = require('../lib/config');
const { GPTXAdapter } = require('../providers/gpt-x');
const { XPublisherAdapter } = require('../providers/x-publisher');
const { attemptXPublish, rankXResults } = require('../lib/x');
const { createPublishedRecord } = require('../lib/pipeline');

test('fixture X generator produces 8 single-post candidates derived from LinkedIn text', async (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const adapter = new GPTXAdapter({ mode: 'fixture' });
  const linkedinText = [
    'Most teams do not avoid criticism because they lack courage.',
    '',
    'They avoid it because criticism is still too expensive.',
    '',
    'Lower the social price, and people tell the truth sooner.',
  ].join('\n');

  const candidates = await adapter.generateCandidates({
    linkedinText,
    strategy,
    bestOfN: strategy.x.best_of_n,
  });

  assert.equal(candidates.length, 8);
  for (const candidate of candidates) {
    assert.ok(candidate.post_text.length <= strategy.x.max_length);
    assert.ok(candidate.post_text.split(/\n\s*\n/).length >= 2);
  }
});

test('fixture X scorer rejects anti-patterns and ranks shorter passing candidates higher on ties', async (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const adapter = new GPTXAdapter({ mode: 'fixture' });
  const candidates = [
    {
      id: 'good-long',
      post_text: 'Most trust failures start as naming failures.\n\nPeople avoid criticism when the social cost is still too high.\n\nThat is how an organization starts managing the truth instead of the work.',
    },
    {
      id: 'good-short',
      post_text: 'Most trust failures start as naming failures.\n\nPeople avoid criticism when truth is still too expensive.',
    },
    {
      id: 'hashtag',
      post_text: 'A quick thought on trust.\n\nPeople avoid criticism when truth is too expensive. #leadership',
    },
    {
      id: 'promo',
      post_text: 'The book is free.\n\nDownload the PDF and learn why trust matters.',
    },
  ];

  const scorecards = await adapter.scoreCandidates({
    candidates,
    linkedinText: 'Trust burns faster than it builds.',
    strategy,
  });
  const byCandidateId = new Map(scorecards.map((score) => [score.candidate_id, score]));

  assert.equal(byCandidateId.get('hashtag').pass, false);
  assert.match(byCandidateId.get('hashtag').pass_fail_reasons.join(','), /hashtag_disallowed/);
  assert.equal(byCandidateId.get('promo').pass, false);
  assert.match(byCandidateId.get('promo').pass_fail_reasons.join(','), /book_promotion_payload/);

  const ranked = rankXResults({ scorecards, candidates });
  assert.equal(ranked[0].candidate_id, 'good-short');
});

test('attemptXPublish returns dry-run X payload when a candidate passes', async (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const xWriter = new GPTXAdapter({ mode: 'fixture' });
  const xScorer = new GPTXAdapter({ mode: 'fixture' });
  const x = new XPublisherAdapter({ mode: 'fixture' });

  const result = await attemptXPublish({
    linkedinPayload: {
      final_text: [
        'Failure gets renamed before it gets examined.',
        '',
        'That is how organizations lose the ability to metabolize reality.',
      ].join('\n'),
      winning_candidate_id: 'linkedin-winner-1',
    },
    strategy,
    adapters: { xWriter, xScorer, x },
    dryRun: true,
  });

  assert.equal(result.status, 'dry_run');
  assert.ok(result.winnerCandidate);
  assert.ok(result.payload.text.length <= strategy.x.max_length);
  assert.equal(result.payload.source_channel, 'linkedin');
});

test('attemptXPublish records failure without throwing when publishing to X fails', async (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const xWriter = new GPTXAdapter({ mode: 'fixture' });
  const xScorer = new GPTXAdapter({ mode: 'fixture' });
  const x = {
    publish: async () => {
      throw new Error('x unavailable');
    },
  };

  const result = await attemptXPublish({
    linkedinPayload: {
      final_text: 'Trust burns faster than it builds.\n\nPeople avoid criticism when it threatens belonging.',
      winning_candidate_id: 'linkedin-winner-2',
    },
    strategy,
    adapters: { xWriter, xScorer, x },
    dryRun: false,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'publish_failed');
  assert.match(result.error, /x unavailable/);
});

test('published records persist X metadata without altering primary LinkedIn fields', async (t) => {
  setupTempSocialWorkspace(t);

  const record = createPublishedRecord({
    publishPayload: {
      final_text: 'LinkedIn body',
      source_refs: [],
      research_bundle_id: null,
      timely_subject: null,
      winning_candidate_id: 'linkedin-winner',
      hook: 'Failure gets renamed.',
    },
    publishResult: {
      external_post_id: 'linkedin-123',
      delivered_at: '2026-03-20T15:30:00.000Z',
    },
    calendarItem: {
      content_type: 'decoder_ring',
      pillar: 'Decoder Ring',
      topic_thesis: 'Rectification of names matters.',
      angle: 'Name the pattern underneath the visible event.',
    },
    x: {
      status: 'published',
      winnerCandidate: { id: 'x-winner' },
      payload: { text: 'Most trust failures start as naming failures.' },
      publishResult: {
        external_post_id: 'x-123',
        delivered_at: '2026-03-20T15:35:00.000Z',
      },
    },
  });

  assert.equal(record.post_id, 'linkedin-123');
  assert.equal(record.x_status, 'published');
  assert.equal(record.x_external_post_id, 'x-123');
  assert.equal(record.x_winning_candidate_id, 'x-winner');
  assert.equal(record.x_summary, 'Most trust failures start as naming failures.');
});

test('X publisher exposes rotated credentials after refresh', async () => {
  const adapter = new XPublisherAdapter({ mode: 'live', clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh-old', accessToken: 'access-old' });

  adapter.publishWithToken = async ({ accessToken }) => {
    if (accessToken === 'access-old') {
      return { ok: false, status: 401, body: 'expired' };
    }
    return {
      ok: true,
      status: 200,
      result: {
        ok: true,
        provider: 'x-api-live',
        external_post_id: 'x-123',
        delivered_at: '2026-03-16T02:40:34.618Z',
        response: { data: { id: 'x-123' } },
      },
    };
  };

  adapter.refreshAccessToken = async () => ({
    access_token: 'access-new',
    refresh_token: 'refresh-new',
  });

  const result = await adapter.publish({
    payload: {
      text: 'A test post.',
    },
  });

  assert.equal(result.external_post_id, 'x-123');
  assert.deepEqual(adapter.getRotatedCredentials(), {
    access_token: 'access-new',
    refresh_token: 'refresh-new',
  });
});
