import { describe, expect, it } from "vitest";

import { evidenceHash, legacyEvidenceHash } from "@/lib/services/evidence-hash";
import { stillMatches } from "@/lib/services/evidence-signature";
import type { EvidenceTestCase, ReleaseEvidenceReport } from "@/lib/services/release-evidence";

/**
 * What a signature is a signature of.
 *
 * Somebody accepts a page. The hash is how the product answers, later, whether
 * the project still matches what they accepted. Approved tests that verify no
 * requirement are now on that page, so leaving them out of the hash would mean
 * one could go from passing to failing while the workspace reported the
 * evidence unchanged since it was accepted.
 *
 * The opposite mistake costs just as much: pull them into the hash for every
 * project and every signature recorded before today reads as "changed since
 * they accepted it" on a day nothing changed.
 */
const test = (id: string, result: EvidenceTestCase["latestResult"]): EvidenceTestCase => ({
  id,
  title: `Test ${id}`,
  status: "APPROVED",
  versionNumber: 1,
  latestResult: result,
  latestExecutedAt: new Date("2026-10-30T09:00:00.000Z"),
  approvedBy: null,
  approvedAt: null,
  latestCommitSha: null,
  authoredByAgent: null,
  signal: null,
});

const report = (unlinkedTests: EvidenceTestCase[] = []): ReleaseEvidenceReport => ({
  project: { id: "p1", name: "Shop", slug: "shop" },
  organization: { name: "Acme", slug: "acme" },
  generatedAt: new Date("2026-10-31T09:00:00.000Z"),
  requirements: [
    {
      id: "r1",
      title: "Customers can pay",
      status: "APPROVED",
      versionNumber: 1,
      externalReference: null,
      verdict: "VERIFIED",
      reason: "",
      lastVerifiedAt: new Date("2026-10-30T09:00:00.000Z"),
      ageDays: 1,
      freshness: "FRESH",
      approvedBy: null,
      approvedAt: null,
      criteriaCount: 1,
      testCases: [],
    },
  ],
  unlinkedTests,
  totals: { verified: 1, failing: 0, unverified: 0, stale: 0 },
  truncated: false,
  coverage: { shown: 1, total: 1 },
});

describe("the hash of what somebody accepted", () => {
  it("changes when an unlinked test stops passing", () => {
    expect(evidenceHash(report([test("t1", "PASSED")]))).not.toBe(
      evidenceHash(report([test("t1", "FAILED")])),
    );
  });

  it("is unchanged for a project that has no unlinked tests", () => {
    // Every signature recorded before today was recorded against a project
    // hashed this way. If this ever stops holding, those signatures start
    // reporting a change that did not happen.
    expect(evidenceHash(report())).toBe(legacyEvidenceHash(report()));
  });

  it("reads the same evidence twice to the same hash", () => {
    expect(evidenceHash(report([test("t1", "PASSED")]))).toBe(
      evidenceHash(report([test("t1", "PASSED")])),
    );
  });
});

describe("whether a signature still matches", () => {
  it("holds for a signature given before unlinked tests were shown", () => {
    const signedThen = { evidenceHash: legacyEvidenceHash(report([test("t1", "PASSED")])) };

    // The page that person accepted showed the requirements and nothing else.
    // The requirements have not moved, so nothing they were shown has changed.
    expect(stillMatches(signedThen, report([test("t1", "PASSED")]))).toBe(true);
    expect(stillMatches(signedThen, report([test("t1", "FAILED")]))).toBe(true);
  });

  it("reports a change to somebody who accepted the unlinked tests too", () => {
    const signedNow = { evidenceHash: evidenceHash(report([test("t1", "PASSED")])) };

    expect(stillMatches(signedNow, report([test("t1", "PASSED")]))).toBe(true);
    expect(stillMatches(signedNow, report([test("t1", "FAILED")]))).toBe(false);
  });

  it("still reports a requirement that moved, either way", () => {
    const failing = {
      ...report([test("t1", "PASSED")]),
      requirements: [{ ...report().requirements[0], verdict: "FAILING" as const }],
    };

    expect(stillMatches({ evidenceHash: evidenceHash(report([test("t1", "PASSED")])) }, failing)).toBe(false);
    expect(stillMatches({ evidenceHash: legacyEvidenceHash(report([test("t1", "PASSED")])) }, failing)).toBe(false);
  });
});
