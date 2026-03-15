const { getMemoryConflicts } = require('../lib/memory');
const { sha256 } = require('../lib/hash');

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

class GPTScorerAdapter {
  constructor({ mode = 'fixture', model = 'gpt-5.4', apiKey = process.env.OPENAI_API_KEY } = {}) {
    this.mode = mode;
    this.model = model;
    this.apiKey = apiKey;
  }

  async scoreCandidates({ candidates, brief, strategy, memory, sourceRefs }) {
    if (this.mode === 'live' || this.mode === 'record') {
      return this.scoreCandidatesLive({ candidates, brief, strategy, memory, sourceRefs });
    }
    return this.scoreCandidatesFixture({ candidates, brief, strategy, memory, sourceRefs });
  }

  async normalizeResearchReport({ topicThesis, rawReport, fallbackSources = [] }) {
    if (this.mode === 'live' || this.mode === 'record') {
      return this.normalizeResearchReportLive({ topicThesis, rawReport, fallbackSources });
    }
    return {
      summary: String(rawReport || '').slice(0, 600),
      sources: fallbackSources,
      candidate_angles: [
        {
          topic_thesis: topicThesis,
          angle: 'Use an adjacent case from the report to diagnose the underlying organizational pattern.',
          hook: 'The visible story is not the real diagnosis.',
          subject: 'normalized-research-subject',
        },
      ],
    };
  }

  scoreCandidatesFixture({ candidates, brief, strategy, memory, sourceRefs }) {
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

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
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
                text: 'Score LinkedIn post candidates. Be strict. Prefer concise, high-signal posts. A strong opener should create immediate tension, consequence, or pattern-recognition; it should contain substance rather than merely announcing the existence of a note, thought, or post. Heavily penalize generic setup lines, rambling, repeated thesis statements, article-summary behavior, padded examples, and soft endings. Do not force one opener template; reward variety when it still lands sharply. Fail anything that duplicates recent published ideas, exceeds 260 words, or violates the no-emoji/no-hashtag/no-link policy.',
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
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI scoring failed (${response.status}): ${await response.text()}`);
    }
    const payload = await response.json();
    const outputText = payload.output_text || payload.output?.map((item) => item.content?.map((part) => part.text || '').join('')).join('') || '{}';
    const parsed = JSON.parse(outputText);
    return (parsed.scores || []).map((score) => ({ id: sha256(`${score.candidate_id}:${score.overall_score}`).slice(0, 12), ...score }));
  }

  async normalizeResearchReportLive({ topicThesis, rawReport, fallbackSources }) {
    if (!this.apiKey) throw new Error('Missing OPENAI_API_KEY for research normalization.');
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
            },
            required: ['title', 'url', 'published_at', 'relevance', 'claim'],
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
      },
      required: ['summary', 'sources', 'candidate_angles'],
    };

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        reasoning: { effort: 'medium' },
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
                text: 'Normalize a Gemini Deep Research report into a tight research bundle. Prefer dated sources and explain why each source matters to the thesis.',
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify({ topicThesis, fallbackSources, rawReport }, null, 2),
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI research normalization failed (${response.status}): ${await response.text()}`);
    }
    const payload = await response.json();
    const outputText = payload.output_text || payload.output?.map((item) => item.content?.map((part) => part.text || '').join('')).join('') || '{}';
    return JSON.parse(outputText);
  }
}

module.exports = {
  GPTScorerAdapter,
};
