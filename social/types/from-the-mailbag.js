const { createContentType } = require('./base');

module.exports = createContentType({
  id: 'from_the_mailbag',
  pillar: 'From the Mailbag',
  summary: 'Start from a note or quote, then interpret what it reveals.',
  defaultAngle: 'The interpretation is the point, not the quote itself.',
  promptStyle: 'Quote, what caught Sean’s attention, what it reveals, what to do with it.',
  sourceGroundingRules: [
    'Read the provided letter and choose one short quote from it yourself as the trigger.',
    'Treat the full letter as reference material and react to the sharpest idea inside it.',
    'Do not summarize the whole letter. Pull one live wire out of it and use that.',
    'Do not over-contextualize the sender or provenance unless it materially matters.',
  ],
  typeRules: [
    'Always attribute the letter as "Not ___" using the provided mailbag attribution.',
    'Name that "Not ___" attribution in the opening or second paragraph.',
    'Choose one brief quote from the letter, then move to Sean’s reaction fast.',
    'After the quote, get to interpretation immediately. Do not spend multiple paragraphs re-explaining the letter.',
    'Spend more space on interpretation than on the quote.',
    'Name what the note reveals about the underlying organizational pattern.',
    'Use at most one short supporting example paragraph.',
    'If the core interpretation is already clear, stop. Do not add a second explanation pass.',
    'End with a concrete implication or move.',
    'Avoid sounding like customer support, therapy, or inbox commentary.',
  ],
  requiresMailbag: true,
  isEligible({ mailbagItems, memory }) {
    const recentSourceRefs = new Set((memory?.recent_sources || []).flatMap((entry) => entry.source_refs || []));
    const eligibleItems = (mailbagItems || []).filter((item) => {
      if (!item?.provenance || !item?.captured_at) return false;
      if (!item?.full_text && !item?.quote) return false;
      return !recentSourceRefs.has(item.provenance);
    });
    return {
      eligible: eligibleItems.length > 0,
      reason: eligibleItems.length > 0 ? null : 'No unused mailbag letters or notes available.',
    };
  },
});
