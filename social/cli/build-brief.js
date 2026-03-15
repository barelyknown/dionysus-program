#!/usr/bin/env node
const { parseArgs, printJson, fail } = require('../lib/cli');
const { loadStrategy } = require('../lib/config');
const { findCalendarItem } = require('../lib/records');
const { prepareBrief } = require('../lib/pipeline');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.item) fail('Usage: build-brief --item <id>');
  const found = findCalendarItem(args.item);
  if (!found) fail(`Calendar item not found: ${args.item}`);
  const strategy = loadStrategy();
  const prepared = prepareBrief({ calendarItem: found.item, strategy });
  printJson({
    ok: true,
    item_id: found.item.id,
    brief: prepared.brief,
    research_bundle: prepared.researchBundle,
  });
}

main().catch((error) => fail(error.stack || error.message));

