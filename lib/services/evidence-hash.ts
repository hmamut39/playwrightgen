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
export function evidenceHash(report: ReleaseEvidenceReport) {
  const claims = {
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
  };
  return createHash("sha256").update(JSON.stringify(claims)).digest("hex");
}
