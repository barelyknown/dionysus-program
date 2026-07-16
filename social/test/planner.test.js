const test = require('node:test');
const assert = require('node:assert/strict');

const { setupTempSocialWorkspace, appendJsonl } = require('./helpers');
const { loadStrategy } = require('../lib/config');
const { rebuildMemory } = require('../lib/memory');
const {
  planBaselineWeek,
  selectTopicForType,
  selectResearchTopic,
  scoreTopicCandidate,
  loadMailbagItems,
} = require('../lib/planner');
const { paths } = require('../lib/paths');
const { loadSourceContext } = require('../lib/context');

test('planner produces a diverse baseline week from an empty history', (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const memory = rebuildMemory({ strategy, referenceDate: new Date('2026-03-14T12:00:00Z') });
  const calendar = planBaselineWeek({
    strategy,
    memory,
    context: { llmContextExcerpt: [], pullQuotes: [], archetypeNames: [], letters: [] },
    referenceDate: new Date('2026-03-14T12:00:00Z'),
  });

  assert.equal(calendar.items.length, 3);
  assert.deepEqual(calendar.items.map((item) => item.weekday), ['monday', 'wednesday', 'friday']);
  assert.ok(new Set(calendar.items.map((item) => item.content_type)).size >= 3);
  for (let index = 1; index < calendar.items.length; index += 1) {
    assert.notEqual(calendar.items[index].content_type, calendar.items[index - 1].content_type);
  }
});

test('planner uses actual published history to avoid overused decoder ring slots', (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  appendJsonl(paths.publishedLedger, Array.from({ length: 10 }, (_, index) => ({
    post_id: `post-${index}`,
    published_at: `2026-02-${String(index + 1).padStart(2, '0')}T16:00:00Z`,
    content_type: 'decoder_ring',
    pillar: 'Decoder Ring',
    topic_thesis: `Topic ${index}`,
    angle: `Angle ${index}`,
    hook: `Hook ${index}`,
    summary: `Summary ${index}`,
    source_refs: [],
    framework_terms_used: [],
    timely_subject: null,
    research_bundle_id: null,
    winning_candidate_id: `candidate-${index}`,
    final_text_hash: `hash-${index}`,
  })));

  const memory = rebuildMemory({ strategy, referenceDate: new Date('2026-03-14T12:00:00Z') });
  const calendar = planBaselineWeek({
    strategy,
    memory,
    context: { llmContextExcerpt: [], pullQuotes: [], archetypeNames: [], letters: [] },
    referenceDate: new Date('2026-03-14T12:00:00Z'),
  });

  const wednesdayItem = calendar.items.find((item) => item.weekday === 'wednesday');
  assert.ok(wednesdayItem);
  assert.notEqual(wednesdayItem.content_type, 'decoder_ring');
});

test('topic selector prefers ritual-oriented topics for ritual recipes even if they appear later in the list', (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const memory = rebuildMemory({ strategy, referenceDate: new Date('2026-03-15T12:00:00Z') });
  const context = loadSourceContext();
  const topic = selectTopicForType({
    topics: [
      'The real bottleneck in AI adoption is cultural, not technical.',
      'A Small Fractal Calendar beats occasional heroic reinvention.',
      'Cooling intervals are part of truth-telling because exhaustion distorts recognition.',
    ],
    typeId: 'ritual_recipe',
    strategy,
    memory,
    context,
    usedTopics: new Set(),
  });

  assert.equal(topic, 'A Small Fractal Calendar beats occasional heroic reinvention.');
});

test('research topic selector balances novelty and researchability against stale repeats', (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  appendJsonl(paths.publishedLedger, [
    {
      post_id: 'post-1',
      published_at: '2026-03-10T16:00:00Z',
      content_type: 'decoder_ring',
      pillar: 'Decoder Ring',
      topic_thesis: 'The real bottleneck in AI adoption is cultural, not technical.',
      angle: 'Angle',
      hook: 'Hook',
      summary: 'Summary',
      source_refs: [],
      framework_terms_used: [],
      timely_subject: null,
      research_bundle_id: null,
      winning_candidate_id: 'candidate-1',
      final_text_hash: 'hash-1',
    },
  ]);
  const memory = rebuildMemory({ strategy, referenceDate: new Date('2026-03-15T12:00:00Z') });
  const context = loadSourceContext();
  const topic = selectResearchTopic({
    topics: [
      'The real bottleneck in AI adoption is cultural, not technical.',
      'Management theater is what happens when ritual capacity grows faster than trust.',
      'A myth should absorb failure as well as success, or it will betray the group when pressure rises.',
    ],
    strategy,
    memory,
    context,
    watchlists: {
      seed_topics: ['ai adoption', 'management theater'],
      adjacent_domains: ['artificial intelligence', 'enterprise software'],
      keyword_clusters: [['reorg', 'org design']],
      entities: { companies: ['OpenAI'], thinkers: ['Confucius'], newsletters: ['Platformer'] },
    },
  });

  assert.equal(topic, 'Management theater is what happens when ritual capacity grows faster than trust.');
});

test('mailbag loader includes letters to the editor as valid mailbag sources', (t) => {
  setupTempSocialWorkspace(t);
  const items = loadMailbagItems();
  const letter = items.find((item) => item.source_kind === 'letter_to_editor');

  assert.ok(letter);
  assert.match(letter.provenance, /letters_to_editor\/confucius\.txt$/);
  assert.equal(typeof letter.full_text, 'string');
  assert.ok(letter.full_text.length > 20);
  assert.equal(letter.attribution, 'Not Confucius');
  assert.ok(!('quote' in letter) || !letter.quote);
});

test('planner novelty scoring considers argument history beyond the topic cooldown window', (t) => {
  setupTempSocialWorkspace(t);
  const strategy = loadStrategy();
  const memory = rebuildMemory({ strategy, referenceDate: new Date('2026-03-15T12:00:00Z') });
  memory.recent_topics = [];
  memory.recent_content = [{
    post_id: 'old-post',
    published_at: '2020-01-01T12:00:00Z',
    topic_thesis: 'Rotation without handoff creates institutional amnesia.',
    text: 'A rotation can prevent capture while destroying the memory required to compound.',
  }];
  const context = loadSourceContext();
  const repeated = scoreTopicCandidate({
    topicEntry: 'Rotation without handoff creates institutional amnesia.',
    strategy,
    memory,
    context,
  });
  const fresh = scoreTopicCandidate({
    topicEntry: 'Play restores sociability only when it is not scored as work.',
    strategy,
    memory,
    context,
  });

  assert.equal(repeated.reasons.novelty, 0);
  assert.ok(fresh.reasons.novelty > repeated.reasons.novelty);
});
