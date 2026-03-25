const { createContentType } = require('./base');

module.exports = createContentType({
  id: 'cautionary_tale',
  pillar: 'Cautionary Tales',
  summary: 'Warn about misuse or anti-patterns without moralizing.',
  defaultAngle: 'Name the misuse clearly and show the cost of getting it wrong.',
  angleOptions: [
    'Name the misuse clearly and show the cost of getting it wrong.',
    'Start with the surface rigor, then show the hidden damage it causes.',
    'Open on the false solution, then name the trust cost it creates.',
    'Make the anti-pattern concrete fast, then show the boundary that would have prevented it.',
  ],
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
