const test = require('node:test');
const assert = require('node:assert/strict');

const { setupTempSocialWorkspace } = require('./helpers');
const { loadStrategy } = require('../lib/config');
const { GPTXAdapter } = require('../providers/gpt-x');
const { XPublisherAdapter } = require('../providers/x-publisher');
const { attemptXPublish, rankXResults } = require('../lib/x');
const { createPublishedRecord } = require('../lib/pipeline');

test('fixture X generator produces 8 structurally varied single-post candidates', async (t) => {
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
  const paragraphCounts = new Set();
  for (const candidate of candidates) {
    assert.ok(candidate.post_text.length <= strategy.x.max_length);
    const paragraphCount = candidate.post_text.split(/\n\s*\n/).length;
    assert.ok(paragraphCount >= 1 && paragraphCount <= 3);
    paragraphCounts.add(paragraphCount);
  }
  assert.ok(paragraphCounts.size >= 2);
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

  const ranked = rankXResults({
    scorecards: [
      { candidate_id: 'good-long', pass: true, overall_score: 8 },
      { candidate_id: 'good-short', pass: true, overall_score: 8 },
    ],
    candidates,
  });
  assert.equal(ranked[0].candidate_id, 'good-short');
});

test('fixture X scorer hard-fails an otherwise strong near-duplicate', async (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const adapter = new GPTXAdapter({ mode: 'fixture' });
  const recentPosts = [{
    post_id: 'x-recent',
    x_summary: 'A healthy team can look disciplined while becoming less honest. The dashboard stays green because bad news moved into private channels.',
  }];
  const [score] = await adapter.scoreCandidates({
    candidates: [{
      id: 'near-duplicate',
      post_text: 'A healthy team can look disciplined while becoming less honest. Its dashboard stays green because the bad news moved into private channels.',
    }],
    linkedinText: 'A healthy team can hide decline behind green dashboards.',
    strategy,
    recentPosts,
  });

  assert.equal(score.pass, false);
  assert.equal(score.novelty_score, 0);
  assert.match(score.pass_fail_reasons.join(','), /x_near_duplicate/);
});

test('attemptXPublish returns dry-run X payload when a candidate passes', async (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const xWriter = new GPTXAdapter({ mode: 'fixture' });
  const xScorer = new GPTXAdapter({ mode: 'fixture' });
  const x = new XPublisherAdapter({ mode: 'fixture' });

  const result = await attemptXPublish({
    linkedinPayload: {
      body_text: [
        'Failure gets renamed before it gets examined.',
        '',
        'That is how organizations lose the ability to metabolize reality.',
      ].join('\n'),
      final_text: [
        'Failure gets renamed before it gets examined.',
        '',
        'That is how organizations lose the ability to metabolize reality.',
        '',
        '---',
        '',
        'The Dionysus Program is free at dionysusprogram.com.',
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
  assert.doesNotMatch(result.payload.text, /dionysusprogram\.com/i);
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

test('attemptXPublish final gate skips a duplicate even if a scorer marks it passing', async (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const duplicateText = 'A healthy team can look disciplined while becoming less honest.';
  let publishCalled = false;
  let writerRecentPosts = null;
  let scorerRecentPosts = null;

  const result = await attemptXPublish({
    linkedinPayload: {
      final_text: 'A source post about healthy-looking decline.',
      winning_candidate_id: 'linkedin-winner',
    },
    strategy,
    memory: {
      recent_x_posts: [{ post_id: 'x-recent', x_summary: duplicateText }],
    },
    adapters: {
      xWriter: {
        generateCandidates: async ({ recentPosts }) => {
          writerRecentPosts = recentPosts;
          return [{ id: 'duplicate', post_text: duplicateText }];
        },
      },
      xScorer: {
        scoreCandidates: async ({ recentPosts }) => {
          scorerRecentPosts = recentPosts;
          return [{ candidate_id: 'duplicate', pass: true, overall_score: 10 }];
        },
      },
      x: {
        publish: async () => {
          publishCalled = true;
        },
      },
    },
    dryRun: false,
  });

  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'duplicate_history');
  assert.equal(publishCalled, false);
  assert.equal(writerRecentPosts.length, 1);
  assert.equal(scorerRecentPosts.length, 1);
});

test('social strategy uses the current flagship OpenAI model', (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();

  assert.equal(strategy.provider_defaults.openai_model, 'gpt-5.6-sol');
  assert.equal(strategy.x.writer_model, 'gpt-5.6-sol');
  assert.equal(strategy.x.scorer_model, 'gpt-5.6-sol');
  assert.equal(new GPTXAdapter().model, 'gpt-5.6-sol');
});

test('live X generation sends recent history and varied voice guidance to OpenAI', async (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const originalFetch = global.fetch;
  let requestBody = null;
  t.after(() => {
    global.fetch = originalFetch;
  });
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          candidates: [{
            prompt_variant: 'vivid_tell',
            post_text: 'The dashboard stayed green. The useful warnings had moved to the hallway.',
            self_notes: 'Concrete and compact.',
          }],
        }),
      }),
    };
  };

  const adapter = new GPTXAdapter({ mode: 'live', apiKey: 'test-key' });
  await adapter.generateCandidates({
    linkedinText: 'A healthy-looking system can hide the signals that matter.',
    strategy,
    bestOfN: 1,
    recentPosts: [{
      post_id: 'x-recent',
      topic_thesis: 'Green dashboards can conceal decline.',
      x_summary: 'Strong teams can miss the turn while every signal stays green.',
    }],
  });

  assert.equal(requestBody.model, 'gpt-5.6-sol');
  const systemText = requestBody.input[0].content[0].text;
  const userPayload = JSON.parse(requestBody.input[1].content[0].text);
  assert.match(systemText, /1-3 short paragraphs/);
  assert.match(systemText, /Never reuse a recent post’s core claim/);
  assert.match(systemText, /Vary the architecture/);
  assert.equal(userPayload.recent_x_posts_do_not_repeat[0].id, 'x-recent');
  assert.match(userPayload.style_center, /concrete tell/);
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
