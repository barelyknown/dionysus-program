#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, 'pull-quotes.json');
const outputPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(__dirname, 'pull-quotes.html');

const raw = fs.readFileSync(inputPath, 'utf8');
let quotes;
try {
  quotes = JSON.parse(raw);
} catch (error) {
  console.error('Failed to parse pull quotes JSON.');
  throw error;
}

if (!Array.isArray(quotes)) {
  throw new Error('Pull quotes JSON must be an array.');
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatQuote(value) {
  const escaped = escapeHtml(String(value));
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

const cards = quotes
  .map((entry, index) => {
    const quote = formatQuote(entry.quote || '');
    const author = escapeHtml(entry.author || '');
    const source = String(entry.source || '');
    const isLetter = source.startsWith('letters_to_editor/');
    const kind = isLetter ? 'letter' : 'essay';
    const imageName = `quote-${String(index + 1).padStart(2, '0')}.png`;
    const imagePath = `dist/pull-quotes/${imageName}`;
    return `
      <div class="quote-wrapper">
        <article class="quote-card quote-card--${kind}" data-kind="${kind}">
          <div class="quote-brand">The Dionysus Program</div>
          <p class="quote-text">${quote}</p>
          <p class="quote-attribution">— ${author}</p>
        </article>
        <a class="quote-image-link" href="${imagePath}">Open image</a>
      </div>
    `;
  })
  .join('\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dionysus Program Pull Quotes</title>
  <style>
    :root {
      color-scheme: light;
      --card-width: 1200px;
      --card-height: 630px;
      --page-background: #f2ece3;
      --essay-background: #fffaf2;
      --essay-border: #e4dbcf;
      --essay-ink: #26211b;
      --letter-background: #1f1b16;
      --letter-border: #2a241e;
      --letter-ink: #f7f2e8;
      --letter-accent: #d6c4a2;
      --accent: #5a4e42;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", serif;
      background: var(--page-background);
      color: var(--essay-ink);
      padding: 3rem 2.5rem 5rem;
      overflow-x: auto;
    }

    main {
      display: block;
    }

    .page-header {
      max-width: 960px;
      margin: 0 auto 3.25rem;
      text-align: center;
      color: var(--accent);
    }

    .page-header h1 {
      font-size: 2.5rem;
      font-weight: 500;
      letter-spacing: 0.06em;
    }

    .page-subtitle {
      margin-top: 0.6rem;
      font-size: 1.05rem;
      font-style: italic;
      color: rgba(90, 78, 66, 0.85);
    }

    .page-download {
      margin-top: 1.6rem;
      font-size: 0.85rem;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: rgba(90, 78, 66, 0.7);
    }

    .page-download a {
      color: inherit;
      text-decoration: none;
      border-bottom: 1px solid rgba(90, 78, 66, 0.35);
      padding-bottom: 0.12rem;
    }

    .page-download a:hover {
      border-bottom-color: rgba(90, 78, 66, 0.75);
      color: rgba(60, 52, 44, 0.95);
    }

    .quote-grid {
      display: grid;
      gap: 2.75rem;
      justify-items: center;
      align-items: start;
      margin-top: 0.75rem;
    }

    .quote-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.85rem;
    }

    .quote-image-link {
      font-size: 0.75rem;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: rgba(90, 78, 66, 0.75);
      text-decoration: none;
      border-bottom: 1px solid rgba(90, 78, 66, 0.35);
      padding-bottom: 0.1rem;
    }

    .quote-image-link:hover {
      color: rgba(60, 52, 44, 0.95);
      border-bottom-color: rgba(90, 78, 66, 0.7);
    }

    .quote-brand {
      font-size: 1.1rem;
      letter-spacing: 0.38em;
      text-transform: uppercase;
      margin: 1.4rem 0 2rem;
      color: rgba(90, 78, 66, 0.6);
      text-align: center;
    }

    .quote-card--letter .quote-brand {
      color: rgba(214, 196, 162, 0.6);
    }

    .quote-card {
      width: var(--card-width);
      height: var(--card-height);
      padding: 4.5rem 5.25rem;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      border-radius: 18px;
      position: relative;
      box-shadow: 0 22px 50px rgba(33, 27, 18, 0.15);
    }

    .quote-card::after {
      content: "";
      position: absolute;
      inset: 18px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.35);
      pointer-events: none;
    }

    .quote-card--essay {
      background: linear-gradient(160deg, #fffdf7 0%, var(--essay-background) 55%, #f6efe4 100%);
      border: 1px solid var(--essay-border);
      color: var(--essay-ink);
    }

    .quote-card--letter {
      background: radial-gradient(circle at top left, #2c261f 0%, var(--letter-background) 60%);
      border: 1px solid var(--letter-border);
      color: var(--letter-ink);
    }

    .quote-card--letter::after {
      border-color: rgba(214, 196, 162, 0.35);
    }

    .quote-text {
      font-size: 2.6rem;
      line-height: 1.4;
      font-weight: 500;
      max-width: 760px;
      margin: 2.2rem auto 0;
      text-align: center;
    }

    .quote-text strong {
      font-weight: 700;
    }

    .quote-text em {
      font-style: italic;
    }

    .quote-card--letter .quote-text {
      font-style: italic;
      font-weight: 400;
    }

    .quote-attribution {
      margin-top: auto;
      font-size: 1.35rem;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: rgba(90, 78, 66, 0.8);
      text-align: center;
    }

    .quote-card--letter .quote-attribution {
      color: var(--letter-accent);
    }

    @media (max-width: 1300px) {
      body {
        padding: 2.5rem 1.5rem 4rem;
      }

      .quote-card {
        transform: scale(0.85);
        transform-origin: top center;
      }
    }
  </style>
</head>
<body>
  <main>
    <header class="page-header">
      <h1>The Dionysus Program</h1>
      <p class="page-subtitle">Pull Quotes</p>
      <p class="page-download"><a href="index.html">← Back</a></p>
    </header>
    <section class="quote-grid">
      ${cards}
    </section>
  </main>
</body>
</html>
`;

fs.writeFileSync(outputPath, html, 'utf8');
