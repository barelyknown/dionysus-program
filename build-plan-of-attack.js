#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ROOT = __dirname;
const esc = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const pandoc = process.env.PANDOC_BIN || path.join(ROOT, '.tools/pandoc-3.6.4/bin/pandoc');
const html = markdown => execFileSync(pandoc, ['--from=markdown', '--to=html5', '--wrap=none'], { input: markdown, encoding: 'utf8' }).trim();

function navigation(side, compact = false) {
  const base = side === 'b' ? '../' : '';
  return `<nav class="edition-nav${compact ? ' edition-nav-compact' : ''}" aria-label="${compact ? 'Reading navigation' : 'Publication sides'}">
    <a href="${base}index.html" ${side === 'a' ? 'aria-current="page"' : 'data-flip="a"'}><span class="side-letter">A</span><span>${compact ? 'The Program' : 'The Dionysus Program'}</span></a>
    <a href="${base}plan-of-attack/" ${side === 'b' ? 'aria-current="page"' : 'data-flip="b"'}><span class="side-letter">B</span><span>Plan of Attack</span></a>
  </nav>`;
}
function cover(side) {
  const base = side === 'b' ? '../' : '';
  const artwork = side === 'a'
    ? `<img class="page-cover" src="${base}dist/dionysus-program-cover.jpg" alt="The Dionysus Program — Rites of Renewal, by Sean Devine" width="1024" height="1536" fetchpriority="high">`
    : `<div class="b-cover"><p class="cover-masthead">The Dionysus Program</p><p class="cover-side">Side B</p><h1>Plan<br>of<br>Attack</h1><span class="cover-rule"></span><p class="cover-deck">Six letters to a founder<br>whose company does not yet exist.</p><p class="cover-correspondent">From Silenus.</p><span class="cover-phi" aria-hidden="true">Φ</span></div>`;
  return `<div class="edition-cover"><div class="cover-turn">${artwork}</div></div>
    ${navigation(side)}`;
}
function toolbar(side) {
  return `<div class="edition-bar" hidden>${navigation(side, true)}${side === 'b' ? '<a class="letters-link" href="#letters">Letters <span aria-hidden="true">↑</span></a>' : ''}</div>`;
}
function build(output = ROOT) {
  const source = fs.readFileSync(path.join(ROOT, 'content/plan-of-attack.md'), 'utf8');
  const sections = source.split(/^## Letter /m).slice(1);
  if (sections.length !== 6) throw new Error('Expected six letters in the canonical draft.');
  const terms = [
    ['epistemic melt', 'the-wins-that-break-the-game'],
    ['Auteur Bottleneck', 'auteurs-agents-actors'],
    ['Coherence Ceiling', 'the-coherence-ceiling'],
    ['epimetabolic rate', 'the-alchemists-assay'],
    ['negative selection', 'negative-selection-on-epimetabolic-talent'],
    ['coherent wrongness', 'auteurs-agents-actors'],
  ];
  const letters = sections.map((section, i) => {
    const [heading, ...rest] = section.trim().split('\n');
    const match = heading.match(/^([IVX]+) — (.+)$/);
    const paragraphs = rest.join('\n').trim().split(/\n\s*\n/);
    if (!match || paragraphs[0] !== 'Dear founder,' || !/^\*\*.+\*\*$/.test(paragraphs[1]) || paragraphs.at(-2) !== 'Yours,' || paragraphs.at(-1) !== 'Silenus') {
      throw new Error(`Unexpected structure in letter ${i + 1}; do not silently omit source text.`);
    }
    const [term, anchor] = terms[i];
    let body = html(paragraphs.slice(3, -2).join('\n\n'));
    const marker = `<em>${term}</em>`;
    if (!body.includes(marker)) throw new Error(`Missing book concept: ${term}`);
    body = body.replace(marker, `<a class="concept-link" href="../index.html#${anchor}" title="Explore ${esc(term)} in The Dionysus Program">${marker}</a>`);
    return {
      id: `letter-${match[1].toLowerCase()}`,
      numeral: match[1], title: match[2], cry: paragraphs[1].slice(2, -2),
      content: `<section class="attack-letter" id="letter-${match[1].toLowerCase()}" aria-labelledby="heading-${i + 1}">
        <h2 id="heading-${i + 1}" class="letter-heading"><span>Letter ${match[1]}</span>${esc(match[2])}</h2>
        <p class="salutation">Dear founder,</p>
        <h3 class="rallying-cry">${esc(paragraphs[1].slice(2, -2))}</h3>
        <div class="attack-opening">${html(paragraphs[2])}</div>
        <div class="attack-body">${body}</div>
        <p class="signature">Yours,<br><span>Silenus</span></p>
      </section>`,
    };
  });
  const toc = letters.map(l => `<li><a href="#${l.id}"><span class="track-number">${l.numeral}</span><span>${esc(l.cry)}</span><span aria-hidden="true">↓</span></a></li>`).join('\n');
  const template = fs.readFileSync(path.join(ROOT, 'templates/plan-of-attack.html'), 'utf8');
  const markdown = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\s*/, '');
  const replacements = { COVER: cover('b'), TOOLBAR: toolbar('b'), CONTENTS: toc, LETTERS: letters.map(l => l.content).join('\n'), MARKDOWN: JSON.stringify(markdown).replaceAll('<', '\\u003c') };
  const page = template.replace(/\{\{(COVER|TOOLBAR|CONTENTS|LETTERS|MARKDOWN)\}\}/g, (_, key) => replacements[key]);
  fs.mkdirSync(path.join(output, 'plan-of-attack'), { recursive: true });
  fs.mkdirSync(path.join(output, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(output, 'plan-of-attack/index.html'), page);
  fs.writeFileSync(path.join(output, 'dist/side-a-cover.html'), cover('a'));
  fs.writeFileSync(path.join(output, 'dist/side-a-bar.html'), toolbar('a'));
  console.log(`Built six letters at ${path.join(output, 'plan-of-attack/index.html')}`);
}
if (require.main === module) build(path.resolve(process.argv[2] || ROOT));
module.exports = { build };
