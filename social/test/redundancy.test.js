const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { setupTempSocialWorkspace } = require('./helpers');
const { paths } = require('../lib/paths');
const { writeText } = require('../lib/fs');
const { readJsonl } = require('../lib/jsonl');

const {
  loadPublishedRecordsForAudit,
  buildSemanticAuditCandidatePairs,
  fixtureRedundancyClusters,
  buildRemovalDryRun,
  buildRemovalConfirmationPairs,
  applyRemovalConfirmations,
  applyLocalRedundancyRemoval,
} = require('../lib/redundancy');

function record({ id, date, xId = null, linkedinUrn = null, note = null, thesis = 'Same claim' }) {
  return {
    post_id: id,
    external_post_id: id,
    published_at: date,
    topic_thesis: thesis,
    hook: `${thesis}.`,
    summary: `${thesis}. The same mechanism produces the same operator implication.`,
    content_text: `${thesis}. The same mechanism produces the same operator implication.`,
    linkedin_activity_urn: linkedinUrn,
    note_source_path: note,
    x_status: xId ? 'published' : null,
    x_external_post_id: xId,
    x_summary: xId ? `${thesis}. Same consequence.` : null,
  };
}

test('redundancy dry run keeps the newest record and performs no destructive action', () => {
  const records = [
    record({ id: 'old-post', date: '2026-04-01T12:00:00Z', xId: 'x-old', note: 'content/notes/old.md' }),
    record({ id: 'new-post', date: '2026-05-01T12:00:00Z', xId: 'x-new', linkedinUrn: 'urn:li:activity:2', note: 'content/notes/new.md' }),
  ];
  const result = buildRemovalDryRun({
    records,
    clusters: [{
      post_ids: ['old-post', 'new-post'],
      confidence: 0.96,
      central_argument: 'Same claim.',
      overlap_explanation: 'Same mechanism and implication.',
    }],
    generatedAt: new Date('2026-07-15T12:00:00Z'),
  });

  assert.equal(result.dry_run, true);
  assert.equal(result.destructive_actions_executed, 0);
  assert.equal(result.proposed_record_removal_count, 1);
  assert.equal(result.clusters[0].keep.post_id, 'new-post');
  assert.equal(result.clusters[0].remove[0].record.post_id, 'old-post');
  assert.equal(result.clusters[0].remove[0].proposed_actions.length, 2);
  assert.equal(result.blocked_action_count, 0);
  assert.deepEqual(result.preserved_external_channels, ['linkedin', 'x']);
  assert.match(result.removal_scope, /Local website notes only/);
});

