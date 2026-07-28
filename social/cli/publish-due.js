#!/usr/bin/env node
const { parseArgs, printJson, fail } = require('../lib/cli');
const { loadCalendars, saveCalendar, replaceCalendarItem } = require('../lib/records');
const { appendJsonl } = require('../lib/jsonl');
const { paths } = require('../lib/paths');
const { writeJson } = require('../lib/fs');
const {
  isDue,
  baselineCadenceSkipReason,
  nextCalendarItemState,
} = require('../lib/publish-due-state');
const {
  createAdapters,
  createRun,
  updateRun,
  loadStrategy,
  loadFreshMemory,
  createPublishedRecord,
} = require('../lib/pipeline');
const {
  prepareItemPackage,
  preparedPackageStatus,
  deliverPreparedPackage,
} = require('../lib/publication-package');
const { rebuildMemory } = require('../lib/memory');
const { now } = require('../lib/time');

async function handleItem({ item, strategy, adapters, memory, dryRun }) {
  const prepared = await prepareItemPackage({ item, strategy, adapters, memory });
  if (prepared.status !== 'prepared') return prepared;
  if (dryRun) {
    return {
      ...prepared,
      status: 'dry_run',
    };
  }
  return deliverPreparedPackage({
    item: prepared.calendarItem,
    preparedPackage: prepared.prepared_package,
    strategy,
    adapters,
  });
}

function scheduledItemAgeHours(item, currentTime) {
  return (currentTime.getTime() - new Date(item.scheduled_at).getTime()) / (60 * 60 * 1000);
}

function requiresDeliveryAttention(result) {
  return result.status === 'deferred'
    || ['package_preparation_expired', 'delivery_failed', 'internal_preparation_error'].includes(result.reason)
    || result.x?.status === 'failed'
    || result.note?.status === 'failed';
}

async function handlePreparedScheduledItem({ item, strategy, adapters, memory, currentTime, dryRun = false }) {
  const packageStatus = preparedPackageStatus({ item, strategy, memory });
  if (!packageStatus.ready) {
    const graceHours = Math.max(1, Number(strategy.preparation?.delivery_grace_hours || 8));
    const expired = scheduledItemAgeHours(item, currentTime) > graceHours;
    return {
      calendarItem: item,
      status: expired ? 'skipped' : 'deferred',
      reason: expired ? 'package_preparation_expired' : packageStatus.reason,
      attempted_at: currentTime.toISOString(),
      details: packageStatus,
      conflicts: [],
    };
  }

  if (dryRun) {
    return {
      calendarItem: item,
      status: 'dry_run',
      payload: packageStatus.preparedPackage.payload,
      note_preflight: packageStatus.preparedPackage.prepared_note,
      x: packageStatus.preparedPackage.x_preflight,
      package_gate: packageStatus.preparedPackage.package_gate,
      conflicts: [],
    };
  }

  try {
    return await deliverPreparedPackage({
      item,
      preparedPackage: packageStatus.preparedPackage,
      strategy,
      adapters,
    });
  } catch (error) {
    return {
      calendarItem: item,
      status: 'skipped',
      reason: 'delivery_failed',
      attempted_at: currentTime.toISOString(),
      error: error.message,
      conflicts: [],
    };
  }
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
      let outcome;
      if (cadenceSkipReason) {
        outcome = {
          calendarItem: item,
          status: 'skipped',
          reason: cadenceSkipReason,
          conflicts: [],
        };
      } else {
        const memory = loadFreshMemory(strategy, { write: !dryRun });
        try {
          outcome = await handlePreparedScheduledItem({
            item,
            strategy,
            adapters,
            memory,
            currentTime,
            dryRun,
          });
        } catch (error) {
          outcome = {
            calendarItem: item,
            status: 'skipped',
            reason: 'internal_preparation_error',
            error: error.message,
            conflicts: [],
          };
        }
      }
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

  if (!dryRun && results.some((result) => result.status === 'published')) rebuildMemory({ strategy });

  const attentionRequired = results.filter(requiresDeliveryAttention);
  const ok = attentionRequired.length === 0;
  updateRun(run, { results, dry_run: dryRun, ok, attention_required: attentionRequired });
  printJson({ ok, run_id: run.id, dry_run: dryRun, results, attention_required: attentionRequired });
}

if (require.main === module) {
  main().catch((error) => fail(error.stack || error.message));
}

module.exports = {
  isDue,
  baselineCadenceSkipReason,
  nextCalendarItemState,
  handleItem,
  handlePreparedScheduledItem,
  requiresDeliveryAttention,
  main,
};
