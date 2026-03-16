#!/usr/bin/env node
const path = require('path');
const { countTokens } = require('gpt-tokenizer');
const { parseArgs, printJson, fail } = require('../lib/cli');
const { listFiles, readJson } = require('../lib/fs');
const { loadStrategy, loadWatchlists } = require('../lib/config');
const { loadSourceContext } = require('../lib/context');
const { rebuildMemory } = require('../lib/memory');
const { prepareBrief, selectedPromptVariants } = require('../lib/pipeline');
const { selectResearchTopic } = require('../lib/planner');
const { getType } = require('../types');
const { OpenAIWriterAdapter } = require('../providers/openai-writer');
const { GPTScorerAdapter } = require('../providers/gpt-scorer');
const { GPTXAdapter, VARIANT_LABELS } = require('../providers/gpt-x');
const { paths } = require('../lib/paths');

const OPENAI_PRICING = {
  model: 'gpt-5.4',
  inputPerMillionUsd: 2.5,
  outputPerMillionUsd: 15,
};

const GEMINI_STANDARD_TASK = {
  agent: 'deep-research-pro-preview-12-2025',
  promptTokens: 250000,
  outputTokens: 60000,
  searchQueries: 80,
  cacheHitRatioLow: 0.5,
  cacheHitRatioBase: 0.6,
  cacheHitRatioHigh: 0.7,
  inputPerMillionUsd: 4,
  cacheReadPerMillionUsd: 0.4,
  outputPerMillionUsd: 18,
  googleSearchPerThousandUsd: 14,
};

const DEFAULTS = {
  zapierTaskCostUsd: 0,
  xPublishCostUsd: 0,
  notesMaterializationCostUsd: 0,
  githubActionsCostUsdPerPostDay: 0,
};

const LINKEDIN_WRITER_SYSTEM_PROMPT = 'Write concise, high-signal LinkedIn posts in Sean Devine’s voice. Return only the post text.';

const LINKEDIN_SCORING_SYSTEM_PROMPT = 'Score LinkedIn post candidates. Be strict. Prefer concise, high-signal posts. A strong opener should create immediate tension, consequence, or pattern-recognition; it should contain substance rather than merely announcing the existence of a note, thought, or post. Heavily penalize generic setup lines, rambling, repeated thesis statements, article-summary behavior, padded examples, and soft endings. Do not force one opener template; reward variety when it still lands sharply. Fail anything that duplicates recent published ideas, exceeds 260 words, or violates the no-emoji/no-hashtag/no-link policy.';

const NOTES_REWRITE_SYSTEM_PROMPT = 'Rewrite a published LinkedIn post into a website note. Preserve the thesis, examples, and structure. Remove platform-native phrasing, engagement bait, hashtags, and CTA tone. Keep it close to the original and do not expand it.';

const X_GENERATION_SYSTEM_PROMPT = [
  'Rewrite a published LinkedIn post into a set of strong single-post X candidates.',
  'Produce concise, sharp prose in 2-3 short paragraphs.',
  'Open with a sharp claim, not an announcement, question, or staged setup.',
  'Favor distinction, contrast, paradox, and diagnostic framing.',
  'Keep the thesis somewhat elliptical rather than over-explained.',
  'Use one concrete anchor where possible.',
  'Allow moderate framework language, but do not make the post insider-only.',
  'End cleanly, without a CTA or operator-advice close unless the source genuinely requires it.',
  'Do not use hashtags, emojis, links, thread markers, bullets, or list numbering.',
  'Do not make the book or free download the point of the post. A brief supporting aside is acceptable only if it is not central.',
  'Avoid performative cleverness, pseudo-profound phrasing, announcement openers, and too-neat slogan reversals.',
].join('\n');

const X_SCORING_SYSTEM_PROMPT = [
  'Score single-post X candidates extremely strictly.',
  'Target style: direct, sharp, compact, concept-led, with one clear consequence. Prefer the family of posts that make a diagnosis quickly and land cleanly.',
  'Reward distinction, contrast, paradox, diagnostic framing, one concrete anchor, and clarity under compression.',
  'Allow some opacity, but fail candidates that become merely obtuse.',
  'Hard fail anything over 280 characters, anything with hashtags, emojis, links, thread markers, or any candidate that makes the book/free download the main payload.',
  'Strongly penalize performative cleverness, announcement openers, pseudo-profound openers, advice-heavy endings, and imprecise slogan-like reversals.',
  'In close calls, prefer the shorter/sharper candidate.',
].join('\n');

