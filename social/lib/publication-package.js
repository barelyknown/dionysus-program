const { prepareCanonicalNote, materializePublishedNote } = require('./notes');
const { attemptXPublish, publishPreparedX } = require('./x');
const { resolveCalendarItemAngle, selectPublishCandidate } = require('./publish-selection');
const {
  scoreCandidatesForItem,
  finalMemoryCheck,
  createPublishPayload,
  memoryHistoryFingerprint,
  ResearchPendingError,
  ResearchUnavailableError,
  NovelIdeaUnavailableError,
} = require('./pipeline');
const { now } = require('./time');

const PREPARATION_VERSION = 1;

function compactResearchBundle(bundle) {
  if (!bundle) return null;
  return {
    id: bundle.id || null,
    provider: bundle.provider || null,
    topic_thesis: bundle.topic_thesis || null,
    summary: bundle.summary || '',
    sources: Array.isArray(bundle.sources) ? bundle.sources : [],
    primary_source: bundle.primary_source || bundle.sources?.[0] || null,
    candidate_angles: Array.isArray(bundle.candidate_angles) ? bundle.candidate_angles : [],
    created_at: bundle.created_at || null,
  };
}

function compactXPreflight(preflight) {
  if (!preflight) return null;
  return {
    status: preflight.status,
    reason: preflight.reason || null,
    payload: preflight.payload || null,
    winnerCandidate: preflight.winnerCandidate || null,
    winnerScore: preflight.winnerScore || null,
  };
}

function preparationFailure({ calendarItem, status, reason, error = null, details = null, extra = {} }) {
  return {
    calendarItem,
    status,
    reason,
    error,
    details,
    ...extra,
  };
}

async function prepareItemPackage({ item, strategy, adapters, memory, researchBundle = null }) {
  let scored;
  let resolvedItem = resolveCalendarItemAngle({ calendarItem: item, strategy, memory });
  try {
    scored = await scoreCandidatesForItem({
      calendarItem: resolvedItem,
      strategy,
      adapters,
      memory,
      options: {
        waitForResearch: true,
        researchBundle,
      },
    });
    resolvedItem = scored.calendarItem || resolvedItem;
  } catch (error) {
    if (error instanceof ResearchPendingError) {
      return preparationFailure({
        calendarItem: resolvedItem,
        status: 'deferred',
        reason: 'research_pending',
        details: error.details,
      });
    }
    if (error instanceof ResearchUnavailableError) {
      return preparationFailure({
        calendarItem: resolvedItem,
        status: 'deferred',
        reason: 'research_unavailable',
        error: error.message,
        details: error.details,
      });
    }
    if (error instanceof NovelIdeaUnavailableError) {
      return preparationFailure({
        calendarItem: resolvedItem,
        status: 'skipped',
        reason: 'no_novel_idea',
        details: error.details,
        extra: {
          conflicts: ['idea_duplication'],
          idea_gate: error.details,
        },
      });
    }
    throw error;
  }

  const selection = selectPublishCandidate({
    calendarItem: resolvedItem,
    candidates: scored.candidates,
    scorecards: scored.scorecards,
    strategy,
    memory,
    researchBundle: scored.researchBundle,
    mailbagItem: scored.brief.mailbag_item,
    finalMemoryCheck,
  });

  if (!selection.winnerCandidate || !selection.winnerScore) {
    const duplicateEntityConflict = (selection.memoryConflicts || []).includes('entity_duplication');
    const blockedByMemory = selection.selectionReason === 'blocked_by_memory_conflict';
    return preparationFailure({
      calendarItem: resolvedItem,
      status: 'skipped',
      reason: duplicateEntityConflict
        ? 'entity_duplication'
        : (blockedByMemory ? 'memory_conflict' : 'no_passing_candidate'),
      extra: {
        scorecards: scored.scorecards,
        conflicts: selection.memoryConflicts || [],
        selection_reason: selection.selectionReason,
        research_bundle: compactResearchBundle(scored.researchBundle),
      },
    });
  }

  const xRequired = strategy.x?.enabled !== false;
  const packageAttempts = [];
  let approvedPackage = null;
  let lastAttemptedPackage = null;
  const eligibleCandidates = selection.eligibleCandidates?.length > 0
    ? selection.eligibleCandidates
    : [{
      candidate: selection.winnerCandidate,
      score: selection.winnerScore,
      memoryConflicts: selection.memoryConflicts || [],
    }];

  for (const eligible of eligibleCandidates) {
    const candidatePayload = createPublishPayload({
      calendarItem: resolvedItem,
      winnerCandidate: eligible.candidate,
      winnerScore: eligible.score,
      researchBundle: scored.researchBundle,
      mailbagItem: scored.brief.mailbag_item,
      strategy,
    });
    const candidateNote = prepareCanonicalNote({ publishPayload: candidatePayload });
    const candidateX = await attemptXPublish({
      linkedinPayload: candidatePayload,
      strategy,
      adapters,
      memory,
      dryRun: true,
    });
    lastAttemptedPackage = {
      winnerCandidate: eligible.candidate,
      winnerScore: eligible.score,
      payload: candidatePayload,
      preparedNote: candidateNote,
      xPreflight: candidateX,
    };
    const packagePass = !xRequired || candidateX.status === 'dry_run';
    packageAttempts.push({
      candidate_id: eligible.candidate.id,
      pass: packagePass,
      note_linkedin_novelty_score: eligible.score.novelty_score,
      note_linkedin_engagement_score: eligible.score.engagement_score,
      x_status: candidateX.status,
      x_reason: candidateX.reason || null,
    });
    if (packagePass) {
      approvedPackage = {
        winnerCandidate: eligible.candidate,
        winnerScore: eligible.score,
        memoryConflicts: eligible.memoryConflicts,
        payload: candidatePayload,
        preparedNote: candidateNote,
        xPreflight: candidateX,
      };
      break;
    }
  }

  if (!approvedPackage) {
    const finalAttempt = packageAttempts[packageAttempts.length - 1] || null;
    return preparationFailure({
      calendarItem: resolvedItem,
      status: 'skipped',
      reason: 'package_gate_failed',
      extra: {
        failed_channel: 'x',
        conflicts: finalAttempt?.x_reason ? [`x_${finalAttempt.x_reason}`] : [],
        payload: lastAttemptedPackage?.payload || null,
        note_preflight: lastAttemptedPackage?.preparedNote || null,
        x: lastAttemptedPackage?.xPreflight || null,
        winnerCandidate: lastAttemptedPackage?.winnerCandidate || null,
        winnerScore: lastAttemptedPackage?.winnerScore || null,
        package_attempts: packageAttempts,
        package_gate: {
          pass: false,
          attempted_candidates: packageAttempts.length,
          x_status: finalAttempt?.x_status || null,
          x_reason: finalAttempt?.x_reason || null,
        },
        selection_reason: selection.selectionReason,
        research_bundle: compactResearchBundle(scored.researchBundle),
      },
    });
  }

  const {
    winnerCandidate,
    winnerScore,
    memoryConflicts,
    payload,
    preparedNote,
    xPreflight,
  } = approvedPackage;
  const packageGate = {
    pass: true,
    attempted_candidates: packageAttempts.length,
    note_linkedin_novelty_score: winnerScore.novelty_score,
    note_linkedin_engagement_score: winnerScore.engagement_score,
    x_status: xPreflight.status,
    x_novelty_score: xPreflight.winnerScore?.novelty_score || null,
    x_engagement_score: xPreflight.winnerScore?.engagement_score || null,
  };
  const historyLimit = Math.max(1, Number(strategy.generation?.idea_history_prompt_limit || 1000));
  const historyFingerprint = memoryHistoryFingerprint(memory, historyLimit);
  const preparedAt = now().toISOString();
  const preparedPackage = {
    version: PREPARATION_VERSION,
    prepared_at: preparedAt,
    history_fingerprint: historyFingerprint,
    payload,
    prepared_note: preparedNote,
    x_preflight: compactXPreflight(xPreflight),
    winner_candidate: winnerCandidate,
    winner_score: winnerScore,
    package_gate: packageGate,
    selection_reason: selection.selectionReason,
    research_bundle: compactResearchBundle(scored.researchBundle),
  };

  return {
    calendarItem: resolvedItem,
    status: 'prepared',
    prepared_at: preparedAt,
    history_fingerprint: historyFingerprint,
    prepared_package: preparedPackage,
    payload,
    note_preflight: preparedNote,
    x: xPreflight,
    package_gate: packageGate,
    winnerCandidate,
    winnerScore,
    conflicts: memoryConflicts,
    selection_reason: selection.selectionReason,
  };
}

