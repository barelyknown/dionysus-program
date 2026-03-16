const fs = require('fs');
const os = require('os');
const path = require('path');

const { paths } = require('../lib/paths');
const { writeText, writeJson } = require('../lib/fs');

function setupTempSocialWorkspace(t) {
  const original = { ...paths };
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dionysus-social-'));
  const tempSocial = path.join(tempRoot, 'social');
  const tempDist = path.join(tempRoot, 'dist');
  const tempLetters = path.join(tempRoot, 'letters_to_editor');
  const tempNotes = path.join(tempRoot, 'content', 'notes');

  fs.mkdirSync(path.join(tempSocial, 'config'), { recursive: true });
  fs.mkdirSync(path.join(tempSocial, 'history'), { recursive: true });
  fs.mkdirSync(path.join(tempSocial, 'state'), { recursive: true });
  fs.mkdirSync(path.join(tempSocial, 'calendar'), { recursive: true });
  fs.mkdirSync(path.join(tempSocial, 'runs'), { recursive: true });
  fs.mkdirSync(path.join(tempSocial, 'cache', 'research'), { recursive: true });
  fs.mkdirSync(tempDist, { recursive: true });
  fs.mkdirSync(tempLetters, { recursive: true });
  fs.mkdirSync(tempNotes, { recursive: true });

  Object.assign(paths, {
    repoRoot: tempRoot,
    socialRoot: tempSocial,
    strategyConfig: path.join(tempSocial, 'config', 'strategy.yaml'),
    watchlistsConfig: path.join(tempSocial, 'config', 'watchlists.yaml'),
    calendarDir: path.join(tempSocial, 'calendar'),
    historyDir: path.join(tempSocial, 'history'),
    stateDir: path.join(tempSocial, 'state'),
    runsDir: path.join(tempSocial, 'runs'),
    researchCacheDir: path.join(tempSocial, 'cache', 'research'),
    postMemoryFile: path.join(tempSocial, 'state', 'post-memory.json'),
    publishedLedger: path.join(tempSocial, 'history', 'published.jsonl'),
    skippedLedger: path.join(tempSocial, 'history', 'skipped.jsonl'),
    mailbagLedger: path.join(tempSocial, 'history', 'mailbag.jsonl'),
    contextFile: path.join(tempDist, 'dionysus-program-context.txt'),
    essayFile: path.join(tempRoot, 'essay.md'),
    pullQuotesFile: path.join(tempRoot, 'pull-quotes.json'),
    archetypesFile: path.join(tempRoot, 'archetypes.json'),
    lettersDir: tempLetters,
    notesContentDir: tempNotes,
  });

  const strategyText = fs.readFileSync(original.strategyConfig, 'utf8');
  const watchlistsText = fs.readFileSync(original.watchlistsConfig, 'utf8');
  writeText(paths.strategyConfig, strategyText);
  writeText(paths.watchlistsConfig, watchlistsText);
  writeText(paths.contextFile, 'Trust, ritual time, run time, and organizational change.\n');
  writeText(paths.essayFile, '# Essay\n');
  writeJson(paths.pullQuotesFile, [{ quote: 'Trust burns faster than it builds.', author: 'Sean Devine', source: 'essay.md' }]);
  writeJson(paths.archetypesFile, { MANAGEMENT_THEATER: { name: 'Management Theater' } });
  writeText(path.join(paths.lettersDir, 'confucius.txt'), 'A ritual without humaneness becomes empty.\n');
  writeText(paths.publishedLedger, '');
  writeText(paths.skippedLedger, '');
  writeText(paths.mailbagLedger, '');
  writeJson(paths.postMemoryFile, {
    generated_at: null,
    published_count: 0,
    rolling_window_days: 84,
    typeCounts: {},
    recent_hooks: [],
    recent_angles: [],
    recent_topics: [],
    recent_subjects: [],
    recent_sources: [],
  });

  t.after(() => {
    Object.assign(paths, original);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  return { tempRoot, tempSocial };
}

function appendJsonl(filePath, entries) {
  const lines = entries.map((entry) => JSON.stringify(entry)).join('\n');
  writeText(filePath, lines ? `${lines}\n` : '');
}

module.exports = {
  setupTempSocialWorkspace,
  appendJsonl,
};