const SCORING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          candidate_id: { type: 'string' },
          voice_score: { type: 'number' },
          novelty_score: { type: 'number' },
          clarity_score: { type: 'number' },
          risk_score: { type: 'number' },
          citation_score: { type: 'number' },
          linkedin_native_score: { type: 'number' },
          overall_score: { type: 'number' },
          pass: { type: 'boolean' },
          pass_fail_reasons: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'candidate_id',
          'voice_score',
          'novelty_score',
          'clarity_score',
          'risk_score',
          'citation_score',
          'linkedin_native_score',
          'overall_score',
          'pass',
          'pass_fail_reasons',
        ],
      },
    },
  },
  required: ['scores'],
};

const X_GENERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    candidates: {
      type: 'array',
      minItems: VARIANT_LABELS.length,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          prompt_variant: { type: 'string' },
          post_text: { type: 'string' },
          self_notes: { type: 'string' },
        },
        required: ['prompt_variant', 'post_text', 'self_notes'],
      },
    },
  },
  required: ['candidates'],
};

const X_SCORING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          candidate_id: { type: 'string' },
          clarity_score: { type: 'number' },
          compression_score: { type: 'number' },
          diagnostic_score: { type: 'number' },
          anti_cheese_score: { type: 'number' },
          x_fit_score: { type: 'number' },
          overall_score: { type: 'number' },
          pass: { type: 'boolean' },
          pass_fail_reasons: { type: 'array', items: { type: 'string' } },
        },
        required: ['candidate_id', 'clarity_score', 'compression_score', 'diagnostic_score', 'anti_cheese_score', 'x_fit_score', 'overall_score', 'pass', 'pass_fail_reasons'],
      },
    },
  },
  required: ['scores'],
};

function usd(value) {
  return Number(value.toFixed(6));
}

function costFromTokens({ inputTokens = 0, outputTokens = 0, inputPerMillionUsd, outputPerMillionUsd }) {
  return ((inputTokens / 1_000_000) * inputPerMillionUsd) + ((outputTokens / 1_000_000) * outputPerMillionUsd);
}

function estimateTokens(value) {
  return countTokens(typeof value === 'string' ? value : JSON.stringify(value));
}

function latestCalendarFile() {
  const files = listFiles(paths.calendarDir, (filePath) => path.basename(filePath).startsWith('week-') && filePath.endsWith('.json'))
    .sort();
  if (files.length === 0) throw new Error('No social calendar files found.');
  return files[files.length - 1];
}

function typeRequiresResearch({ typeId, strategy }) {
  const type = getType(typeId);
  const typeConfig = strategy.content_types?.[typeId] || {};
  return Boolean(type?.requiresResearch && typeConfig.requires_research !== false);
}

function syntheticResearchBundle({ topicThesis }) {
  const primarySource = {
    title: 'OpenAI Pentagon deal backlash reveals a naming failure',
    url: 'https://example.com/openai-pentagon-backlash',
    published_at: '2026-03-15',
    relevance: 'This is the visible case the post should open on.',
    claim: 'A deliberate strategic choice was reframed as a communications mistake after backlash.',
    excerpt: 'OpenAI faced backlash after soft constraints around its Pentagon deal became visible.',
    content_text: [
      'OpenAI said it had preserved red lines in its Pentagon deal.',
      'Reporting then suggested the operative terms were softer than the public framing implied.',
      'The backlash turned on whether leadership had named the real choice honestly.',
      'That makes the event a strong decoder-ring case about naming failure, trust, and ritual accountability.',
    ].join(' '),
  };
  return {
    id: 'synthetic-research-bundle',
    provider: 'synthetic',
    topic_thesis: topicThesis,
    summary: 'A recent company event exposed a naming failure and a trust problem underneath the visible controversy.',
    sources: [
      primarySource,
      {
        title: 'Klarna returns to human support after AI backlash',
        url: 'https://example.com/klarna-human-support',
        published_at: '2026-03-14',
        relevance: 'Secondary adjacent case.',
        claim: 'The visible AI move exposed a deeper coordination problem.',
        excerpt: 'The company pulled back from a more automated posture.',
        content_text: 'Klarna shifted back toward human support after AI-related backlash.',
      },
    ],
    primary_source: primarySource,
    candidate_angles: [
      {
        topic_thesis: topicThesis,
        angle: 'Open on the visible case in plain language, then diagnose the naming failure underneath it.',
        hook: 'The visible controversy is not the whole story. The naming around it is the real tell.',
        subject: primarySource.title,
      },
    ],
  };
}

function loadRepresentativeResearchBundle({ topicThesis }) {
  const files = listFiles(paths.researchCacheDir, (filePath) => filePath.endsWith('.json'));
  const bundles = files
    .map((filePath) => readJson(filePath, null))
    .filter(Boolean)
    .filter((bundle) => bundle.primary_source || (Array.isArray(bundle.sources) && bundle.sources.length > 0))
    .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')));
  return bundles[0] || syntheticResearchBundle({ topicThesis });
}

