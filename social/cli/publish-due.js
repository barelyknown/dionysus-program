#!/usr/bin/env node
const { parseArgs, printJson, fail } = require('../lib/cli');
const { loadCalendars, saveCalendar, replaceCalendarItem } = require('../lib/records');
const { appendJsonl } = require('../lib/jsonl');
const { paths } = require('../lib/paths');
const { materializePublishedNote } = require('../lib/notes');
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
} = require('../lib/pipeline');
const { rebuildMemory } = require('../lib/memory');
const { now } = require('../lib/time');

function isDue(item, currentTime) {
  return item.status === 'planned' && new Date(item.scheduled_at).getTime() <= currentTime.getTime();
}

async function handleItem({ item, strategy, adapters, memory, dryRun }) {
  const scored = await scoreCandidatesForItem({ calendarItem: item, strategy, adapters, memory });
  if (!scored.winnerCandidate || !scored.winnerScore) {
    return {
      status: 'skipped',
      reason: 'no_passing_candidate',
      scorecards: scored.scorecards,
    };
  }
  const memoryConflicts = finalMemoryCheck({
    calendarItem: item,
    winnerCandidate: scored.winnerCandidate,
    strategy,
    memory,
    researchBundle: scored.researchBundle,
    mailbagItem: scored.brief.mailbag_item,
  });
  if (memoryConflicts.length > 0) {
    return {
      status: 'skipped',
      reason: 'memory_conflict',
      conflicts: memoryConflicts,
      winnerCandidate: scored.winnerCandidate,
      winnerScore: scored.winnerScore,
    };
  }

  const payload = createPublishPayload({
    calendarItem: item,
    winnerCandidate: scored.winnerCandidate,
    winnerScore: scored.winnerScore,
    researchBundle: scored.researchBundle,
    mailbagItem: scored.brief.mailbag_item,
  });

  if (dryRun) {
    return {
      status: 'dry_run',
      payload,
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
  return {
    status: 'published',
    payload,
    publishResult,
    note,
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
          calendarItem: item,
          note: outcome.note,
        });
        appendJsonl(paths.publishedLedger, record);
        calendar = replaceCalendarItem(calendar, {
          ...item,
          status: 'published',
          winner_id: outcome.winnerCandidate.id,
          publish_payload: outcome.payload,
          published_at: outcome.publishResult.delivered_at,
          external_post_id: outcome.publishResult.external_post_id,
          note_slug: outcome.note?.slug || null,
          note_source_path: outcome.note?.sourcePath || null,
        });
      } else if (outcome.status === 'skipped') {
        appendJsonl(paths.skippedLedger, {
          item_id: item.id,
          skipped_at: currentTime.toISOString(),
          reason: outcome.reason,
          conflicts: outcome.conflicts || [],
        });
        calendar = replaceCalendarItem(calendar, {
          ...item,
          status: 'skipped',
          skip_reason: outcome.reason,
        });
      }
    }
    if (!dryRun) saveCalendar(entry.filePath, calendar);
  }

  if (!dryRun) rebuildMemory({ strategy });

  updateRun(run, { results, dry_run: dryRun });
  printJson({ ok: true, run_id: run.id, dry_run: dryRun, results });
}

main().catch((error) => fail(error.stack || error.message));
