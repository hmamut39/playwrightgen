import { describe, expect, it } from "vitest";

import { projectHealthVerdict } from "@/lib/services/project-health";

const readiness = (
  overrides: {
    releasable?: boolean;
    regressions?: number;
    hasExecution?: boolean;
    freshness?: "FRESH" | "AGING" | "STALE" | "MISSING";
    ageDays?: number | null;
  } = {},
) => ({
  releasable: overrides.releasable ?? true,
  counts: {
    approvedRequirements: 1,
    requirementsWithApprovedTests: 1,
    approvedTestCases: 1,
    testCasesWithCurrentAutomation: 1,
    regressions: overrides.regressions ?? 0,
    flaky: 0,
    openFindings: 0,
  },
  findings: overrides.releasable === false
    ? [{ severity: "BLOCKER" as const, code: "a", title: "A", detail: "", href: null, count: 1 }, { severity: "CAUTION" as const, code: "b", title: "B", detail: "", href: null, count: 1 }]
    : [],
  evidence: {
    freshness: overrides.freshness ?? ("FRESH" as const),
    lastEvidenceAt: new Date(),
    ageDays: overrides.ageDays === undefined ? 0 : overrides.ageDays,
    hasExecution: overrides.hasExecution ?? true,
    attemptCount: 1,
  },
});

describe("project health verdict", () => {
  it("needs attention when anything is failing or blocked, and says what", () => {
    expect(projectHealthVerdict({ readiness: readiness(), live: { failed: 2, checked: 3 } })).toEqual({
      verdict: "attention",
      reasons: ["2 failing in the last live check"],
    });
    expect(projectHealthVerdict({ readiness: readiness({ regressions: 1, releasable: false }), live: null }).reasons).toEqual([
      "1 regression",
      "1 release blocker",
    ]);
  });

  it("never calls a project healthy when nothing has run", () => {
    const untested = {
      ...readiness({ hasExecution: false, releasable: false }),
      findings: [{ severity: "BLOCKER" as const, code: "evidence_missing", title: "No run evidence", detail: "", href: null, count: 1 }],
    };
    expect(projectHealthVerdict({ readiness: untested, live: null })).toEqual({ verdict: "no-evidence", reasons: ["no test has run yet"] });
    expect(projectHealthVerdict({ readiness: readiness({ hasExecution: false }), live: null }).verdict).toBe("no-evidence");
    expect(projectHealthVerdict({ readiness: readiness({ hasExecution: false }), live: { failed: 0, checked: 0 } }).verdict).toBe("no-evidence");
  });

  it("says how old the evidence is rather than showing a plain green on track", () => {
    // Nothing failing, nothing blocking -- and the only run was months ago.
    // The screen people glance at from a phone must not read as "checked
    // lately" when it means "checked once, in March".
    expect(
      projectHealthVerdict({
        readiness: readiness({ freshness: "STALE", ageDays: 193 }),
        live: null,
      }),
    ).toEqual({
      verdict: "on-track",
      reasons: ["nothing failing, but the last evidence is 193 days old"],
    });
  });

  it("stays quiet while the evidence is merely aging", () => {
    // Between a week and a month old is ordinary, and nagging about it would
    // teach people to ignore the line that matters.
    expect(projectHealthVerdict({ readiness: readiness({ freshness: "AGING", ageDays: 12 }), live: null })).toEqual({
      verdict: "on-track",
      reasons: [],
    });
  });

  it("is on track once something ran and nothing is wrong", () => {
    expect(projectHealthVerdict({ readiness: readiness(), live: null }).verdict).toBe("on-track");
    expect(projectHealthVerdict({ readiness: readiness({ hasExecution: false }), live: { failed: 0, checked: 2 } }).verdict).toBe("on-track");
  });
});
