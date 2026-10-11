#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

// Keep the repository test runner independent of the build renderer's browser.
// On this Mac, use the shared package and its matching Chrome for Testing.
const sharedPlaywright = path.join(os.homedir(), 'node_modules', 'playwright');
const playwrightModule = process.env.DIONYSUS_PLAYWRIGHT_MODULE ||
  (process.platform === 'darwin' && fs.existsSync(sharedPlaywright) ? sharedPlaywright : 'playwright');
const { chromium } = require(playwrightModule);
const checkOnly = process.argv[2] === '--check';

const outputDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, 'dist', 'pull-quotes');
const htmlPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(__dirname, 'pull-quotes.html');

if (!checkOnly && !fs.existsSync(htmlPath)) {
  console.error(`Pull quotes HTML not found at ${htmlPath}`);
  process.exit(1);
}

const url = htmlPath.startsWith('http://') || htmlPath.startsWith('https://')
  ? htmlPath
  : pathToFileURL(htmlPath).toString();

async function renderImages() {
  const browser = await chromium.launch({ channel: 'chromium', headless: true, chromiumSandbox: true });
  try {
    if (checkOnly) return;
    fs.mkdirSync(outputDir, { recursive: true });
    const page = await browser.newPage({
      viewport: { width: 1400, height: 2000 },
      deviceScaleFactor: 1,
    });

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('.quote-card');

    const cards = await page.$$('.quote-card');
    if (!cards.length) {
      console.error('No quote cards found to capture.');
      throw new Error('No pull quote cards were rendered.');
    }

    let index = 1;
    for (const card of cards) {
      const filename = `quote-${String(index).padStart(2, '0')}.png`;
      const outputPath = path.join(outputDir, filename);
      await card.screenshot({ path: outputPath });
      index += 1;
    }

    console.log(`Wrote ${cards.length} images to ${outputDir}`);
  } finally {
    await browser.close();
  }
}

renderImages().catch((error) => {
  console.error(error);
  process.exit(1);
});
