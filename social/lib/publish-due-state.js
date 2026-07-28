function isDue(item, currentTime) {
  const retryablePending = item.status === 'skipped'
    && ['research_pending', 'memory_conflict'].includes(item.skip_reason);
  return (item.status === 'planned' || retryablePending)
    && new Date(item.scheduled_at).getTime() <= currentTime.getTime();
}

function baselineCadenceSkipReason({ item, calendar, strategy }) {
  if (item.slot_type !== 'baseline') return null;

  const activeSlots = strategy.publishing?.baseline_slots || [];
  if (activeSlots.length === 0) return null;

  const activeWeekdays = new Set(activeSlots.map((slot) => slot.weekday));
  if (!activeWeekdays.has(item.weekday)) return 'schedule_disabled';

  const publishedBaselineCount = (calendar.items || []).filter((calendarItem) => (
    calendarItem.slot_type === 'baseline' && calendarItem.status === 'published'
  )).length;
  if (publishedBaselineCount >= activeSlots.length) return 'weekly_cadence_limit';

  return null;
}

function nextCalendarItemState(item, outcome) {
  if (outcome.status === 'published') {
    const downstreamFailure = outcome.note?.status === 'failed'
      ? outcome.note.reason
      : (outcome.x?.status === 'failed' ? `x_${outcome.x.reason || 'publish_failed'}` : null);
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
      delivery: {
        status: downstreamFailure ? 'partial' : 'published',
        attempted_at: outcome.publishResult.delivered_at,
        reason: downstreamFailure,
      },
    };
  }

  if (outcome.status === 'deferred') {
    return {
      ...(outcome.calendarItem || item),
      status: 'planned',
      skip_reason: null,
      delivery: {
        status: 'deferred',
        attempted_at: outcome.attempted_at || null,
        reason: outcome.reason || null,
        details: outcome.details || null,
      },
    };
  }

  if (outcome.status === 'skipped') {
    return {
      ...(outcome.calendarItem || item),
      status: 'skipped',
      skip_reason: outcome.reason,
      delivery: {
        status: 'skipped',
        attempted_at: outcome.attempted_at || null,
        reason: outcome.reason || null,
        error: outcome.error || null,
      },
    };
  }

  return outcome.calendarItem || item;
}

module.exports = {
  isDue,
  baselineCadenceSkipReason,
  nextCalendarItemState,
};
