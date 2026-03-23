const { sha256 } = require('../lib/hash');
const { now } = require('../lib/time');
const { getResearchRecencyPolicy } = require('../lib/research-policy');

const SOURCE_FETCH_TIMEOUT_MS = 10000;
const SOURCE_CONTENT_MAX_CHARS = 30000;
const MAX_GROUNDED_SOURCES = 40;

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizePublishedDate(value) {
  if (!value) return null;
  const exact = String(value).match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (exact) return exact[1];
  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function extractPageText(html) {
  const body = String(html || '').match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || String(html || '');
  return stripTags(
    body
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' '),
  ).slice(0, SOURCE_CONTENT_MAX_CHARS);
}

function extractDateFromUrl(url) {
  if (!url) return null;
  const numeric = String(url).match(/\/(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})(?:[\/-]|$)/);
  if (numeric) {
    const [, year, month, day] = numeric;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const monthName = String(url).match(/\/(20\d{2})\/(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\/(\d{1,2})(?:\/|$)/i);
  if (monthName) {
    const monthMap = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
    };
    const [, year, monthToken, day] = monthName;
    return `${year}-${monthMap[monthToken.toLowerCase()]}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

function extractMetaContent(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return stripTags(match[1]);
  }
  return null;
}

function dedupeSources(sources = []) {
  const seen = new Set();
  const deduped = [];
  for (const source of sources) {
    const key = source?.url || source?.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(source);
  }
  return deduped;
}

function sourcePriorityScore(source) {
  const url = String(source?.url || '').toLowerCase();
  const title = String(source?.title || '').toLowerCase();
  const publishedAt = String(source?.published_at || '');
  let score = 0;
  if (publishedAt) score += 8;
  if (/2026|2025/.test(publishedAt)) score += 4;
  if (/reuters|theguardian|businessinsider|fastcompany|techcrunch|bloomberg|nytimes|washingtonpost|wsj|ft\.com|forbes|cbsnews|fortune|theinformation|platformer|stratechery/.test(url)) score += 6;
  if (/klarna|meta|openai|google|microsoft|anthropic|shopify|salesforce|nvidia|amazon/.test(url + title)) score += 5;
  if (/wikipedia|grokipedia|scribd|pdf|archive\.org|stanford\.edu|plato\.stanford\.edu/.test(url)) score -= 4;
  return score;
}

async function fetchSourceMetadata(url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DionysusResearchBot/1.0)',
      },
    });
    if (!response.ok) return null;
    const finalUrl = response.url || url;
    const html = await response.text();
    const title = extractMetaContent(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"]+)["']/i,
      /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"]+)["']/i,
      /<title[^>]*>([^<]+)<\/title>/i,
    ]);
    const excerpt = extractMetaContent(html, [
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"]+)["']/i,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"]+)["']/i,
      /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"]+)["']/i,
    ]);
    const publishedAt = normalizePublishedDate(extractMetaContent(html, [
      /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"]+)["']/i,
      /<meta[^>]+name=["']pubdate["'][^>]+content=["']([^"]+)["']/i,
      /<meta[^>]+name=["']publish-date["'][^>]+content=["']([^"]+)["']/i,
      /<meta[^>]+name=["']parsely-pub-date["'][^>]+content=["']([^"]+)["']/i,
      /"datePublished"\s*:\s*"([^"]+)"/i,
    ])) || extractDateFromUrl(finalUrl);
    return {
      title: title || finalUrl,
      url: finalUrl,
      published_at: publishedAt,
      excerpt: excerpt || '',
      content_text: extractPageText(html),
    };
  } catch {
    return null;
  }
}

async function extractGroundedSources({ latest, limit = MAX_GROUNDED_SOURCES }) {
  const groundingUrls = unique(
    (latest?.outputs || []).flatMap((entry) => (entry.annotations || []).map((annotation) => annotation.source)),
  ).slice(0, limit);
  const sources = [];
  for (const url of groundingUrls) {
    const metadata = await fetchSourceMetadata(url);
    if (!metadata?.url) continue;
    sources.push({
      title: metadata.title,
      url: metadata.url,
      published_at: metadata.published_at || '',
      excerpt: metadata.excerpt || '',
      content_text: metadata.content_text || '',
      relevance: 'Resolved from Gemini grounding annotations.',
      claim: 'Grounded source captured from the deep research report.',
    });
  }
  return dedupeSources(sources).sort((left, right) => sourcePriorityScore(right) - sourcePriorityScore(left));
}

class GeminiResearchAdapter {
  constructor({ mode = 'fixture', agent = 'deep-research-pro-preview-12-2025', apiKey = process.env.GEMINI_API_KEY } = {}) {
    this.mode = mode;
    this.agent = agent;
    this.apiKey = apiKey;
    this.pollIntervalMs = Number(process.env.GEMINI_POLL_INTERVAL_MS || 3000);
    this.pollAttempts = Number(process.env.GEMINI_POLL_ATTEMPTS || 60);
    this.publishPollIntervalMs = Number(process.env.GEMINI_PUBLISH_POLL_INTERVAL_MS || this.pollIntervalMs);
    this.publishPollAttempts = Number(process.env.GEMINI_PUBLISH_POLL_ATTEMPTS || this.pollAttempts);
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
          topic_thesis: 'Enterprise AI rollout reporting shows the visible product miss is usually a naming failure upstream.',
          angle: 'Start from one fresh AI rollout case, then show how euphemistic language kept the institution from naming the real social bottleneck.',
          hook: 'The product miss is visible. The naming failure above it is the real story.',
          subject: sources[0].title,
        },
      ],
      watchlist_inputs: watchlists,
      created_at: now().toISOString(),
    };
  }

  buildPrompt({ topicThesis, watchlists, referenceDate = now() }) {
    const recencyPolicy = getResearchRecencyPolicy({ watchlists, referenceDate });
    return [
      `Research thesis: ${topicThesis}`,
      `Today's date: ${recencyPolicy.reference_date}`,
      'Search for hot recent reporting first, then choose the single best case that matches the thesis most clearly.',
      `Search for recent reporting first. Prioritize sources published on or after ${recencyPolicy.cutoff_date} (${recencyPolicy.recent_window_days}-day window).`,
      `Return at least ${recencyPolicy.min_recent_sources} recent reported company or institutional cases unless no such reporting exists.`,
      'Use older canonical or conceptual sources only as supporting context, not as the main case.',
      'Do not rely on old famous examples when fresh reporting is available.',
      'The goal is not to prove the thesis abstractly. The goal is to find one concrete recent event that makes the thesis legible.',
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

  async fetchResearchJob({ job }) {
    if (!this.apiKey) throw new Error('Missing GEMINI_API_KEY for live research.');
    const pollResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions/${job.interaction_id}?key=${this.apiKey}`);
    if (!pollResponse.ok) {
      throw new Error(`Gemini Deep Research poll failed (${pollResponse.status}): ${await pollResponse.text()}`);
    }
    return pollResponse.json();
  }

  async pollResearchJob({ job, pollAttempts = this.pollAttempts, pollIntervalMs = this.pollIntervalMs }) {
    if (!this.apiKey) throw new Error('Missing GEMINI_API_KEY for live research.');
    let latest = null;
    for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      latest = await this.fetchResearchJob({ job });
      if (latest.status === 'completed' || latest.status === 'failed' || latest.status === 'cancelled' || latest.status === 'incomplete') break;
    }

    return latest || { status: job.status || 'in_progress', id: job.interaction_id };
  }

  async normalizeCompletedResearch({ job, latest }) {
    const interactionId = job.interaction_id;

    if (latest.status !== 'completed') {
      throw new Error(`Gemini Deep Research did not complete successfully (status=${latest.status || 'unknown'} after ${this.pollAttempts} polls).`);
    }

    const outputText = Array.isArray(latest.outputs)
      ? latest.outputs.map((entry) => entry.text || '').filter(Boolean).join('\n\n')
      : JSON.stringify(latest);
    const sources = await extractGroundedSources({ latest });
    return {
      id: sha256(`live:${job.topic_thesis}:${interactionId}`).slice(0, 12),
      provider: 'gemini-live',
      topic_thesis: job.topic_thesis,
      summary: outputText.slice(0, 2000),
      sources,
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
