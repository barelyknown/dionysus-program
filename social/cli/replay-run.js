#!/usr/bin/env node
const { parseArgs, printJson, fail } = require('../lib/cli');
const { readJson } = require('../lib/fs');
const { runFilePath } = require('../lib/records');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['run-id']) fail('Usage: replay-run --run-id <id>');
  const run = readJson(runFilePath(args['run-id']), null);
  if (!run) fail(`Run not found: ${args['run-id']}`);
  printJson({ ok: true, run });
}

main().catch((error) => fail(error.stack || error.message));

