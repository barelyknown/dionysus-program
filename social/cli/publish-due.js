#!/usr/bin/env node
const { parseArgs, printJson, fail } = require('../lib/cli');
const { loadCalendars, saveCalendar, replaceCalendarItem } = require('../lib/records');
const { appendJsonl } = require('../lib/jsonl');
const { paths } = require('../lib/paths');
const { writeJson } = require('../lib/fs');
const { materializePublishedNote } = require('../lib/notes');
const { attemptXPublish } = require('../lib/x');
const { isDue, nextCalendarItemState } = require('../lib/publish-due-state');
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
    return {
      calendarItem: resolvedItem,
      status: 'skipped',
      reason: 'no_passing_candidate',
      scorecards: scored.scorecards,
    };
  }

  const payload = createPublishPayload({
    calendarItem: resolvedItem,
    winnerCandidate: selection.winnerCandidate,
    winnerScore: selection.winnerScore,
    researchBundle: scored.researchBundle,
    mailbagItem: scored.brief.mailbag_item,
    strategy,
  });

  if (dryRun) {
    const x = await attemptXPublish({
      linkedinPayload: payload,
      strategy,
      adapters,
      dryRun: true,
    });
    return {
      calendarItem: resolvedItem,
      status: 'dry_run',
      payload,
      x,
      winnerCandidate: selection.winnerCandidate,
      winnerScore: selection.winnerScore,
      conflicts: selection.memoryConflicts,
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
  });
  const x = await attemptXPublish({
    linkedinPayload: payload,
    strategy,
    adapters,
    dryRun: false,
  });
  return {
    calendarItem: resolvedItem,
    status: 'published',
    payload,
    publishResult,
    note,
    x,
    winnerCandidate: selection.winnerCandidate,
    winnerScore: selection.winnerScore,
    conflicts: selection.memoryConflicts,
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
      const memory = loadFreshMemory(strategy, { write: !dryRun });
      const outcome = await handleItem({ item, strategy, adapters, memory, dryRun });
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
        appendJsonl(paths.skippedLedger, {
          item_id: item.id,
          skipped_at: currentTime.toISOString(),
          reason: outcome.reason,
          conflicts: outcome.conflicts || [],
        });
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
  nextCalendarItemState,
  handleItem,
  main,
};
