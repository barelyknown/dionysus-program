const { getMemoryConflicts, overlapScore } = require('../lib/memory');
const { sha256 } = require('../lib/hash');
const { countRecentSources, getResearchRecencyPolicy } = require('../lib/research-policy');
const { fixtureRedundancyClusters } = require('../lib/redundancy');

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
    'Score engagement explicitly: does the post earn attention with substantive tension, a concrete tell, a human consequence, or a surprising distinction, and then sustain the read without clickbait?',
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

function normalizeCandidateAngles(candidateAngles = [], { topicOptions = [], fallbackTopic = null } = {}) {
  const allowedTopics = (Array.isArray(topicOptions) ? topicOptions : []).filter(Boolean);
  const resolveTopic = (candidateTopic) => {
    if (allowedTopics.length === 0) return candidateTopic || fallbackTopic || '';
    if (allowedTopics.includes(candidateTopic)) return candidateTopic;
    const best = allowedTopics
      .map((topic) => ({ topic, score: overlapScore(topic, candidateTopic || '') }))
      .sort((left, right) => right.score - left.score)[0];
    if (best?.score > 0) return best.topic;
    return fallbackTopic || allowedTopics[0];
  };

  return (Array.isArray(candidateAngles) ? candidateAngles : []).map((angle) => ({
    ...angle,
    topic_thesis: resolveTopic(angle?.topic_thesis),
  })).filter((angle) => angle.topic_thesis);
}

function fixtureTopicChoice({ topicThesis = null, topicOptions = [], fallbackSources = [] }) {
  if (topicThesis) return topicThesis;
  const allowedTopics = (Array.isArray(topicOptions) ? topicOptions : []).filter(Boolean);
  if (allowedTopics.length === 0) return 'The visible event reveals a deeper organizational pattern.';
  const sourceText = fallbackSources.map((source) => (
    [source?.title, source?.relevance, source?.claim, source?.excerpt].filter(Boolean).join(' ')
  )).join(' ');
  const best = allowedTopics
    .map((topic) => ({ topic, score: overlapScore(topic, sourceText) }))
    .sort((left, right) => right.score - left.score)[0];
  return best?.score > 0 ? best.topic : allowedTopics[0];
}

