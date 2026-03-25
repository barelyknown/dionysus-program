const { createContentType } = require('./base');

module.exports = createContentType({
  id: 'short_story',
  pillar: 'Short Stories',
  summary: 'Use compressed narrative to dramatize a recurring organizational truth.',
  defaultAngle: 'A short story must resolve into a concrete lesson, not just a mood.',
  angleOptions: [
    'A short story must resolve into a concrete lesson, not just a mood.',
    'Start inside one live moment, then let the lesson land without a second explanation pass.',
    'Use one small scene to reveal the pattern, then close on the concrete truth it exposes.',
    'Begin with action or dialogue, then turn the scene into an organizational diagnosis.',
  ],
  promptStyle: 'Compressed narrative, clear recurring truth, sharp closing implication.',
  sourceGroundingRules: [
    'Use the source material to anchor the truth the story reveals, even if the story itself is compressed or illustrative.',
    'Do not invent ornate lore, multiple scenes, or character backstories.',
  ],
  typeRules: [
    'Keep the story short and compressed.',
    'Use one small concrete scene, one turn, and one lesson.',
    'Begin inside the moment, not with company-level summary or dashboard language.',
    'Preferred opening material: a sentence someone says, a sentence someone swallows, a visible gesture, a forecast being softened, a slide advancing while no one objects.',
    'Stay close to a specific moment: a sentence in a meeting, a hesitation, a softened forecast, a look in the room, a decision that does not get said.',
    'Keep named actors to the minimum necessary for the scene to work.',
    'Do not open with broad setup like "the numbers were fine," "the dashboard was green," or "the company looked healthy."',
    'Do not zoom out into a broad montage of organizational life until the story has already landed.',
    'Avoid "middle-distance" abstraction: stay with the moment, then draw the lesson.',
    'Avoid literary flourish that slows the post down.',
    'Resolve the story into a concrete organizational truth by the end.',
    'If the piece reads like mood instead of diagnosis, it has failed.',
    'Do not add a second explanatory paragraph after the lesson is already clear.',
  ],
  maxRollingWeeks: 8,
  isEligible({ strategy, memory }) {
    const recentCount = memory.typeCounts?.short_story || 0;
    const maxCount = strategy.content_types?.short_story?.rolling_max ?? 1;
    return {
      eligible: recentCount < maxCount,
      reason: recentCount < maxCount ? null : 'Short story frequency cap reached.',
    };
  },
});
