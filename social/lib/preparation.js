const { loadSourceContext } = require('./context');
const { getMemoryConflicts, normalizeText } = require('./memory');
const { loadMailbagItems, scoreTopicCandidate, candidateHook } = require('./planner');
const { listTypes } = require('../types');
const { now } = require('./time');

function typeDeficit({ typeId, strategy, memory }) {
  const targetWeight = Number(strategy.content_types?.[typeId]?.target_weight || 0);
  const rollingTotal = Math.max(1, Number(memory.rolling_published_count ?? memory.published_count ?? 0));
  const currentCount = Number(memory.typeCounts?.[typeId] || 0);
  return (rollingTotal * targetWeight) - currentCount;
}

function eligibleFallbackTypes({ item, strategy, memory, context, mailbagItems }) {
  return listTypes().filter((type) => {
    const config = strategy.content_types?.[type.id] || {};
    if (type.requiresResearch || config.requires_research === true) return false;
    if (config.enabled === false) return false;
    if (Array.isArray(config.weekdays) && !config.weekdays.includes(item.weekday)) return false;
    if (!type.isEligible({ strategy, memory, context, mailbagItems }).eligible) return false;
    const conflicts = getMemoryConflicts({
      record: {
        content_type: type.id,
        topic_thesis: '',
        angle: type.defaultAngle,
        hook: '',
        source_refs: [],
      },
      memory,
      strategy,
    });
    return !conflicts.includes('type_overuse');
  });
}

function buildFallbackCandidates({ item, strategy, memory, limit = 6 }) {
  const context = loadSourceContext();
  const mailbagItems = loadMailbagItems();
  const types = eligibleFallbackTypes({ item, strategy, memory, context, mailbagItems });
  const candidates = [];

  for (const type of types) {
    for (const topicEntry of strategy.topics || []) {
      const scored = scoreTopicCandidate({
        topicEntry,
        typeId: type.id,
        strategy,
        memory,
        context,
        usedTopics: new Set(),
      });
      if (!Number.isFinite(scored.score)) continue;
      const topicThesis = scored.topic.thesis;
      const sameAsCurrent = type.id === item.content_type
        && normalizeText(topicThesis) === normalizeText(item.seed_topic_thesis || item.topic_thesis);
      if (sameAsCurrent) continue;
      candidates.push({
        type,
        topicThesis,
        score: scored.score + (typeDeficit({ typeId: type.id, strategy, memory }) * 2),
      });
    }
  }

  return candidates
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Number(limit || 6)))
    .map(({ type, topicThesis }, index) => ({
      ...item,
      content_type: type.id,
      pillar: type.pillar,
      topic_thesis: topicThesis,
      seed_topic_thesis: topicThesis,
      idea_status: 'pending',
      novel_idea: null,
      angle: type.defaultAngle,
      hook: candidateHook(type, topicThesis),
      source_bundle_id: null,
      timely_subject: null,
      preparation: null,
      fallback: {
        attempt: index + 1,
        selected_at: now().toISOString(),
        from_content_type: item.content_type,
        from_seed_topic_thesis: item.seed_topic_thesis || item.topic_thesis,
      },
    }));
}

function preparationWindowStatus({ item, currentTime, horizonHours, overdueGraceHours }) {
  if (item.status !== 'planned') return { eligible: false, reason: 'not_planned' };
  const scheduledAt = new Date(item.scheduled_at);
  const deltaHours = (scheduledAt.getTime() - currentTime.getTime()) / (60 * 60 * 1000);
  if (deltaHours > horizonHours) return { eligible: false, reason: 'outside_horizon', delta_hours: deltaHours };
  if (deltaHours < -overdueGraceHours) return { eligible: false, reason: 'expired', delta_hours: deltaHours };
  return { eligible: true, reason: null, delta_hours: deltaHours };
}

module.exports = {
  eligibleFallbackTypes,
  buildFallbackCandidates,
  preparationWindowStatus,
};
