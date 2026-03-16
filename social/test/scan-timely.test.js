const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const { setupTempSocialWorkspace } = require('./helpers');
const { paths } = require('../lib/paths');
const { main } = require('../cli/scan-timely');

test('scan-timely exits before research work when no timely slots are configured', async (t) => {
  setupTempSocialWorkspace(t);

  const result = await main(['--use-fixtures']);

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no_timely_slots_configured');
  assert.equal(result.updated, false);
  assert.equal(result.research_bundle, null);
  assert.equal(result.timely_item, null);
  assert.equal(result.pending_job, null);
  assert.deepEqual(fs.readdirSync(paths.runsDir), []);
  assert.deepEqual(fs.readdirSync(paths.researchCacheDir), []);
});
