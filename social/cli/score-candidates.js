#!/usr/bin/env node
const { parseArgs, printJson, fail } = require('../lib/cli');
const { findCalendarItem } = require('../lib/records');
const { createAdapters, createRun, updateRun, loadStrategy, scoreCandidatesForItem, loadFreshMemory } = require('../lib/pipeline');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.item) fail('Usage: score-candidates --item <id>');
  const found = findCalendarItem(args.item);
  if (!found) fail(`Calendar item not found: ${args.item}`);
  const strategy = loadStrategy();
  const adapters = createAdapters({ args, strategy });
  const memory = loadFreshMemory(strategy);
  const run = createRun('score-candidates', { args, item_id: found.item.id, mode: adapters.mode });
  const result = await scoreCandidatesForItem({ calendarItem: found.item, strategy, adapters, memory });
  updateRun(run, { result });
  printJson({
    ok: true,
    run_id: run.id,
    item_id: found.item.id,
    scorecards: result.scorecards,
    winner: result.winnerCandidate,
    winner_score: result.winnerScore,
  });
}

main().catch((error) => fail(error.stack || error.message));

