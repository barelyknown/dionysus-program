const { overlapScore } = require('./memory');
const { getType } = require('../types');

function buildBrief({ calendarItem, strategy, context, researchBundle, mailbagItems, memory = {} }) {
  const type = getType(calendarItem.content_type);
  if (!type) throw new Error(`Unknown content type: ${calendarItem.content_type}`);

  let mailbagItem = null;
  if (type.requiresMailbag) {
    const recentSourceRefs = new Set((memory.recent_sources || []).flatMap((entry) => entry.source_refs || []));
    mailbagItem = [...(mailbagItems || [])]
      .filter((item) => !item.used_at)
      .filter((item) => item.provenance && !recentSourceRefs.has(item.provenance))
      .sort((left, right) => (
        overlapScore(calendarItem.topic_thesis || '', right.full_text || right.quote || '')
        - overlapScore(calendarItem.topic_thesis || '', left.full_text || left.quote || '')
      ))[0] || null;
  }

  return type.buildBrief({
    calendarItem,
    strategy,
    context,
    researchBundle,
    mailbagItem,
  });
}

module.exports = {
  buildBrief,
};
