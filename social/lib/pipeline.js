const path = require('path');
const { loadStrategy } = require('./config');
const { loadSourceContext, deriveSourceEvidence } = require('./context');
const { readJson, writeJson } = require('./fs');
const { paths } = require('./paths');
const { rebuildMemory, loadPublishedRecords, getMemoryConflicts } = require('./memory');
const { loadMailbagItems } = require('./planner');
const { buildBrief } = require('./briefs');
const { getType } = require('../types');
const { GPTScorerAdapter } = require('../providers/gpt-scorer');
const { ClaudeWriterAdapter } = require('../providers/claude-writer');
const { GeminiResearchAdapter } = require('../providers/gemini-research');
const { ZapierPublisherAdapter } = require('../providers/zapier-publisher');
const { runFilePath } = require('./records');
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
  return {
    mode,
    claude: new ClaudeWriterAdapter({
      mode,
      model: process.env.ANTHROPIC_MODEL || strategy.provider_defaults?.claude_model,
    }),
    scorer: new GPTScorerAdapter({
      mode,
      model: process.env.OPENAI_MODEL || strategy.provider_defaults?.openai_model,
    }),
    gemini: new GeminiResearchAdapter({
      mode,
      agent: process.env.GEMINI_AGENT || strategy.provider_defaults?.gemini_agent,
    }),
    zapier: new ZapierPublisherAdapter({ mode }),
  };
}

function loadResearchBundle(bundleId) {
  if (!bundleId) return null;
  return readJson(path.join(paths.researchCacheDir, `${bundleId}.json`), null);
}

function saveResearchBundle(bundle) {
  writeJson(path.join(paths.researchCacheDir, `${bundle.id}.json`), bundle);
}

function prepareBrief({ calendarItem, strategy, memory = null }) {
  const baseContext = loadSourceContext();
  const context = {
    ...baseContext,
    sourceEvidence: deriveSourceEvidence({
      topicThesis: calendarItem.topic_thesis,
      contextText: baseContext.contextText,
      pullQuotes: baseContext.pullQuotes,
      contentType: calendarItem.content_type,
    }),
  };
  const mailbagItems = loadMailbagItems();
  const researchBundle = loadResearchBundle(calendarItem.source_bundle_id);
  const brief = buildBrief({
    calendarItem,
    strategy,
    context,
    researchBundle,
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
    researchBundle,
    type,
  };
}

async function generateCandidatesForItem({ calendarItem, strategy, adapters, memory = null }) {
  const prepared = prepareBrief({ calendarItem, strategy, memory });
  const candidates = await adapters.claude.generateCandidates({
    brief: prepared.brief,
    promptVariants: strategy.generation?.prompt_variants || ['hook_forward', 'diagnosis_forward', 'operator_forward', 'contrarian_forward'],
  });
  return { ...prepared, candidates };
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

function createPublishedRecord({ publishPayload, publishResult, calendarItem }) {
  return {
    post_id: publishResult.external_post_id,
    published_at: publishResult.delivered_at,
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
