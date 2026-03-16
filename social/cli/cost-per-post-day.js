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
const { OpenAIWriterAdapter } = require('../providers/openai-writer');
const { GPTScorerAdapter } = require('../providers/gpt-scorer');
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
  githubActionsCostUsdPerPostDay: 0,
};

const SCORING_SYSTEM_PROMPT = 'Score LinkedIn post candidates. Be strict. Prefer concise, high-signal posts. A strong opener should create immediate tension, consequence, or pattern-recognition; it should contain substance rather than merely announcing the existence of a note, thought, or post. Heavily penalize generic setup lines, rambling, repeated thesis statements, article-summary behavior, padded examples, and soft endings. Do not force one opener template; reward variety when it still lands sharply. Fail anything that duplicates recent published ideas, exceeds 260 words, or violates the no-emoji/no-hashtag/no-link policy.';

const NORMALIZATION_SYSTEM_PROMPT = 'Normalize a Gemini Deep Research report into a tight research bundle. Prefer dated sources and explain why each source matters to the thesis.';

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

const NORMALIZATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          published_at: { type: 'string' },
          relevance: { type: 'string' },
          claim: { type: 'string' },
        },
        required: ['title', 'url', 'published_at', 'relevance', 'claim'],
      },
    },
    candidate_angles: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          topic_thesis: { type: 'string' },
          angle: { type: 'string' },
          hook: { type: 'string' },
          subject: { type: 'string' },
        },
        required: ['topic_thesis', 'angle', 'hook', 'subject'],
      },
    },
  },
  required: ['summary', 'sources', 'candidate_angles'],
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

