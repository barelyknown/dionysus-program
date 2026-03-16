const path = require('path');
const { loadStrategy, loadWatchlists } = require('./config');
const { loadSourceContext } = require('./context');
const { readJson, writeJson } = require('./fs');
const { paths } = require('./paths');
const { rebuildMemory, loadPublishedRecords, getMemoryConflicts } = require('./memory');
const { loadMailbagItems } = require('./planner');
const { buildBrief } = require('./briefs');
const { getType } = require('../types');
const { GPTScorerAdapter } = require('../providers/gpt-scorer');
const { GPTXAdapter } = require('../providers/gpt-x');
const { ClaudeWriterAdapter } = require('../providers/claude-writer');
const { OpenAIWriterAdapter } = require('../providers/openai-writer');
const { GeminiResearchAdapter } = require('../providers/gemini-research');
const { ZapierPublisherAdapter } = require('../providers/zapier-publisher');
const { XPublisherAdapter } = require('../providers/x-publisher');
const { runFilePath } = require('./records');
const { findCalendarItem, saveCalendar, replaceCalendarItem } = require('./records');
const { buildResearchJob, findPendingJobForTopic, removeResearchJob, upsertResearchJob } = require('./research-jobs');
const { getResearchRecencyPolicy, researchBundleMeetsRecencyPolicy } = require('./research-policy');
const { sha256 } = require('./hash');
const { now } = require('./time');

function providerMode({ args, strategy }) {
  if (args['use-fixtures']) return 'fixture';
  return String(args.mode || process.env.SOCIAL_PROVIDER_MODE || strategy.provider_defaults?.mode || 'fixture');
}

function createRun(kind, payload) {
  const timestamp = now().toISOString();
  const runId = sha256(`${kind}:${timestamp}:${JSON.stringify(payload || {})}`).slice(0, 12);
  const run = {
    id: runId,
    kind,
    created_at: timestamp,
    payload,
  };
  writeJson(runFilePath(runId), run);
  return run;
}

function updateRun(run, extra) {
  const next = { ...run, ...extra };
  writeJson(runFilePath(run.id), next);
  return next;
}

function createAdapters({ args, strategy }) {
  const mode = providerMode({ args, strategy });
  const writerProvider = String(
    args['writer-provider']
      || process.env.SOCIAL_WRITER_PROVIDER
      || strategy.provider_defaults?.writer_provider
      || 'claude'
  );
  const writerModel = writerProvider === 'openai'
    ? (process.env.OPENAI_MODEL || strategy.provider_defaults?.openai_model)
    : (process.env.ANTHROPIC_MODEL || strategy.provider_defaults?.claude_model);
  const writer = writerProvider === 'openai'
    ? new OpenAIWriterAdapter({
      mode,
      model: writerModel,
      reasoningEffort: process.env.OPENAI_REASONING_EFFORT || strategy.provider_defaults?.openai_reasoning_effort || 'medium',
    })
    : new ClaudeWriterAdapter({
      mode,
      model: writerModel,
    });
  return {
    mode,
    writerProvider,
    writerModel,
    writer,
    claude: writer,
    scorer: new GPTScorerAdapter({
      mode,
      model: process.env.OPENAI_MODEL || strategy.provider_defaults?.openai_model,
    }),
    gemini: new GeminiResearchAdapter({
      mode,
      agent: process.env.GEMINI_AGENT || strategy.provider_defaults?.gemini_agent,
    }),
    zapier: new ZapierPublisherAdapter({ mode }),
    xWriter: new GPTXAdapter({
      mode,
      model: strategy.x?.writer_model || strategy.provider_defaults?.openai_model || 'gpt-5.4',
      reasoningEffort: strategy.x?.writer_reasoning_effort || 'medium',
    }),
    xScorer: new GPTXAdapter({
      mode,
      model: strategy.x?.scorer_model || strategy.provider_defaults?.openai_model || 'gpt-5.4',
      reasoningEffort: strategy.x?.scorer_reasoning_effort || 'high',
    }),
    x: new XPublisherAdapter({ mode }),
  };
}

