const { createContentType } = require('./base');

module.exports = createContentType({
  id: 'archetype_diagnosis',
  pillar: 'Archetype Diagnosis',
  summary: 'Classify recognizable organizational patterns with vivid language.',
  defaultAngle: 'Make the pattern recognizable fast and show what drives it.',
  promptStyle: 'Name the archetype, signs, what drives it, what happens if ignored.',
  sourceGroundingRules: [
    'Use source language to anchor the archetype name or core logic.',
    'Do not invent extra sub-types or taxonomy inside the post.',
  ],
  typeRules: [
    'Make the archetype recognizable in the first two paragraphs.',
    'Use 3-5 signs at most.',
    'The signs should be vivid and observable, not abstract personality labels.',
    'Explain what drives the pattern in one tight paragraph.',
    'End with the consequence of leaving it untreated.',
    'Prefer a concrete final consequence over framework jargon in the closing line.',
  ],
  timelyEligible: false,
});
