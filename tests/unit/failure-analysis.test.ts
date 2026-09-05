import { describe, expect, it } from "vitest";

import {
  FailureAnalysisProviderError,
  validateFailureAnalysisEvidence,
  type FailureAnalysisEvidence,
} from "@/lib/ai/failure-analysis";

const evidence: FailureAnalysisEvidence = {
  RUN_RESULT: "FAILED",
  SUMMARY: "Checkout returned a server error.",
  FAILURE_DETAILS: "POST /orders returned HTTP 500.",
  STEP_RESULTS: "Step 2: FAILED — submit failed",
  EVIDENCE_LINKS: "Trace (TRACE): https://example.com/trace",
  TEST_OBJECTIVE: "A customer can place an order.",
  TEST_STEPS: "1. Open cart\n2. Submit order",
  EXPECTED_RESULTS: "1. Order confirmation appears",
  EXECUTION_HISTORY:
    "Verdict: REGRESSION. The same approved version passed on aaaaaaaa and fails on bbbbbbbb, so the change is in the application.",
};

describe("Failure Intelligence evidence validation", () => {
  it("accepts findings quoting the selected immutable evidence field", () => {
    expect(() => validateFailureAnalysisEvidence({
      summary: "The request failed at order submission.",
      findings: [{
        category: "PRODUCT_DEFECT",
        confidence: 75,
        title: "Order endpoint failed",
        explanation: "The captured response indicates a server-side failure.",
        evidenceField: "FAILURE_DETAILS",
        evidenceQuote: "POST /orders returned HTTP 500.",
        recommendation: "Inspect the order service logs for this attempt.",
      }],
    }, evidence)).not.toThrow();
  });

  it("rejects invented evidence even when the output schema is valid", () => {
    expect(() => validateFailureAnalysisEvidence({
      summary: "Invented root cause.",
      findings: [{
        category: "DEPENDENCY",
        confidence: 95,
        title: "Database timeout",
        explanation: "The model invented a database timeout.",
        evidenceField: "FAILURE_DETAILS",
        evidenceQuote: "database connection timed out",
        recommendation: "Restart the database.",
      }],
    }, evidence)).toThrowError(FailureAnalysisProviderError);
  });

  it("rejects empty citations", () => {
    expect(() => validateFailureAnalysisEvidence({
      summary: "Insufficient evidence.",
      findings: [{
        category: "UNKNOWN",
        confidence: 10,
        title: "Unknown failure",
        explanation: "More evidence is needed.",
        evidenceField: "RUN_RESULT",
        evidenceQuote: "",
        recommendation: "Capture a trace.",
      }],
    }, evidence)).toThrowError(FailureAnalysisProviderError);
  });
});