function representativeTopicForType({ typeId, strategy, fallbackTopic }) {
  const preferred = {
    decoder_ring: 'Rectification of Names matters because a leader who cannot call failure failure makes ritual truth-telling a farce.',
    high_lindy_source_tour: 'Knowledge and myth solve different problems, and organizations fail when they confuse them.',
    short_story: 'Trust burns faster than organizations know how to rebuild it.',
    from_the_mailbag: 'Trust burns faster than organizations know how to rebuild it.',
  };
  return preferred[typeId] || fallbackTopic || strategy.topics?.[0] || 'Trust burns faster than organizations know how to rebuild it.';
}

function representativeItemForType({ typeId, strategy, templateItem = null, fallbackTopic }) {
  if (templateItem) return { ...templateItem };
  const type = getType(typeId);
  const weekday = strategy.content_types?.[typeId]?.weekdays?.[0] || 'monday';
  return {
    id: `sample-${typeId}`,
    scheduled_date: '2026-03-16',
    scheduled_time: '05:30',
    scheduled_at: '2026-03-16T12:30:00.000Z',
    timezone: strategy.timezone || 'America/Los_Angeles',
    weekday,
    slot_type: 'baseline',
    status: 'planned',
    content_type: typeId,
    pillar: type?.pillar || typeId,
    topic_thesis: representativeTopicForType({ typeId, strategy, fallbackTopic }),
    angle: type?.defaultAngle || '',
    hook: '',
    source_bundle_id: null,
    timely_subject: null,
  };
}

function geminiResearchCostForCacheHitRatio(cacheHitRatio) {
  const promptTokens = GEMINI_STANDARD_TASK.promptTokens;
  const cachedTokens = promptTokens * cacheHitRatio;
  const uncachedTokens = promptTokens - cachedTokens;
  const searchCost = (GEMINI_STANDARD_TASK.searchQueries / 1000) * GEMINI_STANDARD_TASK.googleSearchPerThousandUsd;
  return {
    cache_hit_ratio: cacheHitRatio,
    uncached_input_tokens: Math.round(uncachedTokens),
    cached_input_tokens: Math.round(cachedTokens),
    output_tokens: GEMINI_STANDARD_TASK.outputTokens,
    search_queries: GEMINI_STANDARD_TASK.searchQueries,
    usd: usd(
      (uncachedTokens / 1_000_000) * GEMINI_STANDARD_TASK.inputPerMillionUsd
      + (cachedTokens / 1_000_000) * GEMINI_STANDARD_TASK.cacheReadPerMillionUsd
      + (GEMINI_STANDARD_TASK.outputTokens / 1_000_000) * GEMINI_STANDARD_TASK.outputPerMillionUsd
      + searchCost
    ),
  };
}

async function estimateOpenAIWriting({ prepared, strategy, writer }) {
  const promptVariants = selectedPromptVariants(strategy);
  const candidates = await writer.generateCandidates({
    brief: prepared.brief,
    promptVariants,
  });

  let inputTokens = 0;
  let outputTokens = 0;

  for (const [index, variant] of promptVariants.entries()) {
    const candidate = candidates[index];
    const variantPrompt = `${prepared.brief.prompt}\n\nVariant: ${variant}`;
    inputTokens += estimateTokens(LINKEDIN_WRITER_SYSTEM_PROMPT);
    inputTokens += estimateTokens(variantPrompt);
    outputTokens += estimateTokens(candidate.post_text);
  }

  return {
    candidates,
    candidate_count: candidates.length,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    usd: usd(costFromTokens({
      inputTokens,
      outputTokens,
      inputPerMillionUsd: OPENAI_PRICING.inputPerMillionUsd,
      outputPerMillionUsd: OPENAI_PRICING.outputPerMillionUsd,
    })),
  };
}

function estimateOpenAIScoring({ prepared, candidates, strategy, memory, scorer }) {
  const sourceRefs = [
    ...(prepared.researchBundle?.sources || []).map((source) => source.url),
    ...(prepared.brief.mailbag_item?.provenance ? [prepared.brief.mailbag_item.provenance] : []),
  ];
  const scorecards = scorer.scoreCandidatesFixture({
    candidates,
    brief: prepared.brief,
    strategy,
    memory,
    sourceRefs,
  });

  const inputPayload = {
    brief: prepared.brief,
    strategy,
    memory,
    sourceRefs,
    candidates,
  };

  const outputPayload = { scores: scorecards.map(({ id, ...rest }) => rest) };
  const inputTokens = estimateTokens(LINKEDIN_SCORING_SYSTEM_PROMPT)
    + estimateTokens(JSON.stringify(SCORING_SCHEMA))
    + estimateTokens(JSON.stringify(inputPayload, null, 2));
  const outputTokens = estimateTokens(JSON.stringify(outputPayload));

  const ranked = [...scorecards].sort((left, right) => right.overall_score - left.overall_score);
  const winnerScore = ranked.find((entry) => entry.pass) || ranked[0] || null;
  const winnerCandidate = winnerScore
    ? candidates.find((candidate) => candidate.id === winnerScore.candidate_id) || null
    : null;

  return {
    scorecards,
    winner_candidate: winnerCandidate,
    winner_score: winnerScore,
    scorecard_count: scorecards.length,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    usd: usd(costFromTokens({
      inputTokens,
      outputTokens,
      inputPerMillionUsd: OPENAI_PRICING.inputPerMillionUsd,
      outputPerMillionUsd: OPENAI_PRICING.outputPerMillionUsd,
    })),
  };
}

