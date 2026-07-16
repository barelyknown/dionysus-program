const path = require('path');
const { readJsonl } = require('./jsonl');
const { fileExists, readText, writeJson } = require('./fs');
const { paths } = require('./paths');
const { now, dateDiffInDays } = require('./time');
const { loadWatchlists } = require('./config');
const { parseMarkdownWithFrontmatter } = require('../../lib/notes');

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

function uniqueStrings(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(String(value).trim());
  }
  return result;
}

function companyEntityMatches(text, companies = []) {
  const haystack = ` ${normalizeText(text)} `;
  if (!haystack.trim()) return [];
  return companies.filter((company) => {
    const normalizedCompany = normalizeText(company);
    return normalizedCompany && haystack.includes(` ${normalizedCompany} `);
  });
}

function deriveSubjectEntities(record = {}, watchlists = loadWatchlists()) {
  const explicit = uniqueStrings(Array.isArray(record.subject_entities) ? record.subject_entities : []);
  if (explicit.length > 0) return explicit;

  const companies = Array.isArray(watchlists?.entities?.companies) ? watchlists.entities.companies : [];
  const texts = [
    record.timely_subject,
    record.hook,
    record.summary,
  ];

  return uniqueStrings(texts.flatMap((text) => companyEntityMatches(text, companies)));
}

function hasEntityConflict(recordEntities = [], recentEntities = []) {
  const recent = new Set(
    (Array.isArray(recentEntities) ? recentEntities : [])
      .flatMap((entry) => deriveSubjectEntities(entry))
      .map((entity) => normalizeText(entity))
      .filter(Boolean),
  );

  return deriveSubjectEntities({ subject_entities: recordEntities })
    .map((entity) => normalizeText(entity))
    .some((entity) => recent.has(entity));
}

function publishedContentText(record = {}) {
  const preservedText = String(record.publication_memory_text || '').trim();
  if (preservedText) return preservedText;

  const relativePath = String(record.note_source_path || '').trim();
  if (relativePath) {
    const resolvedPath = path.resolve(paths.repoRoot, relativePath);
    const repoPrefix = `${path.resolve(paths.repoRoot)}${path.sep}`;
    if (resolvedPath.startsWith(repoPrefix) && fileExists(resolvedPath)) {
      try {
        const note = parseMarkdownWithFrontmatter(readText(resolvedPath));
        if (note.body) return note.body;
      } catch {
        // Fall back to the ledger summary when an old note cannot be parsed.
      }
    }
  }
  return String(record.summary || '').trim();
}

