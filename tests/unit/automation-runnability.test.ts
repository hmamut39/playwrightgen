import { describe, expect, it } from "vitest";

import {
  validateAutomationGeneration,
  type AutomationGenerationResult,
} from "@/lib/ai/automation-generation";

/**
 * Whether a generated test could run at all.
 *
 * PlaywrightGen's own proof repository has been red since 2026-09-07. The
 * generated test navigated to '/cart' while its configuration set no baseURL,
 * so every run failed with "Cannot navigate to invalid URL" before reaching a
 * single assertion. It could not have passed anywhere, on any machine, and
 * nothing said so: a person approved it, CI ran it three times over a
 * fortnight, and the product recorded three honest failures of a test that was
 * never able to work.
 *
 * The same file shows the second fault. It guarded itself with test.skip()
 * when card details were absent -- sensible -- but put the navigation in
 * beforeEach, which runs first. The guard could never fire.
 *
 * Validation runs before a reviewer sees the code, which is the only place
 * either of these is cheap to catch.
 */

const base = (): AutomationGenerationResult => ({
  model: "test-model",
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
  name: "Card payment",
  summary: "Pays with a card.",
  plan: [{ title: "Pay", intent: "Submit a card.", expectedAssertion: "Confirmation shows." }],
  code: "",
  configuration: `import { defineConfig } from "@playwright/test";
export default defineConfig({ use: { baseURL: "https://shop.example.com" } });`,
  dependencies: ["@playwright/test"],
  assumptions: [],
});

const codes = (result: ReturnType<typeof validateAutomationGeneration>) =>
  result.findings.map((finding) => finding.code);

describe("a generated test that could not run", () => {
  it("blocks a relative navigation when nothing sets a baseURL", () => {
    // Reduced from the artifact that has been failing in the proof repository.
    const result = validateAutomationGeneration("PLAYWRIGHT_BROWSER", {
      ...base(),
      code: `import { test, expect } from "@playwright/test";
test("pays", async ({ page }) => {
  await page.goto("/cart");
  await expect(page.getByText("Order confirmed")).toBeVisible();
});`,
      configuration: `import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./tests" });`,
    });

    expect(codes(result)).toContain("relative_navigation_without_base_url");
    expect(result.status).toBe("BLOCKED");
    // The message names the path, so a reviewer does not have to find it.
    expect(result.findings.find((f) => f.code === "relative_navigation_without_base_url")?.message)
      .toContain("/cart");
  });

  it("allows the same navigation once a baseURL exists", () => {
    const result = validateAutomationGeneration("PLAYWRIGHT_BROWSER", {
      ...base(),
      code: `import { test, expect } from "@playwright/test";
test("pays", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByText("Order confirmed")).toBeVisible();
});`,
    });

    expect(codes(result)).not.toContain("relative_navigation_without_base_url");
  });

  it("allows a full URL with no baseURL at all", () => {
    const result = validateAutomationGeneration("PLAYWRIGHT_BROWSER", {
      ...base(),
      code: `import { test, expect } from "@playwright/test";
test("pays", async ({ page }) => {
  await page.goto("https://shop.example.com/cart");
  await expect(page.getByText("Order confirmed")).toBeVisible();
});`,
      configuration: `import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./tests" });`,
    });

    expect(codes(result)).not.toContain("relative_navigation_without_base_url");
  });

  it("warns when a skip guard runs after the hook it needed to beat", () => {
    const result = validateAutomationGeneration("PLAYWRIGHT_BROWSER", {
      ...base(),
      code: `import { test, expect } from "@playwright/test";
const cardNumber = process.env.TEST_CARD_NUMBER;
test.beforeEach(async ({ page }) => {
  await page.goto("./cart");
});
test("pays", async ({ page }) => {
  test.skip(!cardNumber, "No card details provided.");
  await expect(page.getByText("Order confirmed")).toBeVisible();
});`,
    });

    expect(codes(result)).toContain("skip_after_hook");
    // A warning, not a block: the pattern is fine when the hook does not
    // depend on what is missing, and a reviewer is the right judge of that.
    expect(result.status).not.toBe("BLOCKED");
  });

  it("stays quiet when there is no hook to beat", () => {
    const result = validateAutomationGeneration("PLAYWRIGHT_BROWSER", {
      ...base(),
      code: `import { test, expect } from "@playwright/test";
test("pays", async ({ page }) => {
  test.skip(!process.env.TEST_CARD_NUMBER, "No card details provided.");
  await page.goto("./cart");
  await expect(page.getByText("Order confirmed")).toBeVisible();
});`,
    });

    expect(codes(result)).not.toContain("skip_after_hook");
  });
});
