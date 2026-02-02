#!/usr/bin/env node
/**
 * Build a dense plain-text version of the Dionysus Program.
 *
 * Usage: node build-dense-text.js
 * Output: dist/dionysus-program-dense.txt
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const DIST_DIR = path.join(ROOT, 'dist');
const ESSAY_MD = path.join(ROOT, 'essay.md');
const LETTERS_SCRIPT = path.join(ROOT, 'build-letters-to-editor.js');
const LETTERS_APPENDIX = path.join(DIST_DIR, 'letters-to-editor-appendix.md');
const SOURCES_MD = path.join(ROOT, 'appendix-sources.md');
const KEYWORDS_TXT = path.join(ROOT, 'keywords.txt');
const INDEX_SCRIPT = path.join(ROOT, 'build-index.js');
const INDEX_APPENDIX = path.join(DIST_DIR, 'appendix-index.md');
const OUTPUT_TXT = path.join(DIST_DIR, 'dionysus-program-dense.txt');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function ensureCommand(cmd) {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' });
  } catch (err) {
    console.error(`${cmd} is required but not installed`);
    process.exit(1);
  }
}

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' });
}

function densify(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

ensureCommand('pandoc');
ensureDir(DIST_DIR);

run('node', [LETTERS_SCRIPT, DIST_DIR]);
run('node', [INDEX_SCRIPT, DIST_DIR, ESSAY_MD, KEYWORDS_TXT, LETTERS_APPENDIX, SOURCES_MD]);

const pandocArgs = [
  ESSAY_MD,
  LETTERS_APPENDIX,
  SOURCES_MD,
  INDEX_APPENDIX,
  '--from=markdown',
  '--to=plain',
  '--wrap=none',
];

const raw = execFileSync('pandoc', pandocArgs, { encoding: 'utf8' });
const dense = `${densify(raw)}\n`;
fs.writeFileSync(OUTPUT_TXT, dense, 'utf8');

console.log(`Wrote dense text to ${OUTPUT_TXT}`);
