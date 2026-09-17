import { afterAll, describe, expect, it } from "vitest";

import { reviewCoverage, type CoverageReviewInput } from "@/lib/ai/coverage-review";

/**
 * Measures whether Coverage Review keeps the promises its page makes.
 *
 * The page says the review is bounded by the evidence supplied: it names what
 * it had, what it lacked, and what that means for its conclusions. A prompt
 * that has drifted still returns a confident, well-shaped review -- with
 * findings about systems nobody mentioned, or a high evidence rating for a
 * single paragraph. Nothing else in the test suite can catch that, because the
 * shape stays valid.
 *
 * Graded deterministically from the structured result rather than by a judge
 * model, which would be a second thing that can be wrong.
 */

const brittleTests = `import { test, expect } from "@playwright/test";

test("applies a promo code", async ({ page }) => {
  await page.goto("/checkout");
  await page.locator("#promo").fill("SAVE10");
  await page.locator("button.apply").click();
  await page.waitForTimeout(2000);
  expect(await page.locator(".total").textContent()).toBeTruthy();
});`;

const baseInput: CoverageReviewInput = {
  lens: "COVERAGE",
  pageUrl: "",
  requirement:
    "A signed-in customer can apply one promotion code at checkout. The discount shows as a separate line before tax. An expired or unknown code shows an inline error and leaves the total unchanged. Only one code applies at a time.",
  existingTests: "",
  screenshotDataUrl: "",
};

const attempts: Array<{ id: string; findings: number; nextTests: number; level: string }> = [];

async function review(id: string, overrides: Partial<CoverageReviewInput> = {}) {
  const result = await reviewCoverage({ ...baseInput, ...overrides });
  attempts.push({
    id,
    findings: result.findings.length,
    nextTests: result.nextTests.length,
    level: result.evidenceQuality.level,
  });
  return result;
}

function allText(result: Awaited<ReturnType<typeof reviewCoverage>>) {
  return [
    result.summary,
    ...result.evidenceQuality.limitations,
    ...result.findings.flatMap((finding) => [finding.title, finding.evidenceBasis, finding.whyItMatters, finding.recommendation]),
    ...result.nextTests.flatMap((next) => [next.title, next.rationale, next.objective, next.expectedOutcome]),
  ]
    .join("\n")
    .toLowerCase();
}

describe("Coverage Review quality", () => {
  afterAll(() => {
    // Printed so a failing run can be read without paying to re-run it.
    for (const attempt of attempts) {
      console.log(`[${attempt.id}] findings=${attempt.findings} nextTests=${attempt.nextTests} evidence=${attempt.level}`);
    }
  });

  it("finds the gaps a requirement names and no test covers", async () => {
    const result = await review("gaps", { existingTests: brittleTests });

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.nextTests.length).toBeGreaterThan(0);
    // The requirement states three behaviours the one test ignores; a review
    // that misses all of them is not worth the page it is shown on.
    const text = allText(result);
    const named = ["expired", "unknown", "error", "tax", "one code", "second"].filter((phrase) => text.includes(phrase));
    expect(named.length).toBeGreaterThanOrEqual(2);
    for (const finding of result.findings) {
      expect(finding.recommendation.length).toBeGreaterThan(10);
      expect(finding.evidenceBasis.length).toBeGreaterThan(10);
    }
  }, 120_000);

  it("rates thin evidence as thin, and says what was missing", async () => {
    // A requirement and nothing else: no tests, no page, no screenshot.
    const result = await review("thin-evidence");

    expect(result.evidenceQuality.level).not.toBe("HIGH");
    expect(result.evidenceQuality.missingSignals.length).toBeGreaterThan(0);
    expect(result.evidenceQuality.limitations.length).toBeGreaterThan(0);
    // Nothing was run, so nothing may be reported as observed behaviour.
    const text = allText(result);
    for (const claim of ["test passed", "tests passed", "we ran", "i ran", "after running"]) {
      expect(text).not.toContain(claim);
    }
  }, 120_000);

  it("names the brittle patterns in a pasted test under the flaky lens", async () => {
    const result = await review("flaky-lens", { lens: "FLAKY", existingTests: brittleTests });

    const text = allText(result);
    // The pasted test has a fixed wait, DOM-coupled selectors and a truthiness
    // assertion. These are the three things this lens exists to catch.
    const spotted = ["waitfortimeout", "fixed wait", "hard wait", "sleep"].some((phrase) => text.includes(phrase));
    expect(spotted).toBe(true);
    expect(result.findings.some((finding) => finding.category === "FLAKY_RISK")).toBe(true);
  }, 120_000);

  it("keeps to the evidence instead of reviewing a product it was not shown", async () => {
    const result = await review("no-invention", { existingTests: brittleTests });

    const text = allText(result);
    // Nothing here mentions any of these; naming one means the review is
    // describing an imagined application rather than this one. Matched as whole
    // words, so "scenarios" is not read as "ios".
    for (const invented of ["kubernetes", "graphql", "stripe", "mobile app", "android", "ios", "swift"]) {
      expect(text).not.toMatch(new RegExp(`\\b${invented}\\b`));
    }
  }, 120_000);

  it("weighs the real page when one was read", async () => {
    // The page names controls the requirement does not, so a review that read
    // it should be able to mention one of them.
    const result = await review("live-page", {
      pageUrl: "https://shop.example.com/checkout",
      pageSnapshot: {
        finalUrl: "https://shop.example.com/checkout",
        title: "Checkout",
        aria: [
          "- textbox \"Promotion code\"",
          "- button \"Apply\"",
          "- button \"Remove code\"",
          "- text: Subtotal",
          "- text: Tax",
          "- button \"Place order\"",
          "- link \"Terms of sale\"",
        ].join("\n"),
      },
    });

    const text = allText(result);
    expect(["remove code", "place order", "terms of sale"].some((control) => text.includes(control))).toBe(true);
  }, 120_000);
});
