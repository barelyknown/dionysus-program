const { sha256 } = require('../lib/hash');

const VARIANT_LABELS = [
  'sharp_claim',
  'cost_frame',
  'diagnostic_naming',
  'contrast_frame',
  'paradox_frame',
  'consequence_frame',
  'operator_frame',
  'clean_distinction',
];

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function paragraphs(text) {
  return normalizeWhitespace(text).split(/\n\s*\n/).filter(Boolean);
}

function wordCount(text) {
  return normalizeWhitespace(text).split(/\s+/).filter(Boolean).length;
}

function charCount(text) {
  return normalizeWhitespace(text).length;
}

function containsEmoji(text) {
  return /\p{Extended_Pictographic}/u.test(text);
}

function containsHashtag(text) {
  return /(^|\s)#[A-Za-z0-9_]+/.test(text);
}

function containsLink(text) {
  return /https?:\/\/\S+/i.test(text);
}

function containsThreadMarker(text) {
  return /(^|\s)(?:\d+\/\d+|thread\b|🧵|part 1\b|more tomorrow\b|to be continued\b)/i.test(text);
}

function isAnnouncementOpener(text) {
  const opener = (paragraphs(text)[0] || '').toLowerCase();
  return [
    'a thought on',
    'a quick thought on',
    'quick thought:',
    'quick note:',
    'a note on',
    'here is the thing',
    "here's the thing",
    'something i keep thinking about',
    'one thing about',
    'i have been thinking about',
    'a thread on',
  ].some((phrase) => opener.startsWith(phrase));
}

function isPseudoProfoundOpener(text) {
  const opener = (paragraphs(text)[0] || '').toLowerCase();
  return [
    'the deeper truth is',
    'everything changes when',
    'what nobody tells you is',
    'the deepest problem is',
    'the real secret is',
  ].some((phrase) => opener.startsWith(phrase));
}

function isBookMentionPayload(text) {
  const lower = normalizeWhitespace(text).toLowerCase();
  const opener = (paragraphs(text)[0] || '').toLowerCase();
  if (opener.includes('the book is free') || opener.includes('download the pdf')) return true;
  const mentionCount = (lower.match(/\b(book|pdf|download|free)\b/g) || []).length;
  return mentionCount >= 2 && lower.indexOf('book') < Math.min(80, lower.length);
}

function isTooNeatReversal(text) {
  const lower = normalizeWhitespace(text).toLowerCase();
  return /it does not have a .* problem\.\s*it has a .* problem\./i.test(lower)
    || /the real problem is not .* it is .*/i.test(lower);
}

function isAdviceHeavyEnding(text) {
  const closing = (paragraphs(text).slice(-1)[0] || '').toLowerCase();
  return [
    'start by',
    'if you want',
    'the move is',
    'do this',
    'try this',
    'the practical move is',
  ].some((phrase) => closing.startsWith(phrase));
}

function isObtuseCompression(text) {
  const lower = normalizeWhitespace(text).toLowerCase();
  const abstractHits = [
    'clarity',
    'reality',
    'status',
    'truth',
    'meaning',
    'consequence',
    'recognition',
  ].filter((word) => lower.includes(word)).length;

  return charCount(text) < 85 && abstractHits >= 2;
}

function hasConcreteAnchor(text) {
  const lower = normalizeWhitespace(text).toLowerCase();
  return [
    'team',
    'leader',
    'organization',
    'company',
    'criticism',
    'failure',
    'process',
    'trust',
    'meeting',
    'status',
    'policy',
  ].some((word) => lower.includes(word));
}

function cleanLinkedInParagraphs(linkedinText) {
  return paragraphs(linkedinText)
    .map((paragraph) => paragraph.replace(/https?:\/\/\S+/gi, '').trim())
    .filter(Boolean);
}

function truncateToLength(text, maxLength) {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxLength) return normalized;

  const trimmed = normalized.slice(0, maxLength - 1).replace(/[,:;\s]+$/g, '');
  return `${trimmed}…`;
}