async function estimateNotesRewrite({ writer, postText, calendarItem, strategy }) {
  if (!writer || typeof writer.rewriteForNotes !== 'function') {
    return {
      source_mode: 'verbatim_fallback',
      input_tokens: 0,
      output_tokens: 0,
      usd: 0,
    };
  }
  const rewrite = await writer.rewriteForNotes({
    postText,
    topicThesis: calendarItem.topic_thesis,
    pillar: calendarItem.pillar,
    voice: strategy.voice?.description || '',
  });
  const inputPrompt = [
    'Rewrite this published LinkedIn post for the Notes section on Sean Devine’s website.',
    `Voice: ${strategy.voice?.description || ''}`,
    `Pillar: ${calendarItem.pillar}`,
    `Topic thesis: ${calendarItem.topic_thesis}`,
    'Rules:',
    '- Keep the argument, examples, and core structure intact.',
    '- Keep it short and close to the original length.',
    '- Remove LinkedIn-native opener or closer language if present.',
    '- Normalize paragraphing for web reading.',
    '- Do not add a CTA, hashtags, bullets, or links.',
    '- Output only the rewritten note body in Markdown paragraphs.',
    '',
    'Published LinkedIn text:',
    postText,
  ].join('\n');
  const inputTokens = estimateTokens(NOTES_REWRITE_SYSTEM_PROMPT) + estimateTokens(inputPrompt);
  const outputTokens = estimateTokens(rewrite.text || '');
  return {
    source_mode: rewrite.source_mode || 'ai_rewrite',
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    usd: usd(costFromTokens({
      inputTokens,
      outputTokens,
      inputPerMillionUsd: OPENAI_PRICING.inputPerMillionUsd,
      outputPerMillionUsd: OPENAI_PRICING.outputPerMillionUsd,
    })),
  };
}

async function estimateXGeneration({ xWriter, linkedinText, strategy }) {
  if (!strategy?.x?.enabled) {
    return {
      candidates: [],
      candidate_count: 0,
      input_tokens: 0,
      output_tokens: 0,
      usd: 0,
    };
  }
  const bestOfN = Number(strategy?.x?.best_of_n || 8);
  const candidates = await xWriter.generateCandidates({
    linkedinText,
    strategy,
    bestOfN,
  });
  const inputPayload = {
    best_of_n: bestOfN,
    variant_labels: VARIANT_LABELS.slice(0, bestOfN),
    max_length: Number(strategy?.x?.max_length || 280),
    style_center: 'Closest family is direct, sharp, compact, concept-led, with one clear consequence. Avoid obtuse or promotional modes.',
    linkedin_text: linkedinText,
  };
  const outputPayload = {
    candidates: candidates.map((candidate) => ({
      prompt_variant: candidate.prompt_variant,
      post_text: candidate.post_text,
      self_notes: candidate.self_notes,
    })),
  };
  const inputTokens = estimateTokens(X_GENERATION_SYSTEM_PROMPT)
    + estimateTokens(JSON.stringify(X_GENERATION_SCHEMA))
    + estimateTokens(JSON.stringify(inputPayload, null, 2));
  const outputTokens = estimateTokens(JSON.stringify(outputPayload));
  return {
    candidates,
    candidate_count: candidates.length,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    usd: usd(costFromTokens({
      inputTokens,
      outputTokens,
      inputPerMillionUsd: OPENAI_PRICING.inputPerMillionUsd,
      outputPerMillionUsd: OPENAI_PRICING.outputPerMillionUsd,
    })),
  };
}

function estimateXScoring({ xScorer, candidates, linkedinText, strategy }) {
  if (!strategy?.x?.enabled) {
    return {
      scorecards: [],
      scorecard_count: 0,
      input_tokens: 0,
      output_tokens: 0,
      usd: 0,
    };
  }
  const scorecards = xScorer.scoreCandidatesFixture({
    candidates,
    linkedinText,
    strategy,
  });
  const inputPayload = {
    max_length: Number(strategy?.x?.max_length || 280),
    linkedin_text: linkedinText,
    candidates,
  };
  const outputPayload = { scores: scorecards.map(({ id, ...rest }) => rest) };
  const inputTokens = estimateTokens(X_SCORING_SYSTEM_PROMPT)
    + estimateTokens(JSON.stringify(X_SCORING_SCHEMA))
    + estimateTokens(JSON.stringify(inputPayload, null, 2));
  const outputTokens = estimateTokens(JSON.stringify(outputPayload));
  return {
    scorecards,
    scorecard_count: scorecards.length,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    usd: usd(costFromTokens({
      inputTokens,
      outputTokens,
      inputPerMillionUsd: OPENAI_PRICING.inputPerMillionUsd,
      outputPerMillionUsd: OPENAI_PRICING.outputPerMillionUsd,
    })),
  };
}

