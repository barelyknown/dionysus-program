const { getMemoryConflicts } = require('../lib/memory');
const { sha256 } = require('../lib/hash');
const { countRecentSources, getResearchRecencyPolicy } = require('../lib/research-policy');

const REQUEST_TIMEOUT_MS = 180000;
const NORMALIZATION_TIMEOUT_MS = 180000;
const SCORE_REQUEST_ATTEMPTS = 2;

function containsEmoji(text) {
  return /\p{Extended_Pictographic}/u.test(text);
}

function containsHashtag(text) {
  return /(^|\s)#[A-Za-z0-9_]+/.test(text);
}

function containsLink(text) {
  return /https?:\/\/\S+/i.test(text);
}

function paragraphs(text) {
  return String(text || '').split(/\n\s*\n/).filter(Boolean);
}

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function openerPenalty(text) {
  const opener = (paragraphs(text)[0] || '').trim().toLowerCase();
  if (!opener) return 2;

  const weakStarts = [
    'a note came in',
    'one line stuck',
    'i have been thinking',
    'the book has been making this point',
    'most leaders',
    'most companies',
    'every company i',
    'a note from',
  ];

  if (weakStarts.some((phrase) => opener.startsWith(phrase))) return 1.5;
  if (opener.split(/\s+/).length < 4) return 1;
  return 0;
}

function liveScoringSystemPrompt({ brief }) {
  const instructions = [
    'Score LinkedIn post candidates. Be strict. Prefer concise, high-signal posts.',
    'A strong opener should create immediate tension, consequence, or pattern-recognition; it should contain substance rather than merely announcing the existence of a note, thought, or post.',
    'Heavily penalize generic setup lines, rambling, repeated thesis statements, article-summary behavior, padded examples, and soft endings.',
    'Do not force one opener template; reward variety when it still lands sharply.',
    'Fail anything that duplicates recent published ideas, exceeds 260 words, or violates the no-emoji/no-hashtag/no-link policy.',
  ];
  if (brief?.content_type === 'decoder_ring' && Array.isArray(brief.citations) && brief.citations.length > 0) {
    instructions.push(
      'For decoder_ring posts with research, the first paragraph must clearly anchor the post to one concrete sourced company, leader, or event from the provided research materials.',
      'Fail drafts that speak in broad trend language without naming the visible case, or that use the research only as background inspiration.',
    );
  }
  return instructions.join(' ');
}

function isExactPublishedDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isValidHttpUrl(value) {
  return /^https?:\/\/\S+/i.test(String(value || ''));
}

function normalizeStructuredSources(sources = []) {
  return (Array.isArray(sources) ? sources : [])
    .filter((source) => source && isValidHttpUrl(source.url) && isExactPublishedDate(source.published_at))
    .map((source) => ({
      ...source,
      published_at: String(source.published_at).slice(0, 10),
    }));
}