function createFixtureCandidate({ variant, thesis, anchor, consequence, maxLength }) {
  const variantMap = {
    sharp_claim: [
      thesis,
      consequence,
    ],
    cost_frame: [
      `${anchor} is not just a style problem.`,
      consequence,
    ],
    diagnostic_naming: [
      `Most trust failures start as naming failures.`,
      consequence,
    ],
    contrast_frame: [
      `${anchor} is not the same thing as trust.`,
      consequence,
    ],
    paradox_frame: [
      `A team can get more disciplined and less honest at the same time.`,
      consequence,
    ],
    consequence_frame: [
      thesis,
      `After that, every new initiative looks like execution from the outside and extraction from the inside.`,
    ],
    operator_frame: [
      `People avoid criticism when the social cost is still too high.`,
      `Then distortion starts looking like professionalism.`,
    ],
    clean_distinction: [
      `The difference between rigor and theater is whether reality is allowed to interrupt the script.`,
      consequence,
    ],
  };

  return truncateToLength((variantMap[variant] || [thesis, consequence]).join('\n\n'), maxLength);
}

class GPTXAdapter {
  constructor({
    mode = 'fixture',
    model = 'gpt-5.4',
    reasoningEffort = 'medium',
    apiKey = process.env.OPENAI_API_KEY,
  } = {}) {
    this.mode = mode;
    this.model = model;
    this.reasoningEffort = reasoningEffort;
    this.apiKey = apiKey;
  }

  async generateCandidates({ linkedinText, strategy, bestOfN = 8 }) {
    if (this.mode === 'live' || this.mode === 'record') {
      return this.generateCandidatesLive({ linkedinText, strategy, bestOfN });
    }
    return this.generateCandidatesFixture({ linkedinText, strategy, bestOfN });
  }

  async scoreCandidates({ candidates, linkedinText, strategy }) {
    if (this.mode === 'live' || this.mode === 'record') {
      return this.scoreCandidatesLive({ candidates, linkedinText, strategy });
    }
    return this.scoreCandidatesFixture({ candidates, linkedinText, strategy });
  }

  generateCandidatesFixture({ linkedinText, strategy, bestOfN }) {
    const maxLength = Number(strategy?.x?.max_length || 280);
    const sourceParagraphs = cleanLinkedInParagraphs(linkedinText);
    const thesis = sourceParagraphs[1] || sourceParagraphs[0] || 'Failure gets renamed before it gets examined.';
    const anchor = sourceParagraphs[0] || thesis;
    const consequence = sourceParagraphs[2]
      || 'That is how an organization starts managing the truth instead of the work.';

    return VARIANT_LABELS.slice(0, bestOfN).map((variant) => {
      const postText = createFixtureCandidate({ variant, thesis, anchor, consequence, maxLength });
      return {
        id: sha256(`x:${variant}:${postText}`).slice(0, 12),
        writer_model: this.model,
        prompt_variant: variant,
        post_text: postText,
        self_notes: `Fixture X candidate in ${variant} mode.`,
      };
    });
  }

