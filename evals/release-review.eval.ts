import { afterAll, describe, expect, it } from "vitest";

import {
  buildReleaseReviewContext,
  reviewRelease,
  ReleaseReviewProviderError,
  type Finding,
} from "@/lib/ai/release-review";

/**
 * Measures whether Release Review's report is grounded in what was submitted.
 *
 * Its own content checks run inside the engine and a failed check costs a
 * repair call, so the number that matters is how often a first attempt is good
 * enough -- and whether the report stays inside the evidence when the
 * submission is thin. Both are invisible to the test suite: the report is
 * always well formed, and a drifted prompt reads more confident, not less.
 */

const rich = buildReleaseReviewContext({
  projectName: "Checkout promotions",
  changeSummary:
    "The promotion code field at checkout now validates against the promotions service before the order is submitted, instead of after payment authorisation.",
  expectedBehavior:
    "An invalid or expired code shows an inline error and the order is not submitted. A valid code shows the discount as a separate line before tax.",
  beforeBehavior:
    "Codes were validated after payment authorisation, so an expired code could take payment and then fail the order.",
  acceptanceCriteria:
    "Invalid code: inline error, total unchanged, no payment attempt. Valid code: discount line before tax. One code at a time.",
  changeCategories: ["Backend logic", "Payment flow"],
  affectedApplications: ["Storefront checkout"],
  userRoles: ["Customer"],
  featureFlagStatus: "Behind a flag",
  featureFlagName: "checkout_promo_preflight",
  rolloutStrategy: "Gradual rollout",
  downstreamConsumers: ["Order service", "Finance reporting"],
  reviewMode: "impact",
  depth: "standard",
});

const thin = buildReleaseReviewContext({
  changeSummary: "Updated the checkout page.",
  expectedBehavior: "It should work.",
});

const attempts: Array<{ id: string; repaired: boolean; findings: number; score: number }> = [];

async function run(id: string, context: Parameters<typeof reviewRelease>[0]) {
  const result = await reviewRelease(context);
  const findings = [
    ...result.criticalFindings,
    ...result.architectureIntelligence,
    ...result.testIntelligence,
    ...result.securityIntelligence,
    ...result.performanceIntelligence,
    ...result.maintainabilityIntelligence,
    ...result.recommendedActions,
  ];
  attempts.push({ id, repaired: result.provider.repaired, findings: findings.length, score: result.overallScore });
  return { result, findings };
}

const EVIDENCE_MARKER = /^\[(CONFIRMED|LIKELY|POSSIBLE|UNKNOWN)\]\s/;

describe("Release Review report quality", () => {
  afterAll(() => {
    for (const attempt of attempts) {
      console.log(`[${attempt.id}] repaired=${attempt.repaired} findings=${attempt.findings} confidence=${attempt.score}`);
    }
  });

  it("reports the sections the page shows, each finding marked with how sure it is", async () => {
    const { result, findings } = await run("rich", rich);

    expect(result.executiveSummary.length).toBeGreaterThan(40);
    expect(result.criticalFindings.length + result.recommendedActions.length).toBeGreaterThan(0);
    expect(result.testIntelligence.length).toBeGreaterThan(0);
    expect(result.maintainabilityIntelligence.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.evidence).toMatch(EVIDENCE_MARKER);
      expect(["Critical", "High", "Medium", "Low"]).toContain(finding.severity);
      expect(finding.recommendation.length).toBeGreaterThan(10);
    }
  }, 180_000);

  it("gets there without needing the repair attempt", async () => {
    // A repair means the first report failed the engine's own content checks,
    // which doubles the cost and the wait for every visitor.
    const { result } = await run("first-attempt", rich);

    expect(result.provider.repaired).toBe(false);
  }, 180_000);

  it("stays inside the systems it was told about", async () => {
    const { findings, result } = await run("no-invention", rich);

    const text = [result.executiveSummary, ...findings.flatMap((finding: Finding) => [finding.title, finding.impact, finding.evidence, finding.recommendation])]
      .join("\n")
      .toLowerCase();
    for (const invented of ["kubernetes", "graphql", "android", "kafka", "mongodb"]) {
      expect(text).not.toContain(invented);
    }
  }, 180_000);

  it("does not repeat one finding across sections", async () => {
    const { findings } = await run("distinct", rich);

    const titles = findings.map((finding: Finding) => finding.title.trim().toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
  }, 180_000);

  it("rates a two-sentence submission as low confidence, or refuses it", async () => {
    // Almost no evidence: a report that claims high confidence from this is the
    // failure that would cost a team the most.
    try {
      const { result } = await run("thin", thin);
      expect(
        result.overallScore,
        `rated a two-sentence submission ${result.overallScore} out of 100: "${result.productionReadiness.reason.slice(0, 160)}"`,
      ).toBeLessThan(60);
      expect(result.productionReadiness.reason.length, "scored it without saying why").toBeGreaterThan(20);
    } catch (error) {
      /*
       * Refusing thin evidence is an acceptable outcome; inventing is not.
       *
       * The assertions above are inside this try, so a failing one arrives
       * here as an AssertionError. Asserting the type alone turned "rated a
       * two-sentence submission 78 out of 100" into "expected AssertionError
       * to be an instance of ReleaseReviewProviderError", which says nothing
       * about the model and sends the reader to the wrong file. A measurement
       * that loses its own evidence on the way out is the fault this suite
       * found in automation-generation on 2026-11-15, where four runs went by
       * without anyone learning which rule had fired.
       *
       * So only a refusal is swallowed. Everything else is rethrown exactly
       * as it was raised.
       */
      if (!(error instanceof ReleaseReviewProviderError)) throw error;
    }
  }, 180_000);
});
