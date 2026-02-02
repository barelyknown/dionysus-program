#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

let playwright;
try {
  playwright = require('playwright');
} catch (error) {
  console.error('Skipping pull quote images: Playwright not installed.');
  console.error('Install it with: npm install --save-dev playwright');
  console.error('Then install a browser with: npx playwright install chromium');
  process.exit(0);
}

const { chromium } = playwright;

const resolveChromiumExecutables = () => {
  const defaultPath = chromium.executablePath();
  if (defaultPath && fs.existsSync(defaultPath)) return [defaultPath];

  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const cacheRoot = browsersPath && browsersPath !== '0'
    ? browsersPath
    : path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');

  if (!fs.existsSync(cacheRoot)) return [];

  const entries = fs.readdirSync(cacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const headlessCandidates = [];
  const chromeCandidates = [];

  const addCandidates = (base) => {
    headlessCandidates.push(
      path.join(base, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
      path.join(base, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell')
    );
    chromeCandidates.push(
      path.join(base, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      path.join(base, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
    );
  };

  const revisionMatch = defaultPath ? defaultPath.match(/chromium-(\d+)/) : null;
  const revision = revisionMatch ? revisionMatch[1] : null;
  if (revision) {
    addCandidates(path.join(cacheRoot, `chromium_headless_shell-${revision}`));
    addCandidates(path.join(cacheRoot, `chromium-${revision}`));
  }

  for (const entry of entries) {
    if (!entry.startsWith('chromium') && !entry.startsWith('chromium_headless_shell')) continue;
    addCandidates(path.join(cacheRoot, entry));
  }

  const seen = new Set();
  const candidates = [...headlessCandidates, ...chromeCandidates]
    .filter((candidate) => {
      if (seen.has(candidate)) return false;
      seen.add(candidate);
      return fs.existsSync(candidate);
    });

  return candidates;
};

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
  const executablePaths = resolveChromiumExecutables();
  if (!executablePaths.length) {
    console.error('Skipping pull quote images: Chromium executable not found.');
    return;
  }

  fs.mkdirSync(outputDir, { recursive: true });

  let browser = null;
  let lastError = null;
  for (const executablePath of executablePaths) {
    try {
      browser = await chromium.launch({ executablePath });
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!browser) {
    console.error('Skipping pull quote images: Unable to launch Chromium.');
    if (lastError) console.error(lastError);
    return;
  }
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
