const test = require('node:test');
const assert = require('node:assert/strict');

const { registry } = require('../types');

test('from_the_mailbag requires a valid mailbag item', () => {
  const type = registry.from_the_mailbag;
  assert.equal(type.isEligible({ mailbagItems: [] }).eligible, false);
  assert.equal(type.isEligible({ mailbagItems: [{ provenance: 'letters_to_editor/confucius.txt', captured_at: '2026-03-10T00:00:00Z', full_text: 'Full letter.' }] }).eligible, true);
});

test('from_the_mailbag avoids recently used letter sources', () => {
  const type = registry.from_the_mailbag;
  const memory = {
    recent_sources: [
      {
        source_refs: ['letters_to_editor/confucius.txt'],
      },
    ],
  };
  const mailbagItems = [
    { provenance: 'letters_to_editor/confucius.txt', captured_at: '2026-03-10T00:00:00Z', full_text: 'Full letter.' },
  ];
  assert.equal(type.isEligible({ mailbagItems, memory }).eligible, false);
});

test('short_story respects rarity cap from memory counts', () => {
  const type = registry.short_story;
  const strategy = {
    content_types: {
      short_story: {
        rolling_max: 1,
      },
    },
  };
  assert.equal(type.isEligible({ strategy, memory: { typeCounts: { short_story: 0 } } }).eligible, true);
  assert.equal(type.isEligible({ strategy, memory: { typeCounts: { short_story: 1 } } }).eligible, false);
});

test('base prompt includes shared concision rules', () => {
  const type = registry.decoder_ring;
  const prompt = type.buildPrompt({
    voice: 'Direct.',
    topic_thesis: 'Trust is lagging.',
    angle: 'Diagnose the pattern.',
    full_compressed_context: 'context',
    primary_source: {
      title: 'Reuters: OpenAI board crisis',
      url: 'https://www.reuters.com/example',
      published_at: '2026-03-10',
      claim: 'Leadership breakdown made the governance failure visible.',
      relevance: 'This is the visible case the post should decode.',
      excerpt: 'The board removed and then restored the chief executive within days.',
      content_text: 'OpenAI removed its chief executive, then restored him days later after an internal crisis.',
    },
    citations: [
      {
        title: 'Reuters: OpenAI board crisis',
        published_at: '2026-03-10',
        claim: 'Leadership breakdown made the governance failure visible.',
      },
    ],
    source_grounding_rules: [],
    type_rules: [],
    book_context: null,
    timely_subject: null,
    mailbag_item: null,
    research_summary: null,
  }, 'hook_forward');

  assert.match(prompt, /Aim for about 90-170 words/);
  assert.match(prompt, /No generic setup/);
  assert.match(prompt, /Do not restate the same idea/);
  assert.match(prompt, /opening line should create immediate tension, consequence, or pattern-recognition/i);
  assert.match(prompt, /Vary the shape of the opener/i);
  assert.match(prompt, /Primary source \(this is the case the post must open on\)/i);
  assert.match(prompt, /Primary source full text:/i);
  assert.match(prompt, /Research sources \(pick one as the visible entry point/i);
  assert.match(prompt, /Reuters: OpenAI board crisis/);
});

test('content types include specific anti-ramble guidance', () => {
  const strategy = { voice: { description: 'Direct.' }, book_context: null };
  const context = {
    sourceEvidence: [{ id: 's1', text: 'Evidence', source: 'essay.md' }],
    contextText: 'context',
    llmContextExcerpt: [],
    pullQuotes: [],
  };
  const calendarItem = {
    slot_type: 'baseline',
    topic_thesis: 'Topic',
    angle: 'Angle',
    hook: 'Hook',
  };
  const checks = [
    ['decoder_ring', /Do not drift into article summary/],
    ['ritual_recipe', /This must contain a usable move/],
    ['archetype_diagnosis', /Prefer a concrete final consequence/],
    ['high_lindy_source_tour', /Avoid familiar generic formulations/],
    ['cautionary_tale', /Prefer a hard boundary question or test/],
    ['from_the_mailbag', /Do not summarize the whole letter/],
    ['short_story', /Do not open with broad setup like/],
  ];

  for (const [typeId, expected] of checks) {
    const type = registry[typeId];
    const brief = type.buildBrief({
      calendarItem: { ...calendarItem, content_type: typeId },
      strategy,
      context,
      researchBundle: null,
      mailbagItem: null,
    });
    const prompt = type.buildPrompt(brief, 'hook_forward');
    assert.match(prompt, expected);
  }
});

test('decoder ring prompt requires a concrete sourced event in the first paragraph', () => {
  const type = registry.decoder_ring;
  const prompt = type.buildPrompt({
    voice: 'Direct.',
    topic_thesis: 'Naming failures hide institutional decay.',
    angle: 'Show the pattern behind the event.',
    full_compressed_context: 'context',
    citations: [
      {
        title: 'Reuters: Microsoft layoffs framed around AI',
        published_at: '2026-03-12',
        claim: 'The company used AI framing while cutting roles elsewhere.',
      },
    ],
    source_grounding_rules: type.buildBrief({
      calendarItem: {
        slot_type: 'baseline',
        topic_thesis: 'Naming failures hide institutional decay.',
        angle: 'Show the pattern behind the event.',
        hook: 'The euphemism is the tell.',
      },
      strategy: { voice: { description: 'Direct.' }, book_context: null },
      context: {
        contextText: 'context',
        llmContextExcerpt: [],
        pullQuotes: [],
      },
      researchBundle: null,
      mailbagItem: null,
    }).source_grounding_rules,
    type_rules: [],
    book_context: null,
    timely_subject: null,
    mailbag_item: null,
    research_summary: null,
  }, 'hook_forward');

  assert.match(prompt, /first paragraph must name one specific company, leader, or event/i);
  assert.match(prompt, /Do not reuse the article headline or source title verbatim as your first line/i);
  assert.match(prompt, /Do not open with broad trend language/i);
});
