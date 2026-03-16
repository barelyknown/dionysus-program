function buildVariantInstructions(contentTypeId) {
  if (contentTypeId === 'short_story') {
    return {
      hook_forward: 'Write as short_story with an opening that begins inside a concrete moment, line of dialogue, or visible action. Do not open with summary.',
      diagnosis_forward: 'Write as short_story with a tighter causal turn from the moment to the diagnosis, while staying inside the scene as long as possible.',
      operator_forward: 'Write as short_story with a concrete scene that resolves into an operator-level implication, without adding extra exposition.',
      contrarian_forward: 'Write as short_story with a sharper point of view, but keep it grounded in one small moment rather than a broad organizational summary.',
    };
  }
  return {
    hook_forward: `Write as ${contentTypeId} with a stronger opening line and immediate stake.`,
    diagnosis_forward: `Write as ${contentTypeId} with sharper diagnosis and tighter naming of the organizational pattern.`,
    operator_forward: `Write as ${contentTypeId} with more practical operational implication and fewer abstractions.`,
    contrarian_forward: `Write as ${contentTypeId} with a sharper point of view, without becoming glib or combative.`,
  };
}

function sharedSourceGroundingRules() {
  return [
    'Ground the post in the provided source evidence first, then use the wider context only as support.',
    'Use one core claim only. Do not stack multiple theses into one post.',
    'Prefer one concrete example or image over a list of examples.',
    'Do not restate the same idea in slightly different language.',
  ];
}

function sharedTypeRules() {
  return [
    'Be concise. Aim for about 90-170 words and never exceed 220 words.',
    'Use 3-6 short paragraphs.',
    'Start with a strong first line, not throat-clearing.',
    'The opening line should create immediate tension, consequence, or pattern-recognition. It should make the reader feel why this matters now.',
    'A good opener contains substance, not just setup. It can name a sharp claim, a vivid tell, a contradiction, or a quote that carries real weight.',
    'Vary the shape of the opener. Do not fall back on the same template every time.',
    'No generic setup like "I have been thinking" or "the book has been making this point for a while."',
    'Use plain, direct language. Cut abstraction when a concrete noun or verb will do.',
    'End with one sharp implication or move. Do not fade out.',
    'Stop as soon as the real ending lands. Do not add an extra explanation after the close.',
  ];
}

function formatResearchSources(citations = []) {
  const normalized = Array.isArray(citations) ? citations.filter(Boolean).slice(0, 5) : [];
  if (normalized.length === 0) return '';
  return [
    'Research sources (pick one as the visible entry point unless the brief explicitly calls for comparison):',
    ...normalized.map((source, index) => {
      const title = source.title || source.url || `Source ${index + 1}`;
      const publishedAt = source.published_at ? `, ${source.published_at}` : '';
      const claim = source.claim ? `: ${String(source.claim).replace(/\s+/g, ' ').trim()}` : '';
      return `- [${index + 1}] ${title}${publishedAt}${claim}`;
    }),
  ].join('\n');
}