function selectedPromptVariants(strategy) {
  const variants = strategy.generation?.prompt_variants || ['hook_forward', 'diagnosis_forward', 'operator_forward', 'contrarian_forward'];
  const bestOfN = Math.max(1, Number(strategy.generation?.best_of_n || variants.length));
  return variants.slice(0, bestOfN);
}

class ResearchPendingError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ResearchPendingError';
    this.details = details;
  }
}

function typeRequiresResearch({ calendarItem, strategy }) {
  const type = getType(calendarItem.content_type);
  const typeConfig = strategy.content_types?.[calendarItem.content_type] || {};
  return Boolean(type?.requiresResearch && typeConfig.requires_research !== false);
}

function persistResearchBundleId({ itemId, bundleId }) {
  const found = findCalendarItem(itemId);
  if (!found) return;
  const nextItem = { ...found.item, source_bundle_id: bundleId };
  saveCalendar(found.filePath, replaceCalendarItem(found.calendar, nextItem));
}

function persistCalendarItem(nextItem) {
  const found = findCalendarItem(nextItem.id);
  if (!found) return;
  saveCalendar(found.filePath, replaceCalendarItem(found.calendar, nextItem));
}

function toSentenceFragment(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  return text.endsWith('.') ? text.slice(0, -1) : text;
}

