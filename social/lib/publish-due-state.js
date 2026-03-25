function isDue(item, currentTime) {
  const retryablePending = item.status === 'skipped'
    && ['research_pending', 'memory_conflict'].includes(item.skip_reason);
  return (item.status === 'planned' || retryablePending)
    && new Date(item.scheduled_at).getTime() <= currentTime.getTime();
}

function nextCalendarItemState(item, outcome) {
  if (outcome.status === 'published') {
    return {
      ...(outcome.calendarItem || item),
      status: 'published',
      skip_reason: null,
      winner_id: outcome.winnerCandidate.id,
      publish_payload: outcome.payload,
      published_at: outcome.publishResult.delivered_at,
      external_post_id: outcome.publishResult.external_post_id,
      note_slug: outcome.note?.slug || null,
      note_source_path: outcome.note?.sourcePath || null,
      x_status: outcome.x?.status || null,
      x_external_post_id: outcome.x?.publishResult?.external_post_id || null,
      x_published_at: outcome.x?.publishResult?.delivered_at || null,
      x_winning_candidate_id: outcome.x?.winnerCandidate?.id || null,
      x_publish_payload: outcome.x?.payload || null,
      x_skip_reason: outcome.x && outcome.x.status !== 'published' ? outcome.x.reason || null : null,
    };
  }

  if (outcome.status === 'deferred') {
    return {
      ...(outcome.calendarItem || item),
      status: 'planned',
      skip_reason: null,
    };
  }

  if (outcome.status === 'skipped') {
    return {
      ...(outcome.calendarItem || item),
      status: 'skipped',
      skip_reason: outcome.reason,
    };
  }

  return outcome.calendarItem || item;
}

module.exports = {
  isDue,
  nextCalendarItemState,
};
