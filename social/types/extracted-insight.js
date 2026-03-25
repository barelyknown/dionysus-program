const { createContentType } = require('./base');

module.exports = createContentType({
  id: 'extracted_insight',
  pillar: 'Extracted Insights',
  summary: 'One sharp idea from the book, explained plainly.',
  defaultAngle: 'Name the concept, explain it plainly, and show why it matters now.',
  angleOptions: [
    'Name the concept, explain it plainly, and show why it matters now.',
    'Start with the false virtue, then show the operating cost it hides.',
    'Draw the boundary between patience and avoidance, then show the failure mode.',
    'Name the mistake directly, then show why fast change turns it into negligence.',
  ],
  promptStyle: 'Strong first line, define the concept, explain it cleanly, end with implication.',
  sourceGroundingRules: [
    'Anchor the post in at least one provided source evidence item.',
    'Prefer exact book language or a very close paraphrase over a newly invented label.',
    'If you use a coined term, it must appear verbatim in the source evidence.',
    'Do not make unsupported market-size, competitive, or inevitability claims.',
  ],
  typeRules: [
    'This is a book-derived insight, not a generic AI-culture take.',
    'Use one clear concept only.',
    'The implication should follow directly from the source evidence.',
    'Do not pad the post with multiple examples or scene-setting.',
  ],
});