async function estimateItemCost({ item, strategy, memory, writer, scorer, xWriter, xScorer, researchBundleSample }) {
  const researchBundle = typeRequiresResearch({ typeId: item.content_type, strategy }) ? researchBundleSample : null;
  const prepared = prepareBrief({ calendarItem: item, strategy, memory, researchBundle });
  const generation = await estimateOpenAIWriting({ prepared, strategy, writer });
  const scoring = estimateOpenAIScoring({ prepared, candidates: generation.candidates, strategy, memory, scorer });
  const winnerCandidate = scoring.winner_candidate || generation.candidates[0] || { post_text: '' };
  const notesRewrite = await estimateNotesRewrite({
    writer,
    postText: winnerCandidate.post_text,
    calendarItem: item,
    strategy,
  });
  const xGeneration = await estimateXGeneration({
    xWriter,
    linkedinText: winnerCandidate.post_text,
    strategy,
  });
  const xScoring = estimateXScoring({
    xScorer,
    candidates: xGeneration.candidates,
    linkedinText: winnerCandidate.post_text,
    strategy,
  });
  const requiresResearch = typeRequiresResearch({ typeId: item.content_type, strategy });
  const geminiLow = requiresResearch ? geminiResearchCostForCacheHitRatio(GEMINI_STANDARD_TASK.cacheHitRatioHigh) : { usd: 0 };
  const geminiBase = requiresResearch ? geminiResearchCostForCacheHitRatio(GEMINI_STANDARD_TASK.cacheHitRatioBase) : { usd: 0 };
  const geminiHigh = requiresResearch ? geminiResearchCostForCacheHitRatio(GEMINI_STANDARD_TASK.cacheHitRatioLow) : { usd: 0 };
  const steps = {
    gemini_deep_research: {
      low: usd(geminiLow.usd || 0),
      base: usd(geminiBase.usd || 0),
      high: usd(geminiHigh.usd || 0),
    },
    openai_research_normalization: 0,
    openai_linkedin_generation: generation.usd,
    openai_linkedin_scoring: scoring.usd,
    openai_notes_rewrite: notesRewrite.usd,
    openai_x_generation: xGeneration.usd,
    openai_x_scoring: xScoring.usd,
    notes_materialization_local: DEFAULTS.notesMaterializationCostUsd,
    zapier_publish: DEFAULTS.zapierTaskCostUsd,
    x_publish: DEFAULTS.xPublishCostUsd,
  };
  return {
    item_id: item.id,
    content_type: item.content_type,
    steps,
    token_estimates: {
      linkedin_generation: {
        input_tokens: generation.input_tokens,
        output_tokens: generation.output_tokens,
      },
      linkedin_scoring: {
        input_tokens: scoring.input_tokens,
        output_tokens: scoring.output_tokens,
      },
      notes_rewrite: {
        input_tokens: notesRewrite.input_tokens,
        output_tokens: notesRewrite.output_tokens,
      },
      x_generation: {
        input_tokens: xGeneration.input_tokens,
        output_tokens: xGeneration.output_tokens,
      },
      x_scoring: {
        input_tokens: xScoring.input_tokens,
        output_tokens: xScoring.output_tokens,
      },
    },
    winner_candidate_length: (winnerCandidate.post_text || '').length,
    total_usd: {
      low: usd((geminiLow.usd || 0) + generation.usd + scoring.usd + notesRewrite.usd + xGeneration.usd + xScoring.usd + DEFAULTS.notesMaterializationCostUsd + DEFAULTS.zapierTaskCostUsd + DEFAULTS.xPublishCostUsd),
      base: usd((geminiBase.usd || 0) + generation.usd + scoring.usd + notesRewrite.usd + xGeneration.usd + xScoring.usd + DEFAULTS.notesMaterializationCostUsd + DEFAULTS.zapierTaskCostUsd + DEFAULTS.xPublishCostUsd),
      high: usd((geminiHigh.usd || 0) + generation.usd + scoring.usd + notesRewrite.usd + xGeneration.usd + xScoring.usd + DEFAULTS.notesMaterializationCostUsd + DEFAULTS.zapierTaskCostUsd + DEFAULTS.xPublishCostUsd),
    },
  };
}

