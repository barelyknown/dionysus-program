const path = require('path');

const { ensureDir, fileExists, writeText } = require('./fs');
const { paths } = require('./paths');
const {
  normalizeNoteBody,
  deriveNoteTitle,
  deriveNoteExcerpt,
  stringifyMarkdownWithFrontmatter,
  findExistingNoteBySocialItemId,
  resolveNoteSlug,
} = require('../../lib/notes');

function toRepoRelative(filePath) {
  return path.relative(paths.repoRoot, filePath).replace(/\\/g, '/');
}

async function materializePublishedNote({
  calendarItem,
  publishPayload,
  publishResult,
  writer,
  strategy,
}) {
  ensureDir(paths.notesContentDir);

  const existing = findExistingNoteBySocialItemId(paths.notesContentDir, calendarItem.id);
  if (existing) {
    return {
      slug: existing.data.slug,
      sourcePath: toRepoRelative(existing.filePath),
      sourceMode: existing.data.source_mode || 'ai_rewrite',
      existing: true,
    };
  }

  const fallbackBody = normalizeNoteBody(publishPayload.final_text);
  let rewrittenBody = fallbackBody;
  let sourceMode = 'verbatim_fallback';

  try {
    const rewrite = await writer.rewriteForNotes({
      postText: publishPayload.final_text,
      topicThesis: calendarItem.topic_thesis,
      pillar: calendarItem.pillar,
      voice: strategy.voice?.description || '',
    });
    if (rewrite && typeof rewrite.text === 'string' && rewrite.text.trim()) {
      rewrittenBody = normalizeNoteBody(rewrite.text);
      sourceMode = rewrite.source_mode || 'ai_rewrite';
    }
  } catch (error) {
    sourceMode = 'verbatim_fallback';
  }

  const title = deriveNoteTitle({
    text: rewrittenBody,
    topicThesis: calendarItem.topic_thesis,
  });
  const slug = resolveNoteSlug(paths.notesContentDir, {
    title,
    date: publishResult.delivered_at,
    itemId: calendarItem.id,
  });
  const notePath = path.join(paths.notesContentDir, `${slug}.md`);

  if (fileExists(notePath)) {
    return {
      slug,
      sourcePath: toRepoRelative(notePath),
      sourceMode,
      existing: true,
    };
  }

  const frontmatter = {
    title,
    date: publishResult.delivered_at,
    slug,
    content_type: calendarItem.content_type,
    pillar: calendarItem.pillar,
    topic_thesis: calendarItem.topic_thesis,
    social_item_id: calendarItem.id,
    external_post_id: publishResult.external_post_id,
    linkedin_post_url: publishResult.linkedin_post_url || null,
    linkedin_activity_urn: publishResult.linkedin_activity_urn || null,
    source_mode: sourceMode,
    excerpt: deriveNoteExcerpt(rewrittenBody),
  };

  writeText(notePath, stringifyMarkdownWithFrontmatter(frontmatter, rewrittenBody));

  return {
    slug,
    sourcePath: toRepoRelative(notePath),
    sourceMode,
    existing: false,
  };
}

module.exports = {
  materializePublishedNote,
};
