#!/usr/bin/env node
/**
 * Build a JS wrapper that exposes the LLM context text on window.
 *
 * Usage: node build-llm-context.js <inputTxt> <outputJs>
 */

const fs = require('fs');
const path = require('path');

const [,, inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
  console.error('Usage: node build-llm-context.js <inputTxt> <outputJs>');
  process.exit(1);
}

const resolvedInput = path.resolve(inputPath);
const resolvedOutput = path.resolve(outputPath);
const text = fs.readFileSync(resolvedInput, 'utf8');
const payload = [
  `window.DIONYSUS_LLM_CONTEXT = ${JSON.stringify(text)};`,
  `window.DIONYSUS_LLM_CONTEXT_CHAR_COUNT = ${text.length};`,
  '',
].join('\n');

fs.writeFileSync(resolvedOutput, payload, 'utf8');
console.log(`Wrote LLM context JS to ${resolvedOutput}`);
