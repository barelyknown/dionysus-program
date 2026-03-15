const { createContentType } = require('./base');

module.exports = createContentType({
  id: 'decoder_ring',
  pillar: 'Decoder Ring',
  summary: 'Interpret current events or company behavior through the Dionysus lens.',
  defaultAngle: 'Do not summarize the news; diagnose the pattern underneath it.',
  promptStyle: 'Start from a visible event or behavior, show what people are missing, diagnose it.',
  sourceGroundingRules: [
    'If research is provided, use it to name the visible event or behavior briefly, then move to diagnosis.',
    'Do not make broad claims about what "every company" or "everyone" is doing.',
  ],
  typeRules: [
    'The event is the entry point, not the post.',
    'Name one visible pattern and one underlying diagnosis.',
    'Do not drift into article summary, timeline recap, or industry overview.',
    'Use at most one external example unless the brief explicitly requires comparison.',
    'Keep the close practical: what a serious operator should notice or do next.',
  ],
  timelyEligible: true,
});
