#!/usr/bin/env node
const { parseArgs, printJson, fail } = require('../lib/cli');
const { loadCalendars, saveCalendar, replaceCalendarItem } = require('../lib/records');
const { appendJsonl } = require('../lib/jsonl');
const { paths } = require('../lib/paths');
const { writeJson } = require('../lib/fs');
const { materializePublishedNote } = require('../lib/notes');
const { attemptXPublish } = require('../lib/x');
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

function isDue(item, currentTime) {
  return item.status === 'planned' && new Date(item.scheduled_at).getTime() <= currentTime.getTime();
}

async function handleItem({ item, strategy, adapters, memory, dryRun }) {
  let scored;
  let resolvedItem = item;
  try {
    scored = await scoreCandidatesForItem({ calendarItem: item, strategy, adapters, memory });
    resolvedItem = scored.calendarItem || item;
  } catch (error) {
    if (error instanceof ResearchPendingError) {
      return {
        calendarItem: item,
        status: 'skipped',
        reason: 'research_pending',
        pending_job: error.details?.pending_job || null,
      };
    }
    throw error;
  }
  if (!scored.winnerCandidate || !scored.winnerScore) {
    return {
      calendarItem: scored.calendarItem || item,
      status: 'skipped',
      reason: 'no_passing_candidate',
      scorecards: scored.scorecards,
    };
  }
  const memoryConflicts = finalMemoryCheck({
    calendarItem: resolvedItem,
    winnerCandidate: scored.winnerCandidate,
    strategy,
    memory,
    researchBundle: scored.researchBundle,
    mailbagItem: scored.brief.mailbag_item,
  });
  if (memoryConflicts.length > 0) {
    return {
      calendarItem: scored.calendarItem || item,
      status: 'skipped',
      reason: 'memory_conflict',
      conflicts: memoryConflicts,
      winnerCandidate: scored.winnerCandidate,
      winnerScore: scored.winnerScore,
    };
  }

  const payload = createPublishPayload({
    calendarItem: resolvedItem,
    winnerCandidate: scored.winnerCandidate,
    winnerScore: scored.winnerScore,
    researchBundle: scored.researchBundle,
    mailbagItem: scored.brief.mailbag_item,
  });

  if (dryRun) {
    const x = await attemptXPublish({
      linkedinPayload: payload,
      strategy,
      adapters,
      dryRun: true,
    });
    return {
      calendarItem: scored.calendarItem || item,
      status: 'dry_run',
      payload,
      x,
      winnerCandidate: scored.winnerCandidate,
      winnerScore: scored.winnerScore,
    };
  }

  const publishResult = await adapters.zapier.publish({ payload });
  const note = await materializePublishedNote({
    calendarItem: item,
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
    calendarItem: scored.calendarItem || item,
    status: 'published',
    payload,
    publishResult,
    note,
    x,
    winnerCandidate: scored.winnerCandidate,
    winnerScore: scored.winnerScore,
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
        calendar = replaceCalendarItem(calendar, {
          ...(outcome.calendarItem || item),
          status: 'published',
          winner_id: outcome.winnerCandidate.id,
          publish_payload: outcome.payload,
          published_at: outcome.publishResult.delivered_at,
          external_post_id: outcome.publishResult.external_post_id,
          note_slug: outcome.note?.slug || null,
          note_source_path: outcome.note?.sourcePath || null,
          x_status: outcome.x?.status || null,
          x_external_post_id: outcome.x?.publishResult?.external_post_id || null,
          x_published_at: outcome.x?.publishResult?.delivered_at || null,
          x_winning_candidate_id: outcome.x?.winnerCandidate?.id || null,
          x_publish_payload: outcome.x?.payload || null,
          x_skip_reason: outcome.x && outcome.x.status !== 'published' ? outcome.x.reason || null : null,
        });
      } else if (outcome.status === 'skipped') {
        appendJsonl(paths.skippedLedger, {
          item_id: item.id,
          skipped_at: currentTime.toISOString(),
          reason: outcome.reason,
          conflicts: outcome.conflicts || [],
        });
        calendar = replaceCalendarItem(calendar, {
          ...(outcome.calendarItem || item),
          status: 'skipped',
          skip_reason: outcome.reason,
        });
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

main().catch((error) => fail(error.stack || error.message));