function zeroStepTotals() {
  return {
    gemini_deep_research: { low: 0, base: 0, high: 0 },
    openai_research_normalization: 0,
    openai_linkedin_generation: 0,
    openai_linkedin_scoring: 0,
    openai_notes_rewrite: 0,
    openai_x_generation: 0,
    openai_x_scoring: 0,
    notes_materialization_local: 0,
    zapier_publish: 0,
    x_publish: 0,
  };
}

function addWeightedSteps(target, steps, weight = 1) {
  target.gemini_deep_research.low += (steps.gemini_deep_research?.low || 0) * weight;
  target.gemini_deep_research.base += (steps.gemini_deep_research?.base || 0) * weight;
  target.gemini_deep_research.high += (steps.gemini_deep_research?.high || 0) * weight;
  target.openai_research_normalization += (steps.openai_research_normalization || 0) * weight;
  target.openai_linkedin_generation += (steps.openai_linkedin_generation || 0) * weight;
  target.openai_linkedin_scoring += (steps.openai_linkedin_scoring || 0) * weight;
  target.openai_notes_rewrite += (steps.openai_notes_rewrite || 0) * weight;
  target.openai_x_generation += (steps.openai_x_generation || 0) * weight;
  target.openai_x_scoring += (steps.openai_x_scoring || 0) * weight;
  target.notes_materialization_local += (steps.notes_materialization_local || 0) * weight;
  target.zapier_publish += (steps.zapier_publish || 0) * weight;
  target.x_publish += (steps.x_publish || 0) * weight;
  return target;
}

function finalizeStepTotals(steps) {
  return {
    gemini_deep_research: {
      low: usd(steps.gemini_deep_research.low),
      base: usd(steps.gemini_deep_research.base),
      high: usd(steps.gemini_deep_research.high),
    },
    openai_research_normalization: usd(steps.openai_research_normalization),
    openai_linkedin_generation: usd(steps.openai_linkedin_generation),
    openai_linkedin_scoring: usd(steps.openai_linkedin_scoring),
    openai_notes_rewrite: usd(steps.openai_notes_rewrite),
    openai_x_generation: usd(steps.openai_x_generation),
    openai_x_scoring: usd(steps.openai_x_scoring),
    notes_materialization_local: usd(steps.notes_materialization_local),
    zapier_publish: usd(steps.zapier_publish),
    x_publish: usd(steps.x_publish),
  };
}

