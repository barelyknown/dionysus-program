#!/usr/bin/env node
const { printJson, fail } = require('../lib/cli');
const { loadStrategy, loadWatchlists } = require('../lib/config');
const { loadCalendars } = require('../lib/records');
const { readJsonl } = require('../lib/jsonl');
const { paths } = require('../lib/paths');
const { validateCalendarItem, validatePublishedRecord, validateMailbagItem } = require('../lib/validation');
const { readJson } = require('../lib/fs');

async function main() {
  const strategy = loadStrategy();
  const watchlists = loadWatchlists();
  const calendars = loadCalendars();
  const published = readJsonl(paths.publishedLedger);
  const mailbag = readJsonl(paths.mailbagLedger);
  const memory = readJson(paths.postMemoryFile, {});
  const researchJobs = readJson(paths.researchJobsFile, { jobs: [] });

  calendars.forEach((calendar) => (calendar.data.items || []).forEach(validateCalendarItem));
  published.forEach(validatePublishedRecord);
  mailbag.forEach(validateMailbagItem);
  if (!strategy.content_types) fail('Strategy missing content_types.');
  if (!watchlists.seed_topics) fail('Watchlists missing seed_topics.');

  printJson({
    ok: true,
    calendars: calendars.length,
    published: published.length,
    mailbag: mailbag.length,
    research_jobs: (researchJobs.jobs || []).length,
    memory_generated_at: memory.generated_at || null,
  });
}

main().catch((error) => fail(error.stack || error.message));
