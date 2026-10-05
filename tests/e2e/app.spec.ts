import { expect, test, type Browser, type Page } from "@playwright/test";

async function openPage(
  browser: Browser,
  width: number,
  height: number,
  deviceScaleFactor: number,
) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByText("AWS Exam Practice", { exact: true }).first()).toBeVisible();
  return { context, page };
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
}

const screenshotViewports = [
  { width: 320, height: 568, dpr: 1 },
  { width: 390, height: 844, dpr: 2 },
  { width: 768, height: 1024, dpr: 2 },
  { width: 1280, height: 720, dpr: 1 },
  { width: 1440, height: 900, dpr: 2 },
];

for (const { width, height, dpr } of screenshotViewports) {
  test(`setup screenshot at ${width}×${height} ${dpr}x`, async ({ browser }, testInfo) => {
    const { context, page } = await openPage(browser, width, height, dpr);
    try {
      await settle(page);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        "horizontal overflow",
      ).toBeLessThanOrEqual(width);
      // Saved to test-results so CI can upload each screenshot as an artifact.
      await page.screenshot({
        path: testInfo.outputPath(`setup-${width}x${height}-${dpr}x.png`),
        fullPage: true,
      });
    } finally {
      await context.close();
    }
  });
}

test("provider toggle switches theme and title", async ({ browser }, testInfo) => {
  const { context, page } = await openPage(browser, 1280, 720, 1);
  try {
    await page.getByRole("tab", { name: "Claude" }).click();
    await expect(page.locator("html")).toHaveClass(/theme-claude/);
    await expect(page).toHaveTitle("Claude Exam Practice");
    await settle(page);
    await page.screenshot({
      path: testInfo.outputPath("setup-claude-1280x720-1x.png"),
      fullPage: true,
    });
    await page.getByRole("tab", { name: "AWS" }).click();
    await expect(page.locator("html")).not.toHaveClass(/theme-claude/);
    await expect(page).toHaveTitle("AWS Exam Practice");
  } finally {
    await context.close();
  }
});

test("quiz flow: start, answer, and reach a question", async ({ browser }, testInfo) => {
  const { context, page } = await openPage(browser, 390, 844, 2);
  try {
    await page.getByLabel("Custom").fill("5");
    await page.getByRole("button", { name: /Start new quiz/ }).click();
    await expect(page.getByRole("button", { name: /Start new quiz/ })).toHaveCount(0);
    await expect(page.getByRole("radio").or(page.getByRole("checkbox")).first()).toBeVisible();
    await settle(page);
    await page.screenshot({ path: testInfo.outputPath("quiz-390x844-2x.png"), fullPage: true });
  } finally {
    await context.close();
  }
});

test("study notes open from setup", async ({ browser }, testInfo) => {
  const { context, page } = await openPage(browser, 1280, 720, 1);
  try {
    await page.getByRole("button", { name: "Study notes" }).click();
    await expect(page.getByRole("button", { name: "Study notes" })).toHaveCount(0);
    await expect(page.locator("main")).toContainText(/\w/);
    await page.waitForLoadState("networkidle");
    await settle(page);
    await page.screenshot({ path: testInfo.outputPath("study-1280x720-1x.png"), fullPage: true });
  } finally {
    await context.close();
  }
});

test("CCDV-F questions show an answer-confidence footnote", async ({ browser }, testInfo) => {
  const { context, page } = await openPage(browser, 390, 844, 2);
  try {
    await page.getByRole("tab", { name: "Claude" }).click();
    await page.getByText("Claude Certified Developer – Foundations").first().click();
    await page.getByLabel("Custom").fill("3");
    await page.getByRole("button", { name: /Start new quiz/ }).click();

    const trigger = page.getByRole("button", { name: /^Answer confidence: / });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute("data-rag", /^(green|amber|red)$/);

    // Doc links stay hidden until the question is answered, so they can't hint at it.
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Reviewed Oct 2026");
    await expect(dialog).toContainText("Disputed:");
    await expect(dialog.getByRole("link")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // Questions are drawn at random and some are multi-select, which keeps
    // Submit disabled until enough options are picked.
    const submit = page.getByRole("button", { name: "Submit answer" });
    const options = page.locator("button[aria-pressed]");
    for (let i = 0; !(await submit.isEnabled()); i++) await options.nth(i).click();
    await submit.click();
    await trigger.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await settle(page);
    await page.screenshot({
      path: testInfo.outputPath("confidence-390x844-2x.png"),
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

test("AWS questions show no answer-confidence footnote", async ({ browser }) => {
  const { context, page } = await openPage(browser, 1280, 720, 1);
  try {
    await page.getByLabel("Custom").fill("3");
    await page.getByRole("button", { name: /Start new quiz/ }).click();
    await expect(page.locator("button[aria-pressed]").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Answer confidence: / })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