function preparedPackageStatus({ item, strategy, memory }) {
  const preparation = item?.preparation;
  const preparedPackage = preparation?.package;
  if (preparation?.status !== 'ready' || !preparedPackage) {
    return { ready: false, reason: 'package_not_prepared' };
  }
  if (preparedPackage.version !== PREPARATION_VERSION) {
    return { ready: false, reason: 'package_version_mismatch' };
  }
  const historyLimit = Math.max(1, Number(strategy.generation?.idea_history_prompt_limit || 1000));
  const currentFingerprint = memoryHistoryFingerprint(memory, historyLimit);
  if (preparedPackage.history_fingerprint !== currentFingerprint) {
    return {
      ready: false,
      reason: 'package_history_stale',
      prepared_history_fingerprint: preparedPackage.history_fingerprint,
      current_history_fingerprint: currentFingerprint,
    };
  }
  if (preparedPackage.payload?.item_id !== item.id) {
    return { ready: false, reason: 'package_item_mismatch' };
  }
  if (!preparedPackage.package_gate?.pass) {
    return { ready: false, reason: 'package_quality_gate_failed' };
  }
  if (strategy.x?.enabled !== false && preparedPackage.x_preflight?.status !== 'dry_run') {
    return { ready: false, reason: 'package_x_preflight_missing' };
  }
  return { ready: true, reason: null, preparedPackage };
}

async function deliverPreparedPackage({ item, preparedPackage, strategy, adapters }) {
  const payload = preparedPackage.payload;
  const publishResult = await adapters.zapier.publish({ payload });
  let note;
  try {
    note = await materializePublishedNote({
      calendarItem: item,
      publishPayload: payload,
      publishResult,
      writer: adapters.claude,
      strategy,
      preparedNote: preparedPackage.prepared_note,
    });
  } catch (error) {
    note = {
      status: 'failed',
      reason: 'note_materialization_failed',
      error: error.message,
    };
  }
  const x = await publishPreparedX({ preparedX: preparedPackage.x_preflight, adapters });
  return {
    calendarItem: item,
    status: 'published',
    payload,
    publishResult,
    note,
    x,
    package_gate: preparedPackage.package_gate,
    winnerCandidate: preparedPackage.winner_candidate,
    winnerScore: preparedPackage.winner_score,
    conflicts: [],
    selection_reason: preparedPackage.selection_reason,
  };
}

module.exports = {
  PREPARATION_VERSION,
  compactResearchBundle,
  compactXPreflight,
  prepareItemPackage,
  preparedPackageStatus,
  deliverPreparedPackage,
};
