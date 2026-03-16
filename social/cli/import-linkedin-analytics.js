#!/usr/bin/env node
const { parseArgs, printJson, fail } = require('../lib/cli');
const { fileExists } = require('../lib/fs');
const { importWorkbook } = require('../lib/linkedin-analytics');

function requiredInput(args) {
  const inputPath = args.input || args.file;
  if (!inputPath) fail('Missing --input <path-to-linkedin-workbook.xlsx>.');
  if (!fileExists(inputPath)) fail(`Input file not found: ${inputPath}`);
  return inputPath;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const inputPath = requiredInput(args);
  const result = importWorkbook({
    inputPath,
    deleteInput: Boolean(args['delete-input']),
  });
  printJson({
    ok: true,
    input: inputPath,
    input_deleted: Boolean(args['delete-input']),
    imported_at: result.dataset.imported_at,
    output: result.output,
    ranked_post_count: result.dataset.ranked_post_count,
    published_record_count: result.dataset.published_record_count,
    matched_record_count: result.dataset.matched_record_count,
    unmatched_record_count: result.dataset.unmatched_record_count,
  });
}

if (require.main === module) {
  main().catch((error) => fail(error.stack || error.message));
}

module.exports = {
  main,
};