test('local historical removal deletes only redundant note sources and preserves publication memory', (t) => {
  const { tempRoot } = setupTempSocialWorkspace(t);
  const oldNotePath = path.join(paths.notesContentDir, 'old.md');
  const newNotePath = path.join(paths.notesContentDir, 'new.md');
  const oldBody = 'A full old argument about the same mechanism and the same operator consequence.';
  writeText(oldNotePath, `---\ntitle: Old\n---\n\n${oldBody}\n`);
  writeText(newNotePath, '---\ntitle: New\n---\n\nA newer version of the argument.\n');
  const records = [
    record({
      id: 'old-post',
      date: '2026-04-01T12:00:00Z',
      xId: 'x-old',
      linkedinUrn: 'urn:li:activity:1',
      note: 'content/notes/old.md',
    }),
    record({
      id: 'new-post',
      date: '2026-05-01T12:00:00Z',
      xId: 'x-new',
      linkedinUrn: 'urn:li:activity:2',
      note: 'content/notes/new.md',
    }),
  ];
  records[0].note_slug = 'old';
  records[1].note_slug = 'new';
  writeText(paths.publishedLedger, `${records.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  const initialManifest = buildRemovalDryRun({
    records,
    clusters: [{
      post_ids: ['old-post', 'new-post'],
      confidence: 0.96,
      central_argument: 'Same claim.',
      overlap_explanation: 'Same mechanism and implication.',
    }],
    generatedAt: new Date('2026-07-15T12:00:00Z'),
  });
  const pairs = buildRemovalConfirmationPairs({ records, plan: initialManifest });
  const manifest = applyRemovalConfirmations({
    plan: initialManifest,
    decisions: [{
      remove_post_id: 'old-post',
      keep_post_id: 'new-post',
      redundant: true,
      confidence: 0.97,
      justification: 'The retained post subsumes the same claim, mechanism, and implication.',
    }],
  });
  assert.equal(pairs.length, 1);
  const manifestPath = path.join(tempRoot, 'social', 'history', 'removal.json');

  const result = applyLocalRedundancyRemoval({
    manifest,
    manifestPath,
    removedAt: new Date('2026-07-16T12:00:00Z'),
  });

  assert.equal(result.applied, true);
  assert.equal(result.removed_record_count, 1);
  assert.deepEqual(result.external_deletions_executed, { linkedin: 0, x: 0 });
  assert.equal(fs.existsSync(oldNotePath), false);
  assert.equal(fs.existsSync(newNotePath), true);

  const stored = readJsonl(paths.publishedLedger);
  assert.equal(stored.length, 2);
  const removed = stored.find((entry) => entry.post_id === 'old-post');
  assert.equal(removed.site_status, 'removed_redundant');
  assert.equal(removed.linkedin_activity_urn, 'urn:li:activity:1');
  assert.equal(removed.x_external_post_id, 'x-old');
  assert.equal(removed.note_source_path, null);
  assert.equal(removed.removed_note_source_path, 'content/notes/old.md');
  assert.equal(removed.publication_memory_text, oldBody);
  assert.deepEqual(loadPublishedRecordsForAudit().map((entry) => entry.post_id), ['new-post']);

  const repeated = applyLocalRedundancyRemoval({ manifest, manifestPath });
  assert.equal(repeated.applied, false);
  assert.equal(repeated.already_applied, true);
});

test('independent confirmation fails closed on missing, uncertain, or distinct removal decisions', () => {
  const records = [
    record({ id: 'old-post', date: '2026-04-01T12:00:00Z', note: 'content/notes/old.md' }),
    record({ id: 'new-post', date: '2026-05-01T12:00:00Z', note: 'content/notes/new.md' }),
  ];
  const plan = buildRemovalDryRun({
    records,
    clusters: [{ post_ids: ['old-post', 'new-post'], confidence: 0.96 }],
  });

  const missing = applyRemovalConfirmations({ plan, decisions: [] });
  assert.equal(missing.proposed_record_removal_count, 0);
  assert.equal(missing.rejected_removal_count, 1);

  const uncertain = applyRemovalConfirmations({
    plan,
    decisions: [{
      remove_post_id: 'old-post',
      keep_post_id: 'new-post',
      redundant: true,
      confidence: 0.89,
      justification: 'Uncertain.',
    }],
  });
  assert.equal(uncertain.proposed_record_removal_count, 0);
});

test('fixture audit groups exact repeated arguments but not distinct claims', () => {
  const records = [
    record({ id: 'one', date: '2026-04-01T12:00:00Z' }),
    record({ id: 'two', date: '2026-05-01T12:00:00Z' }),
    record({ id: 'three', date: '2026-06-01T12:00:00Z', thesis: 'A distinct mechanism changes a different decision' }),
  ];
  const clusters = fixtureRedundancyClusters(records);

  assert.equal(clusters.length, 1);
  assert.deepEqual(new Set(clusters[0].post_ids), new Set(['one', 'two']));
});

test('semantic audit candidate detection always nominates exact thesis reuse for full-text adjudication', () => {
  const records = [
    record({ id: 'one', date: '2026-04-01T12:00:00Z' }),
    record({ id: 'two', date: '2026-05-01T12:00:00Z' }),
    record({ id: 'three', date: '2026-06-01T12:00:00Z', thesis: 'Distinct claim' }),
  ];
  const pairs = buildSemanticAuditCandidatePairs(records, { lexicalThreshold: 0.99 });

  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].same_topic_thesis, true);
  assert.equal(pairs[0].left.post_id, 'one');
  assert.equal(pairs[0].right.post_id, 'two');
});

test('dry run excludes clusters below the deletion confidence threshold', () => {
  const records = [
    record({ id: 'one', date: '2026-04-01T12:00:00Z' }),
    record({ id: 'two', date: '2026-05-01T12:00:00Z' }),
  ];
  const result = buildRemovalDryRun({
    records,
    clusters: [{ post_ids: ['one', 'two'], confidence: 0.7 }],
    minimumConfidence: 0.88,
  });

  assert.equal(result.confirmed_cluster_count, 0);
  assert.equal(result.proposed_record_removal_count, 0);
});
