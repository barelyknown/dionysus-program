const { defineConfig, devices } = require("@playwright/test");

const defaultBaseURL = "http://localhost:4173";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || defaultBaseURL;
const useWebServer = baseURL === defaultBaseURL;

module.exports = defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01
    }
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  outputDir: "playwright-artifacts/test-output",
  snapshotDir: "e2e/__screenshots__",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-artifacts/report", open: "never" }]
  ],
  webServer: useWebServer
    ? {
        command: "python3 -m http.server 4173",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000
      }
    : undefined,
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 }
      }
    }
  ]
});
