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
  const finding = (overrides: Record<string, unknown>) => ({
    summary: "A failure was analyzed.",
    findings: [{
      category: "UNKNOWN" as const,
      confidence: 20,
      title: "A finding",
      explanation: "An explanation.",
      evidenceField: "FAILURE_DETAILS" as const,
      evidenceQuote: "POST /orders returned HTTP 500.",
      recommendation: "A recommendation.",
      ...overrides,
    }],
  });

  it("rejects a citation too short to identify what it refers to", () => {
    // "the" occurs in almost any evidence field, so a substring match alone
    // would let a finding claim a citation while proving nothing.
    expect(() => validateFailureAnalysisEvidence(
      finding({ evidenceField: "SUMMARY", evidenceQuote: "the" }),
      evidence,
    )).toThrowError(FailureAnalysisProviderError);

    expect(() => validateFailureAnalysisEvidence(
      finding({ evidenceField: "SUMMARY", evidenceQuote: "a" }),
      evidence,
    )).toThrowError(FailureAnalysisProviderError);
  });

  it("accepts a short quote when it is the whole evidence field", () => {
    // RUN_RESULT is "FAILED". Quoting it whole is the most precise citation
    // available for that field, so brevity there is not vagueness.
    expect(() => validateFailureAnalysisEvidence(
      finding({ evidenceField: "RUN_RESULT", evidenceQuote: "FAILED" }),
      evidence,
    )).not.toThrow();
  });

  it("still accepts a substantial quote from a longer field", () => {
    expect(() => validateFailureAnalysisEvidence(
      finding({ evidenceField: "SUMMARY", evidenceQuote: "Checkout returned a server error." }),
      evidence,
    )).not.toThrow();
  });

  it("rejects a quote from a field the finding did not cite", () => {
    // The quote is real, but it belongs to FAILURE_DETAILS. Attributing it to
    // the wrong field would make the citation uncheckable by a reader who goes
    // looking for it where the finding said it was.
    expect(() => validateFailureAnalysisEvidence(
      finding({ evidenceField: "TEST_OBJECTIVE", evidenceQuote: "POST /orders returned HTTP 500." }),
      evidence,
    )).toThrowError(FailureAnalysisProviderError);
  });
});
