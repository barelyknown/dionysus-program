const { createContentType } = require('./base');

module.exports = createContentType({
  id: 'cautionary_tale',
  pillar: 'Cautionary Tales',
  summary: 'Warn about misuse or anti-patterns without moralizing.',
  defaultAngle: 'Name the misuse clearly and show the cost of getting it wrong.',
  promptStyle: 'Warning-first, concrete anti-pattern, practical implication.',
  sourceGroundingRules: [
    'Anchor the warning in a real misuse pattern from the source evidence or research.',
    'Do not speculate about motives when behavior and consequences are enough.',
  ],
  typeRules: [
    'Lead with the warning, not background.',
    'Name one anti-pattern only.',
    'Show the concrete cost of that misuse quickly.',
    'Warn clearly without sermonizing, shaming, or sounding morally self-satisfied.',
    'End with a tighter practice or boundary, not a vague plea to be careful.',
    'Prefer a hard boundary question or test in the final line.',
  ],
});
