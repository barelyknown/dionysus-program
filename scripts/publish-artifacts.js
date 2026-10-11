#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function requireFile(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) {
    throw new Error(`Missing or empty generated artifact: ${file}`);
  }
}

function validate(stage, root, skipKpf) {
  const revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const short = revision.slice(0, 12);
  const required = ['index.html', 'praise.html', 'pull-quotes.html', 'notes/index.html',
    'dist/essay.md', 'dist/source-revision.txt', 'dist/dionysus-program.epub',
    'dist/dionysus-program.pdf', 'dist/dionysus-program-print.pdf'];
  if (!skipKpf) required.push('dist/dionysus-program.kpf');
  for (const name of required) requireFile(path.join(stage, name));
  const read = name => fs.readFileSync(path.join(stage, name), 'utf8');
  if (!read('dist/source-revision.txt').includes(`commit=${revision}\n`) || !read('index.html').includes(short)) {
    throw new Error('Publication revision does not match HEAD.');
  }
  const markdown = read('dist/essay.md').replace(/^(source-revision|source-revision-short|published-at-utc|published-at-iso):.*\n/gm, '');
  if (markdown !== fs.readFileSync(path.join(root, 'essay.md'), 'utf8')) {
    throw new Error('Published Markdown differs from source (or source changed during the build).');
  }
  for (const name of ['dionysus-program.epub', ...(skipKpf ? [] : ['dionysus-program.kpf'])]) {
    execFileSync('unzip', ['-tq', path.join(stage, 'dist', name)], { stdio: 'pipe' });
  }
  const epubPath = path.join(stage, 'dist/dionysus-program.epub');
  const epubText = execFileSync('unzip', ['-p', epubPath, '*.xhtml'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (!epubText.includes(short)) throw new Error('Missing source revision in EPUB.');
  if (!skipKpf) {
    const embeddedEpub = execFileSync('unzip', ['-p', path.join(stage, 'dist/dionysus-program.kpf'), 'book.epub'], { maxBuffer: 64 * 1024 * 1024 });
    if (!embeddedEpub.equals(fs.readFileSync(epubPath))) {
      throw new Error('KPF was not converted from this build’s EPUB.');
    }
  }
  for (const name of ['dionysus-program.pdf', 'dionysus-program-print.pdf']) {
    const text = execFileSync('pdftotext', [path.join(stage, 'dist', name), '-'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (!text.includes(short)) throw new Error(`Missing revision in ${name}`);
  }
  const quotes = JSON.parse(fs.readFileSync(path.join(root, 'pull-quotes.json'), 'utf8'));
  const quoteCount = Array.isArray(quotes) ? quotes.length : quotes.quotes.length;
  for (let i = 1; i <= quoteCount; i++) {
    requireFile(path.join(stage, 'dist/pull-quotes', `quote-${String(i).padStart(2, '0')}.png`));
  }
  return revision;
}

// All generation and validation finish before the first published path changes.
// Same-filesystem renames replace each unit; rollback restores prior units if an
// ordinary I/O error interrupts promotion. Git publishes the resulting set together.
function promote(stage, root, skipKpf) {
  const units = ['index.html', 'praise.html', 'pull-quotes.html', 'notes',
    ...fs.readdirSync(path.join(stage, 'dist')).sort().map(name => `dist/${name}`)];
  if (skipKpf) units.push('dist/dionysus-program.kpf');
  const backup = path.join(path.dirname(stage), 'backup');
  const changed = [];
  try {
    for (const relative of units) {
      const source = path.join(stage, relative);
      const target = path.join(root, relative);
      const saved = path.join(backup, relative);
      fs.mkdirSync(path.dirname(saved), { recursive: true });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const state = { target, saved, hadOriginal: fs.existsSync(target), installed: false, backedUp: false };
      changed.push(state);
      if (state.hadOriginal) {
        fs.renameSync(target, saved);
        state.backedUp = true;
      }
      if (fs.existsSync(source)) {
        fs.renameSync(source, target);
        state.installed = true;
      }
    }
  } catch (error) {
    for (const state of changed.reverse()) {
      if (state.installed) fs.rmSync(state.target, { recursive: true, force: true });
      if (state.backedUp) fs.renameSync(state.saved, state.target);
    }
    throw error;
  }
}

if (require.main === module) {
  const [stage, root, skip, pandocVersion, kindleVersion] = process.argv.slice(2);
  const skipKpf = skip === '1';
  const revision = validate(stage, root, skipKpf);
  fs.writeFileSync(path.join(stage, 'dist/build-manifest.json'), `${JSON.stringify({
    sourceRevision: revision,
    pandoc: pandocVersion,
    kindlePreviewer: kindleVersion,
    excludedArtifacts: skipKpf ? ['dionysus-program.kpf'] : [],
  }, null, 2)}\n`);
  promote(stage, root, skipKpf);
}

module.exports = { validate, promote };
