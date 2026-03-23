#!/usr/bin/env node
const { parseArgs, printJson, fail } = require('../lib/cli');
const { loadStrategy, loadWatchlists } = require('../lib/config');
const { rebuildMemory } = require('../lib/memory');
const { loadCalendars, saveCalendar } = require('../lib/records');
const { selectTimelyCandidate, selectResearchTopic } = require('../lib/planner');
const { createRun, updateRun, createAdapters, saveResearchBundle } = require('../lib/pipeline');
const { buildResearchJob, findPendingJob, findPendingJobForTopic, removeResearchJob, upsertResearchJob } = require('../lib/research-jobs');
const { loadSourceContext } = require('../lib/context');
const { getResearchDiscoveryMode } = require('../lib/research-policy');

function chooseTopic(strategy, memory, watchlists) {
  return selectResearchTopic({
    topics: strategy.topics || [],
    strategy,
    memory,
    context: loadSourceContext(),
    watchlists,
  });
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const strategy = loadStrategy();
  const timelySlots = strategy.publishing?.timely_slots || [];
  const dryRun = Boolean(args['dry-run']);

  if (timelySlots.length === 0) {
    const result = {
      ok: true,
      dry_run: dryRun,
      updated: false,
      skipped: true,
      reason: 'no_timely_slots_configured',
      research_bundle: null,
      timely_item: null,
      pending_job: null,
    };
    printJson(result);
    return result;
  }

  const watchlists = loadWatchlists();
  const memory = rebuildMemory({ strategy, write: !dryRun });
  const adapters = createAdapters({ args, strategy });
  const discoveryMode = getResearchDiscoveryMode({ watchlists });
  const supportsArticleFirst = (adapters.mode === 'live' || adapters.mode === 'record')
    ? typeof adapters?.gemini?.submitDiscoveryJob === 'function'
    : typeof adapters?.gemini?.discoverNews === 'function';
  const useArticleFirst = discoveryMode === 'article_first' && supportsArticleFirst;
  const topicOptions = Array.isArray(strategy.topics) ? strategy.topics : [];
  const topicThesis = useArticleFirst ? null : (args.topic || chooseTopic(strategy, memory, watchlists));
  const jobKey = useArticleFirst ? 'timely-discovery' : topicThesis;
  if (!useArticleFirst && !topicThesis) fail('No topic thesis available for timely scan.');

  const run = createRun('scan-timely', { args, topicThesis, mode: adapters.mode, discovery_mode: discoveryMode });
  let researchBundle = null;
  let pendingJob = null;

  if (adapters.mode === 'live' || adapters.mode === 'record') {
    const existingJob = useArticleFirst ? findPendingJob(jobKey) : findPendingJobForTopic(topicThesis);
    if (existingJob) {
      const latest = await adapters.gemini.pollResearchJob({ job: existingJob });
      if (latest.status === 'completed') {
        const completed = adapters.gemini.normalizeCompletedResearch({ job: existingJob, latest });
        const normalized = await adapters.scorer.normalizeResearchReport({
          topicThesis: useArticleFirst ? null : topicThesis,
          topicOptions: useArticleFirst ? topicOptions : [],
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
      const submitted = useArticleFirst
        ? await adapters.gemini.submitDiscoveryJob({
          watchlists,
          topicOptions,
          requestedTopic: args.topic || null,
          jobKey,
        })
        : await adapters.gemini.submitResearchJob({ topicThesis, watchlists });
      pendingJob = buildResearchJob({
        topicThesis: topicThesis || args.topic || null,
        jobKey,
        submitted,
        mode: adapters.mode,
      });
      if (!dryRun) upsertResearchJob(pendingJob);
    }
  } else {
    researchBundle = useArticleFirst
      ? await adapters.gemini.discoverNews({
        watchlists,
        topicOptions,
        requestedTopic: args.topic || null,
        jobKey,
      })
      : await adapters.gemini.researchTopic({ topicThesis, watchlists });
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
  const result = {
    ok: true,
    dry_run: dryRun,
    updated,
    pending_job: pendingJob,
    research_bundle: researchBundle,
    timely_item: timelyItem,
  };
  printJson(result);
  return result;
}

if (require.main === module) {
  main().catch((error) => fail(error.stack || error.message));
}

module.exports = {
  main,
};
