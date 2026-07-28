const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GeminiResearchAdapter,
  DEFAULT_DEEP_RESEARCH_AGENT,
  interactionOutputText,
  interactionUrlCitations,
} = require('../providers/gemini-research');

test('current Interactions API steps expose report text and url citations', async () => {
  const adapter = new GeminiResearchAdapter({ mode: 'live', apiKey: 'test-key' });
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false });
  const latest = {
    status: 'completed',
    steps: [{
      type: 'model_output',
      content: [{
        type: 'text',
        text: 'On July 18, 2026, a company reversed its AI-only support policy after quality declined.',
        annotations: [{
          type: 'url_citation',
          title: 'Company restores human support',
          url: 'https://news.example.com/company-restores-human-support',
          start_index: 3,
          end_index: 86,
        }],
      }],
    }],
  };

  try {
    assert.match(interactionOutputText(latest), /July 18, 2026/);
    assert.deepEqual(interactionUrlCitations(latest).map(({ url, title }) => ({ url, title })), [{
      url: 'https://news.example.com/company-restores-human-support',
      title: 'Company restores human support',
    }]);
    const result = await adapter.normalizeCompletedResearch({
      job: {
        interaction_id: 'interaction-current',
        topic_thesis: 'Automation can hide the coordination work it still depends on.',
        watchlist_inputs: {},
      },
      latest,
    });
    assert.equal(result.summary, latest.steps[0].content[0].text);
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].url, 'https://news.example.com/company-restores-human-support');
    assert.equal(result.sources[0].published_at, '2026-07-18');
    assert.match(result.sources[0].citation_context, /quality declined/);
    assert.equal(adapter.agent, DEFAULT_DEEP_RESEARCH_AGENT);
    assert.equal(DEFAULT_DEEP_RESEARCH_AGENT, 'deep-research-preview-04-2026');
  } finally {
    global.fetch = originalFetch;
  }
});

test('legacy outputs remain compatible and resolve exact urls and dates', async () => {
  const adapter = new GeminiResearchAdapter({ mode: 'live', apiKey: 'test-key' });
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    if (String(url).includes('grounding-api-redirect/example-1')) {
      return {
        ok: true,
        url: 'https://www.theguardian.com/technology/2026/mar/13/meta-layoffs-ai',
        text: async () => `
          <html>
            <head>
              <meta content="Meta plans layoffs amid AI spending" property="og:title" />
              <meta content="2026-03-13T07:00:00Z" property="article:published_time" />
            </head>
            <body>
              Meta is preparing layoffs after a wave of AI spending.
            </body>
          </html>`,
      };
    }
    if (String(url).includes('grounding-api-redirect/example-2')) {
      return {
        ok: true,
        url: 'https://www.fastcompany.com/91468582/klarna-tried-to-replace-its-workforce-with-ai',
        text: async () => `
          <html>
            <head>
              <title>Klarna tried to replace its workforce with AI</title>
              <script type="application/ld+json">
                {"datePublished":"2026-03-14T09:30:00Z"}
              </script>
            </head>
            <body>
              Klarna reversed part of its AI-first support strategy after customer backlash.
            </body>
          </html>`,
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const result = await adapter.normalizeCompletedResearch({
      job: {
        interaction_id: 'interaction-1',
        topic_thesis: 'AI-washed layoffs reveal naming failure.',
        watchlist_inputs: {},
      },
      latest: {
        status: 'completed',
        outputs: [
          {
            text: 'Recent reporting highlights layoffs and AI substitution claims.',
            annotations: [
              { source: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/example-1' },
              { source: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/example-2' },
            ],
          },
        ],
      },
    });

    assert.equal(result.sources.length, 2);
    assert.deepEqual(
      result.sources.map((source) => ({ url: source.url, published_at: source.published_at })),
      [
        {
          url: 'https://www.theguardian.com/technology/2026/mar/13/meta-layoffs-ai',
          published_at: '2026-03-13',
        },
        {
          url: 'https://www.fastcompany.com/91468582/klarna-tried-to-replace-its-workforce-with-ai',
          published_at: '2026-03-14',
        },
      ],
    );
    assert.match(result.sources[0].content_text, /Meta is preparing layoffs/i);
    assert.match(result.sources[1].content_text, /Klarna reversed part of its AI-first support strategy/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test('pollResearchJob accepts publish-time polling overrides', async () => {
  const adapter = new GeminiResearchAdapter({ mode: 'live', apiKey: 'test-key' });
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async () => {
    calls.push(calls.length + 1);
    return {
      ok: true,
      json: async () => ({
        status: calls.length >= 3 ? 'completed' : 'in_progress',
      }),
    };
  };

  try {
    const result = await adapter.pollResearchJob({
      job: { interaction_id: 'interaction-1', status: 'in_progress' },
      pollAttempts: 3,
      pollIntervalMs: 0,
    });

    assert.equal(calls.length, 3);
    assert.equal(result.status, 'completed');
  } finally {
    global.fetch = originalFetch;
  }
});

test('discovery prompt includes recently used story exclusions', () => {
  const adapter = new GeminiResearchAdapter({ mode: 'fixture' });
  const prompt = adapter.buildDiscoveryPrompt({
    watchlists: {
      adjacent_domains: ['artificial intelligence'],
      entities: { companies: ['Klarna', 'Meta'] },
      prompts: ['Prefer concrete cases.'],
      research: { recent_window_days: 30, min_recent_sources: 1 },
    },
    topicOptions: ['The Apollo Program is necessary but insufficient because optimization cannot metabolize meaning.'],
    requestedTopic: 'The Apollo Program is necessary but insufficient because optimization cannot metabolize meaning.',
    excludedEntities: ['Klarna'],
    excludedSourceUrls: ['https://www.forbes.com/sites/jonmarkman/2026/03/04/why-todays-ai-driven-layoffs-are-becoming-tomorrows-rehiring-crisis/'],
    referenceDate: new Date('2026-03-30T12:30:00Z'),
  });

  assert.match(prompt, /Exclude any candidate whose lead company or institution is in this recently used set: Klarna/);
  assert.match(prompt, /Exclude any candidate that depends on these exact recently used source URLs/);
});
