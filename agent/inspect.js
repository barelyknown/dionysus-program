#!/usr/bin/env node

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const outputDir = process.argv[2];
const configPath = process.argv[3];
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:4173";
const selector = process.env.INSPECT_SELECTOR || ".page-header";
const fullPage = process.env.INSPECT_FULL_PAGE === "1";
const viewportWidth = Number.parseInt(process.env.INSPECT_VIEWPORT_WIDTH || "1280", 10);
const viewportHeight = Number.parseInt(process.env.INSPECT_VIEWPORT_HEIGHT || "720", 10);
const quality = Number.parseInt(process.env.INSPECT_JPEG_QUALITY || "82", 10);
const startServerMode = (process.env.INSPECT_START_SERVER || "auto").toLowerCase();

const shouldStartServer = (url) => {
  if (["1", "true", "yes"].includes(startServerMode)) return true;
  if (["0", "false", "no"].includes(startServerMode)) return false;
  try {
    const parsed = new URL(url);
    const hostMatches =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1";
    return hostMatches && parsed.port === "4173";
  } catch {
    return false;
  }
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isServerReachable = async (url) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return true;
  } catch {
    return false;
  }
};

if (!outputDir) {
  console.error("Usage: node agent/inspect.js <output-dir> [config-path]");
  process.exit(1);
}

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

(async () => {
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch (error) {
    console.error("Playwright is not available. Run npm install first.");
    process.exit(1);
  }

  ensureDir(outputDir);

  let serverProcess = null;
  const needsServer = shouldStartServer(baseURL);
  if (needsServer && !(await isServerReachable(baseURL))) {
    if (!process.env.PYTHONHTTPSERVER_DISABLE) {
      serverProcess = spawn("python3", ["-m", "http.server", "4173"], {
        cwd: process.cwd(),
        stdio: "ignore"
      });
    }
    for (let i = 0; i < 15; i += 1) {
      if (await isServerReachable(baseURL)) {
        break;
      }
      await wait(300);
    }
  }

  if (!(await isServerReachable(baseURL))) {
    console.error(`Unable to reach ${baseURL}. Set PLAYWRIGHT_BASE_URL or start a server.`);
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
    }
    process.exit(1);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: viewportWidth, height: viewportHeight }
  });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({
    content: `*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
}`
  });

  const configExists = configPath && fs.existsSync(configPath);
  let captures = [];

  if (configExists) {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    captures = Array.isArray(raw) ? raw : raw.captures || [];
  }

  if (captures.length === 0) {
    captures = [
      {
        name: "home-header",
        url: "/",
        selector
      }
    ];
  }

  const manifest = [];

  for (let i = 0; i < captures.length; i += 1) {
    const capture = captures[i] || {};
    const name = capture.name || `capture-${i + 1}`;
    const captureUrl = capture.url ? new URL(capture.url, baseURL).toString() : baseURL;
    const captureSelector = capture.selector || null;
    const captureFullPage = capture.fullPage === true || fullPage;
    const captureViewport = capture.viewport || null;
    const captureWaitFor = capture.waitFor || captureSelector || "main";
    const captureFormat = (capture.format || process.env.INSPECT_FORMAT || "png").toLowerCase();
    const ext = captureFormat === "jpg" || captureFormat === "jpeg" ? "jpg" : "png";
    const outputPath = path.join(outputDir, `${name}.${ext}`);

    if (captureViewport && captureViewport.width && captureViewport.height) {
      await page.setViewportSize({
        width: captureViewport.width,
        height: captureViewport.height
      });
    }

    await page.goto(captureUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(captureWaitFor, { state: "visible", timeout: 10000 });

    await page.waitForFunction(() => {
      const cover = document.querySelector(".page-cover");
      return cover ? cover.complete : true;
    });

    const screenshotOptions = { path: outputPath, animations: "disabled", caret: "hide" };
    if (ext === "jpg") {
      screenshotOptions.type = "jpeg";
      screenshotOptions.quality = Number.isFinite(quality)
        ? Math.min(Math.max(quality, 20), 100)
        : 82;
    }

    if (captureFullPage) {
      await page.screenshot({ ...screenshotOptions, fullPage: true });
    } else if (captureSelector) {
      const element = await page.$(captureSelector);
      if (element) {
        try {
          await element.scrollIntoViewIfNeeded();
        } catch {
          // ignore scroll failures and attempt bounding box capture
        }
        const box = await element.boundingBox();
        if (box && box.width > 0 && box.height > 0) {
          await page.screenshot({
            ...screenshotOptions,
            clip: {
              x: Math.max(0, box.x),
              y: Math.max(0, box.y),
              width: Math.min(box.width, viewportWidth),
              height: Math.min(box.height, viewportHeight)
            }
          });
        } else {
          await page.screenshot({ ...screenshotOptions, fullPage: false });
        }
      } else {
        await page.screenshot({ ...screenshotOptions, fullPage: false });
      }
    } else {
      await page.screenshot({ ...screenshotOptions, fullPage: false });
    }

    manifest.push({
      name,
      url: captureUrl,
      selector: captureSelector,
      path: outputPath
    });
  }

  fs.writeFileSync(
    path.join(outputDir, "inspect-manifest.json"),
    JSON.stringify({ captures: manifest }, null, 2)
  );
  await browser.close();

  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }
})();