function buildMemoryIndex({ publishedRecords, strategy, referenceDate = now() }) {
  const memoryConfig = strategy.memory || {};
  const xConfig = strategy.x || {};
  const recentHooks = [];
  const recentAngles = [];
  const recentTopics = [];
  const recentSubjects = [];
  const recentSources = [];
  const recentEntities = [];
  const recentContent = [];
  const recentXPosts = [];
  const typeCounts = {};
  let rollingPublishedCount = 0;

  for (const record of publishedRecords) {
    if (withinCooldown(record.published_at, memoryConfig.rolling_window_days, referenceDate)) {
      typeCounts[record.content_type] = (typeCounts[record.content_type] || 0) + 1;
      rollingPublishedCount += 1;
    }
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
    if (withinCooldown(
      record.published_at,
      memoryConfig.entity_cooldown_days || memoryConfig.timely_subject_cooldown_days,
      referenceDate,
    )) {
      const subjectEntities = deriveSubjectEntities(record);
      if (subjectEntities.length > 0) recentEntities.push({ ...record, subject_entities: subjectEntities });
    }
    if (record.summary) {
      recentContent.push({
        post_id: record.post_id || null,
        published_at: record.published_at || null,
        content_type: record.content_type || null,
        topic_thesis: record.topic_thesis || null,
        hook: record.hook || null,
        summary: record.summary,
        text: publishedContentText(record),
        x_summary: record.x_status === 'published' ? record.x_summary || null : null,
      });
    }
    if (
      record.x_status === 'published'
      && record.x_summary
    ) {
      recentXPosts.push(record);
    }
  }

  const contentHistoryLimit = Math.max(1, Number(memoryConfig.content_history_limit || 1000));
  const xHistoryLimit = Math.max(1, Number(xConfig.history_limit || 1000));

  return {
    generated_at: referenceDate.toISOString(),
    published_count: publishedRecords.length,
    site_published_count: publishedRecords.filter((record) => record.site_status !== 'removed_redundant').length,
    site_removed_count: publishedRecords.filter((record) => record.site_status === 'removed_redundant').length,
    rolling_published_count: rollingPublishedCount,
    rolling_window_days: memoryConfig.rolling_window_days,
    typeCounts,
    recent_hooks: recentHooks,
    recent_angles: recentAngles,
    recent_topics: recentTopics,
    recent_subjects: recentSubjects,
    recent_sources: recentSources,
    recent_entities: recentEntities,
    recent_content: recentContent.slice(-contentHistoryLimit),
    recent_x_posts: recentXPosts.slice(-xHistoryLimit),
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

function findContentDuplicate(text, candidates = [], threshold = 0.72) {
  const value = String(text || '').trim();
  if (!value) return null;
  for (const candidate of candidates) {
    const candidateValues = [
      candidate?.text,
      candidate?.summary,
      candidate?.x_summary,
      candidate?.topic_thesis,
      candidate?.hook,
    ].filter(Boolean);
    for (const candidateValue of candidateValues) {
      const score = overlapScore(value, candidateValue);
      if (score >= threshold || normalizeText(value) === normalizeText(candidateValue)) {
        return { candidate, candidate_value: candidateValue, score };
      }
    }
  }
  return null;
}

function buildArgumentHistory(memory = {}, limit = 1000) {
  const byPostId = new Map();
  const content = Array.isArray(memory.recent_content) ? memory.recent_content : [];
  const xPosts = Array.isArray(memory.recent_x_posts) ? memory.recent_x_posts : [];

  for (const entry of content) {
    const key = String(entry.post_id || `${entry.published_at || ''}:${entry.topic_thesis || ''}`);
    byPostId.set(key, {
      post_id: entry.post_id || null,
      published_at: entry.published_at || null,
      content_type: entry.content_type || null,
      topic_thesis: entry.topic_thesis || null,
      hook: entry.hook || null,
      linkedin_text: entry.text || entry.summary || null,
      x_text: entry.x_summary || null,
    });
  }

  for (const entry of xPosts) {
    const key = String(entry.post_id || `${entry.published_at || ''}:${entry.topic_thesis || ''}`);
    const existing = byPostId.get(key) || {
      post_id: entry.post_id || null,
      published_at: entry.published_at || null,
      content_type: entry.content_type || null,
      topic_thesis: entry.topic_thesis || null,
      hook: entry.hook || null,
      linkedin_text: entry.summary || null,
      x_text: null,
    };
    existing.x_text = entry.x_summary || existing.x_text;
    byPostId.set(key, existing);
  }

  return [...byPostId.values()]
    .sort((left, right) => String(left.published_at || '').localeCompare(String(right.published_at || '')))
    .slice(-Math.max(1, Number(limit || 1000)));
}

function getMemoryConflicts({ record, memory, strategy }) {
  const conflicts = [];
  if (findDuplicate(record, memory.recent_hooks || [], 'hook', 0.75)) conflicts.push('hook_duplication');
  if (findDuplicate(record, memory.recent_angles || [], 'angle', 0.72)) conflicts.push('angle_duplication');
  if (findDuplicate(record, memory.recent_topics || [], 'topic_thesis', 0.7)) conflicts.push('topic_duplication');
  if (record.timely_subject && findDuplicate(record, memory.recent_subjects || [], 'timely_subject', 0.7)) {
    conflicts.push('timely_subject_duplication');
  }
  if (record.summary) {
    const contentDuplicate = findContentDuplicate(
      record.summary,
      memory.recent_content || [],
      Number(strategy?.memory?.content_similarity_threshold || 0.72),
    );
    if (contentDuplicate) conflicts.push('content_duplication');
  }
  const sourceRefs = Array.isArray(record.source_refs) ? record.source_refs : [];
  if (sourceRefs.length > 0) {
    const recentSourceUrls = new Set((memory.recent_sources || []).flatMap((entry) => entry.source_refs || []));
    if (sourceRefs.some((sourceRef) => recentSourceUrls.has(sourceRef))) conflicts.push('source_overuse');
  }
  const subjectEntities = deriveSubjectEntities(record);
  if (subjectEntities.length > 0 && hasEntityConflict(subjectEntities, memory.recent_entities || [])) {
    conflicts.push('entity_duplication');
  }

  const typeConfig = strategy.content_types?.[record.content_type] || {};
  const rollingMax = typeConfig.rolling_max;
  const currentCount = memory.typeCounts?.[record.content_type] || 0;
  if (Number.isFinite(rollingMax) && currentCount >= rollingMax) conflicts.push('type_overuse');

  return conflicts;
}

function findXDuplicate(text, recentPosts = [], threshold = 0.72) {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  for (const candidate of recentPosts) {
    const candidateText = candidate?.x_summary || candidate?.text || '';
    const candidateNormalized = normalizeText(candidateText);
    if (!candidateNormalized) continue;
    if (normalized === candidateNormalized) {
      return { candidate, score: 1, reason: 'x_exact_duplicate' };
    }

    const score = overlapScore(normalized, candidateNormalized);
    if (score >= threshold) {
      return { candidate, score, reason: 'x_near_duplicate' };
    }
  }

  return null;
}

function getXMemoryConflict({ text, memory, strategy }) {
  return findXDuplicate(
    text,
    memory?.recent_x_posts || [],
    Number(strategy?.x?.near_duplicate_threshold || 0.72),
  );
}

module.exports = {
  normalizeText,
  overlapScore,
  publishedContentText,
  deriveSubjectEntities,
  buildMemoryIndex,
  loadPublishedRecords,
  rebuildMemory,
  getMemoryConflicts,
  findContentDuplicate,
  buildArgumentHistory,
  findXDuplicate,
  getXMemoryConflict,
};
