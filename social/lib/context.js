const path = require('path');
const { paths } = require('./paths');
const { readText, readJson, listFiles } = require('./fs');

function summarizeLines(text, limit = 12) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, limit);
}

function tokenize(value) {
  return new Set(String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 3));
}

function overlapScore(left, right) {
  const a = tokenize(left);
  const b = tokenize(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared += 1;
  }
  return shared / Math.max(a.size, b.size);
}

function rankSourceEvidence({ topicThesis, contextText, pullQuotes, contentType }) {
  const quoteEvidence = (pullQuotes || [])
    .map((quote, index) => ({
      id: `quote-${index + 1}`,
      source: quote.source,
      text: quote.quote,
      score: overlapScore(topicThesis, quote.quote),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

  const excerptEvidence = summarizeLines(contextText, 250)
    .map((line, index) => ({
      id: `context-${index + 1}`,
      source: 'dist/dionysus-program-context.txt',
      text: line,
      score: overlapScore(topicThesis, line),
    }))
    .filter((entry) => entry.text.length > 60)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

  const evidence = [...quoteEvidence, ...excerptEvidence]
    .sort((left, right) => right.score - left.score)
    .slice(0, contentType === 'extracted_insight' ? 4 : 3)
    .map(({ id, source, text, score }) => ({ id, source, text, score }));

  return evidence.length > 0
    ? evidence
    : (pullQuotes || []).slice(0, 2).map((quote, index) => ({
        id: `fallback-quote-${index + 1}`,
        source: quote.source,
        text: quote.quote,
        score: 0,
      }));
}

function deriveSourceEvidence({ topicThesis, contextText, pullQuotes, contentType }) {
  return rankSourceEvidence({ topicThesis, contextText, pullQuotes, contentType })
    .map(({ id, source, text }) => ({ id, source, text }));
}

function loadSourceContext() {
  const contextText = readText(paths.contextFile, '');
  const pullQuotes = readJson(paths.pullQuotesFile, []) || [];
  const archetypes = readJson(paths.archetypesFile, {}) || {};
  const letters = listFiles(paths.lettersDir, (filePath) => filePath.endsWith('.txt'));

  return {
    contextText,
    llmContextExcerpt: summarizeLines(contextText, 18),
    pullQuotes: pullQuotes.slice(0, 20),
    archetypeNames: Object.values(archetypes).map((entry) => entry.name).slice(0, 20),
    letters: letters.map((filePath) => path.basename(filePath, '.txt')).slice(0, 20),
  };
}

module.exports = {
  loadSourceContext,
  deriveSourceEvidence,
  rankSourceEvidence,
};
