const { createContentType } = require('./base');

module.exports = createContentType({
  id: 'decoder_ring',
  pillar: 'Decoder Ring',
  summary: 'Interpret current events or company behavior through the Dionysus lens.',
  defaultAngle: 'Do not summarize the news; diagnose the pattern underneath it.',
  promptStyle: 'Start from a visible event or behavior, show what people are missing, diagnose it.',
  sourceGroundingRules: [
    'If research is provided, the first paragraph must name one specific company, leader, or event from the research sources in plain language.',
    'Use exactly one sourced case as the visible entry point. Treat any other sources as background only.',
    'If you cannot name the concrete case, do not write a generalized trend post instead.',
    'Do not reuse the article headline or source title verbatim as your first line. Name the event in your own words.',
    'Do not open with broad trend language like "in the AI era," "right now," or "most companies."',
    'Do not make broad claims about what "every company" or "everyone" is doing.',
  ],
  typeRules: [
    'The event is the entry point, not the post.',
    'The first paragraph should make the event legible fast: who did what, or what happened, and why it matters.',
    'Name one visible pattern and one underlying diagnosis.',
    'Do not drift into article summary, timeline recap, or industry overview.',
    'Use at most one external example unless the brief explicitly requires comparison.',
    'Keep the close practical: what a serious operator should notice or do next.',
  ],
  timelyEligible: true,
  requiresResearch: true,
});
