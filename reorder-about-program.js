#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const htmlPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const headerMarker = '<h2 id="about-the-program">About the Program</h2>';
const headerIndex = html.indexOf(headerMarker);
if (headerIndex === -1) {
  console.warn('About the Program header not found; skipping reorder.');
  process.exit(0);
}

const divStart = html.indexOf('<div class="about-program">', headerIndex);
if (divStart === -1) {
  console.warn('About the Program wrapper not found; skipping reorder.');
  process.exit(0);
}

function findMatchingDivEnd(str, startIndex) {
  let idx = startIndex;
  let depth = 0;
  while (idx < str.length) {
    const nextOpen = str.indexOf('<div', idx);
    const nextClose = str.indexOf('</div>', idx);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      idx = nextOpen + 4;
    } else {
      depth -= 1;
      idx = nextClose + 6;
      if (depth === 0) {
        return idx;
      }
    }
  }
  return -1;
}

const divEnd = findMatchingDivEnd(html, divStart);
if (divEnd === -1) {
  console.warn('About the Program wrapper did not close cleanly; skipping reorder.');
  process.exit(0);
}

const aboutBlock = html.slice(headerIndex, divEnd);
let updated = html.slice(0, headerIndex) + html.slice(divEnd);

const navIndex = updated.indexOf('<nav class="page-toc"');
if (navIndex === -1) {
  console.warn('TOC nav not found; skipping reorder.');
  fs.writeFileSync(htmlPath, updated, 'utf8');
  process.exit(0);
}

updated = `${updated.slice(0, navIndex)}${aboutBlock}\n${updated.slice(navIndex)}`;
fs.writeFileSync(htmlPath, updated, 'utf8');
