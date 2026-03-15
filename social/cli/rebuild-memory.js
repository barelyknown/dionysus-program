#!/usr/bin/env node
const { printJson, fail } = require('../lib/cli');
const { loadStrategy } = require('../lib/config');
const { rebuildMemory } = require('../lib/memory');

async function main() {
  const strategy = loadStrategy();
  const memory = rebuildMemory({ strategy });
  printJson({ ok: true, memory });
}

main().catch((error) => fail(error.stack || error.message));

