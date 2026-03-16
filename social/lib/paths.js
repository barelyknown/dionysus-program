const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const socialRoot = path.join(repoRoot, 'social');

const paths = {
  repoRoot,
  socialRoot,
  strategyConfig: path.join(socialRoot, 'config', 'strategy.yaml'),
  watchlistsConfig: path.join(socialRoot, 'config', 'watchlists.yaml'),
  calendarDir: path.join(socialRoot, 'calendar'),
  historyDir: path.join(socialRoot, 'history'),
  stateDir: path.join(socialRoot, 'state'),
  runsDir: path.join(socialRoot, 'runs'),
  researchCacheDir: path.join(socialRoot, 'cache', 'research'),
  postMemoryFile: path.join(socialRoot, 'state', 'post-memory.json'),
  researchJobsFile: path.join(socialRoot, 'state', 'research-jobs.json'),
  publishedLedger: path.join(socialRoot, 'history', 'published.jsonl'),
  skippedLedger: path.join(socialRoot, 'history', 'skipped.jsonl'),
  mailbagLedger: path.join(socialRoot, 'history', 'mailbag.jsonl'),
  contextFile: path.join(repoRoot, 'dist', 'dionysus-program-context.txt'),
  essayFile: path.join(repoRoot, 'essay.md'),
  pullQuotesFile: path.join(repoRoot, 'pull-quotes.json'),
  archetypesFile: path.join(repoRoot, 'archetypes.json'),
  lettersDir: path.join(repoRoot, 'letters_to_editor'),
  notesContentDir: path.join(repoRoot, 'content', 'notes'),
};

module.exports = { paths };
