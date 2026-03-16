#!/usr/bin/env node
const path = require('path');
const { parseArgs, printJson, fail } = require('../lib/cli');
const { loadStrategy } = require('../lib/config');
const { rebuildMemory } = require('../lib/memory');
const { prepareBrief } = require('../lib/pipeline');
const { GPTScorerAdapter } = require('../providers/gpt-scorer');
const { listFiles, readJson, writeJson, ensureDir } = require('../lib/fs');
const { paths } = require('../lib/paths');

const REQUEST_TIMEOUT_MS = 60000;
const OPENAI_PRICING = {
  'gpt-5.4': {
    inputPerMillionUsd: 2.5,
    outputPerMillionUsd: 15,
  },
};
const ANTHROPIC_PRICING = {
  'claude-opus-4-6': {
    inputPerMillionUsd: 5,
    outputPerMillionUsd: 25,
  },
};
const GEMINI_PRICING = {
  'gemini-3-pro-preview': {
    inputPerMillionUsd: 2,
    outputPerMillionUsd: 12,
  },
};

function usd(value) {
  return Number((value || 0).toFixed(6));
}

function latestCalendarFile() {
  const files = listFiles(paths.calendarDir, (filePath) => path.basename(filePath).startsWith('week-') && filePath.endsWith('.json'))
    .sort();
  if (files.length === 0) throw new Error('No social calendar files found.');
  return files[files.length - 1];
}

function loadItems({ calendarPath, limit }) {
  const calendar = readJson(calendarPath, null);
  if (!calendar || !Array.isArray(calendar.items)) {
    throw new Error(`Invalid calendar file: ${calendarPath}`);
  }
  return calendar.items
    .filter((item) => item.status === 'planned')
    .sort((left, right) => left.scheduled_at.localeCompare(right.scheduled_at))
    .slice(0, limit);
}

function systemPrompt() {
  return 'Write concise, high-signal LinkedIn posts in Sean Devine’s voice. Return only the post text.';
}

function extractOpenAIText(payload) {
  if (payload.output_text) return payload.output_text.trim();
  const chunks = [];
  for (const output of payload.output || []) {
    for (const part of output.content || []) {
      if (part.type === 'output_text' && part.text) chunks.push(part.text);
    }
  }
  return chunks.join('\n').trim();
}

function parseJsonText(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Empty JSON response.');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  return JSON.parse(candidate);
}

function computeTextCost({ modelId, inputTokens, outputTokens }) {
  const pricing = OPENAI_PRICING[modelId] || ANTHROPIC_PRICING[modelId] || GEMINI_PRICING[modelId];
  if (!pricing) return null;
  return usd(
    (Number(inputTokens || 0) / 1_000_000) * pricing.inputPerMillionUsd
      + (Number(outputTokens || 0) / 1_000_000) * pricing.outputPerMillionUsd
  );
}

function judgeSchemaDescription() {
  return {
    scores: [
      {
        candidate_id: 'string',
        overall_score: 'number 0-10',
        pass: 'boolean',
        pass_fail_reasons: ['string'],
      },
    ],
  };
}

function judgeSystemPrompt(judgeName) {
  return [
    'You are a strict judge scoring LinkedIn post candidates.',
    'Use the same standard regardless of who wrote the draft.',
    'Optimize for sharp openers, concise operator-level writing, one clear idea, and a strong ending.',
    'Heavily penalize empty rhetoric, article-summary behavior, throat-clearing, repeated thesis statements, and incomplete drafts.',
    'Fail anything that is not publishable as-is.',
    `Return valid JSON only with this shape: ${JSON.stringify(judgeSchemaDescription())}`,
    `Judge identity: ${judgeName}.`,
  ].join(' ');
}

function buildJudgePayload({ prepared, candidates, sourceRefs }) {
  return {
    brief: {
      content_type: prepared.brief.content_type,
      topic_thesis: prepared.brief.topic_thesis,
      angle: prepared.brief.angle,
      hook: prepared.brief.hook,
      voice: prepared.brief.voice,
    },
    rules: {
      no_emojis: true,
      no_hashtags: true,
      no_links: true,
      prefer_concise: true,
      target_words: 'roughly 90-170 words, absolute max 260',
      source_refs: sourceRefs,
    },
    candidates: candidates.map((candidate) => ({
      candidate_id: candidate.id,
      prompt_variant: candidate.prompt_variant,
      post_text: candidate.post_text,
    })),
  };
}

