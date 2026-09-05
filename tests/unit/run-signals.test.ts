import { describe, expect, it, vi } from "vitest";

import {
  classifyRuns,
  loadAttemptFacts,
  SIGNAL_ATTEMPT_CAP,
  SIGNAL_WINDOW_DAYS,
  type AttemptFact,
} from "@/lib/services/run-signals";

const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const CASE = "33333333-3333-4333-8333-333333333333";
const RUN = "44444444-4444-4444-8444-444444444444";
const OTHER_RUN = "55555555-5555-4555-8555-555555555555";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

let clock = 0;
function attempt(overrides: Partial<AttemptFact> = {}): AttemptFact {
  clock += 1_000;
  return {
    testRunId: RUN,
    testCaseId: CASE,
    testCaseVersionId: V1,
    attemptNumber: 1,
    result: "FAILED",
    commitSha: SHA_A,
    executedAt: new Date(clock),
    ...overrides,
  };
}

const signalFor = (facts: AttemptFact[], runId = RUN) =>
  classifyRuns(facts).get(runId)?.signal;

describe("classifyRuns", () => {
  it("reports a passing latest attempt as stable", () => {
    expect(signalFor([attempt({ result: "PASSED" })])).toBe("STABLE");
  });

  it("calls the same version failing and passing on one commit flaky", () => {
    const facts = [
      attempt({ attemptNumber: 1, result: "PASSED", commitSha: SHA_A }),
      attempt({ attemptNumber: 2, result: "FAILED", commitSha: SHA_A }),
    ];

    expect(signalFor(facts)).toBe("FLAKY");
    expect(classifyRuns(facts).get(RUN)?.detail).toContain("not reproducible");
  });

  it("calls a failure after passing on an earlier commit a regression", () => {
    const facts = [
      attempt({ attemptNumber: 1, result: "PASSED", commitSha: SHA_A }),
      attempt({ attemptNumber: 2, result: "FAILED", commitSha: SHA_B }),
    ];

    expect(signalFor(facts)).toBe("REGRESSION");
    expect(classifyRuns(facts).get(RUN)?.detail).toContain("in the application");
  });

  it("refuses to call it a regression when only an older version ever passed", () => {
    const facts = [
      attempt({
        testRunId: OTHER_RUN,
        testCaseVersionId: V1,
        result: "PASSED",
        commitSha: SHA_A,
      }),
      attempt({
        testRunId: RUN,
        testCaseVersionId: V2,
        result: "FAILED",
        commitSha: SHA_B,
      }),
    ];

    expect(signalFor(facts)).toBe("INTENT_CHANGED");
  });

  it("reports a first-ever failure as a new failure, not a regression", () => {
    expect(signalFor([attempt({ result: "FAILED" })])).toBe("NEW_FAILURE");
  });

  it("does not infer a regression from an unrecorded revision", () => {
    const facts = [
      attempt({ attemptNumber: 1, result: "PASSED", commitSha: null }),
      attempt({ attemptNumber: 2, result: "FAILED", commitSha: null }),
    ];

    // Manually recorded attempts carry no commit, so neither flakiness nor
    // regression can be established. Guessing either would be a false claim.
    expect(signalFor(facts)).toBe("NEW_FAILURE");
  });

  it("prefers flaky over regression when both patterns are present", () => {
    const facts = [
      attempt({ attemptNumber: 1, result: "PASSED", commitSha: SHA_B }),
      attempt({ attemptNumber: 2, result: "PASSED", commitSha: SHA_A }),
      attempt({ attemptNumber: 3, result: "FAILED", commitSha: SHA_A }),
    ];

    // The same commit already produced both outcomes, so the test is
    // unreliable; blaming the application would send the team to the wrong place.
    expect(signalFor(facts)).toBe("FLAKY");
  });

  it("treats a blocked latest attempt as failing", () => {
    const facts = [
      attempt({ attemptNumber: 1, result: "PASSED", commitSha: SHA_A }),
      attempt({ attemptNumber: 2, result: "BLOCKED", commitSha: SHA_B }),
    ];

    expect(signalFor(facts)).toBe("REGRESSION");
  });

  it("ignores a later passing attempt from an unrelated run", () => {
    const facts = [
      attempt({ testRunId: RUN, result: "FAILED", commitSha: SHA_A }),
      attempt({
        testRunId: OTHER_RUN,
        testCaseId: "66666666-6666-4666-8666-666666666666",
        result: "PASSED",
        commitSha: SHA_A,
      }),
    ];

    expect(signalFor(facts)).toBe("NEW_FAILURE");
  });

  it("classifies every run independently in one pass", () => {
    const facts = [
      attempt({ testRunId: RUN, attemptNumber: 1, result: "PASSED", commitSha: SHA_A }),
      attempt({ testRunId: RUN, attemptNumber: 2, result: "FAILED", commitSha: SHA_A }),
      attempt({
        testRunId: OTHER_RUN,
        testCaseId: "77777777-7777-4777-8777-777777777777",
        result: "PASSED",
      }),
    ];

    const signals = classifyRuns(facts);
    expect(signals.get(RUN)?.signal).toBe("FLAKY");
    expect(signals.get(OTHER_RUN)?.signal).toBe("STABLE");
  });

  it("returns nothing for a run with no attempts", () => {
    expect(classifyRuns([]).size).toBe(0);
  });
});

