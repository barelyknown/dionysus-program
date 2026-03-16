const test = require('node:test');
const assert = require('node:assert/strict');

const { isDue, nextCalendarItemState } = require('../lib/publish-due-state');

test('publish-due retries previously research-pending items', () => {
  const currentTime = new Date('2026-03-16T13:30:00.000Z');

  assert.equal(isDue({
    status: 'planned',
    scheduled_at: '2026-03-16T12:30:00.000Z',
  }, currentTime), true);

  assert.equal(isDue({
    status: 'skipped',
    skip_reason: 'research_pending',
    scheduled_at: '2026-03-16T12:30:00.000Z',
  }, currentTime), true);

  assert.equal(isDue({
    status: 'skipped',
    skip_reason: 'memory_conflict',
    scheduled_at: '2026-03-16T12:30:00.000Z',
  }, currentTime), false);
});

test('research-pending outcomes remain planned for retry', () => {
  const item = {
    id: 'item-1',
    status: 'skipped',
    skip_reason: 'research_pending',
    scheduled_at: '2026-03-16T12:30:00.000Z',
    topic_thesis: 'Rectification of Names matters.',
  };

  const next = nextCalendarItemState(item, {
    status: 'deferred',
    reason: 'research_pending',
    calendarItem: item,
  });

  assert.equal(next.status, 'planned');
  assert.equal(next.skip_reason, null);
});

test('published outcomes clear stale skip reasons', () => {
  const item = {
    id: 'item-1',
    status: 'skipped',
    skip_reason: 'research_pending',
  };

  const next = nextCalendarItemState(item, {
    status: 'published',
    calendarItem: item,
    winnerCandidate: { id: 'winner-1' },
    payload: { item_id: 'item-1' },
    publishResult: {
      delivered_at: '2026-03-16T13:18:47.586Z',
      external_post_id: 'external-1',
    },
    note: null,
    x: null,
  });

  assert.equal(next.status, 'published');
  assert.equal(next.skip_reason, null);
});