function lowerFirst(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

function humanizeSlug(slug) {
  const words = String(slug || '')
    .split('-')
    .map((word) => word.trim())
    .filter(Boolean)
    .filter((word) => !/^\d+$/.test(word));
  if (words.length === 0) return '';
  const tokenMap = {
    ai: 'AI',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    meta: 'Meta',
    google: 'Google',
    microsoft: 'Microsoft',
    pentagon: 'Pentagon',
    usa: 'USA',
    us: 'US',
  };
  return words
    .slice(0, 8)
    .map((word) => tokenMap[word.toLowerCase()] || `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function derivePrimaryEventLabel(primarySource) {
  const title = String(primarySource?.title || '').trim();
  if (title && !/[?]$/.test(title) && !/^what\b/i.test(title)) return title;
  const url = String(primarySource?.url || '');
  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    const humanized = humanizeSlug(slug);
    if (humanized) return humanized;
  } catch {
    // Ignore invalid URLs and fall through to excerpt-based labeling.
  }
  const excerpt = toSentenceFragment(primarySource?.excerpt || primarySource?.claim);
  if (excerpt) return excerpt;
  return title || primarySource?.url || 'recent company case';
}

function fallbackNormalizedResearch({ calendarItem, rawResearch }) {
  const primarySource = rawResearch?.primary_source || rawResearch?.sources?.[0] || null;
  const eventLabel = derivePrimaryEventLabel(primarySource);
  const seedTopicThesis = calendarItem.seed_topic_thesis || calendarItem.topic_thesis;
  const claim = toSentenceFragment(primarySource?.claim || primarySource?.excerpt || 'The visible event reveals an underlying organizational pattern');
  const diagnosis = lowerFirst(toSentenceFragment(seedTopicThesis)) || 'the visible event reveals an underlying organizational pattern';
  return {
    summary: rawResearch?.summary || '',
    sources: rawResearch?.sources || [],
    primary_source: primarySource,
    candidate_angles: [
      {
        topic_thesis: seedTopicThesis,
        angle: `Open on ${eventLabel} in plain language, then show how it makes the deeper diagnosis legible.`,
        hook: `${eventLabel} is the visible case. The real point is ${diagnosis}.`,
        subject: eventLabel,
      },
    ],
    normalization_fallback_reason: claim,
  };
}

function selectedResearchAngle(researchBundle) {
  return Array.isArray(researchBundle?.candidate_angles) ? researchBundle.candidate_angles[0] || null : null;
}

function applyResearchAngleToCalendarItem({ calendarItem, researchBundle }) {
  const topAngle = selectedResearchAngle(researchBundle);
  const primarySource = researchBundle?.primary_source || researchBundle?.sources?.[0] || null;
  const seedTopicThesis = calendarItem.seed_topic_thesis || calendarItem.topic_thesis;
  const eventLabel = derivePrimaryEventLabel(primarySource);
  if (!topAngle) return calendarItem;
  return {
    ...calendarItem,
    seed_topic_thesis: seedTopicThesis,
    topic_thesis: seedTopicThesis,
    angle: eventLabel
      ? `Open on ${eventLabel} in plain language, then show how it makes the deeper diagnosis legible.`
      : (topAngle.angle || calendarItem.angle),
    hook: calendarItem.hook,
    timely_subject: eventLabel || topAngle.subject || calendarItem.timely_subject || null,
  };
}

async function ensureResearchBundleForItem({ calendarItem, strategy, adapters }) {
  const watchlists = loadWatchlists();
  const recencyPolicy = getResearchRecencyPolicy({ watchlists });
  const loadedExisting = loadResearchBundle(calendarItem.source_bundle_id);
  const existing = loadedExisting && researchBundleMeetsRecencyPolicy(loadedExisting, recencyPolicy)
    ? loadedExisting
    : null;
  if (existing || !typeRequiresResearch({ calendarItem, strategy })) {
    const updatedItem = existing ? applyResearchAngleToCalendarItem({ calendarItem, researchBundle: existing }) : calendarItem;
    if (existing && (adapters.mode === 'live' || adapters.mode === 'record')) persistCalendarItem(updatedItem);
    return {
      calendarItem: updatedItem,
      researchBundle: existing,
      generated: false,
    };
  }
  if (!adapters?.gemini || !adapters?.scorer) {
    throw new Error(`Content type ${calendarItem.content_type} requires research, but provider adapters are unavailable.`);
  }
  let rawResearch;
  if (adapters.mode === 'live' || adapters.mode === 'record') {
    const existingJob = findPendingJobForTopic(calendarItem.topic_thesis);
    if (existingJob) {
      const latest = await adapters.gemini.pollResearchJob({ job: existingJob });
      if (latest.status === 'completed') {
        upsertResearchJob({ ...existingJob, status: 'completed' });
        rawResearch = await adapters.gemini.normalizeCompletedResearch({ job: existingJob, latest });
      } else if (latest.status === 'failed' || latest.status === 'cancelled' || latest.status === 'incomplete') {
        removeResearchJob(existingJob.id);
        throw new Error(`Required decoder-ring research failed for "${calendarItem.topic_thesis}" (status=${latest.status}).`);
      } else {
        const pendingJob = { ...existingJob, status: latest.status || existingJob.status };
        upsertResearchJob(pendingJob);
        throw new ResearchPendingError('Required decoder-ring research is still in progress.', {
          item_id: calendarItem.id,
          topic_thesis: calendarItem.topic_thesis,
          pending_job: pendingJob,
        });
      }
    } else {
      const submitted = await adapters.gemini.submitResearchJob({
        topicThesis: calendarItem.topic_thesis,
        watchlists,
      });
      const pendingJob = buildResearchJob({
        topicThesis: calendarItem.topic_thesis,
        submitted,
        mode: adapters.mode,
      });
      upsertResearchJob(pendingJob);
      throw new ResearchPendingError('Submitted required decoder-ring research job.', {
        item_id: calendarItem.id,
        topic_thesis: calendarItem.topic_thesis,
        pending_job: pendingJob,
      });
    }
  } else {
    rawResearch = await adapters.gemini.researchTopic({
      topicThesis: calendarItem.topic_thesis,
      watchlists,
    });
  }
  if (!researchBundleMeetsRecencyPolicy(rawResearch, recencyPolicy)) {
    throw new Error(`Required decoder-ring research did not yield enough recent sources for "${calendarItem.topic_thesis}".`);
  }
  const normalized = fallbackNormalizedResearch({ calendarItem, rawResearch });
  const researchBundle = {
    ...rawResearch,
    summary: normalized.summary,
    sources: normalized.sources,
    primary_source: normalized.primary_source || normalized.sources?.[0] || rawResearch.primary_source || rawResearch.sources?.[0] || null,
    candidate_angles: normalized.candidate_angles,
  };
  saveResearchBundle(researchBundle);
  if (adapters.mode === 'live' || adapters.mode === 'record') {
    const completedJob = findPendingJobForTopic(calendarItem.topic_thesis);
    if (completedJob) removeResearchJob(completedJob.id);
  }
  const updatedItem = applyResearchAngleToCalendarItem({
    calendarItem: { ...calendarItem, source_bundle_id: researchBundle.id },
    researchBundle,
  });
  if (adapters.mode === 'live' || adapters.mode === 'record') {
    persistResearchBundleId({ itemId: calendarItem.id, bundleId: researchBundle.id });
    persistCalendarItem(updatedItem);
  }
  return {
    calendarItem: updatedItem,
    researchBundle,
    generated: true,
  };
}

function loadResearchBundle(bundleId) {
  if (!bundleId) return null;
  return readJson(path.join(paths.researchCacheDir, `${bundleId}.json`), null);
}

function saveResearchBundle(bundle) {
  writeJson(path.join(paths.researchCacheDir, `${bundle.id}.json`), bundle);
}

function prepareBrief({ calendarItem, strategy, memory = null, researchBundle = undefined }) {
  const context = loadSourceContext();
  const mailbagItems = loadMailbagItems();
  const resolvedResearchBundle = researchBundle === undefined
    ? loadResearchBundle(calendarItem.source_bundle_id)
    : researchBundle;
  const brief = buildBrief({
    calendarItem,
    strategy,
    context,
    researchBundle: resolvedResearchBundle,
    mailbagItems,
    memory: memory || {},
  });
  const type = getType(calendarItem.content_type);
  return {
    brief: {
      ...brief,
      prompt: type.buildPrompt(brief, 'base'),
    },
    context,
    mailbagItems,
    researchBundle: resolvedResearchBundle,
    type,
  };
}

async function generateCandidatesForItem({ calendarItem, strategy, adapters, memory = null }) {
  const ensured = await ensureResearchBundleForItem({ calendarItem, strategy, adapters });
  const prepared = prepareBrief({
    calendarItem: ensured.calendarItem,
    strategy,
    memory,
    researchBundle: ensured.researchBundle,
  });
  const candidates = await (adapters.writer || adapters.claude).generateCandidates({
    brief: prepared.brief,
    promptVariants: selectedPromptVariants(strategy),
  });
  return { ...prepared, calendarItem: ensured.calendarItem, candidates };
}

async function scoreCandidatesForItem({ calendarItem, strategy, adapters, memory }) {
  const generated = await generateCandidatesForItem({ calendarItem, strategy, adapters, memory });
  const sourceRefs = [
    ...(generated.researchBundle?.sources || []).map((source) => source.url),
    ...(generated.brief.mailbag_item?.provenance ? [generated.brief.mailbag_item.provenance] : []),
  ];
  const scorecards = await adapters.scorer.scoreCandidates({
    candidates: generated.candidates,
    brief: generated.brief,
    strategy,
    memory,
    sourceRefs,
  });
  const ranked = [...scorecards].sort((left, right) => right.overall_score - left.overall_score);
  const winnerScore = ranked.find((entry) => entry.pass) || null;
  const winnerCandidate = winnerScore
    ? generated.candidates.find((candidate) => candidate.id === winnerScore.candidate_id) || null
    : null;
  return {
    ...generated,
    scorecards,
    winnerScore,
    winnerCandidate,
  };
}

function createPublishPayload({ calendarItem, winnerCandidate, winnerScore, researchBundle, mailbagItem = null }) {
  return {
    item_id: calendarItem.id,
    scheduled_at: calendarItem.scheduled_at,
    content_type: calendarItem.content_type,
    pillar: calendarItem.pillar,
    topic_thesis: calendarItem.topic_thesis,
    angle: calendarItem.angle,
    hook: winnerCandidate.post_text.split(/\n/)[0].trim(),
    final_text: winnerCandidate.post_text,
    winning_candidate_id: winnerCandidate.id,
    winning_score: winnerScore.overall_score,
    source_refs: [
      ...(researchBundle?.sources || []).map((source) => source.url),
      ...(mailbagItem?.provenance ? [mailbagItem.provenance] : []),
    ],
    research_bundle_id: researchBundle?.id || null,
    timely_subject: calendarItem.timely_subject || null,
  };
}

function createPublishedRecord({ publishPayload, publishResult, calendarItem, note = null, x = null }) {
  return {
    post_id: publishResult.external_post_id,
    external_post_id: publishResult.external_post_id,
    published_at: publishResult.delivered_at,
    linkedin_post_url: publishResult.linkedin_post_url || null,
    linkedin_activity_urn: publishResult.linkedin_activity_urn || null,
    content_type: calendarItem.content_type,
    pillar: calendarItem.pillar,
    topic_thesis: calendarItem.topic_thesis,
    angle: calendarItem.angle,
    hook: publishPayload.hook,
    summary: publishPayload.final_text.slice(0, 280),
    source_refs: publishPayload.source_refs,
    framework_terms_used: extractFrameworkTerms(publishPayload.final_text),
    timely_subject: publishPayload.timely_subject,
    research_bundle_id: publishPayload.research_bundle_id,
    winning_candidate_id: publishPayload.winning_candidate_id,
    final_text_hash: sha256(publishPayload.final_text),
    note_slug: note?.slug || null,
    note_source_path: note?.sourcePath || null,
    x_status: x?.status || null,
    x_external_post_id: x?.publishResult?.external_post_id || null,
    x_published_at: x?.publishResult?.delivered_at || null,
    x_winning_candidate_id: x?.winnerCandidate?.id || null,
    x_final_text_hash: x?.payload?.text ? sha256(x.payload.text) : null,
    x_summary: x?.payload?.text ? x.payload.text.slice(0, 280) : null,
    x_skip_reason: x && x.status !== 'published' ? x.reason || null : null,
  };
}

function extractFrameworkTerms(text) {
  const terms = [
    'ritual time',
    'run time',
    'trust',
    'management theater',
    'epimetabolic',
    'li',
    'ren',
    'scapegoat',
    'tragic postmortem',
    'oligarchic decay',
  ];
  const lower = String(text || '').toLowerCase();
  return terms.filter((term) => lower.includes(term));
}

function finalMemoryCheck({ calendarItem, winnerCandidate, strategy, memory, researchBundle, mailbagItem = null }) {
  return getMemoryConflicts({
    record: {
      content_type: calendarItem.content_type,
      hook: winnerCandidate.post_text.split(/\n/)[0].trim(),
      angle: calendarItem.angle,
      topic_thesis: calendarItem.topic_thesis,
      timely_subject: calendarItem.timely_subject,
      source_refs: [
        ...(researchBundle?.sources || []).map((source) => source.url),
        ...(mailbagItem?.provenance ? [mailbagItem.provenance] : []),
      ],
    },
    strategy,
    memory,
  });
}

function loadFreshMemory(strategy, options = {}) {
  return rebuildMemory({ strategy, ...options });
}

module.exports = {
  providerMode,
  createRun,
  updateRun,
  createAdapters,
  selectedPromptVariants,
  ensureResearchBundleForItem,
  ResearchPendingError,
  loadResearchBundle,
  saveResearchBundle,
  prepareBrief,
  generateCandidatesForItem,
  scoreCandidatesForItem,
  createPublishPayload,
  createPublishedRecord,
  loadFreshMemory,
  loadStrategy,
  loadPublishedRecords,
  finalMemoryCheck,
};
