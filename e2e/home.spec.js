const { test, expect } = require("@playwright/test");
const { AxeBuilder } = require("@axe-core/playwright");

const disableMotion = async (page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({
    content: `*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
}`
  });
};

const gotoHome = async (page) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await disableMotion(page);
  await expect(page.locator(".page-header")).toBeVisible();
  await page.waitForFunction(() => {
    const cover = document.querySelector(".page-cover");
    return cover && cover.complete;
  });
};

test("home page renders key header and downloads", async ({ page }) => {
  await gotoHome(page);
  await expect(page.locator("img.page-cover")).toBeVisible();
  await expect(page.getByRole("link", { name: "PDF" })).toBeVisible();
});

test("navigation from home to simulation works", async ({ page }) => {
  await gotoHome(page);
  await page
    .locator(".page-header")
    .getByRole("link", { name: "Simulation" })
    .click();
  await expect(page).toHaveURL(/simulation\.html$/);
  await expect(
    page.getByRole("heading", { name: "The Dionysus Program", level: 1 })
  ).toBeVisible();
});

test("home header visual snapshot", async ({ page }) => {
  await gotoHome(page);
  const cover = page.locator(".page-cover");
  await expect(cover).toHaveScreenshot("home-cover.png");
});

test("home page a11y check (critical/serious)", async ({ page }) => {
  await gotoHome(page);
  const results = await new AxeBuilder({ page })
    .include("main")
    .disableRules(["color-contrast"])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious"
  );
  expect(blocking).toEqual([]);
});