describe("loadAttemptFacts", () => {
  const ORG = "88888888-8888-4888-8888-888888888888";

  function stubPrisma(rows: unknown[] = []) {
    const findMany = vi.fn().mockResolvedValue(rows);
    return { prisma: { testRunAttempt: { findMany } } as never, findMany };
  }

  it("bounds the query by time and by row count", async () => {
    const { prisma, findMany } = stubPrisma();
    const now = new Date("2026-09-05T00:00:00.000Z");

    await loadAttemptFacts(prisma, { organizationId: ORG, now });

    const [args] = findMany.mock.calls[0];
    // Unbounded here means every attempt ever recorded is read on each page
    // view, and attempts are the fastest-growing table once CI reports.
    expect(args.take).toBe(SIGNAL_ATTEMPT_CAP);
    expect(args.orderBy).toEqual({ executedAt: "desc" });

    const cutoff = args.where.executedAt.gte as Date;
    const days = (now.getTime() - cutoff.getTime()) / 86_400_000;
    expect(days).toBe(SIGNAL_WINDOW_DAYS);
  });

  it("scopes to the organization, and to a project when given one", async () => {
    const { prisma, findMany } = stubPrisma();

    await loadAttemptFacts(prisma, { organizationId: ORG });
    expect(findMany.mock.calls[0][0].where).toMatchObject({ organizationId: ORG });
    expect(findMany.mock.calls[0][0].where.projectId).toBeUndefined();

    await loadAttemptFacts(prisma, { organizationId: ORG, projectId: "p1" });
    expect(findMany.mock.calls[1][0].where).toMatchObject({ organizationId: ORG, projectId: "p1" });
  });

  it("returns attempts oldest-first even though the query takes the newest", async () => {
    const row = (id: string, at: string) => ({
      testRunId: id,
      projectId: "p1",
      attemptNumber: 1,
      result: "PASSED" as const,
      commitSha: null,
      executedAt: new Date(at),
      testRun: { testCaseId: "c1", testCaseVersionId: "v1" },
    });
    // The query orders newest-first so the cap keeps recent evidence; the
    // classifier reasons in the order things happened.
    const { prisma } = stubPrisma([
      row("newest", "2026-09-05T00:00:00.000Z"),
      row("oldest", "2026-09-01T00:00:00.000Z"),
    ]);

    const facts = await loadAttemptFacts(prisma, { organizationId: ORG });

    expect(facts.map((f) => f.testRunId)).toEqual(["oldest", "newest"]);
  });
});
