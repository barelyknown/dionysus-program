const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const { ensureDir, writeJson } = require('./fs');
const { paths } = require('./paths');
const { now } = require('./time');
const { readJsonl } = require('./jsonl');

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/[,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return text;
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function normalizeIsoDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return isoDate(text);
}

function activityUrnFromUrl(postUrl) {
  const match = String(postUrl || '').match(/urn:li:activity:\d+/);
  return match ? match[0] : null;
}

function loadSheetRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: false,
  });
}

function parseTopPosts(rows) {
  const posts = new Map();

  function upsert(postUrl, publishDate, metricKey, metricValue, rankKey, rankValue) {
    if (!postUrl) return;
    const existing = posts.get(postUrl) || {
      post_url: postUrl,
      activity_urn: activityUrnFromUrl(postUrl),
      publish_date: isoDate(publishDate),
      impressions: null,
      engagements: null,
      rank_by_impressions: null,
      rank_by_engagements: null,
    };
    existing.publish_date ||= isoDate(publishDate);
    existing[metricKey] = toNumber(metricValue);
    existing[rankKey] = rankValue;
    posts.set(postUrl, existing);
  }

  rows.slice(3).forEach((row, index) => {
    const rank = index + 1;
    upsert(row[0], row[1], 'engagements', row[2], 'rank_by_engagements', rank);
    upsert(row[4], row[5], 'impressions', row[6], 'rank_by_impressions', rank);
  });

  return Array.from(posts.values()).map((post) => ({
    ...post,
    engagement_rate: post.impressions ? post.engagements / post.impressions : null,
  }));
}

function loadRankedPosts(inputPath) {
  const workbook = XLSX.readFile(inputPath);
  const rows = loadSheetRows(workbook, 'TOP POSTS');
  if (rows.length === 0) {
    throw new Error('Workbook is missing the TOP POSTS sheet.');
  }
  return parseTopPosts(rows);
}

function buildLearningDataset({ inputPath, publishedRecords = readJsonl(paths.publishedLedger) }) {
  const rankedPosts = loadRankedPosts(inputPath);
  const postsByUrl = new Map(rankedPosts.map((post) => [post.post_url, post]));
  const postsByUrn = new Map(rankedPosts.map((post) => [post.activity_urn, post]).filter((entry) => entry[0]));
  const postsByDate = rankedPosts.reduce((acc, post) => {
    const key = normalizeIsoDate(post.publish_date);
    if (!key) return acc;
    acc[key] ||= [];
    acc[key].push(post);
    return acc;
  }, {});

  const matchedRecords = [];
  const unmatchedRecords = [];

  for (const record of publishedRecords) {
    const linkedinPostUrl = record.linkedin_post_url || null;
    const linkedinActivityUrn = record.linkedin_activity_urn || activityUrnFromUrl(linkedinPostUrl) || null;
    const publishedDate = normalizeIsoDate(record.published_at);
    const sameDayPosts = publishedDate ? (postsByDate[publishedDate] || []) : [];

    const directUrlMatch = linkedinPostUrl ? postsByUrl.get(linkedinPostUrl) : null;
    const directUrnMatch = linkedinActivityUrn ? postsByUrn.get(linkedinActivityUrn) : null;
    const uniqueDateMatch = sameDayPosts.length === 1 ? sameDayPosts[0] : null;
    const matchedPost = directUrlMatch || directUrnMatch || uniqueDateMatch || null;

    if (!matchedPost) {
      unmatchedRecords.push({
        post_id: record.post_id,
        published_at: record.published_at,
        content_type: record.content_type,
        pillar: record.pillar,
      });
      continue;
    }

    let matchedBy = 'published_date_unique';
    let confidence = 'medium';
    if (directUrlMatch) {
      matchedBy = 'linkedin_post_url';
      confidence = 'high';
    } else if (directUrnMatch) {
      matchedBy = 'linkedin_activity_urn';
      confidence = 'high';
    }

    matchedRecords.push({
      post_id: record.post_id,
      external_post_id: record.external_post_id,
      published_at: record.published_at,
      content_type: record.content_type,
      pillar: record.pillar,
      topic_thesis: record.topic_thesis,
      angle: record.angle,
      hook: record.hook,
      winning_candidate_id: record.winning_candidate_id,
      linkedin_post_url: matchedPost.post_url,
      linkedin_activity_urn: matchedPost.activity_urn,
      matched_by: matchedBy,
      confidence,
      impressions: matchedPost.impressions,
      engagements: matchedPost.engagements,
      engagement_rate: matchedPost.engagement_rate,
      rank_by_impressions: matchedPost.rank_by_impressions,
      rank_by_engagements: matchedPost.rank_by_engagements,
    });
  }

  return {
    source: {
      path: inputPath,
      filename: path.basename(inputPath),
    },
    imported_at: now().toISOString(),
    ranked_post_count: rankedPosts.length,
    published_record_count: publishedRecords.length,
    matched_record_count: matchedRecords.length,
    unmatched_record_count: unmatchedRecords.length,
    matched_records: matchedRecords,
    unmatched_records: unmatchedRecords,
  };
}

function removeLegacyOutputs() {
  for (const filename of ['latest.json', 'latest.md', 'published-matches.json']) {
    const filePath = path.join(paths.linkedinAnalyticsDir, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

function importWorkbook({ inputPath, deleteInput = false }) {
  const dataset = buildLearningDataset({ inputPath });
  ensureDir(paths.linkedinAnalyticsDir);
  removeLegacyOutputs();
  const datasetPath = path.join(paths.linkedinAnalyticsDir, 'learning-dataset.json');
  writeJson(datasetPath, dataset);
  if (deleteInput) fs.unlinkSync(inputPath);
  return {
    dataset,
    output: {
      dataset_path: datasetPath,
    },
  };
}

module.exports = {
  activityUrnFromUrl,
  parseTopPosts,
  loadRankedPosts,
  buildLearningDataset,
  importWorkbook,
};
