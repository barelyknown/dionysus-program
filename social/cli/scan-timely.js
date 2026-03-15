#!/usr/bin/env node
const { parseArgs, printJson, fail } = require('../lib/cli');
const { loadStrategy, loadWatchlists } = require('../lib/config');
const { rebuildMemory } = require('../lib/memory');
const { loadCalendars, saveCalendar } = require('../lib/records');
const { selectTimelyCandidate, selectResearchTopic } = require('../lib/planner');
const { createRun, updateRun, createAdapters, saveResearchBundle } = require('../lib/pipeline');
const { buildResearchJob, findPendingJobForTopic, removeResearchJob, upsertResearchJob } = require('../lib/research-jobs');
const { loadSourceContext } = require('../lib/context');

function chooseTopic(strategy, memory, watchlists) {
  return selectResearchTopic({
    topics: strategy.topics || [],
    strategy,
    memory,
    context: loadSourceContext(),
    watchlists,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const strategy = loadStrategy();
  const watchlists = loadWatchlists();
  const dryRun = Boolean(args['dry-run']);
  const memory = rebuildMemory({ strategy, write: !dryRun });
  const adapters = createAdapters({ args, strategy });
  const topicThesis = args.topic || chooseTopic(strategy, memory, watchlists);
  if (!topicThesis) fail('No topic thesis available for timely scan.');

  const run = createRun('scan-timely', { args, topicThesis, mode: adapters.mode });
  let researchBundle = null;
  let pendingJob = null;

  if (adapters.mode === 'live' || adapters.mode === 'record') {
    const existingJob = findPendingJobForTopic(topicThesis);
    if (existingJob) {
      const latest = await adapters.gemini.pollResearchJob({ job: existingJob });
      if (latest.status === 'completed') {
        const completed = adapters.gemini.normalizeCompletedResearch({ job: existingJob, latest });
        const normalized = await adapters.scorer.normalizeResearchReport({
          topicThesis,
          rawReport: completed.summary,
          fallbackSources: completed.sources || [],
        });
        researchBundle = {
          ...completed,
          summary: normalized.summary,
          sources: normalized.sources,
          candidate_angles: normalized.candidate_angles,
        };
        if (!dryRun) {
          saveResearchBundle(researchBundle);
          removeResearchJob(existingJob.id);
        }
      } else {
        pendingJob = { ...existingJob, status: latest.status || existingJob.status };
        if (!dryRun) upsertResearchJob(pendingJob);
      }
    } else {
      const submitted = await adapters.gemini.submitResearchJob({ topicThesis, watchlists });
      pendingJob = buildResearchJob({ topicThesis, submitted, mode: adapters.mode });
      if (!dryRun) upsertResearchJob(pendingJob);
    }
  } else {
    researchBundle = await adapters.gemini.researchTopic({ topicThesis, watchlists });
    if (!dryRun) saveResearchBundle(researchBundle);
  }

  const timelyItem = researchBundle ? selectTimelyCandidate({ strategy, memory, researchBundle }) : null;
  let updated = false;
  if (timelyItem && !dryRun) {
    for (const calendarEntry of loadCalendars()) {
      const alreadyHasTimely = (calendarEntry.data.items || []).some((item) => item.slot_type === 'timely' && ['planned', 'published'].includes(item.status));
      if (alreadyHasTimely) continue;
      calendarEntry.data.items.push(timelyItem);
      calendarEntry.data.items.sort((left, right) => left.scheduled_at.localeCompare(right.scheduled_at));
      saveCalendar(calendarEntry.filePath, calendarEntry.data);
      updated = true;
      break;
    }
  }

  updateRun(run, {
    research_bundle_id: researchBundle?.id || null,
    timely_item: timelyItem,
    updated,
    pending_job: pendingJob,
  });
  printJson({
    ok: true,
    dry_run: dryRun,
    updated,
    pending_job: pendingJob,
    research_bundle: researchBundle,
    timely_item: timelyItem,
  });
}

main().catch((error) => fail(error.stack || error.message));