async function generateWithOpenAI({ model, effort, prompt, apiKey }) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      reasoning: { effort },
      max_output_tokens: 1800,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: systemPrompt() }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: prompt }],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI generation failed (${response.status}): ${await response.text()}`);
  }
  const payload = await response.json();
  return {
    text: extractOpenAIText(payload),
    usage: payload.usage || null,
  };
}

async function judgeWithAnthropic({ model, payload, apiKey, judgeName }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      temperature: 0,
      system: judgeSystemPrompt(judgeName),
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Anthropic judge failed (${response.status}): ${await response.text()}`);
  }
  const body = await response.json();
  const text = (body.content || []).map((part) => part.text || '').join('\n').trim();
  return {
    parsed: parseJsonText(text),
    usage: body.usage || null,
  };
}

async function judgeWithGemini({ model, payload, apiKey, judgeName }) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: judgeSystemPrompt(judgeName) }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: JSON.stringify(payload, null, 2) }],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 2000,
          responseMimeType: 'application/json',
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`Gemini judge failed (${response.status}): ${await response.text()}`);
    }
    const body = await response.json();
    const text = (body.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('\n').trim();
    try {
      return {
        parsed: parseJsonText(text),
        usage: body.usageMetadata || null,
      };
    } catch (error) {
      lastError = error;
      if (attempt === 3) {
        throw new Error(`Gemini judge returned invalid JSON after 3 attempts: ${error.message}`);
      }
    }
  }
  throw lastError || new Error('Gemini judge failed without a parseable response.');
}

