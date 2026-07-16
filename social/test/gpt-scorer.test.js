const test = require('node:test');
const assert = require('node:assert/strict');

const { GPTScorerAdapter } = require('../providers/gpt-scorer');

test('live idea development sends published argument history before prose generation', async (t) => {
  const originalFetch = global.fetch;
  let requestBody = null;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        status: 'completed',
        output_text: JSON.stringify({
          pass: true,
          topic_thesis: 'A novel thesis.',
          angle: 'A distinct mechanism.',
          hook: 'A concrete tell.',
          argument_summary: 'A novel mechanism changes a different operator decision.',
          novelty_score: 9,
          closest_post_id: 'old-post',
          novelty_rationale: 'The prior post reaches a different consequence.',
          source_grounding: 'The supplied source context supports the claim.',
        }),
      }),
    };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const scorer = new GPTScorerAdapter({ mode: 'live', model: 'gpt-5.6-sol', apiKey: 'test-key' });
  const idea = await scorer.developNovelIdea({
    calendarItem: {
      content_type: 'extracted_insight',
      topic_thesis: 'Seed topic.',
      angle: 'Seed angle.',
    },
    brief: {
      full_compressed_context: 'Grounding from the book.',
      citations: [],
    },
    history: [{
      post_id: 'old-post',
      topic_thesis: 'Prior claim.',
      linkedin_text: 'The full prior argument.',
      x_text: 'The prior X version.',
    }],
    strategy: { generation: { idea_reasoning_effort: 'high' } },
  });

  const userPayload = JSON.parse(requestBody.input[1].content[0].text);
  assert.equal(requestBody.model, 'gpt-5.6-sol');
  assert.equal(userPayload.published_argument_history.length, 1);
  assert.equal(userPayload.published_argument_history[0].linkedin_text, 'The full prior argument.');
  assert.equal(idea.pass, true);
  assert.equal(idea.novelty_score, 9);
});

test('live draft scoring fails closed below the configured engagement threshold', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      output_text: JSON.stringify({
        scores: [{
          candidate_id: 'candidate-low-engagement',
          voice_score: 9,
          novelty_score: 9,
          engagement_score: 6.5,
          clarity_score: 9,
          risk_score: 9,
          citation_score: 8,
          linkedin_native_score: 9,
          overall_score: 8.7,
          pass: true,
          pass_fail_reasons: [],
        }],
      }),
    }),
  });
  t.after(() => {
    global.fetch = originalFetch;
  });

  const scorer = new GPTScorerAdapter({ mode: 'live', apiKey: 'test-key' });
  const [score] = await scorer.scoreCandidates({
    candidates: [{ id: 'candidate-low-engagement', post_text: 'A novel but inert draft.' }],
    brief: { content_type: 'extracted_insight' },
    strategy: {
      generation: {
        minimum_draft_novelty_score: 8,
        minimum_draft_engagement_score: 7.5,
      },
    },
    memory: {},
    sourceRefs: [],
  });

  assert.equal(score.pass, false);
  assert.match(score.pass_fail_reasons.join(','), /draft_engagement_below_threshold/);
});

test('live redundancy audit reserves enough output budget for the current corpus', async (t) => {
  const originalFetch = global.fetch;
  let requestBody = null;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        status: 'completed',
        output_text: JSON.stringify({ clusters: [] }),
      }),
    };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const scorer = new GPTScorerAdapter({ mode: 'live', apiKey: 'test-key' });
  await scorer.auditPublishedRedundancy({
    records: [
      { post_id: 'one', linkedin_text: 'Full first note.' },
      { post_id: 'two', linkedin_text: 'Full second note.' },
    ],
    candidatePairs: [{
      pair_id: 'one::two',
      same_topic_thesis: false,
      lexical_signals: { linkedin_overlap: 0.8 },
      maximum_lexical_overlap: 0.8,
      left: { post_id: 'one', linkedin_text: 'Full first note.' },
      right: { post_id: 'two', linkedin_text: 'Full second note.' },
    }],
  });

  assert.equal(requestBody.max_output_tokens, 20000);
  assert.equal(requestBody.reasoning.effort, 'high');
  const userPayload = JSON.parse(requestBody.input[1].content[0].text);
  assert.equal(userPayload.corpus_records.length, 2);
  assert.equal(userPayload.candidate_pairs[0].left_post_id, 'one');
  assert.equal(userPayload.candidate_pairs[0].left, undefined);
});

test('live redundancy removal confirmation independently compares each remove and keep pair', async (t) => {
  const originalFetch = global.fetch;
  let requestBody = null;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        status: 'completed',
        output_text: JSON.stringify({
          decisions: [{
            remove_post_id: 'old-post',
            keep_post_id: 'new-post',
            redundant: false,
            confidence: 0.93,
            justification: 'The old post contributes a distinct operator decision.',
          }],
        }),
      }),
    };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const scorer = new GPTScorerAdapter({ mode: 'live', apiKey: 'test-key' });
  const result = await scorer.confirmRedundancyRemovals({
    pairs: [{
      remove: { post_id: 'old-post', linkedin_text: 'Full old argument.' },
      keep: { post_id: 'new-post', linkedin_text: 'Full new argument.' },
    }],
  });

  const systemText = requestBody.input[0].content[0].text;
  const userPayload = JSON.parse(requestBody.input[1].content[0].text);
  assert.equal(requestBody.reasoning.effort, 'high');
  assert.equal(requestBody.max_output_tokens, 12000);
  assert.match(systemText, /reasonable follower feel they had practically already read this note/);
  assert.equal(userPayload.proposed_removals[0].remove.linkedin_text, 'Full old argument.');
  assert.equal(result.decisions[0].redundant, false);
});
