const { createContentType } = require('./base');

module.exports = createContentType({
  id: 'ritual_recipe',
  pillar: 'Ritual Recipes',
  summary: 'Turn the framework into a practical operating move.',
  defaultAngle: 'Start with a recurring problem and end with a usable move.',
  promptStyle: 'Problem, common mistake, better structure, practical steps, when to use it.',
  sourceGroundingRules: [
    'Anchor the recipe in a specific organizational failure mode from the source evidence.',
    'If you give steps, keep them minimal and executable.',
  ],
  typeRules: [
    'This must contain a usable move, not just a critique.',
    'State the recurring problem quickly, then get to the better structure.',
    'Use no more than 3-4 steps or operating rules.',
    'Include a "when not to use this" boundary when the move is socially hot or risky.',
    'Avoid dense framework vocabulary unless the term is necessary.',
  ],
});
