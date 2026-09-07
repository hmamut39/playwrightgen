import { describe, expect, it, vi } from "vitest";

import type { FailureAnalysisScope } from "@/lib/services/failure-intelligence";
import {
  analyzeReportedFailures,
  AUTO_ANALYSIS_LIMIT,
} from "@/lib/operations/auto-failure-analysis";

/** Typed so the recorded calls can be asserted rather than cast. */
type AnalyzeInput = { testRunId: string; testRunAttemptId: string; requestId?: string };
const spy = () =>
  vi.fn(async (_scope: FailureAnalysisScope, _input: AnalyzeInput) => ({}) as never);

const summary = (count: number) => ({
  organizationId: "11111111-1111-4111-8111-111111111111",
  actorUserId: "22222222-2222-4222-8222-222222222222",
  failures: Array.from({ length: count }, (_, index) => ({
    testRunId: `run-${index}`,
    testRunAttemptId: `attempt-${index}`,
  })),
});

const PROJECT = "33333333-3333-4333-8333-333333333333";

describe("analyzing failures reported by CI", () => {
  it("analyzes each failed attempt it is given", async () => {
    const analyze = spy();

    const result = await analyzeReportedFailures(summary(2), PROJECT, analyze);

    expect(result).toEqual({ attempted: 2, succeeded: 2 });
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(analyze.mock.calls[0][1]).toMatchObject({
      testRunId: "run-0",
      testRunAttemptId: "attempt-0",
    });
  });

  it("records the analysis as the system, not as the person who connected CI", async () => {
    // They did not ask for it. An audit trail that credits people with actions
    // they never took is worth less than no audit trail.
    const analyze = spy();

    await analyzeReportedFailures(summary(1), PROJECT, analyze);

    expect(analyze.mock.calls[0][0]).toMatchObject({
      source: "SYSTEM",
      projectId: PROJECT,
      actorUserId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("stops after a few, so a suite turning entirely red cannot run up a bill", async () => {
    const analyze = spy();

    const result = await analyzeReportedFailures(summary(25), PROJECT, analyze);

    expect(result.attempted).toBe(AUTO_ANALYSIS_LIMIT);
    expect(analyze).toHaveBeenCalledTimes(AUTO_ANALYSIS_LIMIT);
  });

  it("keeps going when one analysis fails", async () => {
    const analyze = vi
      .fn()
      .mockRejectedValueOnce(new Error("organization_ai_rate_limited"))
      .mockResolvedValueOnce({} as never);

    const result = await analyzeReportedFailures(summary(2), PROJECT, analyze);

    expect(result).toEqual({ attempted: 2, succeeded: 1 });
  });

  it("never throws, because the webhook it follows has already been answered", async () => {
    // The evidence is stored either way. An analysis that could take the ingest
    // down with it would trade a durable record for a convenience.
    const analyze = vi.fn().mockRejectedValue(new Error("provider_failure"));

    await expect(
      analyzeReportedFailures(summary(2), PROJECT, analyze),
    ).resolves.toEqual({ attempted: 2, succeeded: 0 });
  });

  it("does nothing when the delivery contained no failures", async () => {
    const analyze = spy();

    const result = await analyzeReportedFailures(summary(0), PROJECT, analyze);

    expect(result).toEqual({ attempted: 0, succeeded: 0 });
    expect(analyze).not.toHaveBeenCalled();
  });
});
