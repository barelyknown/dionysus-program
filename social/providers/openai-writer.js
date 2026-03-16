const { sha256 } = require('../lib/hash');
const { lightlyRewriteForNotes } = require('../../lib/notes');

function systemPrompt() {
  return 'Write concise, high-signal LinkedIn posts in Sean Devine’s voice. Return only the post text.';
}

function extractOpenAIText(payload) {
  if (payload.output_text) return payload.output_text.trim();
  const chunks = [];
  for (const output of payload.output || []) {
    for (const part of output.content || []) {
      if (part.type === 'output_text' && part.text) chunks.push(part.text);
    }
  }
  return chunks.join('\n').trim();
}

class OpenAIWriterAdapter {
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

  async generateCandidates({ brief, promptVariants }) {
    if (this.mode === 'live' || this.mode === 'record') {
      const results = [];
      for (const variant of promptVariants) {
        results.push(await this.generateCandidateLive({ brief, variant }));
      }
      return results;
    }
    return promptVariants.map((variant) => this.generateCandidateFixture({ brief, variant }));
  }

  async rewriteForNotes({ postText, topicThesis, pillar, voice = '' }) {
    if (this.mode === 'live' || this.mode === 'record') {
      return this.rewriteForNotesLive({ postText, topicThesis, pillar, voice });
    }

    const rewritten = lightlyRewriteForNotes(postText);
    return {
      text: rewritten || lightlyRewriteForNotes(postText),
      source_mode: 'ai_rewrite',
      writer_model: this.model,
    };
  }

  generateCandidateFixture({ brief, variant }) {
    const primarySource = brief.primary_source || (Array.isArray(brief.citations) ? brief.citations[0] : null);
    const line = {
      hook_forward: brief.hook || `${primarySource?.title || 'The visible case'} is being misread.`,
      diagnosis_forward: `${primarySource?.title || 'The surface story'} is not the real story. ${brief.topic_thesis}`,
      operator_forward: `If you run teams, this is the practical problem hiding underneath ${brief.topic_thesis.toLowerCase()}.`,
      contrarian_forward: `A lot of leaders think ${brief.topic_thesis.toLowerCase()} is a tooling problem. It isn't.`,
    }[variant] || brief.hook || brief.topic_thesis;

    const citationLine = primarySource
      ? `Open on this source directly: ${primarySource.title || primarySource.url}. ${primarySource.claim || ''}`.trim()
      : 'The underlying pattern matters more than the visible event.';

    const tail = {
      decoder_ring: 'The practical implication is to diagnose the naming failure before you add more machinery.',
      ritual_recipe: 'If you need a move, lower the blast radius of being wrong before you ask for candor.',
      archetype_diagnosis: 'If you recognize your own team in this pattern, intervene before the ritual itself becomes part of the decay.',
      high_lindy_source_tour: 'Old language becomes useful when current institutions lose the vocabulary for what they are doing.',
      cautionary_tale: 'The warning is simple: a rigorous-looking process can still burn trust faster than it builds capability.',
      from_the_mailbag: 'The useful move is to treat the note as a diagnostic signal, not just a complaint.',
      short_story: 'That is how a team drifts into theater: not by one lie, but by many small edits to what can be said aloud.',
      extracted_insight: 'That is why the real operating question is not speed alone, but whether the system can metabolize truth without breaking trust.',
    }[brief.content_type];

    const text = [
      line,
      `${brief.angle} ${citationLine}`,
      'A strong post should earn the read quickly, stay concrete, and close with an operator-level implication instead of a summary.',
      tail,
    ].join('\n\n');

    return {
      id: sha256(`${brief.content_type}:${variant}:${text}`).slice(0, 12),
      writer_model: this.model,
      prompt_variant: variant,
      post_text: text,
      self_notes: `Fixture candidate in ${variant} mode.`,
    };
  }

  async generateCandidateLive({ brief, variant }) {
    if (!this.apiKey) throw new Error('Missing OPENAI_API_KEY for live OpenAI generation.');
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        reasoning: { effort: this.reasoningEffort },
        max_output_tokens: 1800,
        input: [
          {
            role: 'system',
            content: [{ type: 'input_text', text: systemPrompt() }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: `${brief.prompt}\n\nVariant: ${variant}` }],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI generation failed (${response.status}): ${await response.text()}`);
    }
    const payload = await response.json();
    const text = extractOpenAIText(payload);
    return {
      id: sha256(`${brief.content_type}:${variant}:${text}`).slice(0, 12),
      writer_model: this.model,
      prompt_variant: variant,
      post_text: text,
      self_notes: `Live candidate in ${variant} mode.`,
    };
  }

  async rewriteForNotesLive({ postText, topicThesis, pillar, voice = '' }) {
    if (!this.apiKey) throw new Error('Missing OPENAI_API_KEY for live OpenAI generation.');
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        reasoning: { effort: 'low' },
        max_output_tokens: 1800,
        input: [
          {
            role: 'system',
            content: [{
              type: 'input_text',
              text: 'Rewrite a published LinkedIn post into a website note. Preserve the thesis, examples, and structure. Remove platform-native phrasing, engagement bait, hashtags, and CTA tone. Keep it close to the original and do not expand it.',
            }],
          },
          {
            role: 'user',
            content: [{
              type: 'input_text',
              text: [
                'Rewrite this published LinkedIn post for the Notes section on Sean Devine’s website.',
                `Voice: ${voice}`,
                `Pillar: ${pillar}`,
                `Topic thesis: ${topicThesis}`,
                'Rules:',
                '- Keep the argument, examples, and core structure intact.',
                '- Keep it short and close to the original length.',
                '- Remove LinkedIn-native opener or closer language if present.',
                '- Normalize paragraphing for web reading.',
                '- Do not add a CTA, hashtags, bullets, or links.',
                '- Output only the rewritten note body in Markdown paragraphs.',
                '',
                'Published LinkedIn text:',
                postText,
              ].join('\n'),
            }],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI notes rewrite failed (${response.status}): ${await response.text()}`);
    }

    const payload = await response.json();
    const text = extractOpenAIText(payload);
    return {
      text: lightlyRewriteForNotes(text),
      source_mode: 'ai_rewrite',
      writer_model: this.model,
    };
  }
}

module.exports = {
  OpenAIWriterAdapter,
};
