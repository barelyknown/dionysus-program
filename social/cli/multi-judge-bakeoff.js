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
    `You are a strict judge scoring LinkedIn post candidates.`,
    `Use the same standard regardless of who wrote the draft.`,
    `Optimize for sharp openers, concise operator-level writing, one clear idea, and a strong ending.`,
    `Heavily penalize empty rhetoric, article-summary behavior, throat-clearing, repeated thesis statements, and incomplete drafts.`,
    `Fail anything that is not publishable as-is.`,
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
    usage: payload.usage || null,
  };
}

async function generateWithOpenAI({ model, effort = 'medium', prompt, apiKey }) {
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

function computeOpenAICost({ model, usage }) {
  const pricing = OPENAI_PRICING[model];
  if (!pricing || !usage) return null;
  return usd(
    (Number(usage.input_tokens || 0) / 1_000_000) * pricing.inputPerMillionUsd
      + (Number(usage.output_tokens || 0) / 1_000_000) * pricing.outputPerMillionUsd
  );
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
  return {
    text: (payload.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('\n').trim(),
    usage: payload.usageMetadata || null,
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
      writer_id: candidate.writer_id,
      writer: candidate.writer,
      writer_model: candidate.writer_model,
      reasoning_effort: candidate.reasoning_effort || null,
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
  const limit = Number(args.limit || 2);
  const variant = String(args.variant || 'hook_forward');
  const items = loadItems({ calendarPath, limit });
  if (items.length === 0) fail(`No planned items found in ${calendarPath}`);
  const requestedGptEfforts = String(args['gpt-efforts'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const gptEfforts = requestedGptEfforts.length > 0 ? requestedGptEfforts : ['medium'];
  const onlyGptEfforts = Boolean(args['only-gpt-efforts']);

  const baselineWriters = [
    {
      id: 'opus',
      writer: 'Claude Opus 4.6',
      writer_model: 'claude-opus-4-6',
      generate: (prompt) => generateWithAnthropic({ model: 'claude-opus-4-6', prompt, apiKey: process.env.ANTHROPIC_API_KEY }),
    },
    {
      id: 'sonnet',
      writer: 'Claude Sonnet 4.6',
      writer_model: 'claude-sonnet-4-6',
      generate: (prompt) => generateWithAnthropic({ model: 'claude-sonnet-4-6', prompt, apiKey: process.env.ANTHROPIC_API_KEY }),
    },
    {
      id: 'gemini3',
      writer: 'Gemini 3 Pro Preview',
      writer_model: 'gemini-3-pro-preview',
      generate: (prompt) => generateWithGemini({ model: 'gemini-3-pro-preview', prompt, apiKey: process.env.GEMINI_API_KEY }),
    },
  ];
  const gptWriters = gptEfforts.map((effort) => ({
    id: `gpt54-${effort}`,
    writer: `GPT-5.4 (${effort})`,
    writer_model: 'gpt-5.4',
    reasoning_effort: effort,
    generate: (prompt) => generateWithOpenAI({
      model: 'gpt-5.4',
      effort,
      prompt,
      apiKey: process.env.OPENAI_API_KEY,
    }),
  }));
  const writers = onlyGptEfforts
    ? gptWriters
    : [
      baselineWriters[0],
      baselineWriters[1],
      ...gptWriters,
      baselineWriters[2],
    ];

  const openAiJudge = new GPTScorerAdapter({ mode: 'live', model: 'gpt-5.4' });
  const judges = [
    {
      id: 'gpt54',
      label: 'GPT-5.4',
      evaluate: async ({ prepared, candidates, sourceRefs }) => {
        const scorecards = await openAiJudge.scoreCandidates({
          candidates,
          brief: prepared.brief,
          strategy,
          memory,
          sourceRefs,
        });
        return {
          normalized: normalizeScores({
            judgeId: 'gpt54',
            judgeLabel: 'GPT-5.4',
            scores: scorecards,
            candidates,
          }),
          usage: openAiJudge.lastUsage || null,
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

  const itemResults = [];
  const aggregate = new Map(writers.map((writer) => [writer.id, {
    writer: writer.writer,
    model: writer.writer_model,
    reasoning_effort: writer.reasoning_effort || null,
    scores: [],
    ranks: [],
    passCount: 0,
    panelWins: 0,
    generationInputTokens: 0,
    generationOutputTokens: 0,
    generationCostUsd: 0,
  }]));

  for (const item of items) {
    const prepared = prepareBrief({ calendarItem: item, strategy, memory });
    const prompt = `${prepared.type.buildPrompt(prepared.brief, variant)}\n\nVariant: ${variant}`;
    const sourceRefs = [
      ...(prepared.researchBundle?.sources || []).map((source) => source.url),
      ...(prepared.brief.mailbag_item?.provenance ? [prepared.brief.mailbag_item.provenance] : []),
    ];

    const generated = [];
    for (const writer of writers) {
      const result = await writer.generate(prompt);
      const generationCostUsd = writer.writer_model === 'gpt-5.4'
        ? computeOpenAICost({ model: writer.writer_model, usage: result.usage })
        : null;
      const bucket = aggregate.get(writer.id);
      if (bucket) {
        bucket.generationInputTokens += Number(result.usage?.input_tokens || 0);
        bucket.generationOutputTokens += Number(result.usage?.output_tokens || 0);
        bucket.generationCostUsd += Number(generationCostUsd || 0);
      }
      generated.push({
        id: `${writer.id}-${item.id}`,
        writer_id: writer.id,
        writer: writer.writer,
        writer_model: writer.writer_model,
        reasoning_effort: writer.reasoning_effort || null,
        prompt_variant: variant,
        post_text: result.text,
        usage: result.usage,
        generation_cost_usd: generationCostUsd,
      });
    }

    const judgePanels = [];
    for (const judge of judges) {
      const panel = await judge.evaluate({ prepared, candidates: generated, sourceRefs });
      judgePanels.push({
        judge_id: judge.id,
        judge: judge.label,
        usage: panel.usage,
        rankings: panel.normalized,
      });

      if (panel.normalized[0]) {
        const winner = aggregate.get(panel.normalized[0].writer_id);
        if (winner) winner.panelWins += 1;
      }

      for (const row of panel.normalized) {
        const bucket = aggregate.get(row.writer_id);
        if (!bucket) continue;
        bucket.scores.push(row.overall_score);
        bucket.ranks.push(row.rank);
        if (row.pass) bucket.passCount += 1;
      }
    }

    itemResults.push({
      item_id: item.id,
      scheduled_date: item.scheduled_date,
      content_type: item.content_type,
      topic_thesis: item.topic_thesis,
      generated: generated.map((entry) => ({
        writer: entry.writer,
        model: entry.writer_model,
        reasoning_effort: entry.reasoning_effort,
        opener: entry.post_text.split(/\n/)[0].trim(),
        text_length: entry.post_text.length,
        generation_cost_usd: entry.generation_cost_usd,
      })),
      judge_panels: judgePanels,
    });
  }

  const totalPanels = items.length * judges.length;
  const summary = Array.from(aggregate.values()).map((entry) => ({
    writer: entry.writer,
    model: entry.model,
    reasoning_effort: entry.reasoning_effort,
    average_score: Number((entry.scores.reduce((sum, value) => sum + value, 0) / entry.scores.length).toFixed(3)),
    average_rank: Number((entry.ranks.reduce((sum, value) => sum + value, 0) / entry.ranks.length).toFixed(3)),
    pass_rate: Number((entry.passCount / totalPanels).toFixed(3)),
    panel_wins: entry.panelWins,
    generation_input_tokens: entry.generationInputTokens,
    generation_output_tokens: entry.generationOutputTokens,
    generation_cost_usd: usd(entry.generationCostUsd),
    average_generation_cost_per_item_usd: usd(entry.generationCostUsd / items.length),
    strongest_signal: entry.panelWins === 0
      ? 'No judge picked this model first.'
      : `${entry.panelWins} of ${totalPanels} judge-panels ranked this model first.`,
  })).sort((left, right) => left.average_rank - right.average_rank);

  const output = {
    ok: true,
    checked_on: '2026-03-15',
    bakeoff: {
      calendar_path: calendarPath,
      items_evaluated: items.length,
      prompt_variant: variant,
      judges: judges.map((judge) => judge.label),
      writers: writers.map((writer) => writer.writer),
      gpt_efforts: gptEfforts,
      only_gpt_efforts: onlyGptEfforts,
      methodology: 'Same generated drafts judged independently by three models; aggregate by average rank, average score, pass rate, and panel wins.',
    },
    summary,
    item_results: itemResults,
  };

  const outDir = path.join(paths.socialRoot, 'cache', 'bakeoffs');
  ensureDir(outDir);
  const modeTag = onlyGptEfforts
    ? `gpt-efforts-${gptEfforts.join('-')}`
    : 'models';
  const outPath = path.join(outDir, `multi-judge-bakeoff-2026-03-15-${modeTag}-${items.length}items.json`);
  writeJson(outPath, output);
  printJson({ out_path: outPath, ...output });
}

if (require.main === module) {
  main().catch((error) => fail(error.stack || error.message));
}

module.exports = {
  main,
};
