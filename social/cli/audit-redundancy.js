#!/usr/bin/env node
const path = require('path');
const { parseArgs, printJson, fail } = require('../lib/cli');
const { loadStrategy } = require('../lib/config');
const { createAdapters } = require('../lib/pipeline');
const { rebuildMemory } = require('../lib/memory');
const { readJson, writeJson } = require('../lib/fs');
const {
  loadPublishedRecordsForAudit,
  compactAuditRecord,
  buildSemanticAuditCandidatePairs,
  buildRemovalDryRun,
  buildRemovalConfirmationPairs,
  applyRemovalConfirmations,
  applyLocalRedundancyRemoval,
} = require('../lib/redundancy');

function resolveRepoFile(value) {
  const absolute = path.resolve(process.cwd(), String(value || ''));
  const repoRoot = path.resolve(__dirname, '..', '..');
  const repoPrefix = `${repoRoot}${path.sep}`;
  if (!absolute.startsWith(repoPrefix)) fail(`Path must stay inside the repository: ${value}`);
  return absolute;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const strategy = loadStrategy();

  if (args['apply-local']) {
    if (!args.manifest) fail('--apply-local requires --manifest <reviewed-manifest.json>.');
    const manifestPath = resolveRepoFile(args.manifest);
    const manifest = readJson(manifestPath);
    if (!manifest) fail(`Manifest not found: ${args.manifest}`);
    const result = applyLocalRedundancyRemoval({ manifest, manifestPath });
    rebuildMemory({ strategy });
    const receiptPath = args.receipt
      ? resolveRepoFile(args.receipt)
      : manifestPath.replace(/\.json$/i, '.receipt.json');
    const receipt = {
      ...result,
      receipt_path: path.relative(path.resolve(__dirname, '..', '..'), receiptPath).replace(/\\/g, '/'),
    };
    writeJson(receiptPath, receipt);
    printJson(receipt);
    return;
  }

  if (!args['dry-run']) fail('Use --dry-run to audit or --apply-local with a reviewed manifest.');
  const adapters = createAdapters({ args, strategy });
  const sourceRef = args.ref || 'working-tree';
  const records = loadPublishedRecordsForAudit({ ref: args.ref || null });
  const auditRecords = records.map(compactAuditRecord);
  const candidatePairs = buildSemanticAuditCandidatePairs(records, {
    lexicalThreshold: Number(args['candidate-threshold'] || 0.3),
    maxPairs: Number(args['max-candidate-pairs'] || 200),
  });
  const audit = await adapters.scorer.auditPublishedRedundancy({ records: auditRecords, candidatePairs });
  const initialResult = buildRemovalDryRun({
    records,
    clusters: audit.clusters || [],
    sourceRef,
    model: adapters.scorer.model,
    minimumConfidence: Number(args['minimum-confidence'] || 0.88),
  });
  const confirmationPairs = buildRemovalConfirmationPairs({ records, plan: initialResult });
  const confirmation = await adapters.scorer.confirmRedundancyRemovals({ pairs: confirmationPairs });
  const result = applyRemovalConfirmations({
    plan: initialResult,
    decisions: confirmation.decisions || [],
    minimumConfidence: Number(args['confirmation-confidence'] || 0.9),
  });
  const output = { ok: true, candidate_pair_count: candidatePairs.length, ...result };
  if (args['write-manifest']) {
    const manifestPath = resolveRepoFile(args['write-manifest']);
    writeJson(manifestPath, output);
    output.manifest_path = path.relative(path.resolve(__dirname, '..', '..'), manifestPath).replace(/\\/g, '/');
  }
  printJson(output);
}

if (require.main === module) {
  main().catch((error) => fail(error.stack || error.message));
}

module.exports = { main };
