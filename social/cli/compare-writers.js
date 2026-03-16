#!/usr/bin/env node
const path = require('path');
const { parseArgs, printJson, fail } = require('../lib/cli');
const { loadStrategy } = require('../lib/config');
const { rebuildMemory } = require('../lib/memory');
const { prepareBrief } = require('../lib/pipeline');
const { GPTScorerAdapter } = require('../providers/gpt-scorer');
const { listFiles, readJson } = require('../lib/fs');
const { paths } = require('../lib/paths');

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
  'claude-sonnet-4-6': {
    inputPerMillionUsd: 3,
    outputPerMillionUsd: 15,
  },
};

const GEMINI_PRICING = {
  'gemini-3-pro-preview': {
    inputPerMillionUsd: 2,
    outputPerMillionUsd: 12,
  },
};

const REQUEST_TIMEOUT_MS = 60000;

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

function scoreSourceRefs(prepared) {
  return [
    ...(prepared.researchBundle?.sources || []).map((source) => source.url),
    ...(prepared.brief.mailbag_item?.provenance ? [prepared.brief.mailbag_item.provenance] : []),
  ];
}

function systemPrompt() {
  return 'Write concise, high-signal LinkedIn posts in Sean Devine’s voice. Return only the post text.';
}

function pricingForModel(modelId) {
  return OPENAI_PRICING[modelId] || ANTHROPIC_PRICING[modelId] || GEMINI_PRICING[modelId] || null;
}

function computeTextCost({ modelId, inputTokens, outputTokens }) {
  const pricing = pricingForModel(modelId);
  if (!pricing) return null;
  return usd(
    (Number(inputTokens || 0) / 1_000_000) * pricing.inputPerMillionUsd
      + (Number(outputTokens || 0) / 1_000_000) * pricing.outputPerMillionUsd
  );
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

async function generateWithOpenAI({ model, prompt, apiKey, effort = 'medium' }) {
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
    usage: payload.usage || {},
  };
}

async function generateWithAnthropic({ model, prompt, apiKey }) {
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
      max_tokens: 900,
      temperature: 0.9,
      system: systemPrompt(),
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic generation failed (${response.status}): ${await response.text()}`);
  }
  const payload = await response.json();
  return {
    text: (payload.content || []).map((part) => part.text || '').join('\n').trim(),
    usage: payload.usage || {},
  };
}

async function generateWithGemini({ model, prompt, apiKey }) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt() }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 1200,
        thinkingConfig: {
          thinkingBudget: 128,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini generation failed (${response.status}): ${await response.text()}`);
  }
  const payload = await response.json();
  const text = (payload.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '')
    .join('\n')
    .trim();
  return {
    text,
    usage: payload.usageMetadata || {},
  };
}

async function runWriter({ entry, prepared, strategy }) {
  const promptVariants = prepared.promptVariants;
  const candidates = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (const variant of promptVariants) {
    const prompt = `${prepared.type.buildPrompt(prepared.brief, variant)}\n\nVariant: ${variant}`;
    let generated;
    if (entry.provider === 'openai') {
      generated = await generateWithOpenAI({
        model: entry.model,
        prompt,
        apiKey: process.env.OPENAI_API_KEY,
        effort: entry.reasoning_effort || 'medium',
      });
      inputTokens += Number(generated.usage.input_tokens || 0);
      outputTokens += Number(generated.usage.output_tokens || 0);
    } else if (entry.provider === 'anthropic') {
      generated = await generateWithAnthropic({ model: entry.model, prompt, apiKey: process.env.ANTHROPIC_API_KEY });
      inputTokens += Number(generated.usage.input_tokens || 0);
      outputTokens += Number(generated.usage.output_tokens || 0);
    } else if (entry.provider === 'gemini') {
      generated = await generateWithGemini({ model: entry.model, prompt, apiKey: process.env.GEMINI_API_KEY });
      inputTokens += Number(generated.usage.promptTokenCount || 0);
      outputTokens += Number(generated.usage.candidatesTokenCount || 0);
    } else {
      throw new Error(`Unknown provider: ${entry.provider}`);
    }

    candidates.push({
      id: `${entry.id}-${prepared.brief.content_type}-${variant}`,
      writer_model: entry.model,
      prompt_variant: variant,
      post_text: generated.text,
      self_notes: `${entry.label} candidate in ${variant} mode.`,
    });
  }

  return {
    candidates,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      generation_cost_usd: computeTextCost({
        modelId: entry.model,
        inputTokens,
        outputTokens,
      }),
    },
  };
}

