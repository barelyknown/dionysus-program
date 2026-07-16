#!/usr/bin/env node
const { parseArgs, printJson, fail } = require('../lib/cli');
const { loadCalendars, saveCalendar, replaceCalendarItem } = require('../lib/records');
const { appendJsonl } = require('../lib/jsonl');
const { paths } = require('../lib/paths');
const { writeJson } = require('../lib/fs');
const { prepareCanonicalNote, materializePublishedNote } = require('../lib/notes');
const { attemptXPublish, publishPreparedX } = require('../lib/x');
const {
  isDue,
  baselineCadenceSkipReason,
  nextCalendarItemState,
} = require('../lib/publish-due-state');
const { resolveCalendarItemAngle, selectPublishCandidate } = require('../lib/publish-selection');
const {
  createAdapters,
  createRun,
  updateRun,
  loadStrategy,
  scoreCandidatesForItem,
  loadFreshMemory,
  finalMemoryCheck,
  createPublishPayload,
  createPublishedRecord,
  ResearchPendingError,
  NovelIdeaUnavailableError,
} = require('../lib/pipeline');
const { rebuildMemory } = require('../lib/memory');
const { now } = require('../lib/time');

async function handleItem({ item, strategy, adapters, memory, dryRun }) {
  let scored;
  let resolvedItem = resolveCalendarItemAngle({ calendarItem: item, strategy, memory });
  try {
    scored = await scoreCandidatesForItem({
      calendarItem: resolvedItem,
      strategy,
      adapters,
      memory,
      options: { waitForResearch: !dryRun },
    });
    resolvedItem = scored.calendarItem || resolvedItem;
  } catch (error) {
    if (error instanceof ResearchPendingError) {
      return {
        calendarItem: resolvedItem,
        status: 'deferred',
        reason: 'research_pending',
        pending_job: error.details?.pending_job || null,
      };
    }
    if (error instanceof NovelIdeaUnavailableError) {
      return {
        calendarItem: resolvedItem,
        status: 'skipped',
        reason: 'no_novel_idea',
        conflicts: ['idea_duplication'],
        idea_gate: error.details,
      };
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
    return {
      calendarItem: resolvedItem,
      status: 'skipped',
      reason: duplicateEntityConflict
        ? 'entity_duplication'
        : (blockedByMemory ? 'memory_conflict' : 'no_passing_candidate'),
      scorecards: scored.scorecards,
      conflicts: selection.memoryConflicts || [],
      selection_reason: selection.selectionReason,
    };
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
    return {
      calendarItem: resolvedItem,
      status: 'skipped',
      reason: 'package_gate_failed',
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
    };
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

  if (dryRun) {
    return {
      calendarItem: resolvedItem,
      status: 'dry_run',
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

  const publishResult = await adapters.zapier.publish({ payload });
  const note = await materializePublishedNote({
    calendarItem: resolvedItem,
    publishPayload: payload,
    publishResult,
    writer: adapters.claude,
    strategy,
    preparedNote,
  });
  const x = await publishPreparedX({ preparedX: xPreflight, adapters });
  return {
    calendarItem: resolvedItem,
    status: 'published',
    payload,
    publishResult,
    note,
    x,
    package_gate: packageGate,
    winnerCandidate,
    winnerScore,
    conflicts: memoryConflicts,
    selection_reason: selection.selectionReason,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const strategy = loadStrategy();
  const adapters = createAdapters({ args, strategy });
  const run = createRun('publish-due', { args, mode: adapters.mode });
  const dryRun = Boolean(args['dry-run']);
  const currentTime = args.now ? new Date(args.now) : now();
  const results = [];

  for (const entry of loadCalendars()) {
    let calendar = entry.data;
    for (const item of calendar.items || []) {
      if (!isDue(item, currentTime)) continue;
      const cadenceSkipReason = baselineCadenceSkipReason({ item, calendar, strategy });
      const outcome = cadenceSkipReason
        ? {
          calendarItem: item,
          status: 'skipped',
          reason: cadenceSkipReason,
          conflicts: [],
        }
        : await handleItem({
          item,
          strategy,
          adapters,
          memory: loadFreshMemory(strategy, { write: !dryRun }),
          dryRun,
        });
      results.push({ item_id: item.id, ...outcome });

      if (outcome.status === 'published') {
        const record = createPublishedRecord({
          publishPayload: outcome.payload,
          publishResult: outcome.publishResult,
          calendarItem: outcome.calendarItem || item,
          note: outcome.note,
          x: outcome.x,
        });
        appendJsonl(paths.publishedLedger, record);
        calendar = replaceCalendarItem(calendar, nextCalendarItemState(item, outcome));
      } else if (outcome.status === 'deferred') {
        calendar = replaceCalendarItem(calendar, nextCalendarItemState(item, outcome));
      } else if (outcome.status === 'skipped') {
        if (!dryRun) {
          appendJsonl(paths.skippedLedger, {
            item_id: item.id,
            skipped_at: currentTime.toISOString(),
            reason: outcome.reason,
            conflicts: outcome.conflicts || [],
          });
        }
        calendar = replaceCalendarItem(calendar, nextCalendarItemState(item, outcome));
      }
    }
    if (!dryRun) saveCalendar(entry.filePath, calendar);
  }

  const xTokenRotationOutput = process.env.X_TOKEN_ROTATION_OUTPUT;
  const rotatedCredentials = !dryRun && typeof adapters.x?.getRotatedCredentials === 'function'
    ? adapters.x.getRotatedCredentials()
    : null;
  if (!dryRun && xTokenRotationOutput && rotatedCredentials) {
    writeJson(xTokenRotationOutput, rotatedCredentials);
  }

  if (!dryRun) rebuildMemory({ strategy });

  updateRun(run, { results, dry_run: dryRun });
  printJson({ ok: true, run_id: run.id, dry_run: dryRun, results });
}

if (require.main === module) {
  main().catch((error) => fail(error.stack || error.message));
}

module.exports = {
  isDue,
  baselineCadenceSkipReason,
  nextCalendarItemState,
  handleItem,
  main,
};
