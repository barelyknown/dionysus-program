const { sha256 } = require('../lib/hash');
const { now } = require('../lib/time');

class GeminiResearchAdapter {
  constructor({ mode = 'fixture', agent = 'deep-research-pro-preview-12-2025', apiKey = process.env.GEMINI_API_KEY } = {}) {
    this.mode = mode;
    this.agent = agent;
    this.apiKey = apiKey;
    this.pollIntervalMs = Number(process.env.GEMINI_POLL_INTERVAL_MS || 3000);
    this.pollAttempts = Number(process.env.GEMINI_POLL_ATTEMPTS || 60);
  }

  async researchTopic({ topicThesis, watchlists }) {
    if (this.mode === 'live' || this.mode === 'record') {
      return this.researchTopicLive({ topicThesis, watchlists });
    }
    return this.researchTopicFixture({ topicThesis, watchlists });
  }

  researchTopicFixture({ topicThesis, watchlists }) {
    const date = now().toISOString().slice(0, 10);
    const sources = [
      {
        title: 'Enterprise AI rollouts keep exposing social bottlenecks',
        url: 'https://example.com/enterprise-ai-rollout',
        published_at: date,
        relevance: `This article is adjacent to "${topicThesis}" because it shows a technical deployment failing socially.`,
        claim: 'Organizations often fail to absorb AI into trust-bearing routines.',
      },
      {
        title: 'A high-profile reorg reveals management theater under pressure',
        url: 'https://example.com/reorg-theater',
        published_at: date,
        relevance: `This article is indirectly related to "${topicThesis}" because reorg behavior reveals hidden trust dynamics.`,
        claim: 'Formal process expands when leaders no longer trust real dissent.',
      },
    ];

    return {
      id: sha256(`fixture:${topicThesis}:${date}`).slice(0, 12),
      provider: 'gemini-fixture',
      topic_thesis: topicThesis,
      summary: `Lateral research found adjacent cases around ${topicThesis.toLowerCase()}.`,
      sources,
      candidate_angles: [
        {
          topic_thesis: topicThesis,
          angle: 'Use an adjacent company story to show that the real failure is social metabolism, not feature delivery.',
          hook: 'The obvious story is rarely the real one.',
          subject: 'adjacent-company-case',
        },
      ],
      watchlist_inputs: watchlists,
      created_at: now().toISOString(),
    };
  }

  buildPrompt({ topicThesis, watchlists }) {
    return [
      `Research thesis: ${topicThesis}`,
      'Find direct and indirect articles that reveal the pattern, not just articles using the same words.',
      `Adjacent domains: ${(watchlists.adjacent_domains || []).join(', ')}`,
      `Entities: ${JSON.stringify(watchlists.entities || {})}`,
      `Prompts: ${(watchlists.prompts || []).join(' ')}`,
      'Return a detailed research report with clearly dated sources and explain why each source matters to the thesis.',
    ].join('\n');
  }

  async submitResearchJob({ topicThesis, watchlists }) {
    if (!this.apiKey) throw new Error('Missing GEMINI_API_KEY for live research.');
    const prompt = this.buildPrompt({ topicThesis, watchlists });
    const createResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: prompt,
        agent: this.agent,
        background: true,
        store: true,
      }),
    });

    if (!createResponse.ok) {
      throw new Error(`Gemini Deep Research create failed (${createResponse.status}): ${await createResponse.text()}`);
    }
    const created = await createResponse.json();
    const interactionId = created.id;
    if (!interactionId) throw new Error('Gemini Deep Research response missing interaction id.');

    return {
      interaction_id: interactionId,
      status: created.status || 'in_progress',
      submitted_at: now().toISOString(),
      prompt,
      topic_thesis: topicThesis,
      watchlist_inputs: watchlists,
    };
  }

  async pollResearchJob({ job }) {
    if (!this.apiKey) throw new Error('Missing GEMINI_API_KEY for live research.');
    let latest = { status: job.status || 'in_progress', id: job.interaction_id };
    for (let attempt = 0; attempt < this.pollAttempts; attempt += 1) {
      if (latest.status === 'completed' || latest.status === 'failed' || latest.status === 'cancelled' || latest.status === 'incomplete') break;
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
      const pollResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions/${job.interaction_id}?key=${this.apiKey}`);
      if (!pollResponse.ok) {
        throw new Error(`Gemini Deep Research poll failed (${pollResponse.status}): ${await pollResponse.text()}`);
      }
      latest = await pollResponse.json();
    }

    return latest;
  }

  normalizeCompletedResearch({ job, latest }) {
    const interactionId = job.interaction_id;

    if (latest.status !== 'completed') {
      throw new Error(`Gemini Deep Research did not complete successfully (status=${latest.status || 'unknown'} after ${this.pollAttempts} polls).`);
    }

    const outputText = Array.isArray(latest.outputs)
      ? latest.outputs.map((entry) => entry.text || '').filter(Boolean).join('\n\n')
      : JSON.stringify(latest);
    return {
      id: sha256(`live:${job.topic_thesis}:${interactionId}`).slice(0, 12),
      provider: 'gemini-live',
      topic_thesis: job.topic_thesis,
      summary: outputText.slice(0, 2000),
      sources: [],
      candidate_angles: [
        {
          topic_thesis: job.topic_thesis,
          angle: 'Normalize live research output with GPT scoring before scheduling.',
          hook: 'The visible event is not the real diagnosis.',
          subject: 'live-research-subject',
        },
      ],
      raw: latest,
      watchlist_inputs: job.watchlist_inputs,
      created_at: now().toISOString(),
    };
  }

  async researchTopicLive({ topicThesis, watchlists }) {
    const job = await this.submitResearchJob({ topicThesis, watchlists });
    const latest = await this.pollResearchJob({ job });
    return this.normalizeCompletedResearch({ job, latest });
  }
}

module.exports = {
  GeminiResearchAdapter,
};
