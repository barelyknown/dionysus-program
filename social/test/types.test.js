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
    source_evidence: [{ id: 's1', text: 'Trust matters.', source: 'essay.md' }],
    full_compressed_context: 'context',
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