function normalizeScores({ judgeId, judgeLabel, scores, candidates }) {
  const byId = new Map((scores || []).map((score) => [score.candidate_id, score]));
  return candidates.map((candidate) => {
    const raw = byId.get(candidate.id) || {};
    return {
      judge_id: judgeId,
      judge: judgeLabel,
      candidate_id: candidate.id,
      n: candidate.n,
      overall_score: Number(raw.overall_score || 0),
      pass: Boolean(raw.pass),
      pass_fail_reasons: Array.isArray(raw.pass_fail_reasons) ? raw.pass_fail_reasons : [],
    };
  }).sort((left, right) => right.overall_score - left.overall_score)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const strategy = loadStrategy();
  const memory = rebuildMemory({ strategy, write: false });
  const calendarPath = args.calendar
    ? path.resolve(process.cwd(), String(args.calendar))
    : latestCalendarFile();
  const limit = Number(args.limit || 3);
  const model = String(args.model || strategy.provider_defaults?.openai_model || 'gpt-5.4');
  const effort = String(args.effort || strategy.provider_defaults?.openai_reasoning_effort || 'medium');
  const selectorOnly = Boolean(args['selector-only']);
  const promptVariants = (strategy.generation?.prompt_variants || []).slice(0, Number(args['max-n'] || (strategy.generation?.best_of_n || 4)));
  const items = loadItems({ calendarPath, limit });
  if (items.length === 0) fail(`No planned items found in ${calendarPath}`);
  if (promptVariants.length === 0) fail('No prompt variants configured.');
  if (!process.env.OPENAI_API_KEY) fail('Missing OPENAI_API_KEY.');
  const selector = new GPTScorerAdapter({ mode: 'live', model });
  const gptJudge = new GPTScorerAdapter({ mode: 'live', model });
  const ns = Array.from({ length: promptVariants.length }, (_, index) => index + 1);

  if (!selectorOnly && !process.env.ANTHROPIC_API_KEY) fail('Missing ANTHROPIC_API_KEY.');
  if (!selectorOnly && !process.env.GEMINI_API_KEY) fail('Missing GEMINI_API_KEY.');

  const judges = selectorOnly ? [] : [
    {
      id: 'gpt54',
      label: model,
      evaluate: async ({ prepared, candidates, sourceRefs }) => {
        const scorecards = await gptJudge.scoreCandidates({
          candidates,
          brief: prepared.brief,
          strategy,
          memory,
          sourceRefs,
        });
        return {
          normalized: normalizeScores({
            judgeId: 'gpt54',
            judgeLabel: model,
            scores: scorecards,
            candidates,
          }),
          usage: gptJudge.lastUsage || null,
        };
      },
    },
    {
      id: 'opus',
      label: 'Claude Opus 4.6',
      evaluate: async ({ prepared, candidates, sourceRefs }) => {
        const payload = buildJudgePayload({ prepared, candidates, sourceRefs });
        const judged = await judgeWithAnthropic({
          model: 'claude-opus-4-6',
          payload,
          apiKey: process.env.ANTHROPIC_API_KEY,
          judgeName: 'Claude Opus 4.6',
        });
        return {
          normalized: normalizeScores({
            judgeId: 'opus',
            judgeLabel: 'Claude Opus 4.6',
            scores: judged.parsed.scores,
            candidates,
          }),
          usage: judged.usage,
        };
      },
    },
    {
      id: 'gemini3',
      label: 'Gemini 3 Pro Preview',
      evaluate: async ({ prepared, candidates, sourceRefs }) => {
        const payload = buildJudgePayload({ prepared, candidates, sourceRefs });
        const judged = await judgeWithGemini({
          model: 'gemini-3-pro-preview',
          payload,
          apiKey: process.env.GEMINI_API_KEY,
          judgeName: 'Gemini 3 Pro Preview',
        });
        return {
          normalized: normalizeScores({
            judgeId: 'gemini3',
            judgeLabel: 'Gemini 3 Pro Preview',
            scores: judged.parsed.scores,
            candidates,
          }),
          usage: judged.usage,
        };
      },
    },
  ];

  const aggregate = new Map(ns.map((n) => [n, {
    n,
    selectedVariants: [],
    selectorScores: [],
    selectorPassCount: 0,
    panelScores: [],
    panelPassCount: 0,
    panelRanks: [],
    panelWins: 0,
    productionGenerationCostUsd: 0,
    productionSelectionCostUsd: 0,
  }]));
  const itemResults = [];

  for (const item of items) {
    const prepared = prepareBrief({ calendarItem: item, strategy, memory });
    const generated = [];
    for (const variant of promptVariants) {
      const prompt = `${prepared.type.buildPrompt(prepared.brief, variant)}\n\nVariant: ${variant}`;
      const result = await generateWithOpenAI({
        model,
        effort,
        prompt,
        apiKey: process.env.OPENAI_API_KEY,
      });
      generated.push({
        id: `${item.id}-${variant}`,
        prompt_variant: variant,
        post_text: result.text,
        writer_model: model,
        usage: result.usage,
        generation_cost_usd: computeTextCost({
          modelId: model,
          inputTokens: result.usage?.input_tokens,
          outputTokens: result.usage?.output_tokens,
        }),
      });
    }

    const sourceRefs = [
      ...(prepared.researchBundle?.sources || []).map((source) => source.url),
      ...(prepared.brief.mailbag_item?.provenance ? [prepared.brief.mailbag_item.provenance] : []),
    ];

    const winners = [];
    for (const n of ns) {
      const candidates = generated.slice(0, n).map((candidate) => ({
        id: candidate.id,
        writer_model: candidate.writer_model,
        prompt_variant: candidate.prompt_variant,
        post_text: candidate.post_text,
        self_notes: `best_of_n=${n}`,
      }));
      const scorecards = await selector.scoreCandidates({
        candidates,
        brief: prepared.brief,
        strategy,
        memory,
        sourceRefs,
      });
      const selectorUsage = selector.lastUsage || null;
      const ranked = [...scorecards].sort((left, right) => right.overall_score - left.overall_score);
      const winnerScore = ranked.find((entry) => entry.pass) || ranked[0] || null;
      const winnerCandidate = winnerScore
        ? candidates.find((candidate) => candidate.id === winnerScore.candidate_id) || null
        : null;
      if (!winnerCandidate || !winnerScore) {
        throw new Error(`No winner found for item ${item.id} at best_of_n=${n}`);
      }

      const generationCostUsd = generated
        .slice(0, n)
        .reduce((sum, entry) => sum + Number(entry.generation_cost_usd || 0), 0);
      const selectionCostUsd = computeTextCost({
        modelId: model,
        inputTokens: selectorUsage?.input_tokens,
        outputTokens: selectorUsage?.output_tokens,
      });

      const bucket = aggregate.get(n);
      bucket.selectedVariants.push(winnerCandidate.prompt_variant);
      bucket.selectorScores.push(Number(winnerScore.overall_score || 0));
      if (winnerScore.pass) bucket.selectorPassCount += 1;
      bucket.productionGenerationCostUsd += Number(generationCostUsd || 0);
      bucket.productionSelectionCostUsd += Number(selectionCostUsd || 0);

      winners.push({
        id: `${item.id}-best-of-${n}`,
        n,
        prompt_variant: winnerCandidate.prompt_variant,
        post_text: winnerCandidate.post_text,
        selector_score: Number(winnerScore.overall_score || 0),
        selector_pass: Boolean(winnerScore.pass),
        generation_cost_usd: usd(generationCostUsd),
        selection_cost_usd: usd(selectionCostUsd || 0),
        total_production_cost_usd: usd(generationCostUsd + Number(selectionCostUsd || 0)),
      });
    }

    const judgePanels = [];
    if (!selectorOnly) {
      for (const judge of judges) {
        const panel = await judge.evaluate({ prepared, candidates: winners, sourceRefs });
        judgePanels.push({
          judge_id: judge.id,
          judge: judge.label,
          usage: panel.usage,
          rankings: panel.normalized,
        });
        if (panel.normalized[0]) {
          const winnerBucket = aggregate.get(panel.normalized[0].n);
          if (winnerBucket) winnerBucket.panelWins += 1;
        }
        for (const row of panel.normalized) {
          const bucket = aggregate.get(row.n);
          if (!bucket) continue;
          bucket.panelScores.push(Number(row.overall_score || 0));
          bucket.panelRanks.push(Number(row.rank || 0));
          if (row.pass) bucket.panelPassCount += 1;
        }
      }
    }

    itemResults.push({
      item_id: item.id,
      scheduled_date: item.scheduled_date,
      content_type: item.content_type,
      topic_thesis: item.topic_thesis,
      generated: generated.map((entry) => ({
        prompt_variant: entry.prompt_variant,
        opener: entry.post_text.split(/\n/)[0].trim(),
        text_length: entry.post_text.length,
        generation_cost_usd: entry.generation_cost_usd,
      })),
      winners_by_n: winners,
      judge_panels: judgePanels,
    });
  }

  const totalPanels = items.length * judges.length;
  const summary = ns.map((n) => {
    const entry = aggregate.get(n);
    const selectorAverage = entry.selectorScores.length > 0
      ? entry.selectorScores.reduce((sum, value) => sum + value, 0) / entry.selectorScores.length
      : 0;
    const panelAverageScore = entry.panelScores.length > 0
      ? entry.panelScores.reduce((sum, value) => sum + value, 0) / entry.panelScores.length
      : 0;
    const panelAverageRank = entry.panelRanks.length > 0
      ? entry.panelRanks.reduce((sum, value) => sum + value, 0) / entry.panelRanks.length
      : 0;
    const totalProductionCostUsd = entry.productionGenerationCostUsd + entry.productionSelectionCostUsd;
    return {
      best_of_n: n,
      variants_considered: promptVariants.slice(0, n),
      selector_average_winner_score: Number(selectorAverage.toFixed(3)),
      selector_pass_rate: Number((entry.selectorPassCount / items.length).toFixed(3)),
      panel_average_score: selectorOnly ? null : Number(panelAverageScore.toFixed(3)),
      panel_average_rank: selectorOnly ? null : Number(panelAverageRank.toFixed(3)),
      panel_pass_rate: selectorOnly ? null : Number((entry.panelPassCount / totalPanels).toFixed(3)),
      panel_wins: selectorOnly ? null : entry.panelWins,
      average_production_cost_per_item_usd: usd(totalProductionCostUsd / items.length),
      average_generation_cost_per_item_usd: usd(entry.productionGenerationCostUsd / items.length),
      average_selection_cost_per_item_usd: usd(entry.productionSelectionCostUsd / items.length),
      selected_variants: entry.selectedVariants,
    };
  });

  const output = {
    ok: true,
    checked_on: '2026-03-15',
    bakeoff: {
      calendar_path: calendarPath,
      items_evaluated: items.length,
      writer_model: model,
      writer_reasoning_effort: effort,
      selector_only: selectorOnly,
      prompt_variants: promptVariants,
      judges: judges.map((judge) => judge.label),
      methodology: selectorOnly
        ? 'For each item, generate all configured prompt variants once, then select the production winner for each best_of_n using the GPT scorer on the first n variants.'
        : 'For each item, generate all configured prompt variants once, select the production winner for each best_of_n using the GPT scorer on the first n variants, then have a three-judge panel score those selected winners.',
    },
    summary,
    item_results: itemResults,
  };

  const outDir = path.join(paths.socialRoot, 'cache', 'bakeoffs');
  ensureDir(outDir);
  const outPath = path.join(outDir, `best-of-n-bakeoff-2026-03-15-${items.length}items.json`);
  writeJson(outPath, output);
  printJson({ out_path: outPath, ...output });
}

if (require.main === module) {
  main().catch((error) => fail(error.stack || error.message));
}

module.exports = {
  main,
};
