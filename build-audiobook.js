#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function build(output = root) {
  const book = JSON.parse(fs.readFileSync(path.join(root, 'content/audiobook.json'), 'utf8'));
  if (!book.chapters.length || book.chapters.some((c, i) => c.number !== i + 1 || c.duration_seconds <= 0 || !c.url.startsWith('https://'))) {
    throw new Error('Invalid audiobook chapter manifest');
  }
  const duration = book.chapters.reduce((sum, c) => sum + c.duration_seconds, 0);
  if (Math.abs(duration - book.duration_seconds) > 0.2) throw new Error('Audiobook duration mismatch');
  let html = fs.readFileSync(path.join(root, 'templates/audiobook.html'), 'utf8');
  const replacements = {
    DATA: JSON.stringify(book).replace(/</g, '\\u003c'),
    OPTIONS: book.chapters.map((c, i) => `<option value="${i}">${String(c.number).padStart(2, '0')} — ${escapeHtml(c.title)}</option>`).join('\n'),
    DOWNLOADS: book.downloads.map(d => `<a class="audiobook-download" href="${escapeHtml(d.url)}"><strong>${escapeHtml(d.label)}</strong><span>${escapeHtml(d.detail)}</span></a>`).join('\n'),
  };
  html = html.replace(/\{\{(DATA|OPTIONS|DOWNLOADS)\}\}/g, (_, key) => replacements[key]);
  const target = path.join(output, 'audiobook');
  fs.mkdirSync(target, {recursive:true});
  fs.writeFileSync(path.join(target, 'index.html'), html);
  console.log(`Wrote audiobook page to ${target}`);
}
if (require.main === module) build(process.argv[2] ? path.resolve(process.argv[2]) : root);
module.exports = {build};
