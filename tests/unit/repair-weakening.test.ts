import { describe, expect, it } from "vitest";

import { repairKeptItsPromise, weakeningFindings } from "@/lib/ai/repair-weakening";

/**
 * A repair is the one place where "it passes now" can mean "it stopped
 * checking", and the fastest way to make a failing assertion pass is to
 * delete it. The prompt forbids that in words. These are the rules.
 *
 * The cases that must keep passing matter as much: a repair that fixes a
 * locator, opens the right address, or replaces a fixed wait with an
 * assertion is exactly what the loop is for, and a guard that stopped those
 * would be turned off within a week.
 */
const original = `import { test, expect } from "@playwright/test";

test("[pwg:v1] a visitor adds a todo", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("textbox", { name: "What needs to be done?" }).fill("Buy milk");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Buy milk")).toBeVisible();
  await expect(page.getByTestId("todo-count")).toHaveText("1 item left");
});`;

describe("what a repair took away", () => {
  it("catches an assertion quietly dropped", () => {
    const repaired = original.replace(
      '  await expect(page.getByTestId("todo-count")).toHaveText("1 item left");\n',
      "",
    );

    const findings = weakeningFindings(original, repaired);
    expect(findings.map((finding) => finding.code)).toContain("assertions_removed");
    expect(findings[0].message).toContain("stopped looking");
    expect(repairKeptItsPromise(original, repaired)).toBe(false);
  });

  it("catches an assertion turned into its opposite", () => {
    // Passes for precisely the reason the test existed to rule out.
    const repaired = original.replace(
      'await expect(page.getByText("Buy milk")).toBeVisible()',
      'await expect(page.getByText("Buy milk")).not.toBeVisible()',
    );

    expect(weakeningFindings(original, repaired).map((finding) => finding.code)).toContain("assertion_negated");
  });

  it("catches a test that now skips itself", () => {
    const repaired = original.replace(
      'await page.goto("./");',
      'test.skip(!process.env.TODO_URL, "no address");\n  await page.goto("./");',
    );

    expect(weakeningFindings(original, repaired).map((finding) => finding.code)).toContain("test_skipped");
  });

  it("catches a failure swallowed rather than fixed", () => {
    const caught = original.replace(
      'await expect(page.getByText("Buy milk")).toBeVisible();',
      'await expect(page.getByText("Buy milk")).toBeVisible().catch(() => {});',
    );
    const softened = original.replace("await expect(page.getByTestId", "await expect.soft(page.getByTestId");

    expect(weakeningFindings(original, caught).map((finding) => finding.code)).toContain("failure_swallowed");
    expect(weakeningFindings(original, softened).map((finding) => finding.code)).toContain("failure_swallowed");
  });

  it("catches waiting put in place of asserting", () => {
    const repaired = original.replace(
      'await expect(page.getByText("Buy milk")).toBeVisible();',
      'await page.waitForTimeout(3000);\n  await expect(page.getByText("Buy milk")).toBeVisible();',
    );

    expect(weakeningFindings(original, repaired).map((finding) => finding.code)).toContain(
      "waits_instead_of_asserting",
    );
  });
});

describe("repairs that are what the loop is for", () => {
  it("allows a locator corrected against the page that really loaded", () => {
    const repaired = original.replace(
      'page.getByTestId("todo-count")',
      'page.getByRole("status").filter({ hasText: "item left" })',
    );

    expect(weakeningFindings(original, repaired)).toEqual([]);
    expect(repairKeptItsPromise(original, repaired)).toBe(true);
  });

  it("allows the address being fixed", () => {
    const repaired = original.replace('page.goto("./")', 'page.goto("./todomvc/")');
    expect(weakeningFindings(original, repaired)).toEqual([]);
  });

  it("allows an assertion added, and a fixed wait replaced by one", () => {
    // Strictly more checking than before: the thing a good repair does.
    const waiting = original.replace(
      'await page.keyboard.press("Enter");',
      'await page.keyboard.press("Enter");\n  await page.waitForTimeout(500);',
    );
    const repaired = waiting.replace(
      '  await page.waitForTimeout(500);',
      '  await expect(page.getByRole("listitem")).toHaveCount(1);',
    );

    expect(weakeningFindings(waiting, repaired)).toEqual([]);
  });

  it("allows a test rewritten with the same number of checks", () => {
    const repaired = original
      .replace('page.getByText("Buy milk")', 'page.getByRole("listitem").filter({ hasText: "Buy milk" })')
      .replace('toHaveText("1 item left")', 'toContainText("1 item")');

    expect(weakeningFindings(original, repaired)).toEqual([]);
  });
});