async function scoreCandidates({ scorer, candidates, prepared, strategy, memory }) {
  const sourceRefs = scoreSourceRefs(prepared);
  const scorecards = await scorer.scoreCandidates({
    candidates,
    brief: prepared.brief,
    strategy,
    memory,
    sourceRefs,
  });
  const ranked = [...scorecards].sort((left, right) => right.overall_score - left.overall_score);
  const winnerScore = ranked.find((entry) => entry.pass) || ranked[0] || null;
  const winnerCandidate = winnerScore
    ? candidates.find((candidate) => candidate.id === winnerScore.candidate_id) || null
    : null;
  return { scorecards, winnerScore, winnerCandidate };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const strategy = loadStrategy();
  const memory = rebuildMemory({ strategy, write: false });
  const calendarPath = args.calendar
    ? path.resolve(process.cwd(), String(args.calendar))
    : latestCalendarFile();
  const limit = Number(args.limit || 3);
  const requestedVariants = String(args.variants || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const promptVariants = requestedVariants.length > 0
    ? requestedVariants
    : (strategy.generation?.prompt_variants || []).slice(0, Number(args['variant-count'] || 4));
  const items = loadItems({ calendarPath, limit });
  if (items.length === 0) fail(`No planned items found in ${calendarPath}`);

  const writers = [
    {
      id: 'opus',
      label: 'Claude Opus 4.6',
      provider: 'anthropic',
      model: args.opusModel || 'claude-opus-4-6',
      enabled: Boolean(process.env.ANTHROPIC_API_KEY),
      disabled_reason: process.env.ANTHROPIC_API_KEY ? null : 'Missing ANTHROPIC_API_KEY',
    },
    {
      id: 'sonnet',
      label: 'Claude Sonnet 4.6',
      provider: 'anthropic',
      model: args.sonnetModel || 'claude-sonnet-4-6',
      enabled: Boolean(process.env.ANTHROPIC_API_KEY),
      disabled_reason: process.env.ANTHROPIC_API_KEY ? null : 'Missing ANTHROPIC_API_KEY',
    },
    {
      id: 'gpt54',
      label: 'GPT-5.4',
      provider: 'openai',
      model: args.openaiModel || 'gpt-5.4',
      reasoning_effort: 'medium',
      enabled: Boolean(process.env.OPENAI_API_KEY),
      disabled_reason: process.env.OPENAI_API_KEY ? null : 'Missing OPENAI_API_KEY',
    },
    {
      id: 'gemini',
      label: 'Gemini 3 Pro Preview',
      provider: 'gemini',
      model: args.geminiModel || 'gemini-3-pro-preview',
      enabled: Boolean(process.env.GEMINI_API_KEY),
      disabled_reason: process.env.GEMINI_API_KEY ? null : 'Missing GEMINI_API_KEY',
      note: 'Using the newer Gemini 3 Pro preview by default for writer comparisons.',
    },
  ];

  const scorer = new GPTScorerAdapter({
    mode: 'live',
    model: args.scorerModel || strategy.provider_defaults?.openai_model || 'gpt-5.4',
  });

  const results = [];

  for (const writer of writers) {
    if (!writer.enabled) {
      results.push({
        writer: writer.label,
        model: writer.model,
        provider: writer.provider,
        skipped: true,
        reason: writer.disabled_reason,
      });
      continue;
    }

    const writerResult = {
      writer: writer.label,
      model: writer.model,
      provider: writer.provider,
      skipped: false,
      note: writer.note || null,
      items: [],
    };

    let generationInputTokens = 0;
    let generationOutputTokens = 0;
    let generationCostUsd = 0;
    let scoringCostUsd = 0;
    let totalWinnerScore = 0;
    let passCount = 0;

    for (const item of items) {
      const prepared = prepareBrief({ calendarItem: item, strategy, memory });
      prepared.promptVariants = promptVariants;
      const generated = await runWriter({ entry: writer, prepared, strategy });
      const judged = await scoreCandidates({
        scorer,
        candidates: generated.candidates,
        prepared,
        strategy,
        memory,
      });
      const usage = scorer.lastUsage || null;

      generationInputTokens += generated.usage.input_tokens;
      generationOutputTokens += generated.usage.output_tokens;
      generationCostUsd += Number(generated.usage.generation_cost_usd || 0);
      scoringCostUsd += Number(
        usage
          ? computeTextCost({
              modelId: scorer.model,
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
            })
          : 0
      );
      if (judged.winnerScore) {
        totalWinnerScore += Number(judged.winnerScore.overall_score || 0);
        if (judged.winnerScore.pass) passCount += 1;
      }

      writerResult.items.push({
        item_id: item.id,
        scheduled_date: item.scheduled_date,
        content_type: item.content_type,
        winner_score: judged.winnerScore?.overall_score || null,
        winner_pass: judged.winnerScore?.pass || false,
        winner_variant: judged.winnerCandidate?.prompt_variant || null,
        generation_usage: generated.usage,
        scoring_usage: usage || null,
      });
    }

    writerResult.summary = {
      items_evaluated: items.length,
      pass_rate: usd(passCount / items.length),
      average_winner_score: usd(totalWinnerScore / items.length),
      generation_input_tokens: generationInputTokens,
      generation_output_tokens: generationOutputTokens,
      generation_cost_usd: usd(generationCostUsd),
      scoring_cost_usd: usd(scoringCostUsd),
      total_cost_usd: usd(generationCostUsd + scoringCostUsd),
      average_cost_per_item_usd: usd((generationCostUsd + scoringCostUsd) / items.length),
    };
    results.push(writerResult);
  }

  printJson({
    ok: true,
    calendar_path: calendarPath,
    scorer_model: scorer.model,
    items_evaluated: items.map((item) => ({
      id: item.id,
      scheduled_date: item.scheduled_date,
      content_type: item.content_type,
      topic_thesis: item.topic_thesis,
    })),
    assumptions: {
      pricing_as_of: '2026-03-15',
      judge_note: 'All candidates are scored by the same GPT scorer, so this is a one-judge comparison rather than a human evaluation.',
      opus_note: 'Opus is configured as Claude Opus 4.6 by default.',
      sonnet_note: 'Sonnet is configured as Claude Sonnet 4.6 by default.',
      gemini_note: 'Gemini is configured as Gemini 3 Pro Preview by default because that is the newer top-end Gemini model you asked to compare.',
      prompt_variants_used: promptVariants,
      request_timeout_ms: REQUEST_TIMEOUT_MS,
    },
    results,
  });
}

if (require.main === module) {
  main().catch((error) => fail(error.stack || error.message));
}

module.exports = {
  main,
};