function parseJsonOutput(text) {
  const trimmed = String(text || '').trim();
  const unfenced = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(unfenced);
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
  constructor({ mode = 'fixture', model = 'gpt-5.6-sol', apiKey = process.env.OPENAI_API_KEY } = {}) {
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

  async developNovelIdea({ calendarItem, brief, history = [], strategy = {} }) {
    if (this.mode === 'live' || this.mode === 'record') {
      return this.developNovelIdeaLive({ calendarItem, brief, history, strategy });
    }
    return {
      pass: true,
      topic_thesis: calendarItem.topic_thesis,
      angle: calendarItem.angle,
      hook: calendarItem.hook,
      argument_summary: calendarItem.topic_thesis,
      novelty_score: history.length > 0 ? 8 : 10,
      closest_post_id: '',
      novelty_rationale: history.length > 0
        ? 'Fixture mode preserves the seed while exercising the idea-development stage.'
        : 'No published arguments were supplied.',
      source_grounding: 'Fixture mode uses the supplied calendar seed and brief.',
    };
  }

  async auditPublishedRedundancy({ records = [], candidatePairs = [] }) {
    if (this.mode === 'live' || this.mode === 'record') {
      return this.auditPublishedRedundancyLive({ records, candidatePairs });
    }
    return { clusters: fixtureRedundancyClusters(records) };
  }

  async confirmRedundancyRemovals({ pairs = [] }) {
    if (this.mode === 'live' || this.mode === 'record') {
      return this.confirmRedundancyRemovalsLive({ pairs });
    }
    return {
      decisions: pairs.map((pair) => ({
        remove_post_id: pair.remove.post_id,
        keep_post_id: pair.keep.post_id,
        redundant: true,
        confidence: 1,
        justification: 'Fixture mode independently confirms the nominated duplicate pair.',
      })),
    };
  }

  async normalizeResearchReport({
    topicThesis = null,
    topicOptions = [],
    rawReport,
    fallbackSources = [],
    watchlists = {},
    excludedSourceUrls = [],
    excludedEntities = [],
  }) {
    if (this.mode === 'live' || this.mode === 'record') {
      return this.normalizeResearchReportLive({
        topicThesis,
        topicOptions,
        rawReport,
        fallbackSources,
        watchlists,
        excludedSourceUrls,
        excludedEntities,
      });
    }
    const selectedTopic = fixtureTopicChoice({ topicThesis, topicOptions, fallbackSources });
    const primarySource = fallbackSources[0] || null;
    const primaryTitle = primarySource?.title || 'recent company case';
    return {
      summary: String(rawReport || '').slice(0, 600),
      sources: fallbackSources,
      primary_source: primarySource,
      candidate_angles: [
        {
          topic_thesis: selectedTopic,
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
      const engagementScore = Math.max(0, Math.min(10,
        8.5
        - (weakOpenerPenalty * 1.5)
        - (count < 35 ? 1 : 0)
        - (paragraphs(text).length > 8 ? 1 : 0),
      ));
      const riskScore = Math.max(0, 10 - memoryConflicts.length * 3);
      const noveltyScore = memoryConflicts.length === 0 ? 9 : 4;
      const minimumNoveltyScore = Number(strategy.generation?.minimum_draft_novelty_score || 8);
      const minimumEngagementScore = Number(strategy.generation?.minimum_draft_engagement_score || 7.5);
      const overallScore = Number(((voiceScore * 0.2) + (clarityScore * 0.15) + (citationScore * 0.1) + (linkedinNativeScore * 0.15) + (riskScore * 0.2) + (engagementScore * 0.2)).toFixed(2));
      const pass = overallScore >= 7
        && noveltyScore >= minimumNoveltyScore
        && engagementScore >= minimumEngagementScore
        && memoryConflicts.length === 0
        && !containsEmoji(text)
        && !containsHashtag(text)
        && !containsLink(text)
        && count <= 260;

      return {
        id: sha256(`${candidate.id}:${overallScore}`).slice(0, 12),
        candidate_id: candidate.id,
        voice_score: voiceScore,
        novelty_score: noveltyScore,
        engagement_score: engagementScore,
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

  async developNovelIdeaLive({ calendarItem, brief, history, strategy }) {
    if (!this.apiKey) throw new Error('Missing OPENAI_API_KEY for novel idea development.');
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        pass: { type: 'boolean' },
        topic_thesis: { type: 'string' },
        angle: { type: 'string' },
        hook: { type: 'string' },
        argument_summary: { type: 'string' },
        novelty_score: { type: 'number' },
        closest_post_id: { type: 'string' },
        novelty_rationale: { type: 'string' },
        source_grounding: { type: 'string' },
      },
      required: [
        'pass',
        'topic_thesis',
        'angle',
        'hook',
        'argument_summary',
        'novelty_score',
        'closest_post_id',
        'novelty_rationale',
        'source_grounding',
      ],
    };
    const sourceContextLimit = Math.max(10000, Number(strategy.generation?.idea_source_context_limit || 160000));
    const input = {
      seed: {
        content_type: calendarItem.content_type,
        seed_topic_thesis: calendarItem.seed_topic_thesis || calendarItem.topic_thesis,
        provisional_angle: calendarItem.angle,
        timely_subject: calendarItem.timely_subject || null,
      },
      source_material: {
        compressed_book_context: String(brief.full_compressed_context || '').slice(0, sourceContextLimit),
        research_summary: brief.research_summary || null,
        primary_source: brief.primary_source || null,
        citations: brief.citations || [],
        mailbag_item: brief.mailbag_item || null,
      },
      published_argument_history: history,
    };

    const response = await postOpenAIResponses({
      apiKey: this.apiKey,
      timeoutMs: REQUEST_TIMEOUT_MS,
      attempts: SCORE_REQUEST_ATTEMPTS,
      body: {
        model: this.model,
        reasoning: { effort: strategy.generation?.idea_reasoning_effort || 'high' },
        max_output_tokens: 2200,
        text: {
          format: {
            type: 'json_schema',
            name: 'novel_post_idea',
            schema,
          },
        },
        input: [
          {
            role: 'system',
            content: [{
              type: 'input_text',
              text: [
                'Develop one genuinely new argument for a short social post before any prose is drafted.',
                'Treat published_argument_history as a do-not-repeat corpus, not as style examples.',
                'Novelty means a different central claim, causal mechanism, boundary, consequence, or operator decision. New wording, a new company example, or a narrower restatement of an old claim is not novel.',
                'The seed topic is source territory, not a thesis you must preserve. You may derive a new thesis from the supplied book or research material.',
                'Use only claims grounded in source_material. Do not invent facts or named concepts.',
                'Set pass=false if you cannot explain the substantive delta from the closest prior post. A passing novelty_score must be 8 or higher on a 10-point scale.',
                'topic_thesis must be one crisp, contestable claim. argument_summary must state the full logic that makes it distinct. hook is a provisional entry point, not finished copy.',
                'closest_post_id must identify the strongest prior overlap, or be an empty string only when there is no meaningful overlap.',
              ].join(' '),
            }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: JSON.stringify(input, null, 2) }],
          },
        ],
      },
    });

    if (!response.ok) {
      throw new Error(`OpenAI novel idea development failed (${response.status}): ${await response.text()}`);
    }
    const payload = await response.json();
    this.lastUsage = payload.usage || null;
    const outputText = payload.output_text || payload.output?.map((item) => item.content?.map((part) => part.text || '').join('')).join('') || '{}';
    return parseJsonOutput(outputText);
  }

  async auditPublishedRedundancyLive({ records, candidatePairs }) {
    if (!this.apiKey) throw new Error('Missing OPENAI_API_KEY for redundancy audit.');
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        clusters: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              post_ids: { type: 'array', items: { type: 'string' } },
              confidence: { type: 'number' },
              central_argument: { type: 'string' },
              overlap_explanation: { type: 'string' },
            },
            required: ['post_ids', 'confidence', 'central_argument', 'overlap_explanation'],
          },
        },
      },
      required: ['clusters'],
    };
    const response = await postOpenAIResponses({
      apiKey: this.apiKey,
      timeoutMs: REQUEST_TIMEOUT_MS,
      attempts: SCORE_REQUEST_ATTEMPTS,
      body: {
        model: this.model,
        reasoning: { effort: 'high' },
        max_output_tokens: 20000,
        text: {
          format: {
            type: 'json_schema',
            name: 'published_post_redundancy_audit',
            schema,
          },
        },
        input: [
          {
            role: 'system',
            content: [{
              type: 'input_text',
              text: [
                'Adjudicate candidate pairs from a full corpus of published LinkedIn notes and X posts for substantive redundancy.',
                'Create a cluster only when the posts make practically the same central claim, rely on the same causal mechanism, and land on substantially the same practical implication.',
                'Shared vocabulary, framework, topic, company, or theme is not enough. Distinct boundaries, mechanisms, consequences, or operator decisions are not redundant.',
                'Use the LinkedIn and X versions as two surfaces of one publication record, never as separate records.',
                'The lexical signals only nominate pairs for review; never treat them as proof. Read both full texts.',
                'Clusters must be disjoint, contain at least two known post_ids from the supplied candidate pairs, and include only posts that would make a reader reasonably feel they had already read the argument.',
                'Confidence is 0 to 1. Reserve 0.88 or higher for cases safe enough to propose deletion in a dry run. When uncertain, omit the cluster.',
                'Do not recommend actions and do not prefer older or newer posts; identify redundancy only.',
              ].join(' '),
            }],
          },
          {
            role: 'user',
            content: [{
              type: 'input_text',
              text: JSON.stringify({
                corpus_record_count: records.length,
                corpus_records: records,
                candidate_pairs: candidatePairs.map((pair) => ({
                  pair_id: pair.pair_id,
                  same_topic_thesis: pair.same_topic_thesis,
                  lexical_signals: pair.lexical_signals,
                  maximum_lexical_overlap: pair.maximum_lexical_overlap,
                  left_post_id: pair.left?.post_id || null,
                  right_post_id: pair.right?.post_id || null,
                })),
              }, null, 2),
            }],
          },
        ],
      },
    });
    if (!response.ok) {
      throw new Error(`OpenAI redundancy audit failed (${response.status}): ${await response.text()}`);
    }
    const payload = await response.json();
    this.lastUsage = payload.usage || null;
    if (payload.status === 'incomplete') {
      throw new Error(`OpenAI redundancy audit returned incomplete output (${payload.incomplete_details?.reason || 'unknown reason'}).`);
    }
    const outputText = payload.output_text || payload.output?.map((item) => item.content?.map((part) => part.text || '').join('')).join('') || '{}';
    return parseJsonOutput(outputText);
  }

  async confirmRedundancyRemovalsLive({ pairs }) {
    if (!this.apiKey) throw new Error('Missing OPENAI_API_KEY for redundancy removal confirmation.');
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              remove_post_id: { type: 'string' },
              keep_post_id: { type: 'string' },
              redundant: { type: 'boolean' },
              confidence: { type: 'number' },
              justification: { type: 'string' },
            },
            required: ['remove_post_id', 'keep_post_id', 'redundant', 'confidence', 'justification'],
          },
        },
      },
      required: ['decisions'],
    };
    const response = await postOpenAIResponses({
      apiKey: this.apiKey,
      timeoutMs: REQUEST_TIMEOUT_MS,
      attempts: SCORE_REQUEST_ATTEMPTS,
      body: {
        model: this.model,
        reasoning: { effort: 'high' },
        max_output_tokens: 12000,
        text: {
          format: {
            type: 'json_schema',
            name: 'redundancy_removal_confirmation',
            schema,
          },
        },
        input: [
          {
            role: 'system',
            content: [{
              type: 'input_text',
              text: [
                'Independently review every proposed historical note removal by comparing the full remove and keep texts directly.',
                'Do not trust the prior cluster explanation; it is only a nomination.',
                'Use the reader standard: would a reasonable follower feel they had practically already read this note?',
                'Set redundant=true when the posts make substantially the same central claim through the same causal mechanism and land on the same practical implication, even if the wording, hook, supporting vocabulary, or named framework differs.',
                'The same anecdote plus the same diagnosis and takeaway is redundant. A new label or supporting distinction does not save it unless that distinction materially changes the conclusion or operator decision.',
                'Shared subject matter alone is insufficient. If the removed post contributes a genuinely distinct boundary, consequence, or operator decision, set redundant=false.',
                'Use confidence from 0 to 1. A removal is safe only when redundant=true and confidence is at least 0.90.',
                'Return exactly one decision for every supplied pair, preserving both post IDs. When uncertain, reject the removal.',
              ].join(' '),
            }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: JSON.stringify({ proposed_removals: pairs }, null, 2) }],
          },
        ],
      },
    });
    if (!response.ok) {
      throw new Error(`OpenAI redundancy removal confirmation failed (${response.status}): ${await response.text()}`);
    }
    const payload = await response.json();
    this.lastUsage = payload.usage || null;
    if (payload.status === 'incomplete') {
      throw new Error(`OpenAI redundancy removal confirmation returned incomplete output (${payload.incomplete_details?.reason || 'unknown reason'}).`);
    }
    const outputText = payload.output_text || payload.output?.map((item) => item.content?.map((part) => part.text || '').join('')).join('') || '{}';
    return parseJsonOutput(outputText);
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
              engagement_score: { type: 'number' },
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
              'engagement_score',
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
    const minimumNoveltyScore = Number(strategy.generation?.minimum_draft_novelty_score || 8);
    const minimumEngagementScore = Number(strategy.generation?.minimum_draft_engagement_score || 7.5);
    return (parsed.scores || []).map((score) => {
      const reasons = [...(score.pass_fail_reasons || [])];
      const noveltyPass = Number(score.novelty_score || 0) >= minimumNoveltyScore;
      const engagementPass = Number(score.engagement_score || 0) >= minimumEngagementScore;
      if (!noveltyPass && !reasons.includes('draft_novelty_below_threshold')) {
        reasons.push('draft_novelty_below_threshold');
      }
      if (!engagementPass && !reasons.includes('draft_engagement_below_threshold')) {
        reasons.push('draft_engagement_below_threshold');
      }
      return {
        id: sha256(`${score.candidate_id}:${score.overall_score}`).slice(0, 12),
        ...score,
        pass: Boolean(score.pass) && noveltyPass && engagementPass,
        pass_fail_reasons: reasons,
      };
    });
  }

  async normalizeResearchReportLive({
    topicThesis,
    topicOptions = [],
    rawReport,
    fallbackSources,
    watchlists = {},
    excludedSourceUrls = [],
    excludedEntities = [],
  }) {
    if (!this.apiKey) throw new Error('Missing OPENAI_API_KEY for research normalization.');
    const normalizedRawReport = String(rawReport || '').slice(0, 12000);
    const recencyPolicy = getResearchRecencyPolicy({ watchlists });
    const normalizedFallbackSources = normalizeStructuredSources(fallbackSources);
    const compactFallbackSources = compactSourcesForNormalization(fallbackSources);
    const articleFirst = !topicThesis && Array.isArray(topicOptions) && topicOptions.length > 0;
    const candidateAngleDescription = articleFirst
      ? 'Rank the candidate_angles so the first one is the single best recent article-thesis pairing overall. Each candidate angle must map the visible case to exactly one thesis from topicOptions.'
      : 'Rank the candidate_angles so the first one is the single best recent case match for the thesis.';
    const thesisInstruction = articleFirst
      ? 'Choose topic_thesis values only from topicOptions. Do not invent new thesis text.'
      : 'Keep topic_thesis aligned with the requested thesis.';
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

    let lastError = null;
    for (let attempt = 1; attempt <= SCORE_REQUEST_ATTEMPTS; attempt += 1) {
      try {
        const response = await postOpenAIResponses({
          apiKey: this.apiKey,
          timeoutMs: NORMALIZATION_TIMEOUT_MS,
          attempts: SCORE_REQUEST_ATTEMPTS,
          body: {
            model: this.model,
            reasoning: { effort: 'low' },
            max_output_tokens: 4000,
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
                    text: `Normalize a Gemini Deep Research report into a tight research bundle. Today's date is ${recencyPolicy.reference_date}. Prioritize recent news sources published on or after ${recencyPolicy.cutoff_date} (${recencyPolicy.recent_window_days}-day window). Keep at least ${recencyPolicy.min_recent_sources} recent reported company or institutional cases in the bundle unless the report truly contains none. Older conceptual sources may stay only as secondary context. Explain why each source matters to the thesis. Order the sources so the first source is the single best primary source for the post. Set primary_source_url to that source's exact URL. ${candidateAngleDescription} ${thesisInstruction} Each candidate angle must begin from a concrete visible event, not an abstract restatement, and should align to the primary source. Output only sources with real HTTP URLs and exact published dates in YYYY-MM-DD format. If fallbackSources include exact URLs and dates, treat them as authoritative and prefer them over inferred placeholders. ${excludedEntities.length > 0 ? `Do not select a primary source or first candidate angle centered on any of these recently used entities: ${excludedEntities.join(', ')}.` : ''} ${excludedSourceUrls.length > 0 ? `Do not select any of these recently used exact URLs as the primary source: ${excludedSourceUrls.slice(0, 25).join(', ')}.` : ''}`,
                  },
                ],
              },
              {
                role: 'user',
                content: [
                  {
                    type: 'input_text',
                    text: JSON.stringify({ topicThesis, topicOptions, fallbackSources: compactFallbackSources, rawReport: normalizedRawReport }, null, 2),
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
        const parsed = parseJsonOutput(outputText);
        parsed.candidate_angles = normalizeCandidateAngles(parsed.candidate_angles, {
          topicOptions,
          fallbackTopic: topicThesis || topicOptions[0] || null,
        });
        parsed.sources = mergeStructuredSources(
          normalizeStructuredSources(parsed.sources || []),
          normalizedFallbackSources,
        );
        parsed.primary_source = parsed.sources.find((source) => source.url === parsed.primary_source_url)
          || parsed.sources[0]
          || null;
        if (!Array.isArray(parsed.candidate_angles) || parsed.candidate_angles.length === 0) {
          throw new Error('Normalized research bundle missing candidate angles.');
        }
        const recentSourceCount = countRecentSources(parsed.sources || [], recencyPolicy);
        if (recentSourceCount < recencyPolicy.min_recent_sources) {
          throw new Error(`Normalized research bundle missing recent sources (${recentSourceCount}/${recencyPolicy.min_recent_sources} within ${recencyPolicy.recent_window_days} days).`);
        }
        if (!parsed.primary_source) {
          throw new Error('Normalized research bundle missing primary source.');
        }
        return parsed;
      } catch (error) {
        lastError = error;
        if (attempt === SCORE_REQUEST_ATTEMPTS) throw error;
      }
    }
    throw lastError;
  }
}

module.exports = {
  GPTScorerAdapter,
};
