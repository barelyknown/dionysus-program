const { addDays, now } = require('./time');

function getResearchRecencyPolicy({ watchlists = {}, referenceDate = now() } = {}) {
  const recentWindowDays = Math.max(1, Number(watchlists?.research?.recent_window_days || 30));
  const minRecentSources = Math.max(1, Number(watchlists?.research?.min_recent_sources || 1));
  const cutoffDate = addDays(referenceDate, -recentWindowDays).toISOString().slice(0, 10);
  return {
    recent_window_days: recentWindowDays,
    min_recent_sources: minRecentSources,
    reference_date: referenceDate.toISOString().slice(0, 10),
    cutoff_date: cutoffDate,
  };
}

function getResearchDiscoveryMode({ watchlists = {} } = {}) {
  const configured = String(watchlists?.research?.discovery_mode || 'thesis_first').trim().toLowerCase();
  return configured === 'article_first' ? 'article_first' : 'thesis_first';
}

function parsePublishedAt(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  const fallback = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function isSourceRecent(source, policy) {
  const publishedAt = parsePublishedAt(source?.published_at);
  if (!publishedAt) return false;
  return publishedAt >= new Date(`${policy.cutoff_date}T00:00:00Z`);
}

function countRecentSources(sources, policy) {
  return (Array.isArray(sources) ? sources : []).filter((source) => isSourceRecent(source, policy)).length;
}

function researchBundleMeetsRecencyPolicy(bundle, policy) {
  return countRecentSources(bundle?.sources || [], policy) >= policy.min_recent_sources;
}

module.exports = {
  getResearchRecencyPolicy,
  getResearchDiscoveryMode,
  parsePublishedAt,
  isSourceRecent,
  countRecentSources,
  researchBundleMeetsRecencyPolicy,
};
