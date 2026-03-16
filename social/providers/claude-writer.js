const { sha256 } = require('../lib/hash');
const { lightlyRewriteForNotes } = require('../../lib/notes');

class ClaudeWriterAdapter {
  constructor({ mode = 'fixture', model = 'claude-3-7-sonnet-latest', apiKey = process.env.ANTHROPIC_API_KEY, recordDir = null } = {}) {
    this.mode = mode;
    this.model = model;
    this.apiKey = apiKey;
    this.recordDir = recordDir;
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
    const line = {
      hook_forward: brief.hook || `The wrong lesson people are taking from ${brief.topic_thesis.toLowerCase()}`,
      diagnosis_forward: `The surface story is not the real story. ${brief.topic_thesis}`,
      operator_forward: `If you run teams, this is the practical problem hiding underneath ${brief.topic_thesis.toLowerCase()}.`,
      contrarian_forward: `A lot of leaders think ${brief.topic_thesis.toLowerCase()} is a tooling problem. It isn't.`,
    }[variant] || brief.hook || brief.topic_thesis;

    const citationLine = Array.isArray(brief.citations) && brief.citations.length > 0
      ? `A recent case makes the pattern visible: ${brief.citations[0].title || brief.citations[0].url}.`
      : `The book has been making the same point for a while, and the pattern keeps repeating.`;

    const tail = {
      decoder_ring: 'The practical implication is to diagnose the social bottleneck before you add more machinery.',
      ritual_recipe: 'If you need a move, start smaller than your team’s trust can currently support.',
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
      `What matters now is not whether organizations can move faster. It is whether they can absorb more truth without becoming brittle, theatrical, or less human.`,
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
    if (!this.apiKey) throw new Error('Missing ANTHROPIC_API_KEY for live Claude generation.');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 900,
        temperature: 0.9,
        system: 'Write concise, high-signal LinkedIn posts in Sean Devine’s voice. Return only the post text.',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `${brief.prompt}\n\nVariant: ${variant}` },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude generation failed (${response.status}): ${await response.text()}`);
    }
    const payload = await response.json();
    const text = (payload.content || []).map((part) => part.text || '').join('\n').trim();
    return {
      id: sha256(`${brief.content_type}:${variant}:${text}`).slice(0, 12),
      writer_model: this.model,
      prompt_variant: variant,
      post_text: text,
      self_notes: `Live candidate in ${variant} mode.`,
    };
  }

  async rewriteForNotesLive({ postText, topicThesis, pillar, voice = '' }) {
    if (!this.apiKey) throw new Error('Missing ANTHROPIC_API_KEY for live Claude generation.');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 900,
        temperature: 0.2,
        system: 'Rewrite a published LinkedIn post into a website note. Preserve the thesis, examples, and structure. Remove platform-native phrasing, engagement bait, hashtags, and CTA tone. Keep it close to the original and do not expand it.',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
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
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude notes rewrite failed (${response.status}): ${await response.text()}`);
    }

    const payload = await response.json();
    const text = (payload.content || []).map((part) => part.text || '').join('\n').trim();
    return {
      text: lightlyRewriteForNotes(text),
      source_mode: 'ai_rewrite',
      writer_model: this.model,
    };
  }
}

module.exports = {
  ClaudeWriterAdapter,
};
