import { describe, expect, it } from "vitest";

import { changeSummary, compareEvidence } from "@/lib/services/evidence-change";
import type { EvidenceRequirement, ReleaseEvidenceReport, RequirementVerdict } from "@/lib/services/release-evidence";

const requirement = (id: string, title: string, verdict: RequirementVerdict): EvidenceRequirement => ({
  id,
  title,
  status: "APPROVED",
  versionNumber: 1,
  externalReference: null,
  verdict,
  reason: "",
  lastVerifiedAt: null,
  ageDays: null,
  freshness: "MISSING",
  testCases: [],
});

const report = (requirements: EvidenceRequirement[]): ReleaseEvidenceReport => ({
  project: { id: "p", name: "Shop", slug: "shop" },
  organization: { name: "Acme", slug: "acme" },
  generatedAt: new Date("2026-09-20T10:00:00.000Z"),
  requirements,
  totals: {
    verified: requirements.filter((item) => item.verdict === "VERIFIED").length,
    failing: requirements.filter((item) => item.verdict === "FAILING").length,
    unverified: requirements.filter((item) => item.verdict === "UNVERIFIED").length,
    stale: 0,
  },
  truncated: false,
});

describe("what changed since a snapshot", () => {
  it("says so plainly when nothing moved", () => {
    const before = report([requirement("a", "Pay", "VERIFIED")]);
    const change = compareEvidence(before, report([requirement("a", "Pay", "VERIFIED")]));
    expect(change.same).toBe(true);
    expect(change.unchanged).toBe(1);
    expect(changeSummary(change)).toBe("Nothing has changed since this snapshot was taken.");
  });

  it("names a verdict that moved, and which way", () => {
    const change = compareEvidence(
      report([requirement("a", "Pay", "VERIFIED"), requirement("b", "Refund", "UNVERIFIED")]),
      report([requirement("a", "Pay", "FAILING"), requirement("b", "Refund", "VERIFIED")]),
    );
    expect(change.moved).toHaveLength(2);
    // The one that got worse is first, because it is the one that stops a release.
    expect(change.moved[0]).toMatchObject({ title: "Pay", from: "VERIFIED", to: "FAILING", worse: true });
    expect(change.moved[1]).toMatchObject({ title: "Refund", from: "UNVERIFIED", to: "VERIFIED", worse: false });
    expect(changeSummary(change)).toBe("Since this snapshot, 1 requirement got worse and 1 requirement improved.");
  });

  it("counts a requirement that appeared and one that is gone", () => {
    const change = compareEvidence(
      report([requirement("a", "Pay", "VERIFIED")]),
      report([requirement("b", "Refund", "UNVERIFIED")]),
    );
    expect(change.added).toEqual([{ id: "b", title: "Refund", verdict: "UNVERIFIED" }]);
    expect(change.removed).toEqual([{ id: "a", title: "Pay", verdict: "VERIFIED" }]);
    expect(change.unchanged).toBe(0);
    expect(changeSummary(change)).toBe("Since this snapshot, 1 requirement was added and 1 requirement is gone.");
  });

  it("follows the record when a requirement was renamed, not the title", () => {
    const change = compareEvidence(
      report([requirement("a", "Pay", "VERIFIED")]),
      report([requirement("a", "Pay with a saved card", "VERIFIED")]),
    );
    // Same requirement, so nothing moved; a rename is not a change of verdict.
    expect(change.same).toBe(true);
    expect(change.added).toEqual([]);
  });

  it("reads as one sentence however many kinds of change there are", () => {
    const change = compareEvidence(
      report([
        requirement("a", "Pay", "VERIFIED"),
        requirement("b", "Refund", "VERIFIED"),
        requirement("c", "Search", "VERIFIED"),
        requirement("d", "Gone", "VERIFIED"),
      ]),
      report([
        requirement("a", "Pay", "FAILING"),
        requirement("b", "Refund", "VERIFIED"),
        requirement("c", "Search", "VERIFIED"),
        requirement("e", "New", "UNVERIFIED"),
      ]),
    );
    expect(changeSummary(change)).toBe(
      "Since this snapshot, 1 requirement got worse, 1 requirement was added and 1 requirement is gone. 2 requirements are unchanged.",
    );
  });

  it("treats not-verified as better than failing and worse than verified", () => {
    const worse = compareEvidence(
      report([requirement("a", "Pay", "UNVERIFIED")]),
      report([requirement("a", "Pay", "FAILING")]),
    );
    expect(worse.moved[0].worse).toBe(true);
    const better = compareEvidence(
      report([requirement("a", "Pay", "FAILING")]),
      report([requirement("a", "Pay", "UNVERIFIED")]),
    );
    expect(better.moved[0].worse).toBe(false);
  });
});