  async generateCandidatesLive({ linkedinText, strategy, bestOfN }) {
    if (!this.apiKey) throw new Error('Missing OPENAI_API_KEY for live X generation.');

    const variantLabels = VARIANT_LABELS.slice(0, bestOfN);
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        candidates: {
          type: 'array',
          minItems: bestOfN,
          maxItems: bestOfN,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              prompt_variant: { type: 'string' },
              post_text: { type: 'string' },
              self_notes: { type: 'string' },
            },
            required: ['prompt_variant', 'post_text', 'self_notes'],
          },
        },
      },
      required: ['candidates'],
    };

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        reasoning: { effort: this.reasoningEffort },
        text: {
          format: {
            type: 'json_schema',
            name: 'x_candidates',
            schema,
          },
        },
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: [
                  'Rewrite a published LinkedIn post into a set of strong single-post X candidates.',
                  'Produce concise, sharp prose in 2-3 short paragraphs.',
                  'Open with a sharp claim, not an announcement, question, or staged setup.',
                  'Favor distinction, contrast, paradox, and diagnostic framing.',
                  'Keep the thesis somewhat elliptical rather than over-explained.',
                  'Use one concrete anchor where possible.',
                  'Allow moderate framework language, but do not make the post insider-only.',
                  'End cleanly, without a CTA or operator-advice close unless the source genuinely requires it.',
                  'Do not use hashtags, emojis, links, thread markers, bullets, or list numbering.',
                  'Do not make the book or free download the point of the post. A brief supporting aside is acceptable only if it is not central.',
                  'Avoid performative cleverness, pseudo-profound phrasing, announcement openers, and too-neat slogan reversals.',
                ].join('\n'),
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify({
                  best_of_n: bestOfN,
                  variant_labels: variantLabels,
                  max_length: Number(strategy?.x?.max_length || 280),
                  style_center: 'Closest family is direct, sharp, compact, concept-led, with one clear consequence. Avoid obtuse or promotional modes.',
                  linkedin_text: linkedinText,
                }, null, 2),
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI X generation failed (${response.status}): ${await response.text()}`);
    }

    const payload = await response.json();
    const outputText = payload.output_text
      || payload.output?.map((item) => item.content?.map((part) => part.text || '').join('')).join('')
      || '{}';
    const parsed = JSON.parse(outputText);

    return (parsed.candidates || []).slice(0, bestOfN).map((candidate) => {
      const postText = truncateToLength(candidate.post_text, Number(strategy?.x?.max_length || 280));
      return {
        id: sha256(`x:${candidate.prompt_variant}:${postText}`).slice(0, 12),
        writer_model: this.model,
        prompt_variant: candidate.prompt_variant,
        post_text: postText,
        self_notes: candidate.self_notes,
      };
    });
  }

  scoreCandidatesFixture({ candidates, linkedinText, strategy }) {
    const maxLength = Number(strategy?.x?.max_length || 280);

    return candidates.map((candidate) => {
      const text = candidate.post_text || '';
      const reasons = [];
      const hardFail = [];
      const paragraphCount = paragraphs(text).length;
      const length = charCount(text);

      if (length > maxLength) hardFail.push(`too_long:${length}_chars`);
      if (containsHashtag(text)) hardFail.push('hashtag_disallowed');
      if (containsEmoji(text)) hardFail.push('emoji_disallowed');
      if (containsLink(text)) hardFail.push('link_disallowed');
      if (containsThreadMarker(text)) hardFail.push('thread_marker_disallowed');
      if (isBookMentionPayload(text)) hardFail.push('book_promotion_payload');

      if (isAnnouncementOpener(text)) reasons.push('announcement_opener');
      if (isPseudoProfoundOpener(text)) reasons.push('pseudo_profound_opener');
      if (isTooNeatReversal(text)) reasons.push('too_neat_reversal');
      if (isAdviceHeavyEnding(text)) reasons.push('advice_heavy_ending');
      if (isObtuseCompression(text)) reasons.push('obtuse_compression');
      if (!hasConcreteAnchor(text)) reasons.push('missing_concrete_anchor');
      if (paragraphCount < 2 || paragraphCount > 3) reasons.push('paragraph_shape_miss');

      const clarityScore = Math.max(0, 10 - (reasons.includes('obtuse_compression') ? 3 : 0) - (paragraphCount > 3 ? 1.5 : 0));
      const compressionScore = Math.max(0, 10 - (length > 250 ? 1.5 : 0) - (length < 90 ? 1.5 : 0));
      const diagnosticScore = Math.min(10, 7 + (/[^\n]+\b(not|difference|instead|when)\b/i.test(text) ? 2 : 0) + (hasConcreteAnchor(text) ? 1 : 0));
      const antiCheeseScore = Math.max(0, 10
        - (hardFail.length * 4)
        - (reasons.includes('announcement_opener') ? 2.5 : 0)
        - (reasons.includes('pseudo_profound_opener') ? 2.5 : 0)
        - (reasons.includes('too_neat_reversal') ? 1.5 : 0)
        - (reasons.includes('advice_heavy_ending') ? 1 : 0));
      const xFitScore = Math.max(0, 10
        - (paragraphCount < 2 || paragraphCount > 3 ? 1.5 : 0)
        - (hardFail.length > 0 ? 4 : 0));

      const overallScore = Number(((clarityScore * 0.25)
        + (compressionScore * 0.2)
        + (diagnosticScore * 0.25)
        + (antiCheeseScore * 0.2)
        + (xFitScore * 0.1)).toFixed(2));

      const pass = hardFail.length === 0 && overallScore >= 7.5 && !reasons.includes('obtuse_compression');

      return {
        id: sha256(`${candidate.id}:${overallScore}`).slice(0, 12),
        candidate_id: candidate.id,
        clarity_score: clarityScore,
        compression_score: compressionScore,
        diagnostic_score: diagnosticScore,
        anti_cheese_score: antiCheeseScore,
        x_fit_score: xFitScore,
        overall_score: overallScore,
        pass,
        pass_fail_reasons: [...hardFail, ...reasons],
      };
    });
  }

  async scoreCandidatesLive({ candidates, linkedinText, strategy }) {
    if (!this.apiKey) throw new Error('Missing OPENAI_API_KEY for live X scoring.');

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
              clarity_score: { type: 'number' },
              compression_score: { type: 'number' },
              diagnostic_score: { type: 'number' },
              anti_cheese_score: { type: 'number' },
              x_fit_score: { type: 'number' },
              overall_score: { type: 'number' },
              pass: { type: 'boolean' },
              pass_fail_reasons: { type: 'array', items: { type: 'string' } },
            },
            required: [
              'candidate_id',
              'clarity_score',
              'compression_score',
              'diagnostic_score',
              'anti_cheese_score',
              'x_fit_score',
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
        reasoning: { effort: this.reasoningEffort },
        text: {
          format: {
            type: 'json_schema',
            name: 'x_scores',
            schema,
          },
        },
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: [
                  'Score single-post X candidates extremely strictly.',
                  'Target style: direct, sharp, compact, concept-led, with one clear consequence. Prefer the family of posts that make a diagnosis quickly and land cleanly.',
                  'Reward distinction, contrast, paradox, diagnostic framing, one concrete anchor, and clarity under compression.',
                  'Allow some opacity, but fail candidates that become merely obtuse.',
                  'Hard fail anything over 280 characters, anything with hashtags, emojis, links, thread markers, or any candidate that makes the book/free download the main payload.',
                  'Strongly penalize performative cleverness, announcement openers, pseudo-profound openers, advice-heavy endings, and imprecise slogan-like reversals.',
                  'In close calls, prefer the shorter/sharper candidate.',
                ].join('\n'),
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify({
                  max_length: Number(strategy?.x?.max_length || 280),
                  linkedin_text: linkedinText,
                  candidates,
                }, null, 2),
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI X scoring failed (${response.status}): ${await response.text()}`);
    }

    const payload = await response.json();
    const outputText = payload.output_text
      || payload.output?.map((item) => item.content?.map((part) => part.text || '').join('')).join('')
      || '{}';
    const parsed = JSON.parse(outputText);

    return (parsed.scores || []).map((score) => ({ id: sha256(`${score.candidate_id}:${score.overall_score}`).slice(0, 12), ...score }));
  }
}

module.exports = {
  GPTXAdapter,
  VARIANT_LABELS,
  paragraphs,
  charCount,
  containsHashtag,
  containsEmoji,
  containsLink,
  containsThreadMarker,
  isAnnouncementOpener,
  isPseudoProfoundOpener,
  isBookMentionPayload,
  isTooNeatReversal,
  isAdviceHeavyEnding,
  isObtuseCompression,
};