function formatPrimarySource(primarySource) {
  if (!primarySource) return '';
  const lines = [
    'Primary source (this is the case the post must open on):',
    `- Title: ${primarySource.title || primarySource.url || 'Untitled source'}`,
    primarySource.published_at ? `- Published at: ${primarySource.published_at}` : '',
    primarySource.url ? `- URL: ${primarySource.url}` : '',
    primarySource.claim ? `- Core claim: ${String(primarySource.claim).replace(/\s+/g, ' ').trim()}` : '',
    primarySource.relevance ? `- Why it matters: ${String(primarySource.relevance).replace(/\s+/g, ' ').trim()}` : '',
    primarySource.excerpt ? `- Source summary: ${String(primarySource.excerpt).replace(/\s+/g, ' ').trim()}` : '',
    primarySource.content_text ? `Primary source full text:\n${primarySource.content_text}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

function createContentType({
  id,
  pillar,
  summary,
  defaultAngle,
  promptStyle,
  sourceGroundingRules = [],
  typeRules = [],
  timelyEligible = false,
  requiresResearch = false,
  requiresMailbag = false,
  maxRollingWeeks = null,
  isEligible = () => ({ eligible: true }),
}) {
  return {
    id,
    pillar,
    summary,
    defaultAngle,
    promptStyle,
    timelyEligible,
    requiresResearch,
    requiresMailbag,
    maxRollingWeeks,
    getVariantInstructions() {
      return buildVariantInstructions(id);
    },
    isEligible,
    buildBrief({ calendarItem, strategy, context, researchBundle, mailbagItem }) {
      const voice = strategy.voice?.description || '';
      return {
        content_type: id,
        pillar,
        slot_type: calendarItem.slot_type,
        topic_thesis: calendarItem.topic_thesis,
        angle: calendarItem.angle || defaultAngle,
        hook: calendarItem.hook || '',
        summary,
        voice,
        prompt_style: promptStyle,
        book_context: strategy.book_context || null,
        timely_subject: calendarItem.timely_subject || null,
        research_bundle_id: researchBundle?.id || null,
        research_summary: researchBundle?.summary || null,
        primary_source: researchBundle?.primary_source || researchBundle?.sources?.[0] || null,
        citations: researchBundle?.sources || [],
        full_compressed_context: context.contextText || '',
        mailbag_item: mailbagItem || null,
        context_excerpt: context.llmContextExcerpt.slice(0, 6),
        pull_quotes: context.pullQuotes.slice(0, 4),
        source_grounding_rules: sourceGroundingRules,
        type_rules: typeRules,
      };
    },
    buildPrompt(brief, variant) {
      const variantInstructions = this.getVariantInstructions()[variant] || '';
      return [
        `You are writing a LinkedIn post for Sean Devine.`,
        `Voice: ${brief.voice}`,
        `Content type: ${id} (${summary})`,
        `Prompt style: ${promptStyle}`,
        `Topic thesis: ${brief.topic_thesis}`,
        `Angle: ${brief.angle}`,
        `Variant mode: ${variant}`,
        variantInstructions,
        `Source grounding rules:`,
        ...sharedSourceGroundingRules().map((rule) => `- ${rule}`),
        ...(brief.source_grounding_rules || []).map((rule) => `- ${rule}`),
        `Type-specific rules:`,
        ...sharedTypeRules().map((rule) => `- ${rule}`),
        ...(brief.type_rules || []).map((rule) => `- ${rule}`),
        brief.full_compressed_context ? `Full compressed source context:\n${brief.full_compressed_context}` : '',
        brief.book_context ? `Book mention policy:
- Default to no book mention.
- Mention "${brief.book_context.title}" only if it fits naturally inside the final sentence.
- If you mention the book, note that it is free.
- Do not include a link.
- Do not turn the post into a sales pitch or CTA.
- Never add a separate promotional final paragraph.` : '',
        `Constraints: short paragraphs; one idea per post; no emojis; no hashtags; no outbound links; no lists unless the format truly requires one; end with a sharp implication.`,
        `Output only the post text. Do not invent named concepts unless they appear verbatim in the provided source context or research materials.`,
        brief.timely_subject ? `Timely subject: ${brief.timely_subject}` : '',
        brief.mailbag_item ? `Mailbag source: ${brief.mailbag_item.provenance}` : '',
        brief.mailbag_item?.attribution ? `Mailbag attribution: ${brief.mailbag_item.attribution}` : '',
        brief.mailbag_item?.full_text ? `Full mailbag letter:\n${brief.mailbag_item.full_text}` : '',
        brief.mailbag_item?.quote && !brief.mailbag_item?.full_text ? `Mailbag note: "${brief.mailbag_item.quote}"` : '',
        formatPrimarySource(brief.primary_source),
        formatResearchSources(brief.citations),
        brief.research_summary ? `Research summary: ${brief.research_summary}` : '',
      ].filter(Boolean).join('\n');
    },
  };
}

module.exports = {
  createContentType,
};
