#!/usr/bin/env node
const { parseArgs, printJson, fail } = require('../lib/cli');
const { findCalendarItem } = require('../lib/records');
const { createAdapters, createRun, updateRun, loadStrategy, generateCandidatesForItem, ResearchPendingError } = require('../lib/pipeline');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.item) fail('Usage: generate-candidates --item <id>');
  const found = findCalendarItem(args.item);
  if (!found) fail(`Calendar item not found: ${args.item}`);
  const strategy = loadStrategy();
  const adapters = createAdapters({ args, strategy });
  const run = createRun('generate-candidates', { args, item_id: found.item.id, mode: adapters.mode });
  const result = await generateCandidatesForItem({ calendarItem: found.item, strategy, adapters });
  updateRun(run, { result });
  printJson({ ok: true, run_id: run.id, item_id: found.item.id, candidates: result.candidates });
}

main().catch((error) => {
  if (error instanceof ResearchPendingError) {
    printJson({
      ok: true,
      pending: true,
      reason: 'research_pending',
      ...error.details,
    });
    return;
  }
  fail(error.stack || error.message);
});
