const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');

const { parseTopPosts, buildLearningDataset, importWorkbook } = require('../lib/linkedin-analytics');
const { setupTempSocialWorkspace } = require('./helpers');
const { appendJsonl } = require('../lib/jsonl');
const { paths } = require('../lib/paths');

function writeWorkbook(filePath) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Maximum of 50 posts available to include in this list'],
    [],
    ['Post URL', 'Post publish date', 'Engagements', null, 'Post URL', 'Post publish date', 'Impressions'],
    ['https://www.linkedin.com/feed/update/urn:li:activity:1', '3/17/2025', '7', null, 'https://www.linkedin.com/feed/update/urn:li:activity:2', '3/18/2025', '500'],
    ['https://www.linkedin.com/feed/update/urn:li:activity:2', '3/18/2025', '4', null, 'https://www.linkedin.com/feed/update/urn:li:activity:1', '3/17/2025', '250'],
  ]), 'TOP POSTS');
  XLSX.writeFile(workbook, filePath);
}

test('parseTopPosts merges engagement and impression rankings per LinkedIn post', () => {
  const posts = parseTopPosts([
    ['Maximum of 50 posts available to include in this list'],
    [],
    ['Post URL', 'Post publish date', 'Engagements', null, 'Post URL', 'Post publish date', 'Impressions'],
    ['https://www.linkedin.com/feed/update/urn:li:activity:1', '3/17/2025', '7', null, 'https://www.linkedin.com/feed/update/urn:li:activity:2', '3/18/2025', '500'],
    ['https://www.linkedin.com/feed/update/urn:li:activity:2', '3/18/2025', '4', null, 'https://www.linkedin.com/feed/update/urn:li:activity:1', '3/17/2025', '250'],
  ]);

  assert.equal(posts.length, 2);
  assert.equal(posts[0].activity_urn, 'urn:li:activity:1');
  assert.equal(posts[1].impressions, 500);
});

test('buildLearningDataset matches flow-published posts to LinkedIn ranked posts', (t) => {
  setupTempSocialWorkspace(t);
  appendJsonl(paths.publishedLedger, {
    post_id: 'published-1',
    external_post_id: 'published-1',
    published_at: '2025-03-18T15:00:00.000Z',
    content_type: 'decoder_ring',
    pillar: 'Decoder Ring',
    topic_thesis: 'Example thesis',
    angle: 'Example angle',
    hook: 'Example hook',
    summary: 'Example summary',
    source_refs: [],
    framework_terms_used: [],
    timely_subject: null,
    research_bundle_id: null,
    winning_candidate_id: 'winner-1',
    final_text_hash: 'hash-1',
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkedin-learning-'));
  const filePath = path.join(tmpDir, 'sample.xlsx');
  writeWorkbook(filePath);

  const dataset = buildLearningDataset({ inputPath: filePath });

  assert.equal(dataset.ranked_post_count, 2);
  assert.equal(dataset.matched_record_count, 1);
  assert.equal(dataset.unmatched_record_count, 0);
  assert.equal(dataset.matched_records[0].matched_by, 'published_date_unique');
  assert.equal(dataset.matched_records[0].impressions, 500);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('importWorkbook writes only the learning dataset and can delete the source workbook', (t) => {
  setupTempSocialWorkspace(t);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkedin-learning-import-'));
  const filePath = path.join(tmpDir, 'sample.xlsx');
  writeWorkbook(filePath);

  const result = importWorkbook({ inputPath: filePath, deleteInput: true });

  assert.ok(fs.existsSync(result.output.dataset_path));
  assert.equal(path.basename(result.output.dataset_path), 'learning-dataset.json');
  assert.equal(fs.existsSync(filePath), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
