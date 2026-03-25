const { createContentType } = require('./base');

module.exports = createContentType({
  id: 'high_lindy_source_tour',
  pillar: 'High-Lindy Source Tour Guide',
  summary: 'Explain an old idea and why it matters now.',
  defaultAngle: 'The old source is not the point; present relevance is.',
  angleOptions: [
    'The old source is not the point; present relevance is.',
    'Open on the current failure first, then use the old source to make it legible.',
    'Start with the modern confusion, then show the old idea that cuts through it.',
    'Use one old source to sharpen a present-tense operator problem, not to give a history lesson.',
  ],
  promptStyle: 'Use one old source, make it legible, connect it to current organizational reality.',
  sourceGroundingRules: [
    'Use one named source or thinker only.',
    'If you reference the source, paraphrase cleanly instead of sounding like a book report.',
  ],
  typeRules: [
    'Open with the current problem, not the historical source.',
    'Explain the old idea in plain language in one short paragraph.',
    'Most of the post should be about why it matters now.',
    'Do not stack multiple philosophers, books, or traditions into one post.',
    'Close with a present-tense implication for operators or leaders.',
    'Avoid familiar generic formulations like "ritual without trust is theater" unless you add a fresher consequence or distinction.',
  ],
});
