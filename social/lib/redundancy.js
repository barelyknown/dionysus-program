const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { readJsonl } = require('./jsonl');
const { fileExists, readText, writeText } = require('./fs');
const { paths } = require('./paths');
const { normalizeText, overlapScore, publishedContentText } = require('./memory');
const { sha256 } = require('./hash');
const { parseMarkdownWithFrontmatter } = require('../../lib/notes');

function parseJsonlText(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function safeNotePath(value) {
  const notePath = String(value || '').trim().replace(/\\/g, '/');
  if (!notePath.startsWith('content/notes/') || notePath.includes('..')) return null;
  return notePath;
}

function gitShow(ref, repoPath) {
  return execFileSync('git', ['show', `${ref}:${repoPath}`], {
    cwd: paths.repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function noteBodyAtRef(ref, record) {
  if (record.publication_memory_text) return String(record.publication_memory_text);
  const notePath = safeNotePath(record.note_source_path);
  if (!notePath) return String(record.summary || '');
  try {
    return parseMarkdownWithFrontmatter(gitShow(ref, notePath)).body || String(record.summary || '');
  } catch {
    return String(record.summary || '');
  }
}

function loadPublishedRecordsForAudit({ ref = null } = {}) {
  if (!ref) {
    return readJsonl(paths.publishedLedger)
      .filter((record) => record.site_status !== 'removed_redundant')
      .map((record) => ({
        ...record,
        content_text: publishedContentText(record),
      }));
  }

  return parseJsonlText(gitShow(ref, 'social/history/published.jsonl'))
    .filter((record) => record.site_status !== 'removed_redundant')
    .map((record) => ({
      ...record,
      content_text: noteBodyAtRef(ref, record),
    }));
}

function compactAuditRecord(record = {}) {
  return {
    post_id: record.post_id || record.external_post_id || null,
    published_at: record.published_at || null,
    content_type: record.content_type || null,
    topic_thesis: record.topic_thesis || null,
    hook: record.hook || null,
    linkedin_text: record.content_text || record.summary || null,
    x_text: record.x_status === 'published' ? record.x_summary || null : null,
  };
}

function buildSemanticAuditCandidatePairs(records = [], { lexicalThreshold = 0.2, maxPairs = 120 } = {}) {
  const compact = records.map(compactAuditRecord);
  const pairs = [];
  for (let left = 0; left < compact.length; left += 1) {
    for (let right = left + 1; right < compact.length; right += 1) {
      const a = compact[left];
      const b = compact[right];
      const sameThesis = Boolean(
        normalizeText(a.topic_thesis)
        && normalizeText(a.topic_thesis) === normalizeText(b.topic_thesis),
      );
      const signals = {
        topic_overlap: overlapScore(a.topic_thesis, b.topic_thesis),
        hook_overlap: overlapScore(a.hook, b.hook),
        linkedin_overlap: overlapScore(a.linkedin_text, b.linkedin_text),
        x_overlap: overlapScore(a.x_text, b.x_text),
      };
      const maximumOverlap = Math.max(...Object.values(signals));
      if (!sameThesis && maximumOverlap < lexicalThreshold) continue;
      pairs.push({
        pair_id: `${a.post_id}::${b.post_id}`,
        same_topic_thesis: sameThesis,
        lexical_signals: signals,
        maximum_lexical_overlap: Number(maximumOverlap.toFixed(4)),
        left: a,
        right: b,
      });
    }
  }
  return pairs
    .sort((left, right) => (
      Number(right.same_topic_thesis) - Number(left.same_topic_thesis)
      || right.maximum_lexical_overlap - left.maximum_lexical_overlap
    ))
    .slice(0, Math.max(1, Number(maxPairs || 120)));
}

function fixtureRedundancyClusters(records = [], threshold = 0.76) {
  const compact = records.map(compactAuditRecord);
  const parent = compact.map((_, index) => index);
  const root = (index) => {
    let cursor = index;
    while (parent[cursor] !== cursor) cursor = parent[cursor];
    return cursor;
  };
  const join = (left, right) => {
    const leftRoot = root(left);
    const rightRoot = root(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  for (let left = 0; left < compact.length; left += 1) {
    for (let right = left + 1; right < compact.length; right += 1) {
      const a = compact[left];
      const b = compact[right];
      const sameThesis = normalizeText(a.topic_thesis) && normalizeText(a.topic_thesis) === normalizeText(b.topic_thesis);
      const bodyOverlap = overlapScore(a.linkedin_text, b.linkedin_text);
      const xOverlap = overlapScore(a.x_text, b.x_text);
      if (sameThesis || bodyOverlap >= threshold || xOverlap >= threshold) join(left, right);
    }
  }

  const groups = new Map();
  compact.forEach((record, index) => {
    const key = root(index);
    const values = groups.get(key) || [];
    values.push(record.post_id);
    groups.set(key, values);
  });
  return [...groups.values()]
    .filter((postIds) => postIds.length > 1)
    .map((postIds) => ({
      post_ids: postIds,
      confidence: 1,
      central_argument: 'Fixture-detected exact or near-exact published argument.',
      overlap_explanation: 'The records share an exact thesis or unusually high lexical overlap.',
    }));
}

function recordId(record = {}) {
  return String(record.post_id || record.external_post_id || '');
}

function recordsFingerprint(records = []) {
  return sha256(records
    .filter((record) => record.site_status !== 'removed_redundant')
    .map((record) => JSON.stringify({
      post_id: recordId(record),
      published_at: record.published_at || null,
      final_text_hash: record.final_text_hash || null,
      note_source_path: safeNotePath(record.note_source_path),
      site_status: record.site_status || 'published',
    })).join('\n'));
}

function proposedRemovalActions(record) {
  return [
    {
      system: 'site',
      action: 'delete_note_source',
      target: safeNotePath(record.note_source_path),
      executable: Boolean(safeNotePath(record.note_source_path)),
      blocker: safeNotePath(record.note_source_path) ? null : 'No safe note source path is stored.',
    },
    {
      system: 'history',
      action: 'mark_site_removed_preserve_publication_memory',
      target: recordId(record) || null,
      executable: Boolean(recordId(record)),
      blocker: recordId(record) ? null : 'No ledger post ID is stored.',
    },
  ];
}

function recordSnapshot(record) {
  return {
    post_id: recordId(record) || null,
    published_at: record.published_at || null,
    topic_thesis: record.topic_thesis || null,
    hook: record.hook || null,
    note_slug: record.note_slug || null,
    note_source_path: safeNotePath(record.note_source_path),
    final_text_hash: record.final_text_hash || null,
  };
}

function buildRemovalDryRun({
  records = [],
  clusters = [],
  sourceRef = 'working-tree',
  model = null,
  minimumConfidence = 0.88,
  generatedAt = new Date(),
} = {}) {
  const byId = new Map(records.map((record) => [String(record.post_id || record.external_post_id || ''), record]));
  const assigned = new Set();
  const normalizedClusters = [];

  for (const cluster of clusters) {
    const confidence = Number(cluster.confidence || 0);
    if (confidence < minimumConfidence) continue;
    const members = [...new Set(cluster.post_ids || [])]
      .map((postId) => byId.get(String(postId)))
      .filter(Boolean)
      .filter((record) => !assigned.has(String(record.post_id || record.external_post_id || '')))
      .sort((left, right) => String(left.published_at || '').localeCompare(String(right.published_at || '')));
    if (members.length < 2) continue;
    members.forEach((record) => assigned.add(String(record.post_id || record.external_post_id || '')));

    const keep = members[members.length - 1];
    const removals = members.slice(0, -1).map((record) => ({
      record: recordSnapshot(record),
      proposed_actions: proposedRemovalActions(record),
    }));
    normalizedClusters.push({
      confidence,
      central_argument: cluster.central_argument || '',
      overlap_explanation: cluster.overlap_explanation || '',
      selection_rule: 'keep_newest_remove_older',
      keep: recordSnapshot(keep),
      remove: removals,
    });
  }

  const allActions = normalizedClusters.flatMap((cluster) => cluster.remove.flatMap((entry) => entry.proposed_actions));
  return {
    dry_run: true,
    destructive_actions_executed: 0,
    generated_at: generatedAt.toISOString(),
    source_ref: sourceRef,
    audit_model: model,
    method: 'Strict semantic clustering: same central claim, causal mechanism, and practical implication. Shared theme alone is not redundant.',
    selection_rule: 'Within a confirmed cluster, keep the newest post and propose removal of older posts.',
    removal_scope: 'Local website notes only. Preserve LinkedIn and X publications and preserve full anti-duplication memory.',
    preserved_external_channels: ['linkedin', 'x'],
    source_fingerprint: recordsFingerprint(records),
    published_record_count: records.length,
    confirmed_cluster_count: normalizedClusters.length,
    proposed_record_removal_count: normalizedClusters.reduce((sum, cluster) => sum + cluster.remove.length, 0),
    proposed_action_count: allActions.length,
    executable_action_count: allActions.filter((action) => action.executable).length,
    blocked_action_count: allActions.filter((action) => !action.executable).length,
    clusters: normalizedClusters,
  };
}

function removalEntries(manifest = {}) {
  return (manifest.clusters || []).flatMap((cluster) => (
    (cluster.remove || []).map((entry) => ({
      ...entry,
      keep_post_id: cluster.keep?.post_id || null,
      central_argument: cluster.central_argument || '',
      confidence: cluster.confidence || null,
      confirmation_confidence: entry.confirmation?.confidence || null,
    }))
  ));
}

function buildRemovalConfirmationPairs({ records = [], plan = {} } = {}) {
  const byId = new Map(records.map((record) => [recordId(record), compactAuditRecord(record)]));
  return (plan.clusters || []).flatMap((cluster) => (
    (cluster.remove || []).map((entry) => ({
      remove: byId.get(String(entry.record.post_id)),
      keep: byId.get(String(cluster.keep?.post_id)),
    }))
  )).filter((pair) => pair.remove && pair.keep);
}

function applyRemovalConfirmations({ plan, decisions = [], minimumConfidence = 0.9 } = {}) {
  const byPair = new Map(decisions.map((decision) => (
    [`${decision.remove_post_id}::${decision.keep_post_id}`, decision]
  )));
  let rejectedRemovalCount = 0;
  const rejectedRemovals = [];
  const clusters = (plan.clusters || []).map((cluster) => {
    const remove = (cluster.remove || []).flatMap((entry) => {
      const decision = byPair.get(`${entry.record.post_id}::${cluster.keep?.post_id}`);
      const confirmed = decision?.redundant === true
        && Number(decision.confidence || 0) >= minimumConfidence;
      if (!confirmed) {
        rejectedRemovalCount += 1;
        rejectedRemovals.push({
          remove: entry.record,
          keep: cluster.keep,
          decision: decision || null,
        });
        return [];
      }
      return [{
        ...entry,
        confirmation: {
          redundant: true,
          confidence: Number(decision.confidence),
          justification: decision.justification || '',
        },
      }];
    });
    return remove.length > 0 ? { ...cluster, remove } : null;
  }).filter(Boolean);
  const allActions = clusters.flatMap((cluster) => cluster.remove.flatMap((entry) => entry.proposed_actions));
  return {
    ...plan,
    confirmation_method: 'Independent record-by-record full-text comparison after semantic clustering.',
    confirmation_minimum_confidence: minimumConfidence,
    confirmation_decision_count: decisions.length,
    rejected_removal_count: rejectedRemovalCount,
    rejected_removals: rejectedRemovals,
    confirmed_cluster_count: clusters.length,
    proposed_record_removal_count: clusters.reduce((sum, cluster) => sum + cluster.remove.length, 0),
    proposed_action_count: allActions.length,
    executable_action_count: allActions.filter((action) => action.executable).length,
    blocked_action_count: allActions.filter((action) => !action.executable).length,
    clusters,
  };
}

function repoRelativePath(value) {
  const absolute = path.resolve(paths.repoRoot, value);
  const repoPrefix = `${path.resolve(paths.repoRoot)}${path.sep}`;
  if (!absolute.startsWith(repoPrefix)) throw new Error(`Path must stay inside the repository: ${value}`);
  return path.relative(paths.repoRoot, absolute).replace(/\\/g, '/');
}

function applyLocalRedundancyRemoval({
  manifest,
  manifestPath,
  removedAt = new Date(),
} = {}) {
  if (!manifest || manifest.dry_run !== true) {
    throw new Error('A reviewed dry-run manifest is required for local historical removal.');
  }
  if (manifest.removal_scope !== 'Local website notes only. Preserve LinkedIn and X publications and preserve full anti-duplication memory.') {
    throw new Error('Manifest removal scope does not match the local-only cleanup policy.');
  }
  if (!Array.isArray(manifest.preserved_external_channels)
    || !manifest.preserved_external_channels.includes('linkedin')
    || !manifest.preserved_external_channels.includes('x')) {
    throw new Error('Manifest must explicitly preserve LinkedIn and X publications.');
  }

  const manifestRef = repoRelativePath(manifestPath);
  const entries = removalEntries(manifest);
  if (entries.length === 0) throw new Error('Manifest contains no records to remove.');
  const targetIds = entries.map((entry) => String(entry.record?.post_id || ''));
  if (targetIds.some((postId) => !postId) || new Set(targetIds).size !== targetIds.length) {
    throw new Error('Manifest removal post IDs must be present and unique.');
  }
  if (entries.some((entry) => Number(entry.confidence || 0) < 0.88)) {
    throw new Error('Every removal must come from a cluster with at least 0.88 confidence.');
  }
  if (entries.some((entry) => Number(entry.confirmation_confidence || 0) < 0.9)) {
    throw new Error('Every removal must pass independent confirmation with at least 0.90 confidence.');
  }
  if (entries.some((entry) => !entry.keep_post_id || entry.keep_post_id === entry.record.post_id)) {
    throw new Error('Every removal must identify a distinct retained post.');
  }

  const originalLedgerText = readText(paths.publishedLedger, '');
  const records = readJsonl(paths.publishedLedger);
  const byId = new Map(records.map((record) => [recordId(record), record]));
  const alreadyApplied = entries.every((entry) => {
    const record = byId.get(String(entry.record.post_id));
    return record?.site_status === 'removed_redundant'
      && record.site_removal_manifest === manifestRef;
  });
  if (alreadyApplied) {
    return {
      ok: true,
      applied: false,
      already_applied: true,
      manifest: manifestRef,
      removed_record_count: entries.length,
      external_deletions_executed: { linkedin: 0, x: 0 },
    };
  }

  if (recordsFingerprint(records) !== manifest.source_fingerprint) {
    throw new Error('Published history changed after the manifest was generated; regenerate and review the dry run.');
  }

  const removalTime = removedAt.toISOString();
  const noteBackups = [];
  const updates = new Map();
  for (const entry of entries) {
    const postId = String(entry.record.post_id);
    const record = byId.get(postId);
    if (!record) throw new Error(`Manifest record is missing from published history: ${postId}`);
    const keepRecord = byId.get(String(entry.keep_post_id));
    if (!keepRecord || keepRecord.site_status === 'removed_redundant') {
      throw new Error(`Retained cluster record is missing or inactive: ${entry.keep_post_id}`);
    }
    if (record.site_status === 'removed_redundant') {
      throw new Error(`Record was already removed by another manifest: ${postId}`);
    }
    if ((record.final_text_hash || null) !== (entry.record.final_text_hash || null)) {
      throw new Error(`Manifest content hash does not match published history for ${postId}`);
    }
    const notePath = safeNotePath(record.note_source_path);
    if (!notePath || notePath !== entry.record.note_source_path) {
      throw new Error(`Manifest note path does not match published history for ${postId}`);
    }
    const absoluteNotePath = path.resolve(paths.repoRoot, notePath);
    if (!fileExists(absoluteNotePath)) throw new Error(`Note source does not exist: ${notePath}`);
    const noteSource = readText(absoluteNotePath);
    const noteBody = parseMarkdownWithFrontmatter(noteSource).body;
    if (!noteBody) throw new Error(`Note source has no body: ${notePath}`);
    noteBackups.push({ absoluteNotePath, noteSource });
    updates.set(postId, {
      ...record,
      publication_memory_text: noteBody,
      site_status: 'removed_redundant',
      site_removed_at: removalTime,
      site_removal_reason: 'substantive_redundancy',
      site_removal_manifest: manifestRef,
      site_redundancy_keep_post_id: entry.keep_post_id,
      site_redundancy_confidence: entry.confidence,
      removed_note_slug: record.note_slug || null,
      removed_note_source_path: notePath,
      note_slug: null,
      note_source_path: null,
    });
  }

  try {
    noteBackups.forEach(({ absoluteNotePath }) => fs.unlinkSync(absoluteNotePath));
    const updatedRecords = records.map((record) => updates.get(recordId(record)) || record);
    writeText(paths.publishedLedger, `${updatedRecords.map((record) => JSON.stringify(record)).join('\n')}\n`);
  } catch (error) {
    noteBackups.forEach(({ absoluteNotePath, noteSource }) => {
      fs.mkdirSync(path.dirname(absoluteNotePath), { recursive: true });
      fs.writeFileSync(absoluteNotePath, noteSource, 'utf8');
    });
    writeText(paths.publishedLedger, originalLedgerText);
    throw error;
  }

  return {
    ok: true,
    applied: true,
    already_applied: false,
    applied_at: removalTime,
    manifest: manifestRef,
    removed_record_count: entries.length,
    deleted_note_source_paths: entries.map((entry) => entry.record.note_source_path),
    published_ledger_records_preserved: records.length,
    publication_memory_records_preserved: entries.length,
    external_deletions_executed: { linkedin: 0, x: 0 },
    active_site_record_count_before: records.filter((record) => record.site_status !== 'removed_redundant').length,
    active_site_record_count_after: records.filter((record) => record.site_status !== 'removed_redundant').length - entries.length,
  };
}

module.exports = {
  parseJsonlText,
  loadPublishedRecordsForAudit,
  compactAuditRecord,
  buildSemanticAuditCandidatePairs,
  fixtureRedundancyClusters,
  recordsFingerprint,
  proposedRemovalActions,
  buildRemovalDryRun,
  removalEntries,
  buildRemovalConfirmationPairs,
  applyRemovalConfirmations,
  applyLocalRedundancyRemoval,
};
