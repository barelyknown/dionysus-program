#!/usr/bin/env node
const { parseArgs, printJson, fail } = require('../lib/cli');
const { loadStrategy, loadWatchlists } = require('../lib/config');
const { loadSourceContext } = require('../lib/context');
const { rebuildMemory } = require('../lib/memory');
const { planBaselineWeek, calendarFileName } = require('../lib/planner');
const { readJson, writeJson } = require('../lib/fs');
const { createRun, updateRun } = require('../lib/pipeline');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const strategy = loadStrategy();
  const watchlists = loadWatchlists();
  const context = loadSourceContext();
  const dryRun = Boolean(args['dry-run']);
  const memory = rebuildMemory({ strategy, write: !dryRun });
  const calendar = planBaselineWeek({ strategy, memory, context, watchlists });
  const run = createRun('plan-week', { args, calendar_id: calendar.id });
  const filePath = calendarFileName({ calendarId: calendar.id });

  if (!dryRun) {
    const existing = readJson(filePath, null);
    if (existing && Array.isArray(existing.items)) {
      const preserved = existing.items.filter((item) => item.slot_type === 'timely' || ['published', 'skipped'].includes(item.status));
      calendar.items = [
        ...calendar.items.filter((item) => !preserved.some((entry) => entry.id === item.id)),
        ...preserved,
      ].sort((left, right) => left.scheduled_at.localeCompare(right.scheduled_at));
    }
    writeJson(filePath, calendar);
  }

  updateRun(run, { result: calendar, file_path: filePath });
  printJson({ ok: true, dry_run: dryRun, file_path: filePath, calendar });
}

main().catch((error) => fail(error.stack || error.message));
