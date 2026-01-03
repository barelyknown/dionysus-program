#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let playwright;
try {
  playwright = require('playwright');
} catch (error) {
  console.error('Playwright is required to render images.');
  console.error('Install it with: npm install --save-dev playwright');
  console.error('Then install a browser with: npx playwright install chromium');
  process.exit(1);
}

const { chromium } = playwright;

const outputDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, 'dist', 'pull-quotes');
const htmlPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(__dirname, 'pull-quotes.html');

if (!fs.existsSync(htmlPath)) {
  console.error(`Pull quotes HTML not found at ${htmlPath}`);
  process.exit(1);
}

const url = htmlPath.startsWith('http://') || htmlPath.startsWith('https://')
  ? htmlPath
  : pathToFileURL(htmlPath).toString();

async function renderImages() {
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1400, height: 2000 },
    deviceScaleFactor: 1,
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.quote-card');

  const cards = await page.$$('.quote-card');
  if (!cards.length) {
    console.error('No quote cards found to capture.');
    await browser.close();
    process.exit(1);
  }

  let index = 1;
  for (const card of cards) {
    const filename = `quote-${String(index).padStart(2, '0')}.png`;
    const outputPath = path.join(outputDir, filename);
    await card.screenshot({ path: outputPath });
    index += 1;
  }

  await browser.close();
  console.log(`Wrote ${cards.length} images to ${outputDir}`);
}

renderImages().catch((error) => {
  console.error(error);
  process.exit(1);
});
