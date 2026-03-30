const { getMemoryConflicts } = require('./memory');
const { getType } = require('../types');

const HARD_FAILURE_REASONS = new Set([
  'emoji_disallowed',
  'hashtag_disallowed',
  'link_disallowed',
]);
const BLOCKING_MEMORY_CONFLICTS = new Set([
  'entity_duplication',
]);

function dedupeStrings(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function buildAngleCandidates({ calendarItem }) {
  const type = getType(calendarItem.content_type);
  const currentAngle = calendarItem.angle || type?.defaultAngle || '';
  const topicThesis = String(calendarItem.topic_thesis || '').trim();
  const curatedAngles = Array.isArray(type?.angleOptions) ? type.angleOptions : [];

  return dedupeStrings([
    currentAngle,
    ...curatedAngles,
    topicThesis && currentAngle
      ? `${currentAngle} Keep the framing specific to this thesis: ${topicThesis}`
      : '',
    topicThesis && type?.promptStyle
      ? `${type.promptStyle} Keep the entry point specific to this thesis: ${topicThesis}`
      : '',
    topicThesis
      ? `Start from the concrete consequence inside this thesis, then make the underlying pattern legible: ${topicThesis}`
      : '',
  ]);
}

function resolveCalendarItemAngle({ calendarItem, strategy, memory }) {
  const angleCandidates = buildAngleCandidates({ calendarItem });

  for (const angle of angleCandidates) {
    const conflicts = getMemoryConflicts({
      record: {
        content_type: calendarItem.content_type,
        hook: calendarItem.hook || '',
        angle,
        topic_thesis: calendarItem.topic_thesis,
        timely_subject: calendarItem.timely_subject,
        source_refs: [],
      },
      strategy,
      memory,
    });

    if (!conflicts.includes('angle_duplication')) {
      return angle === calendarItem.angle
        ? calendarItem
        : { ...calendarItem, angle };
    }
  }

  return calendarItem;
}

function rankScoredCandidates({ candidates = [], scorecards = [] }) {
  const byCandidateId = new Map((Array.isArray(candidates) ? candidates : []).map((candidate) => [candidate.id, candidate]));
  return [...(Array.isArray(scorecards) ? scorecards : [])]
    .sort((left, right) => right.overall_score - left.overall_score)
    .map((score) => ({
      score,
      candidate: byCandidateId.get(score.candidate_id) || null,
    }))
    .filter((entry) => entry.candidate);
}

function hasHardFailure(scorecard) {
  const reasons = Array.isArray(scorecard?.pass_fail_reasons) ? scorecard.pass_fail_reasons : [];
  return reasons.some((reason) => HARD_FAILURE_REASONS.has(reason) || String(reason).startsWith('too_long:'));
}

function hasBlockingMemoryConflict(conflicts = []) {
  return (Array.isArray(conflicts) ? conflicts : []).some((conflict) => BLOCKING_MEMORY_CONFLICTS.has(conflict));
}

function selectPublishCandidate({
  calendarItem,
  candidates,
  scorecards,
  strategy,
  memory,
  researchBundle,
  mailbagItem = null,
  finalMemoryCheck,
}) {
  const ranked = rankScoredCandidates({ candidates, scorecards });
  const evaluatedCandidates = ranked.map(({ candidate, score }) => ({
    candidate,
    score,
    memoryConflicts: finalMemoryCheck({
      calendarItem,
      winnerCandidate: candidate,
      strategy,
      memory,
      researchBundle,
      mailbagItem,
    }),
  }));

  const memorySafe = evaluatedCandidates.find((entry) => !hasHardFailure(entry.score) && entry.memoryConflicts.length === 0);
  if (memorySafe) {
    return {
      winnerCandidate: memorySafe.candidate,
      winnerScore: memorySafe.score,
      memoryConflicts: [],
      selectionReason: memorySafe.score.pass ? 'memory_safe_top_choice' : 'memory_safe_best_effort',
      evaluatedCandidates,
    };
  }

  const bestEffort = evaluatedCandidates.find((entry) => !hasHardFailure(entry.score) && !hasBlockingMemoryConflict(entry.memoryConflicts));
  if (bestEffort) {
    return {
      winnerCandidate: bestEffort.candidate,
      winnerScore: bestEffort.score,
      memoryConflicts: bestEffort.memoryConflicts,
      selectionReason: bestEffort.score.pass ? 'memory_override_top_choice' : 'memory_override_best_effort',
      evaluatedCandidates,
    };
  }

  const blockedByMemory = evaluatedCandidates.find((entry) => !hasHardFailure(entry.score) && hasBlockingMemoryConflict(entry.memoryConflicts));
  if (blockedByMemory) {
    return {
      winnerCandidate: null,
      winnerScore: null,
      memoryConflicts: blockedByMemory.memoryConflicts,
      selectionReason: 'blocked_by_memory_conflict',
      evaluatedCandidates,
    };
  }

  return {
    winnerCandidate: null,
    winnerScore: null,
    memoryConflicts: [],
    selectionReason: 'no_publishable_candidate',
    evaluatedCandidates,
  };
}

module.exports = {
  buildAngleCandidates,
  resolveCalendarItemAngle,
  rankScoredCandidates,
  selectPublishCandidate,
  hasHardFailure,
};
