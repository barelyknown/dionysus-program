#!/usr/bin/env node
const { parseArgs, printJson, fail } = require('../lib/cli');
const { loadCalendars, saveCalendar, replaceCalendarItem } = require('../lib/records');
const {
  createAdapters,
  createRun,
  updateRun,
  loadStrategy,
  loadFreshMemory,
} = require('../lib/pipeline');
const { prepareItemPackage, preparedPackageStatus } = require('../lib/publication-package');
const { buildFallbackCandidates, preparationWindowStatus } = require('../lib/preparation');
const { now } = require('../lib/time');

function summarizeAttempt({ candidate, outcome = null, error = null }) {
  return {
    content_type: candidate.content_type,
    seed_topic_thesis: candidate.seed_topic_thesis || candidate.topic_thesis,
    status: outcome?.status || 'failed',
    reason: outcome?.reason || (error ? 'unexpected_error' : null),
    error: error?.message || outcome?.error || null,
    details: outcome?.details || outcome?.idea_gate || null,
  };
}

function readyCalendarItem({ outcome, attempts }) {
  return {
    ...outcome.calendarItem,
    status: 'planned',
    skip_reason: null,
    preparation: {
      status: 'ready',
      prepared_at: outcome.prepared_at,
      history_fingerprint: outcome.history_fingerprint,
      attempts,
      package: outcome.prepared_package,
    },
  };
}

function failedCalendarItem({ item, attempts, currentTime, researchBundle = null }) {
  return {
    ...item,
    preparation: {
      status: 'failed',
      attempted_at: currentTime.toISOString(),
      retry_count: Number(item.preparation?.retry_count || 0) + 1,
      attempts,
      research_bundle: researchBundle,
      package: null,
    },
  };
}

function preparationFailures(results, { requireItem = false } = {}) {
  const failures = results.filter((result) => result.status === 'failed');
  const readyCount = results.filter((result) => ['ready', 'already_ready'].includes(result.status)).length;
  if (requireItem && readyCount === 0) {
    failures.push({
      status: 'failed',
      reason: 'no_upcoming_item',
      error: 'No planned item was available inside the preparation horizon.',
    });
  }
  return failures;
}

async function prepareCalendarItem({ item, strategy, adapters, memory, currentTime }) {
  const currentStatus = preparedPackageStatus({ item, strategy, memory });
  if (currentStatus.ready) {
    return {
      calendarItem: item,
      status: 'already_ready',
      attempts: [],
      package_gate: currentStatus.preparedPackage.package_gate,
    };
  }

  const existingResearchBundle = item.preparation?.package?.research_bundle
    || item.preparation?.research_bundle
    || null;
  const fallbackLimit = Math.max(0, Number(strategy.preparation?.fallback_attempts ?? 3));
  const candidates = [
    { ...item, preparation: null },
    ...(fallbackLimit > 0 ? buildFallbackCandidates({ item, strategy, memory, limit: fallbackLimit }) : []),
  ];
  const attempts = [];
  let retainedResearchBundle = existingResearchBundle;

  for (const [index, candidate] of candidates.entries()) {
    try {
      const outcome = await prepareItemPackage({
        item: candidate,
        strategy,
        adapters,
        memory,
        researchBundle: index === 0 ? existingResearchBundle : null,
      });
      attempts.push(summarizeAttempt({ candidate, outcome }));
      if (index === 0 && outcome.research_bundle) retainedResearchBundle = outcome.research_bundle;
      if (outcome.status === 'prepared') {
        return {
          calendarItem: readyCalendarItem({ outcome, attempts }),
          status: 'ready',
          attempts,
          used_fallback: index > 0,
          package_gate: outcome.package_gate,
        };
      }
    } catch (error) {
      attempts.push(summarizeAttempt({ candidate, error }));
    }
  }

  return {
    calendarItem: failedCalendarItem({ item, attempts, currentTime, researchBundle: retainedResearchBundle }),
    status: 'failed',
    reason: attempts[attempts.length - 1]?.reason || 'no_prepared_package',
    attempts,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const strategy = loadStrategy();
  const adapters = createAdapters({ args, strategy });
  const dryRun = Boolean(args['dry-run']);
  const currentTime = args.now ? new Date(args.now) : now();
  const horizonHours = Math.max(1, Number(args['horizon-hours'] || strategy.preparation?.horizon_hours || 36));
  const overdueGraceHours = Math.max(0, Number(strategy.preparation?.delivery_grace_hours || 8));
  const memory = loadFreshMemory(strategy, { referenceDate: currentTime, write: false });
  const run = createRun('prepare-upcoming', {
    args,
    mode: adapters.mode,
    current_time: currentTime.toISOString(),
    horizon_hours: horizonHours,
  });
  const results = [];

  for (const entry of loadCalendars()) {
    let calendar = entry.data;
    const items = [...(calendar.items || [])].sort((left, right) => left.scheduled_at.localeCompare(right.scheduled_at));
    for (const item of items) {
      const window = preparationWindowStatus({ item, currentTime, horizonHours, overdueGraceHours });
      if (!window.eligible) continue;
      const outcome = await prepareCalendarItem({ item, strategy, adapters, memory, currentTime });
      results.push({
        item_id: item.id,
        scheduled_at: item.scheduled_at,
        status: outcome.status,
        reason: outcome.reason || null,
        used_fallback: Boolean(outcome.used_fallback),
        package_gate: outcome.package_gate || null,
        attempts: outcome.attempts,
      });
      calendar = replaceCalendarItem(calendar, outcome.calendarItem);
    }
    if (!dryRun) saveCalendar(entry.filePath, calendar);
  }

  const failures = preparationFailures(results, { requireItem: Boolean(args['require-item']) });
  const ok = failures.length === 0;
  updateRun(run, { ok, dry_run: dryRun, results, failures });
  printJson({ ok, run_id: run.id, dry_run: dryRun, results, failures });
}

if (require.main === module) {
  main().catch((error) => fail(error.stack || error.message));
}

module.exports = {
  summarizeAttempt,
  readyCalendarItem,
  failedCalendarItem,
  preparationFailures,
  prepareCalendarItem,
  main,
};
