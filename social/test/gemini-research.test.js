const test = require('node:test');
const assert = require('node:assert/strict');

const { GeminiResearchAdapter } = require('../providers/gemini-research');

test('normalizeCompletedResearch extracts exact urls and dates from grounding annotations', async () => {
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
              <meta property="og:title" content="Meta plans layoffs amid AI spending" />
              <meta property="article:published_time" content="2026-03-13T07:00:00Z" />
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
