function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateCalendarItem(item) {
  assert(item.id, 'Calendar item missing id.');
  assert(item.content_type, 'Calendar item missing content_type.');
  assert(item.topic_thesis, 'Calendar item missing topic_thesis.');
  assert(item.scheduled_at, 'Calendar item missing scheduled_at.');
  if (item.preparation?.status === 'ready') {
    assert(item.preparation.prepared_at, `Prepared calendar item ${item.id} missing prepared_at.`);
    assert(item.preparation.history_fingerprint, `Prepared calendar item ${item.id} missing history_fingerprint.`);
    assert(item.preparation.package?.package_gate?.pass === true, `Prepared calendar item ${item.id} has no passing package gate.`);
    assert(item.preparation.package?.payload?.item_id === item.id, `Prepared calendar item ${item.id} has a mismatched package.`);
  }
}

function validatePublishedRecord(record) {
  [
    'post_id',
    'published_at',
    'content_type',
    'pillar',
    'topic_thesis',
    'angle',
    'hook',
    'summary',
    'source_refs',
    'framework_terms_used',
    'timely_subject',
    'research_bundle_id',
    'winning_candidate_id',
    'final_text_hash',
  ].forEach((key) => {
    if (!(key in record)) throw new Error(`Published record missing ${key}.`);
  });
}

function validateMailbagItem(item) {
  assert(item.provenance, 'Mailbag item missing provenance.');
  assert(item.captured_at, 'Mailbag item missing captured_at.');
  assert(item.quote || item.full_text, 'Mailbag item missing content.');
}

module.exports = {
  validateCalendarItem,
  validatePublishedRecord,
  validateMailbagItem,
};