function totalFromSteps(steps) {
  return {
    low: usd(
      steps.gemini_deep_research.low
      + steps.openai_research_normalization
      + steps.openai_linkedin_generation
      + steps.openai_linkedin_scoring
      + steps.openai_notes_rewrite
      + steps.openai_x_generation
      + steps.openai_x_scoring
      + steps.notes_materialization_local
      + steps.zapier_publish
      + steps.x_publish
    ),
    base: usd(
      steps.gemini_deep_research.base
      + steps.openai_research_normalization
      + steps.openai_linkedin_generation
      + steps.openai_linkedin_scoring
      + steps.openai_notes_rewrite
      + steps.openai_x_generation
      + steps.openai_x_scoring
      + steps.notes_materialization_local
      + steps.zapier_publish
      + steps.x_publish
    ),
    high: usd(
      steps.gemini_deep_research.high
      + steps.openai_research_normalization
      + steps.openai_linkedin_generation
      + steps.openai_linkedin_scoring
      + steps.openai_notes_rewrite
      + steps.openai_x_generation
      + steps.openai_x_scoring
      + steps.notes_materialization_local
      + steps.zapier_publish
      + steps.x_publish
    ),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const strategy = loadStrategy();
  const memory = rebuildMemory({ strategy, write: false });
  const calendarPath = args.calendar
    ? path.resolve(process.cwd(), String(args.calendar))
    : latestCalendarFile();
  const calendar = readJson(calendarPath, null);
  if (!calendar || !Array.isArray(calendar.items)) fail(`Invalid calendar file: ${calendarPath}`);

  const items = calendar.items.filter((item) => item.status !== 'skipped');
  const postDays = new Set(items.map((item) => item.scheduled_date)).size;
  if (postDays === 0) fail(`No post days found in calendar: ${calendarPath}`);
  const watchlists = loadWatchlists();
  const context = loadSourceContext();
  const fallbackTopic = args.topic || selectResearchTopic({
    topics: strategy.topics || [],
    strategy,
    memory,
    context,
    watchlists,
  });
  const researchBundleSample = loadRepresentativeResearchBundle({ topicThesis: fallbackTopic });

  const writer = new OpenAIWriterAdapter({
    mode: 'fixture',
    model: strategy.provider_defaults?.openai_model,
    reasoningEffort: strategy.provider_defaults?.openai_reasoning_effort || 'medium',
  });
  const scorer = new GPTScorerAdapter({
    mode: 'fixture',
    model: strategy.provider_defaults?.openai_model,
  });
  const xWriter = new GPTXAdapter({
    mode: 'fixture',
    model: strategy.x?.writer_model || strategy.provider_defaults?.openai_model,
    reasoningEffort: strategy.x?.writer_reasoning_effort || 'medium',
  });
  const xScorer = new GPTXAdapter({
    mode: 'fixture',
    model: strategy.x?.scorer_model || strategy.provider_defaults?.openai_model,
    reasoningEffort: strategy.x?.scorer_reasoning_effort || 'high',
  });

  const perPost = [];
  for (const item of items) {
    const estimate = await estimateItemCost({
      item,
      strategy,
      memory,
      writer,
      scorer,
      xWriter,
      xScorer,
      researchBundleSample,
    });
    perPost.push({
      item_id: item.id,
      scheduled_date: item.scheduled_date,
      content_type: item.content_type,
      ...estimate,
    });
  }

  const currentWeeklyStepsRaw = perPost.reduce((totals, entry) => addWeightedSteps(totals, entry.steps, 1), zeroStepTotals());
  currentWeeklyStepsRaw.github_actions = DEFAULTS.githubActionsCostUsdPerPostDay * postDays;
  const currentWeeklySteps = finalizeStepTotals(currentWeeklyStepsRaw);
  const currentWeeklyTotal = {
    low: usd(totalFromSteps(currentWeeklySteps).low + (DEFAULTS.githubActionsCostUsdPerPostDay * postDays)),
    base: usd(totalFromSteps(currentWeeklySteps).base + (DEFAULTS.githubActionsCostUsdPerPostDay * postDays)),
    high: usd(totalFromSteps(currentWeeklySteps).high + (DEFAULTS.githubActionsCostUsdPerPostDay * postDays)),
  };
  const currentPerPostDaySteps = finalizeStepTotals({
    gemini_deep_research: {
      low: currentWeeklyStepsRaw.gemini_deep_research.low / postDays,
      base: currentWeeklyStepsRaw.gemini_deep_research.base / postDays,
      high: currentWeeklyStepsRaw.gemini_deep_research.high / postDays,
    },
    openai_research_normalization: currentWeeklyStepsRaw.openai_research_normalization / postDays,
    openai_linkedin_generation: currentWeeklyStepsRaw.openai_linkedin_generation / postDays,
    openai_linkedin_scoring: currentWeeklyStepsRaw.openai_linkedin_scoring / postDays,
    openai_notes_rewrite: currentWeeklyStepsRaw.openai_notes_rewrite / postDays,
    openai_x_generation: currentWeeklyStepsRaw.openai_x_generation / postDays,
    openai_x_scoring: currentWeeklyStepsRaw.openai_x_scoring / postDays,
    notes_materialization_local: currentWeeklyStepsRaw.notes_materialization_local / postDays,
    zapier_publish: currentWeeklyStepsRaw.zapier_publish / postDays,
    x_publish: currentWeeklyStepsRaw.x_publish / postDays,
  });
  const currentPerPostDayTotal = {
    low: usd(currentWeeklyTotal.low / postDays),
    base: usd(currentWeeklyTotal.base / postDays),
    high: usd(currentWeeklyTotal.high / postDays),
  };

  const representativeTypeCosts = [];
  const targetWeights = Object.entries(strategy.content_types || {})
    .filter(([, config]) => config?.enabled !== false)
    .map(([typeId, config]) => ({ typeId, weight: Number(config?.target_weight || 0) }))
    .filter((entry) => entry.weight > 0);
  const totalWeight = targetWeights.reduce((sum, entry) => sum + entry.weight, 0) || 1;
  const itemsByType = new Map(items.map((item) => [item.content_type, item]));

  for (const { typeId, weight } of targetWeights) {
    const representativeItem = representativeItemForType({
      typeId,
      strategy,
      templateItem: itemsByType.get(typeId) || null,
      fallbackTopic,
    });
    const estimate = await estimateItemCost({
      item: representativeItem,
      strategy,
      memory,
      writer,
      scorer,
      xWriter,
      xScorer,
      researchBundleSample,
    });
    representativeTypeCosts.push({
      type_id: typeId,
      weight: usd(weight / totalWeight),
      ...estimate,
    });
  }

  const mixWeightedStepsRaw = representativeTypeCosts.reduce(
    (totals, entry) => addWeightedSteps(totals, entry.steps, entry.weight),
    zeroStepTotals(),
  );
  const mixWeightedSteps = finalizeStepTotals(mixWeightedStepsRaw);
  const mixWeightedTotal = totalFromSteps(mixWeightedSteps);
  const averagePerPost = finalizeStepTotals({
    gemini_deep_research: {
      low: perPost.reduce((sum, entry) => sum + entry.steps.gemini_deep_research.low, 0) / items.length,
      base: perPost.reduce((sum, entry) => sum + entry.steps.gemini_deep_research.base, 0) / items.length,
      high: perPost.reduce((sum, entry) => sum + entry.steps.gemini_deep_research.high, 0) / items.length,
    },
    openai_research_normalization: perPost.reduce((sum, entry) => sum + entry.steps.openai_research_normalization, 0) / items.length,
    openai_linkedin_generation: perPost.reduce((sum, entry) => sum + entry.steps.openai_linkedin_generation, 0) / items.length,
    openai_linkedin_scoring: perPost.reduce((sum, entry) => sum + entry.steps.openai_linkedin_scoring, 0) / items.length,
    openai_notes_rewrite: perPost.reduce((sum, entry) => sum + entry.steps.openai_notes_rewrite, 0) / items.length,
    openai_x_generation: perPost.reduce((sum, entry) => sum + entry.steps.openai_x_generation, 0) / items.length,
    openai_x_scoring: perPost.reduce((sum, entry) => sum + entry.steps.openai_x_scoring, 0) / items.length,
    notes_materialization_local: perPost.reduce((sum, entry) => sum + entry.steps.notes_materialization_local, 0) / items.length,
    zapier_publish: perPost.reduce((sum, entry) => sum + entry.steps.zapier_publish, 0) / items.length,
    x_publish: perPost.reduce((sum, entry) => sum + entry.steps.x_publish, 0) / items.length,
  });
  const averagePerPostTotal = totalFromSteps(averagePerPost);

  printJson({
    ok: true,
    calendar_path: calendarPath,
    post_days_per_week: postDays,
    posts_in_calendar_week: items.length,
    assumptions: {
      pricing_as_of: '2026-03-15',
      writer_provider: strategy.provider_defaults?.writer_provider || 'claude',
      writer_model: strategy.provider_defaults?.openai_model,
      writer_reasoning_effort: strategy.provider_defaults?.openai_reasoning_effort || 'medium',
      notes_rewrite_model: strategy.provider_defaults?.openai_model,
      x_writer_model: strategy.x?.writer_model || strategy.provider_defaults?.openai_model,
      x_writer_reasoning_effort: strategy.x?.writer_reasoning_effort || 'medium',
      x_scorer_model: strategy.x?.scorer_model || strategy.provider_defaults?.openai_model,
      x_scorer_reasoning_effort: strategy.x?.scorer_reasoning_effort || 'high',
      writer_pricing_basis: 'OpenAI GPT-5.4 text pricing.',
      openai_model: strategy.provider_defaults?.openai_model,
      gemini_agent: strategy.provider_defaults?.gemini_agent,
      gemini_pricing_basis: 'Google standard Deep Research task assumptions: 250k prompt tokens, 60k output tokens, 80 Google Search queries, 50-70% cache-hit range.',
      decoder_ring_requires_research: true,
      notes_rewrite_enabled: true,
      x_enabled: Boolean(strategy?.x?.enabled),
      x_best_of_n: Number(strategy?.x?.best_of_n || 8),
      github_actions_repo_cost_basis: 'Assumed zero here; public-repo GitHub-hosted runner minutes are free unless you override the script later.',
      notes_materialization_cost_usd: DEFAULTS.notesMaterializationCostUsd,
      zapier_task_cost_usd: DEFAULTS.zapierTaskCostUsd,
      x_publish_cost_usd: DEFAULTS.xPublishCostUsd,
      representative_research_bundle_id: researchBundleSample.id || null,
    },
    current_calendar_weekly_cost_usd: {
      low: currentWeeklyTotal.low,
      base: currentWeeklyTotal.base,
      high: currentWeeklyTotal.high,
      step_breakdown: {
        ...currentWeeklySteps,
        github_actions: usd(DEFAULTS.githubActionsCostUsdPerPostDay * postDays),
      },
    },
    current_calendar_average_per_post_day_usd: {
      low: currentPerPostDayTotal.low,
      base: currentPerPostDayTotal.base,
      high: currentPerPostDayTotal.high,
      step_breakdown: {
        ...currentPerPostDaySteps,
        github_actions: usd(DEFAULTS.githubActionsCostUsdPerPostDay),
      },
    },
    target_mix_average_per_post_day_usd: {
      low: mixWeightedTotal.low,
      base: mixWeightedTotal.base,
      high: mixWeightedTotal.high,
      step_breakdown: {
        ...mixWeightedSteps,
        github_actions: usd(DEFAULTS.githubActionsCostUsdPerPostDay),
      },
    },
    average_per_post_usd: {
      low: averagePerPostTotal.low,
      base: averagePerPostTotal.base,
      high: averagePerPostTotal.high,
      step_breakdown: averagePerPost,
    },
    per_post: perPost,
    representative_type_costs_for_mix: representativeTypeCosts,
  });
}

main().catch((error) => fail(error.stack || error.message));
