import { createHash } from "node:crypto";

import type { ReleaseEvidenceReport } from "@/lib/services/release-evidence";

/**
 * A stable reference for a set of evidence.
 *
 * Two things depend on this being exactly one definition. A signature records
 * the hash of what somebody accepted, so the team can be told later whether
 * the project still matches it. And the exported document prints the same
 * reference, so a reader holding a file and a reader looking at the page can
 * tell whether they are looking at the same evidence.
 *
 * It covers the claims and not the moment they were read. The same evidence
 * read twice must hash the same, or the comparison says nothing about whether
 * anything changed.
 */
const claimSet = (report: ReleaseEvidenceReport) => ({
  project: report.project.id,
  totals: report.totals,
  requirements: report.requirements.map((requirement) => ({
    id: requirement.id,
    title: requirement.title,
    verdict: requirement.verdict,
    version: requirement.versionNumber,
    testCases: requirement.testCases.map((testCase) => ({
      id: testCase.id,
      version: testCase.versionNumber,
      result: testCase.latestResult,
      ranAt: testCase.latestExecutedAt?.toISOString() ?? null,
    })),
  })),
});

const digest = (claims: unknown) =>
  createHash("sha256").update(JSON.stringify(claims)).digest("hex");

/**
 * The claims as they were before the report carried approved tests that
 * verify no requirement.
 *
 * Kept because a signature given then was given over a page that showed the
 * requirements and nothing else. Asking whether that evidence still matches
 * has to mean the evidence that person was shown, or the honest answer to a
 * question nobody can revisit becomes "it changed" on a day nothing changed.
 */
export function legacyEvidenceHash(report: ReleaseEvidenceReport) {
  return digest(claimSet(report));
}

export function evidenceHash(report: ReleaseEvidenceReport) {
  const claims = claimSet(report);
  /*
   * Approved tests that verify no requirement are on the page somebody is
   * accepting, so they belong in the hash of what was accepted: otherwise one
   * of them goes from passing to failing and this still reports the evidence
   * unchanged.
   *
   * Folded in only when the project has some, so that every project without
   * them hashes exactly as it did before and no signature moves for a reason
   * that is not about the evidence.
   */
  if (!report.unlinkedTests.length) return digest(claims);
  return digest({
    ...claims,
    unlinkedTests: report.unlinkedTests.map((testCase) => ({
      id: testCase.id,
      version: testCase.versionNumber,
      result: testCase.latestResult,
      ranAt: testCase.latestExecutedAt?.toISOString() ?? null,
    })),
  });
}
