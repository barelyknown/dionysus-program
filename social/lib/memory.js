const { readJsonl } = require('./jsonl');
const { writeJson } = require('./fs');
const { paths } = require('./paths');
const { now, dateDiffInDays } = require('./time');

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(value) {
  return new Set(normalizeText(value).split(' ').filter((token) => token.length > 2));
}

function overlapScore(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / Math.max(left.size, right.size);
}

function withinCooldown(publishedAt, cooldownDays, referenceDate = now()) {
  if (!publishedAt) return false;
  return dateDiffInDays(referenceDate, new Date(publishedAt)) <= cooldownDays;
}

function buildMemoryIndex({ publishedRecords, strategy, referenceDate = now() }) {
  const memoryConfig = strategy.memory || {};
  const recentHooks = [];
  const recentAngles = [];
  const recentTopics = [];
  const recentSubjects = [];
  const recentSources = [];
  const typeCounts = {};

  for (const record of publishedRecords) {
    typeCounts[record.content_type] = (typeCounts[record.content_type] || 0) + 1;
    if (withinCooldown(record.published_at, memoryConfig.hook_cooldown_days, referenceDate)) {
      recentHooks.push(record);
    }
    if (withinCooldown(record.published_at, memoryConfig.angle_cooldown_days, referenceDate)) {
      recentAngles.push(record);
    }
    if (withinCooldown(record.published_at, memoryConfig.topic_thesis_cooldown_days, referenceDate)) {
      recentTopics.push(record);
    }
    if (withinCooldown(record.published_at, memoryConfig.timely_subject_cooldown_days, referenceDate)) {
      recentSubjects.push(record);
    }
    if (withinCooldown(record.published_at, memoryConfig.source_reuse_cooldown_days, referenceDate)) {
      recentSources.push(record);
    }
  }

  return {
    generated_at: referenceDate.toISOString(),
    published_count: publishedRecords.length,
    rolling_window_days: memoryConfig.rolling_window_days,
    typeCounts,
    recent_hooks: recentHooks,
    recent_angles: recentAngles,
    recent_topics: recentTopics,
    recent_subjects: recentSubjects,
    recent_sources: recentSources,
  };
}

function loadPublishedRecords() {
  return readJsonl(paths.publishedLedger);
}

function rebuildMemory({ strategy, referenceDate = now(), write = true }) {
  const publishedRecords = loadPublishedRecords();
  const memory = buildMemoryIndex({ publishedRecords, strategy, referenceDate });
  if (write) writeJson(paths.postMemoryFile, memory);
  return memory;
}

function findDuplicate(record, candidates, field, threshold = 0.8) {
  const value = record[field];
  if (!value) return null;
  for (const candidate of candidates) {
    const candidateValue = candidate[field];
    if (!candidateValue) continue;
    const score = overlapScore(value, candidateValue);
    if (score >= threshold || normalizeText(value) === normalizeText(candidateValue)) {
      return { candidate, score };
    }
  }
  return null;
}

function getMemoryConflicts({ record, memory, strategy }) {
  const conflicts = [];
  if (findDuplicate(record, memory.recent_hooks || [], 'hook', 0.75)) conflicts.push('hook_duplication');
  if (findDuplicate(record, memory.recent_angles || [], 'angle', 0.72)) conflicts.push('angle_duplication');
  if (findDuplicate(record, memory.recent_topics || [], 'topic_thesis', 0.7)) conflicts.push('topic_duplication');
  if (record.timely_subject && findDuplicate(record, memory.recent_subjects || [], 'timely_subject', 0.7)) {
    conflicts.push('timely_subject_duplication');
  }
  const sourceRefs = Array.isArray(record.source_refs) ? record.source_refs : [];
  if (sourceRefs.length > 0) {
    const recentSourceUrls = new Set((memory.recent_sources || []).flatMap((entry) => entry.source_refs || []));
    if (sourceRefs.some((sourceRef) => recentSourceUrls.has(sourceRef))) conflicts.push('source_overuse');
  }

  const typeConfig = strategy.content_types?.[record.content_type] || {};
  const rollingMax = typeConfig.rolling_max;
  const currentCount = memory.typeCounts?.[record.content_type] || 0;
  if (Number.isFinite(rollingMax) && currentCount >= rollingMax) conflicts.push('type_overuse');

  return conflicts;
}

module.exports = {
  normalizeText,
  overlapScore,
  buildMemoryIndex,
  loadPublishedRecords,
  rebuildMemory,
  getMemoryConflicts,
};
