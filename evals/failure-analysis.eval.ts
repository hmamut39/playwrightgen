import { afterAll, describe, expect, it } from "vitest";

import {
  analyzeFailureEvidence,
  type FailureAnalysisEvidence,
} from "@/lib/ai/failure-analysis";

/**
 * Measures whether Failure Intelligence actually follows the evidence.
 *
 * Graded deterministically against the structured output rather than by another
 * model. An LLM judge would introduce a second thing that can be wrong, and
 * would let a regression hide behind a sympathetic grader.
 *
 * The cases below deliberately hold every field constant except
 * EXECUTION_HISTORY, so a change in classification can only be attributed to the
 * history. That is the property worth protecting: the same failure text must be
 * read differently depending on what prior runs establish.
 */

const baseEvidence: Omit<FailureAnalysisEvidence, "EXECUTION_HISTORY"> = {
  RUN_RESULT: "FAILED",
  SUMMARY: "main @ 7d92e401",
  FAILURE_DETAILS:
    "TimeoutError: locator.click: Timeout 30000ms exceeded waiting for getByRole('button', { name: 'Place order' })",
  STEP_RESULTS: "Step 1: PASSED — open the cart\nStep 2: FAILED — submit payment",
  EVIDENCE_LINKS: "CI run 9001-1 (LINK): https://github.com/acme/web/actions/runs/9001",
  TEST_OBJECTIVE: "A signed-in customer can place an order.",
  TEST_STEPS: "1. Open the cart\n2. Submit valid payment",
  EXPECTED_RESULTS: "1. Order confirmation is displayed",
};

type EvalCase = {
  id: string;
  history: string;
  /** Categories that would be a defensible reading of this evidence. */
  allowed: string[];
  /** Categories that would contradict the supplied history. */
  forbidden: string[];
};

const cases: EvalCase[] = [
  {
    id: "regression-history-is-not-flaky",
    history:
      "Verdict: REGRESSION. The same approved version passed on a3f21b8c and fails on 7d92e401, so the change is in the application. This approved version has 4 recorded attempts, of which 3 passed, across 2 recorded revisions.",
    allowed: ["PRODUCT_DEFECT", "DEPENDENCY", "ENVIRONMENT"],
    // The history establishes the failure tracks a revision change, so calling
    // it flaky would send the team to investigate the wrong thing.
    forbidden: ["FLAKY_TIMING"],
  },
  {
    id: "flaky-history-is-not-a-product-defect",
    history:
      "Verdict: FLAKY. The same approved version both passed and failed on commit 7d92e401, so the result is not reproducible. This approved version has 6 recorded attempts, of which 4 passed, across 1 recorded revision.",
    allowed: ["FLAKY_TIMING", "TEST_DEFECT", "ENVIRONMENT"],
    // A result that is not reproducible on one revision does not demonstrate a
    // defect in the product.
    forbidden: ["PRODUCT_DEFECT"],
  },
  {
    id: "absent-history-claims-neither",
    history:
      "This approved version has 1 recorded attempt, of which 0 passed, across 1 recorded revision. No comparable prior evidence was found.",
    allowed: [
      "PRODUCT_DEFECT",
      "TEST_DEFECT",
      "ENVIRONMENT",
      "TEST_DATA",
      "DEPENDENCY",
      "FLAKY_TIMING",
      "UNKNOWN",
    ],
    forbidden: [],
  },
  {
    id: "changed-intent-is-not-a-regression",
    history:
      "Verdict: INTENT_CHANGED. The only passing evidence is on a different approved version, so this failure cannot be compared as a regression. This approved version has 1 recorded attempt, of which 0 passed, across 1 recorded revision.",
    allowed: [
      "PRODUCT_DEFECT",
      "TEST_DEFECT",
      "ENVIRONMENT",
      "TEST_DATA",
      "DEPENDENCY",
      "UNKNOWN",
    ],
    forbidden: [],
  },
];

const results: Array<{ id: string; passed: boolean; detail: string }> = [];

describe.skipIf(!process.env.OPENAI_API_KEY?.trim())(
  "eval: failure analysis follows execution history",
  () => {
    afterAll(() => {
      const passed = results.filter((entry) => entry.passed).length;
      console.log(`\n  failure-analysis eval: ${passed}/${results.length} passed`);
      for (const entry of results) {
        console.log(`   ${entry.passed ? "PASS" : "FAIL"}  ${entry.id}  ${entry.detail}`);
      }
    });

    for (const testCase of cases) {
      it(testCase.id, async () => {
        const evidence: FailureAnalysisEvidence = {
          ...baseEvidence,
          EXECUTION_HISTORY: testCase.history,
        };

        const analysis = await analyzeFailureEvidence(evidence);
        const categories = analysis.findings.map((finding) => finding.category);
        const top = analysis.findings
          .slice()
          .sort((a, b) => b.confidence - a.confidence)[0];

        const violated = categories.filter((category) =>
          testCase.forbidden.includes(category),
        );
        const topAllowed =
          testCase.allowed.length === 0 || testCase.allowed.includes(top.category);
        const passed = violated.length === 0 && topAllowed;

        results.push({
          id: testCase.id,
          passed,
          detail: `top=${top.category}@${top.confidence}${violated.length ? ` violated=${violated.join(",")}` : ""}`,
        });

        // Every finding must quote its own cited field verbatim; the production
        // path enforces this too, and an eval that skipped it would let a
        // fabricated quote count as a pass.
        for (const finding of analysis.findings) {
          const field = evidence[finding.evidenceField];
          expect(
            field.toLowerCase().replace(/\s+/g, " "),
            `finding "${finding.title}" cited ${finding.evidenceField}`,
          ).toContain(finding.evidenceQuote.toLowerCase().replace(/\s+/g, " ").trim());
        }

        expect(violated, `forbidden categories for ${testCase.id}`).toEqual([]);
        expect(testCase.allowed, `highest-confidence category for ${testCase.id}`).toContain(
          top.category,
        );
      });
    }
  },
);
