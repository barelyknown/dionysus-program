const test = require('node:test');
const assert = require('node:assert/strict');

const {
  countRecentSources,
  getResearchDiscoveryMode,
  getResearchRecencyPolicy,
  researchBundleMeetsRecencyPolicy,
} = require('../lib/research-policy');
const { GeminiResearchAdapter } = require('../providers/gemini-research');

test('research recency policy defaults to a 30-day window', () => {
  const policy = getResearchRecencyPolicy({
    watchlists: {},
    referenceDate: new Date('2026-03-15T12:00:00Z'),
  });

  assert.equal(policy.recent_window_days, 30);
  assert.equal(policy.min_recent_sources, 1);
  assert.equal(policy.reference_date, '2026-03-15');
  assert.equal(policy.cutoff_date, '2026-02-13');
});

test('research discovery mode can be configured for article-first selection', () => {
  assert.equal(getResearchDiscoveryMode({ watchlists: {} }), 'thesis_first');
  assert.equal(getResearchDiscoveryMode({ watchlists: { research: { discovery_mode: 'article_first' } } }), 'article_first');
});

test('research recency policy counts only recent sources toward the minimum', () => {
  const policy = getResearchRecencyPolicy({
    watchlists: { research: { recent_window_days: 21, min_recent_sources: 2 } },
    referenceDate: new Date('2026-03-15T12:00:00Z'),
  });

  const bundle = {
    sources: [
      { published_at: '2026-03-10T12:00:00Z' },
      { published_at: '2026-02-25T12:00:00Z' },
      { published_at: '2025-12-01T12:00:00Z' },
    ],
  };

  assert.equal(countRecentSources(bundle.sources, policy), 2);
  assert.equal(researchBundleMeetsRecencyPolicy(bundle, policy), true);
  assert.equal(researchBundleMeetsRecencyPolicy({
    sources: [{ published_at: '2025-12-01T12:00:00Z' }],
  }, policy), false);
});

test('gemini research prompt includes explicit recency requirements', () => {
  const adapter = new GeminiResearchAdapter({ mode: 'fixture' });
  const prompt = adapter.buildPrompt({
    topicThesis: 'Naming failure makes accountability theatrical.',
    watchlists: {
      research: { recent_window_days: 30, min_recent_sources: 1 },
      adjacent_domains: ['corporate governance'],
      entities: { companies: ['OpenAI'] },
      prompts: ['Prefer recent reported cases.'],
    },
    referenceDate: new Date('2026-03-15T12:00:00Z'),
  });

  assert.match(prompt, /Today's date: 2026-03-15/);
  assert.match(prompt, /Search for hot recent reporting first/);
  assert.match(prompt, /Prioritize sources published on or after 2026-02-13/);
  assert.match(prompt, /Return at least 1 recent reported company or institutional cases/);
  assert.match(prompt, /Do not rely on old famous examples when fresh reporting is available/);
  assert.match(prompt, /The goal is not to prove the thesis abstractly/);
});

test('gemini article-first discovery prompt searches news before thesis selection', () => {
  const adapter = new GeminiResearchAdapter({ mode: 'fixture' });
  const prompt = adapter.buildDiscoveryPrompt({
    watchlists: {
      research: { recent_window_days: 30, min_recent_sources: 1 },
      adjacent_domains: ['corporate governance'],
      entities: { companies: ['OpenAI'] },
      prompts: ['Prefer recent reported cases.'],
    },
    topicOptions: [
      'The One-Man Job makes organizations more efficient and less socially coherent at the same time.',
      'Trust burns faster than organizations know how to rebuild it.',
    ],
    requestedTopic: 'Epimetabolic Rate is the only scoreboard that really matters in periods of fast change.',
    referenceDate: new Date('2026-03-15T12:00:00Z'),
  });

  assert.match(prompt, /Do not begin from a preselected thesis/);
  assert.match(prompt, /Find 3 to 5 concrete recent events/);
  assert.match(prompt, /If one of the discovered cases also fits this previously planned thesis/);
  assert.match(prompt, /The One-Man Job makes organizations more efficient and less socially coherent at the same time/);
});