function mergeStructuredSources(primary = [], fallback = []) {
  const merged = [];
  const byKey = new Map();
  for (const source of [...primary, ...fallback]) {
    const key = `${source.url}|${source.published_at}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...source });
      merged.push(byKey.get(key));
      continue;
    }
    for (const [field, value] of Object.entries(source)) {
      if (!existing[field] && value) existing[field] = value;
    }
  }
  return merged;
}

function compactSourcesForNormalization(sources = []) {
  return normalizeStructuredSources(sources).map((source) => ({
    title: source.title,
    url: source.url,
    published_at: source.published_at,
    relevance: source.relevance || '',
    claim: source.claim || '',
    excerpt: source.excerpt || '',
  }));
}

async function postOpenAIResponses({ apiKey, body, timeoutMs, attempts = 1 }) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch('https://api.openai.com/v1/responses', {
        signal: AbortSignal.timeout(timeoutMs),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      lastError = error;
      const isTimeout = error?.name === 'TimeoutError';
      if (!isTimeout || attempt === attempts) throw error;
    }
  }
  throw lastError;
}

class GPTScorerAdapter {
  constructor({ mode = 'fixture', model = 'gpt-5.4', apiKey = process.env.OPENAI_API_KEY } = {}) {
    this.mode = mode;
    this.model = model;
    this.apiKey = apiKey;
    this.lastUsage = null;
  }

  async scoreCandidates({ candidates, brief, strategy, memory, sourceRefs }) {
    if (this.mode === 'live' || this.mode === 'record') {
      return this.scoreCandidatesLive({ candidates, brief, strategy, memory, sourceRefs });
    }
    return this.scoreCandidatesFixture({ candidates, brief, strategy, memory, sourceRefs });
  }

  async normalizeResearchReport({ topicThesis, rawReport, fallbackSources = [], watchlists = {} }) {
    if (this.mode === 'live' || this.mode === 'record') {
      return this.normalizeResearchReportLive({ topicThesis, rawReport, fallbackSources, watchlists });
    }
    const primarySource = fallbackSources[0] || null;
    const primaryTitle = primarySource?.title || 'recent company case';
    return {
      summary: String(rawReport || '').slice(0, 600),
      sources: fallbackSources,
      primary_source: primarySource,
      candidate_angles: [
        {
          topic_thesis: `${primaryTitle} makes the underlying organizational pattern visible.`,
          angle: 'Start from the selected recent case and diagnose the organizational pattern it reveals.',
          hook: 'The visible event is not the whole story. The naming around it is the real tell.',
          subject: primaryTitle,
        },
      ],
    };
  }

  scoreCandidatesFixture({ candidates, brief, strategy, memory, sourceRefs }) {
    this.lastUsage = null;
    return candidates.map((candidate) => {
      const text = candidate.post_text || '';
      const disallowed = strategy.voice?.disallowed_phrases || [];
      const badPhraseHits = disallowed.filter((phrase) => text.toLowerCase().includes(phrase.toLowerCase()));
      const count = wordCount(text);
      const tooLongPenalty = count > 260 ? 3 : count > 220 ? 1.5 : 0;
      const tooManyParagraphsPenalty = Math.max(0, paragraphs(text).length - 8);
      const weakOpenerPenalty = openerPenalty(text);
      const memoryConflicts = getMemoryConflicts({
        record: {
          content_type: brief.content_type,
          hook: paragraphs(text)[0] || brief.hook || '',
          angle: brief.angle,
          topic_thesis: brief.topic_thesis,
          timely_subject: brief.timely_subject,
          source_refs: sourceRefs || [],
        },
        memory,
        strategy,
      });
      const voiceScore = Math.max(0, 10 - badPhraseHits.length * 2 - (containsEmoji(text) ? 3 : 0));
      const clarityScore = Math.max(0, 10 - Math.max(0, paragraphs(text).length - 4) - tooLongPenalty - tooManyParagraphsPenalty - weakOpenerPenalty);
      const citationScore = sourceRefs && sourceRefs.length > 0 ? 9 : 6;
      const linkedinNativeScore = Math.max(0, 10 - (containsHashtag(text) ? 3 : 0) - (containsLink(text) ? 4 : 0) - weakOpenerPenalty);
      const riskScore = Math.max(0, 10 - memoryConflicts.length * 3);
      const overallScore = Number(((voiceScore * 0.25) + (clarityScore * 0.2) + (citationScore * 0.15) + (linkedinNativeScore * 0.15) + (riskScore * 0.25)).toFixed(2));
      const pass = overallScore >= 7 && memoryConflicts.length === 0 && !containsEmoji(text) && !containsHashtag(text) && !containsLink(text) && count <= 260;

      return {
        id: sha256(`${candidate.id}:${overallScore}`).slice(0, 12),
        candidate_id: candidate.id,
        voice_score: voiceScore,
        novelty_score: memoryConflicts.length === 0 ? 9 : 4,
        clarity_score: clarityScore,
        risk_score: riskScore,
        citation_score: citationScore,
        linkedin_native_score: linkedinNativeScore,
        overall_score: overallScore,
        pass,
        pass_fail_reasons: [
          ...memoryConflicts,
          ...badPhraseHits.map((phrase) => `disallowed_phrase:${phrase}`),
          ...(containsEmoji(text) ? ['emoji_disallowed'] : []),
          ...(containsHashtag(text) ? ['hashtag_disallowed'] : []),
          ...(containsLink(text) ? ['link_disallowed'] : []),
          ...(count > 260 ? [`too_long:${count}_words`] : []),
          ...(weakOpenerPenalty > 0 ? ['weak_opener'] : []),
        ],
      };
    });
  }

  async scoreCandidatesLive({ candidates, brief, strategy, memory, sourceRefs }) {
    if (!this.apiKey) throw new Error('Missing OPENAI_API_KEY for live scoring.');
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        scores: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              candidate_id: { type: 'string' },
              voice_score: { type: 'number' },
              novelty_score: { type: 'number' },
              clarity_score: { type: 'number' },
              risk_score: { type: 'number' },
              citation_score: { type: 'number' },
              linkedin_native_score: { type: 'number' },
              overall_score: { type: 'number' },
              pass: { type: 'boolean' },
              pass_fail_reasons: { type: 'array', items: { type: 'string' } },
            },
            required: [
              'candidate_id',
              'voice_score',
              'novelty_score',
              'clarity_score',
              'risk_score',
              'citation_score',
              'linkedin_native_score',
              'overall_score',
              'pass',
              'pass_fail_reasons',
            ],
          },
        },
      },
      required: ['scores'],
    };

    const response = await postOpenAIResponses({
      apiKey: this.apiKey,
      timeoutMs: REQUEST_TIMEOUT_MS,
      attempts: SCORE_REQUEST_ATTEMPTS,
      body: {
        model: this.model,
        reasoning: { effort: 'medium' },
        text: {
          format: {
            type: 'json_schema',
            name: 'linkedin_scores',
            schema,
          },
        },
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: liveScoringSystemPrompt({ brief }),
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify({ brief, strategy, memory, sourceRefs, candidates }, null, 2),
              },
            ],
          },
        ],
      },
    });

    if (!response.ok) {
      throw new Error(`OpenAI scoring failed (${response.status}): ${await response.text()}`);
    }
    const payload = await response.json();
    this.lastUsage = payload.usage || null;
    const outputText = payload.output_text || payload.output?.map((item) => item.content?.map((part) => part.text || '').join('')).join('') || '{}';
    const parsed = JSON.parse(outputText);
    return (parsed.scores || []).map((score) => ({ id: sha256(`${score.candidate_id}:${score.overall_score}`).slice(0, 12), ...score }));
  }

  async normalizeResearchReportLive({ topicThesis, rawReport, fallbackSources, watchlists = {} }) {
    if (!this.apiKey) throw new Error('Missing OPENAI_API_KEY for research normalization.');
    const normalizedRawReport = String(rawReport || '').slice(0, 12000);
    const recencyPolicy = getResearchRecencyPolicy({ watchlists });
    const normalizedFallbackSources = normalizeStructuredSources(fallbackSources);
    const compactFallbackSources = compactSourcesForNormalization(fallbackSources);
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        summary: { type: 'string' },
        sources: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string' },
              url: { type: 'string' },
              published_at: { type: 'string' },
              relevance: { type: 'string' },
              claim: { type: 'string' },
              excerpt: { type: 'string' },
            },
            required: ['title', 'url', 'published_at', 'relevance', 'claim', 'excerpt'],
          },
        },
        candidate_angles: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              topic_thesis: { type: 'string' },
              angle: { type: 'string' },
              hook: { type: 'string' },
              subject: { type: 'string' },
            },
            required: ['topic_thesis', 'angle', 'hook', 'subject'],
          },
        },
        primary_source_url: { type: 'string' },
      },
      required: ['summary', 'sources', 'candidate_angles', 'primary_source_url'],
    };

    const response = await postOpenAIResponses({
      apiKey: this.apiKey,
      timeoutMs: NORMALIZATION_TIMEOUT_MS,
      body: {
        model: this.model,
        reasoning: { effort: 'low' },
        max_output_tokens: 2000,
        text: {
          format: {
            type: 'json_schema',
            name: 'research_bundle',
            schema,
          },
        },
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: `Normalize a Gemini Deep Research report into a tight research bundle. Today's date is ${recencyPolicy.reference_date}. Prioritize recent news sources published on or after ${recencyPolicy.cutoff_date} (${recencyPolicy.recent_window_days}-day window). Keep at least ${recencyPolicy.min_recent_sources} recent reported company or institutional cases in the bundle unless the report truly contains none. Older conceptual sources may stay only as secondary context. Explain why each source matters to the thesis. Order the sources so the first source is the single best primary source for the post. Set primary_source_url to that source's exact URL. Rank the candidate_angles so the first one is the single best recent case match for the thesis. Each candidate angle must begin from a concrete visible event, not an abstract restatement, and should align to the primary source. Output only sources with real HTTP URLs and exact published dates in YYYY-MM-DD format. If fallbackSources include exact URLs and dates, treat them as authoritative and prefer them over inferred placeholders.`,
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify({ topicThesis, fallbackSources: compactFallbackSources, rawReport: normalizedRawReport }, null, 2),
              },
            ],
          },
        ],
      },
    });

    if (!response.ok) {
      throw new Error(`OpenAI research normalization failed (${response.status}): ${await response.text()}`);
    }
    const payload = await response.json();
    this.lastUsage = payload.usage || null;
    const outputText = payload.output_text || payload.output?.map((item) => item.content?.map((part) => part.text || '').join('')).join('') || '{}';
    const parsed = JSON.parse(outputText);
    parsed.sources = mergeStructuredSources(
      normalizeStructuredSources(parsed.sources || []),
      normalizedFallbackSources,
    );
    parsed.primary_source = parsed.sources.find((source) => source.url === parsed.primary_source_url)
      || parsed.sources[0]
      || null;
    const recentSourceCount = countRecentSources(parsed.sources || [], recencyPolicy);
    if (recentSourceCount < recencyPolicy.min_recent_sources) {
      throw new Error(`Normalized research bundle missing recent sources (${recentSourceCount}/${recencyPolicy.min_recent_sources} within ${recencyPolicy.recent_window_days} days).`);
    }
    if (!parsed.primary_source) {
      throw new Error('Normalized research bundle missing primary source.');
    }
    return parsed;
  }
}

module.exports = {
  GPTScorerAdapter,
};
