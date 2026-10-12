const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { promote } = require('./publish-artifacts');
const repo = path.resolve(__dirname, '..');

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dionysus-build-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'published');
  const stage = path.join(base, 'stage');
  for (const dir of [root, stage]) {
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
    for (const name of ['index.html', 'plan-of-attack/index.html', 'praise.html', 'pull-quotes.html', 'notes/index.html', 'dist/book.pdf']) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), `${dir === root ? 'old' : 'new'} ${name}`);
    }
  }
  return { base, root, stage };
}

function snapshot(dir) {
  const out = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    out[entry.name] = entry.isDirectory() ? snapshot(p) : fs.readFileSync(p).toString('base64');
  }
  return out;
}

test('promotion replaces generated notes but preserves unrelated dist inputs', t => {
  const { root, stage } = fixture(t);
  fs.writeFileSync(path.join(root, 'notes/retired.html'), 'retired');
  fs.writeFileSync(path.join(root, 'dist/context.txt'), 'independent input');
  promote(stage, root, false);
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), 'new index.html');
  assert.equal(fs.readFileSync(path.join(root, 'plan-of-attack/index.html'), 'utf8'), 'new plan-of-attack/index.html');
  assert.equal(fs.existsSync(path.join(root, 'notes/retired.html')), false);
  assert.equal(fs.readFileSync(path.join(root, 'dist/context.txt'), 'utf8'), 'independent input');
});

test('an I/O failure during promotion restores all prior published files', t => {
  const { root, stage } = fixture(t);
  // A blocked output directory fails after the HTML and notes have been moved.
  fs.rmSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist'), 'blocked directory');
  const before = snapshot(root);
  assert.throws(() => promote(stage, root, false));
  assert.deepEqual(snapshot(root), before);
});

test('explicit KPF exclusion removes an old KPF instead of presenting it as fresh', t => {
  const { root, stage } = fixture(t);
  fs.writeFileSync(path.join(root, 'dist/dionysus-program.kpf'), 'stale');
  promote(stage, root, true);
  assert.equal(fs.existsSync(path.join(root, 'dist/dionysus-program.kpf')), false);
});

test('an incompatible Pandoc fails before any published artifact changes', t => {
  const { base } = fixture(t);
  const binary = path.join(base, 'pandoc');
  fs.writeFileSync(binary, '#!/bin/bash\necho "pandoc 3.12.1"\n', { mode: 0o755 });
  const index = fs.readFileSync(path.join(repo, 'index.html'));
  const result = spawnSync('/bin/bash', ['./build.sh', '--check'], {
    cwd: repo, env: { ...process.env, PANDOC_BIN: binary }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Expected Pandoc 3.6.4/);
  assert.deepEqual(fs.readFileSync(path.join(repo, 'index.html')), index);
});

for (const kind of ['missing', 'corrupt']) {
  test(`Kindle exit zero with ${kind} KPF is a build failure`, t => {
    const { base } = fixture(t);
    const converter = path.join(base, 'kindle');
    const scratch = path.join(base, 'conversion');
    const output = path.join(base, 'result.kpf');
    fs.writeFileSync(converter, `#!/bin/bash\n${kind === 'corrupt' ? 'echo corrupt > "$4/book.kpf"' : ':'}\nexit 0\n`, { mode: 0o755 });
    const result = spawnSync('/bin/bash', ['-c', 'set -euo pipefail; source "$ROOT_DIR/scripts/build-tools.sh"; convert_kpf "$1" "$2" "$3"', 'test', 'input.epub', output, scratch], {
      env: { ...process.env, ROOT_DIR: repo, KINDLE_PREVIEWER_BIN: converter, KINDLE_CONVERT_FLAG: '--convert', KINDLE_OUTPUT_FLAG: '--output' }, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, kind === 'missing' ? /without a KPF/ : /invalid KPF/);
    assert.equal(fs.existsSync(output), false);
  });
}
