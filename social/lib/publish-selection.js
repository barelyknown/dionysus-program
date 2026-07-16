const { getMemoryConflicts } = require('./memory');
const { getType } = require('../types');

const HARD_FAILURE_REASONS = new Set([
  'emoji_disallowed',
  'hashtag_disallowed',
  'link_disallowed',
]);
const BLOCKING_MEMORY_CONFLICTS = new Set([
  'hook_duplication',
  'content_duplication',
  'topic_duplication',
  'timely_subject_duplication',
  'source_overuse',
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

function meetsDraftQualityThresholds(scorecard, strategy) {
  const minimumNoveltyScore = Number(strategy?.generation?.minimum_draft_novelty_score || 8);
  const minimumEngagementScore = Number(strategy?.generation?.minimum_draft_engagement_score || 7.5);
  return Number(scorecard?.novelty_score || 0) >= minimumNoveltyScore
    && Number(scorecard?.engagement_score || 0) >= minimumEngagementScore;
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
  const eligibleCandidates = evaluatedCandidates.filter((entry) => (
    entry.score.pass
    && meetsDraftQualityThresholds(entry.score, strategy)
    && !hasHardFailure(entry.score)
    && !hasBlockingMemoryConflict(entry.memoryConflicts)
  ));

  const memorySafe = evaluatedCandidates.find((entry) => (
    entry.score.pass
    && meetsDraftQualityThresholds(entry.score, strategy)
    && !hasHardFailure(entry.score)
    && entry.memoryConflicts.length === 0
  ));
  if (memorySafe) {
    return {
      winnerCandidate: memorySafe.candidate,
      winnerScore: memorySafe.score,
      memoryConflicts: [],
      selectionReason: 'memory_safe_top_choice',
      evaluatedCandidates,
      eligibleCandidates,
    };
  }

  const publishableWithNonBlockingConflict = evaluatedCandidates.find((entry) => (
    entry.score.pass
    && meetsDraftQualityThresholds(entry.score, strategy)
    && !hasHardFailure(entry.score)
    && !hasBlockingMemoryConflict(entry.memoryConflicts)
  ));
  if (publishableWithNonBlockingConflict) {
    return {
      winnerCandidate: publishableWithNonBlockingConflict.candidate,
      winnerScore: publishableWithNonBlockingConflict.score,
      memoryConflicts: publishableWithNonBlockingConflict.memoryConflicts,
      selectionReason: 'memory_override_top_choice',
      evaluatedCandidates,
      eligibleCandidates,
    };
  }

  const blockedByMemory = evaluatedCandidates.find((entry) => (
    entry.score.pass
    && meetsDraftQualityThresholds(entry.score, strategy)
    && !hasHardFailure(entry.score)
    && hasBlockingMemoryConflict(entry.memoryConflicts)
  ));
  if (blockedByMemory) {
    return {
      winnerCandidate: null,
      winnerScore: null,
      memoryConflicts: blockedByMemory.memoryConflicts,
      selectionReason: 'blocked_by_memory_conflict',
      evaluatedCandidates,
      eligibleCandidates,
    };
  }

  return {
    winnerCandidate: null,
    winnerScore: null,
    memoryConflicts: [],
    selectionReason: 'no_publishable_candidate',
    evaluatedCandidates,
    eligibleCandidates,
  };
}

module.exports = {
  buildAngleCandidates,
  resolveCalendarItemAngle,
  rankScoredCandidates,
  selectPublishCandidate,
  hasHardFailure,
  meetsDraftQualityThresholds,
};
