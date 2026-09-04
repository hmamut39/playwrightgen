import "server-only";

import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import { getProjectQualityIntelligence } from "@/lib/services/project-quality";
import { classifyRuns, type RunSignal } from "@/lib/services/run-signals";

/**
 * Answers "can this be released?" without inventing a number.
 *
 * A percentage or a letter grade would be the easy thing to render and the
 * wrong thing to publish: it compresses away exactly the detail a reviewer needs
 * and invites teams to ship against a score they cannot audit. This produces an
 * explicit list of blockers and cautions instead, each one traceable to the
 * record that produced it, so every claim on the page can be opened and checked.
 *
 * Absence of evidence is reported as absence, never as a pass.
 */

export type ReadinessSeverity = "BLOCKER" | "CAUTION";

export type ReadinessFinding = {
  severity: ReadinessSeverity;
  code: string;
  title: string;
  detail: string;
  /** Workspace path for the record this finding was derived from. */
  href: string | null;
  count: number;
};

export type ReleaseReadiness = {
  project: { id: string; name: string; slug: string };
  measuredAt: Date;
  counts: {
    approvedRequirements: number;
    requirementsWithApprovedTests: number;
    approvedTestCases: number;
    testCasesWithCurrentAutomation: number;
    regressions: number;
    flaky: number;
    openFindings: number;
  };
  evidence: {
    freshness: "FRESH" | "AGING" | "STALE" | "MISSING";
    lastEvidenceAt: Date | null;
    ageDays: number | null;
  };
  findings: ReadinessFinding[];
  /** True only when no blocker is present. Cautions do not stop a release. */
  releasable: boolean;
};

const severityRank: Record<ReadinessSeverity, number> = { BLOCKER: 0, CAUTION: 1 };

export async function getReleaseReadiness(
  input: { orgSlug?: string; projectId: string },
  dependencies?: WorkspaceContextDependencies,
): Promise<ReleaseReadiness> {
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId: input.projectId, permission: "testrun:read" },
    dependencies,
  );
  const prisma = dependencies?.prisma ?? getPrismaClient();
  const base = `/workspace/${workspace.organization.slug}/projects/${input.projectId}`;

  const quality = await getProjectQualityIntelligence(input, dependencies);

  const attemptRows = await prisma.testRunAttempt.findMany({
    where: { organizationId: workspace.organization.id, projectId: input.projectId },
    select: {
      testRunId: true,
      attemptNumber: true,
      result: true,
      commitSha: true,
      executedAt: true,
      testRun: { select: { testCaseId: true, testCaseVersionId: true } },
    },
    orderBy: { executedAt: "asc" },
  });

  const signals = classifyRuns(
    attemptRows.map((row) => ({
      testRunId: row.testRunId,
      testCaseId: row.testRun.testCaseId,
      testCaseVersionId: row.testRun.testCaseVersionId,
      attemptNumber: row.attemptNumber,
      result: row.result,
      commitSha: row.commitSha,
      executedAt: row.executedAt,
    })),
  );

  const bySignal = (signal: RunSignal) =>
    [...signals.values()].filter((entry) => entry.signal === signal).length;

  const regressions = bySignal("REGRESSION");
  const flaky = bySignal("FLAKY");
  const intentChanged = bySignal("INTENT_CHANGED");

  const findings: ReadinessFinding[] = [];

  if (regressions > 0) {
    findings.push({
      severity: "BLOCKER",
      code: "regressions_open",
      title: "Failing tests attributable to the application",
      detail:
        "The same approved version passed on an earlier commit and fails now, so the change is in the application rather than the test.",
      href: `${base}/test-runs`,
      count: regressions,
    });
  }

  const uncoveredRequirements = quality.gaps.requirementsWithoutApprovedTests.length;
  if (uncoveredRequirements > 0) {
    findings.push({
      severity: "BLOCKER",
      code: "requirements_uncovered",
      title: "Approved requirements with no approved test case",
      detail:
        "These requirements have been approved but nothing verifies them, so the release carries unmeasured risk.",
      href: `${base}/requirements`,
      count: uncoveredRequirements,
    });
  }

  if (quality.counts.openFailureFindings > 0) {
    findings.push({
      severity: "BLOCKER",
      code: "findings_unreviewed",
      title: "Failure findings awaiting human review",
      detail:
        "Automated failure analysis produced findings that no one has confirmed or dismissed.",
      href: `${base}/test-runs`,
      count: quality.counts.openFailureFindings,
    });
  }

  if (quality.evidence.freshness === "MISSING") {
    findings.push({
      severity: "BLOCKER",
      code: "evidence_missing",
      title: "No execution evidence exists",
      detail:
        "Nothing has been run, so there is no basis on which to judge this release. An empty queue is not confidence.",
      href: `${base}/test-runs`,
      count: 1,
    });
  } else if (quality.evidence.freshness === "STALE") {
    findings.push({
      severity: "CAUTION",
      code: "evidence_stale",
      title: "Execution evidence is stale",
      detail: `The most recent evidence is ${quality.evidence.ageDays} days old and may not reflect the current application.`,
      href: `${base}/test-runs`,
      count: 1,
    });
  }

  const missingAutomation = quality.gaps.testCasesWithoutCurrentAutomation.length;
  if (missingAutomation > 0) {
    findings.push({
      severity: "CAUTION",
      code: "automation_missing",
      title: "Approved test cases without current automation",
      detail:
        "These are verified manually or not at all, so their evidence will not refresh on its own.",
      href: `${base}/automation`,
      count: missingAutomation,
    });
  }

  const staleAutomation = quality.gaps.staleAutomation.length;
  if (staleAutomation > 0) {
    findings.push({
      severity: "CAUTION",
      code: "automation_superseded",
      title: "Automation pinned to a superseded version",
      detail:
        "The approved intent moved on, so this automation no longer exercises the current version.",
      href: `${base}/automation`,
      count: staleAutomation,
    });
  }

  if (flaky > 0) {
    findings.push({
      severity: "CAUTION",
      code: "tests_flaky",
      title: "Tests producing both outcomes on one revision",
      detail:
        "These results are not reproducible, so they neither confirm nor deny the behaviour they cover.",
      href: `${base}/test-runs`,
      count: flaky,
    });
  }

  if (intentChanged > 0) {
    findings.push({
      severity: "CAUTION",
      code: "intent_changed",
      title: "Failures that cannot be compared to history",
      detail:
        "The approved intent changed, so earlier passing evidence describes different behaviour and no regression can be inferred.",
      href: `${base}/test-runs`,
      count: intentChanged,
    });
  }

  findings.sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity] || b.count - a.count,
  );

  return {
    project: quality.project,
    measuredAt: quality.measuredAt,
    counts: {
      approvedRequirements: quality.counts.approvedRequirements,
      requirementsWithApprovedTests: quality.counts.requirementsWithApprovedTests,
      approvedTestCases: quality.counts.approvedTestCases,
      testCasesWithCurrentAutomation: quality.counts.testCasesWithCurrentAutomation,
      regressions,
      flaky,
      openFindings: quality.counts.openFailureFindings,
    },
    evidence: {
      freshness: quality.evidence.freshness,
      lastEvidenceAt: quality.evidence.lastEvidenceAt,
      ageDays: quality.evidence.ageDays,
    },
    findings,
    releasable: !findings.some((finding) => finding.severity === "BLOCKER"),
  };
}