function buildNormalizationSample({ topicThesis }) {
  const sampleSources = [
    {
      title: 'Example source one',
      url: 'https://example.com/source-one',
      published_at: '2026-03-15',
      relevance: 'Directly relevant to the thesis.',
      claim: 'The visible story hides an organizational pattern underneath it.',
    },
    {
      title: 'Example source two',
      url: 'https://example.com/source-two',
      published_at: '2026-03-14',
      relevance: 'Adds an adjacent case for contrast.',
      claim: 'Leaders often confuse process expansion with adaptation.',
    },
  ];

  const sampleParagraph = [
    'A recent company event looked tactical on the surface but exposed a deeper coordination failure.',
    'Multiple dated sources show leaders expanding visible process when trust-bearing routines have already degraded.',
    'The actionable lesson is to diagnose the social bottleneck instead of adding more management theater.',
  ].join(' ');

  const rawReport = Array.from({ length: 8 }, (_, index) => `Section ${index + 1}: ${sampleParagraph}`).join('\n\n').slice(0, 2000);

  return {
    topicThesis,
    fallbackSources: sampleSources,
    rawReport,
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
    inputTokens += estimateTokens('Write concise, high-signal LinkedIn posts in Sean Devine’s voice. Return only the post text.');
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
  const inputTokens = estimateTokens(SCORING_SYSTEM_PROMPT)
    + estimateTokens(JSON.stringify(SCORING_SCHEMA))
    + estimateTokens(JSON.stringify(inputPayload, null, 2));
  const outputTokens = estimateTokens(JSON.stringify(outputPayload));

  return {
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

function estimateNormalization({ topicThesis }) {
  const sample = buildNormalizationSample({ topicThesis });
  const outputPayload = {
    summary: 'The event matters because it reveals a social coordination failure rather than a tooling issue.',
    sources: sample.fallbackSources,
    candidate_angles: [
      {
        topic_thesis: topicThesis,
        angle: 'Use the event to diagnose the underlying organizational pattern.',
        hook: 'The visible story is not the real diagnosis.',
        subject: 'adjacent-case-pattern',
      },
    ],
  };

  const inputTokens = estimateTokens(NORMALIZATION_SYSTEM_PROMPT)
    + estimateTokens(JSON.stringify(NORMALIZATION_SCHEMA))
    + estimateTokens(JSON.stringify(sample, null, 2));
  const outputTokens = estimateTokens(JSON.stringify(outputPayload));

  return {
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const strategy = loadStrategy();
  const watchlists = loadWatchlists();
  const memory = rebuildMemory({ strategy, write: false });
  const context = loadSourceContext();
  const calendarPath = args.calendar
    ? path.resolve(process.cwd(), String(args.calendar))
    : latestCalendarFile();
  const calendar = readJson(calendarPath, null);
  if (!calendar || !Array.isArray(calendar.items)) fail(`Invalid calendar file: ${calendarPath}`);

  const items = calendar.items.filter((item) => item.status !== 'skipped');
  const postDays = new Set(items.map((item) => item.scheduled_date)).size;
  if (postDays === 0) fail(`No post days found in calendar: ${calendarPath}`);
  const timelySlotsConfigured = (strategy.publishing?.timely_slots || []).length;
  const timelyResearchEnabled = timelySlotsConfigured > 0;

  const writer = new OpenAIWriterAdapter({
    mode: 'fixture',
    model: strategy.provider_defaults?.openai_model,
    reasoningEffort: strategy.provider_defaults?.openai_reasoning_effort || 'medium',
  });
  const scorer = new GPTScorerAdapter({
    mode: 'fixture',
    model: strategy.provider_defaults?.openai_model,
  });

  const perPost = [];
  let writingWeeklyUsd = 0;
  let scoringWeeklyUsd = 0;

  for (const item of items) {
    const prepared = prepareBrief({ calendarItem: item, strategy, memory });
    const generation = await estimateOpenAIWriting({ prepared, strategy, writer });
    const scoring = estimateOpenAIScoring({ prepared, candidates: generation.candidates, strategy, memory, scorer });
    writingWeeklyUsd += generation.usd;
    scoringWeeklyUsd += scoring.usd;
    perPost.push({
      item_id: item.id,
      scheduled_date: item.scheduled_date,
      content_type: item.content_type,
      openai_generation: {
        candidate_count: generation.candidate_count,
        input_tokens: generation.input_tokens,
        output_tokens: generation.output_tokens,
        usd: generation.usd,
      },
      openai_scoring: {
        scorecard_count: scoring.scorecard_count,
        input_tokens: scoring.input_tokens,
        output_tokens: scoring.output_tokens,
        usd: scoring.usd,
      },
      total_usd: usd(generation.usd + scoring.usd + DEFAULTS.zapierTaskCostUsd),
    });
  }

  const topicThesis = timelyResearchEnabled
    ? (args.topic || selectResearchTopic({
        topics: strategy.topics || [],
        strategy,
        memory,
        context,
        watchlists,
      }))
    : null;

  const normalization = timelyResearchEnabled
    ? estimateNormalization({ topicThesis })
    : { input_tokens: 0, output_tokens: 0, usd: 0 };
  const geminiLow = timelyResearchEnabled
    ? geminiResearchCostForCacheHitRatio(GEMINI_STANDARD_TASK.cacheHitRatioHigh)
    : {
        cache_hit_ratio: null,
        uncached_input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
        search_queries: 0,
        usd: 0,
      };
  const geminiBase = timelyResearchEnabled
    ? geminiResearchCostForCacheHitRatio(GEMINI_STANDARD_TASK.cacheHitRatioBase)
    : {
        cache_hit_ratio: null,
        uncached_input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
        search_queries: 0,
        usd: 0,
      };
  const geminiHigh = timelyResearchEnabled
    ? geminiResearchCostForCacheHitRatio(GEMINI_STANDARD_TASK.cacheHitRatioLow)
    : {
        cache_hit_ratio: null,
        uncached_input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
        search_queries: 0,
        usd: 0,
      };

  const weeklySharedLowUsd = usd((normalization.usd * postDays) + (geminiLow.usd * postDays) + DEFAULTS.githubActionsCostUsdPerPostDay * postDays);
  const weeklySharedBaseUsd = usd((normalization.usd * postDays) + (geminiBase.usd * postDays) + DEFAULTS.githubActionsCostUsdPerPostDay * postDays);
  const weeklySharedHighUsd = usd((normalization.usd * postDays) + (geminiHigh.usd * postDays) + DEFAULTS.githubActionsCostUsdPerPostDay * postDays);

  const weeklyKnownUsd = usd(writingWeeklyUsd + scoringWeeklyUsd + (DEFAULTS.zapierTaskCostUsd * items.length));

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
      writer_pricing_basis: 'OpenAI GPT-5.4 text pricing.',
      openai_model: strategy.provider_defaults?.openai_model,
      gemini_agent: strategy.provider_defaults?.gemini_agent,
      gemini_pricing_basis: 'Google standard Deep Research task assumptions: 250k prompt tokens, 60k output tokens, 80 Google Search queries, 50-70% cache-hit range.',
      timely_scan_runs_per_weekday: 2,
      publish_runs_per_weekday: 2,
      weekly_plan_runs_per_week: 1,
      timely_slots_configured: timelySlotsConfigured,
      timely_research_enabled: timelyResearchEnabled,
      github_actions_repo_cost_basis: 'Assumed zero here; public-repo GitHub-hosted runner minutes are free unless you override the script later.',
      zapier_task_cost_usd: DEFAULTS.zapierTaskCostUsd,
    },
    weekly_cost_usd: {
      low: usd(weeklyKnownUsd + weeklySharedLowUsd),
      base: usd(weeklyKnownUsd + weeklySharedBaseUsd),
      high: usd(weeklyKnownUsd + weeklySharedHighUsd),
      known_post_pipeline: weeklyKnownUsd,
      shared_research_and_workflow: {
        low: weeklySharedLowUsd,
        base: weeklySharedBaseUsd,
        high: weeklySharedHighUsd,
      },
    },
    per_post_day_cost_usd: {
      low: usd((weeklyKnownUsd + weeklySharedLowUsd) / postDays),
      base: usd((weeklyKnownUsd + weeklySharedBaseUsd) / postDays),
      high: usd((weeklyKnownUsd + weeklySharedHighUsd) / postDays),
      known_post_pipeline: usd(weeklyKnownUsd / postDays),
      shared_research_and_workflow: {
        low: usd(weeklySharedLowUsd / postDays),
        base: usd(weeklySharedBaseUsd / postDays),
        high: usd(weeklySharedHighUsd / postDays),
      },
    },
    daily_shared_components_usd: {
      openai_research_normalization: normalization.usd,
      gemini_deep_research: {
        low: geminiLow.usd,
        base: geminiBase.usd,
        high: geminiHigh.usd,
      },
      github_actions: DEFAULTS.githubActionsCostUsdPerPostDay,
    },
    average_per_post_usd: {
      openai_generation: usd(writingWeeklyUsd / items.length),
      openai_scoring: usd(scoringWeeklyUsd / items.length),
      zapier_publish: DEFAULTS.zapierTaskCostUsd,
      total_known: usd(weeklyKnownUsd / items.length),
    },
    token_estimates: {
      normalization,
      average_post_generation_input_tokens: Math.round(perPost.reduce((sum, entry) => sum + entry.openai_generation.input_tokens, 0) / items.length),
      average_post_generation_output_tokens: Math.round(perPost.reduce((sum, entry) => sum + entry.openai_generation.output_tokens, 0) / items.length),
      average_post_scoring_input_tokens: Math.round(perPost.reduce((sum, entry) => sum + entry.openai_scoring.input_tokens, 0) / items.length),
      average_post_scoring_output_tokens: Math.round(perPost.reduce((sum, entry) => sum + entry.openai_scoring.output_tokens, 0) / items.length),
    },
    per_post: perPost,
  });
}

main().catch((error) => fail(error.stack || error.message));
