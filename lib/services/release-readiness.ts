import "server-only";

import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import { getProjectQualityIntelligence } from "@/lib/services/project-quality";
import { classifyRuns, loadAttemptFacts, type AttemptFact, type RunSignal } from "@/lib/services/run-signals";

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
    /**
     * How recently anything in the project changed, including requirement and
     * test-case edits. It answers "was this touched", not "was this run", and
     * must not be presented as execution evidence on its own.
     */
    freshness: "FRESH" | "AGING" | "STALE" | "MISSING";
    lastEvidenceAt: Date | null;
    ageDays: number | null;
    /** Whether any attempt has ever been recorded. The execution question. */
    hasExecution: boolean;
    attemptCount: number;
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

  // Counted directly rather than inferred from the evidence freshness clock.
  // That clock is refreshed by requirement and test-case edits as well as by
  // runs, so on a project whose documents were approved today it reads "fresh"
  // while nothing has ever executed. Using it as the execution gate turned an
  // untested project into a green "nothing is blocking this release", which is
  // the single most consequential claim this page makes. An indexed count over
  // the append-only attempt table answers the execution question directly.
  // Counted separately from attempts, and never mixed with them. A live-page
  // run proves the code does what it says against the page at that moment; it
  // is not execution evidence for a release, which has to be a run recorded
  // against an approved version. Keeping them apart is right. Saying only the
  // first half was not: a lead who had just watched three tests pass on the
  // live page, and whose Test Cases each read "Passed on the live page, 10
  // checks", was told "Nothing has ever been run for this project" -- which
  // is false as written, and left her with no idea what would count.
  const [attemptFacts, totalAttempts, livePageRuns, projectSettings] = await Promise.all([
    loadAttemptFacts(prisma, {
      organizationId: workspace.organization.id,
      projectId: input.projectId,
    }),
    prisma.testRunAttempt.count({
      where: { organizationId: workspace.organization.id, projectId: input.projectId },
    }),
    prisma.testCaseImportedDraft.count({
      where: {
        organizationId: workspace.organization.id,
        projectId: input.projectId,
        // Only the runs that actually passed. A partial run -- nothing
        // failed, but some steps never ran -- is not something to count in a
        // sentence containing the word "passed"; repairing one false claim
        // with another would be no repair at all.
        runEvidence: { path: ["verdict"], equals: "passed" },
      },
    }),
    prisma.project.findUnique({
      where: { organizationId_id: { organizationId: workspace.organization.id, id: input.projectId } },
      select: { liveChecksEnabled: true, liveUrl: true },
    }),
  ]);
  const signals = classifyRuns(attemptFacts);

  const bySignal = (signal: RunSignal) =>
    [...signals.values()].filter((entry) => entry.signal === signal).length;

  const regressions = bySignal("REGRESSION");
  const flaky = bySignal("FLAKY");
  const intentChanged = bySignal("INTENT_CHANGED");

  /**
   * Approved tests whose last recorded run did not pass, however the failure
   * is classified -- or not classified at all.
   *
   * `regressions` answers a narrower question: which failures can be pinned
   * on the application. That needs commit hashes on both sides, and a daily
   * live check has none, because it runs against an address rather than a
   * revision. So a project checked daily could have every approved test
   * failing and still report "0 regressions", and nothing else on this page
   * counted a failure at all -- `NEW_FAILURE` and `INSUFFICIENT` were
   * classified and then dropped.
   *
   * Found on 2026-10-19 by breaking a mock company's site under its own
   * suite. Three approved tests failed every day, a product-defect finding
   * was confirmed at 70%, and this page said "Nothing is blocking this
   * release". That is the most consequential sentence the product prints.
   *
   * Counted per test case from the attempt records rather than from the
   * signals, so it holds whether or not a cause was ever worked out.
   */
  const latestByTestCase = new Map<string, AttemptFact>();
  for (const attempt of attemptFacts) {
    const held = latestByTestCase.get(attempt.testCaseId);
    if (!held || attempt.executedAt.getTime() > held.executedAt.getTime()) {
      latestByTestCase.set(attempt.testCaseId, attempt);
    }
  }
  const failingTestCases = [...latestByTestCase.values()].filter(
    (attempt) => attempt.result !== "PASSED",
  ).length;

  const findings: ReadinessFinding[] = [];

  // Before the attribution question, the plain one: is anything failing? A
  // release page that can only describe failures it has pinned on somebody
  // stays quiet about the rest, and quiet reads as fine.
  if (failingTestCases > 0) {
    findings.push({
      severity: "BLOCKER",
      code: "tests_failing",
      title: "Approved tests are failing",
      detail:
        `${failingTestCases === 1 ? "An approved test" : `${failingTestCases} approved tests`} last ran and did not pass. ` +
        "Whether the application or the test is at fault is a separate question, and may not be settled yet -- either way the evidence does not show this behaviour working.",
      href: `${base}/test-runs`,
      count: failingTestCases,
    });
  }

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

  /*
   * A project with no approved requirements at all.
   *
   * Every blocking condition here is a comparison against recorded intent:
   * requirements with nothing verifying them, tests failing against the
   * version they were approved at. With no requirements, none of them can
   * fire, so the page reaches "Nothing is blocking this release" by having
   * nothing to check rather than by checking and finding nothing. The
   * sentence is true and a manager reads it as the other thing.
   *
   * It became worth saying out loud on the day sharing stopped requiring a
   * requirement: this state is now one a team can send to somebody outside.
   *
   * A caution, not a blocker. Refusing to report a release because a team
   * writes no requirements would be this product inventing a process and
   * contradicting the evidence it now accepts from tests alone. The verdict
   * stands; what it rests on is said beside it.
   */
  if (quality.counts.approvedRequirements === 0) {
    findings.push({
      severity: "CAUTION",
      code: "requirements_none",
      title: "No approved requirements",
      detail:
        totalAttempts > 0
          ? "Nothing has been recorded as intended behaviour, so a verdict here is about whether tests passed and not about whether the product does what was agreed. Approve a requirement and link the tests that verify it to make this a statement about intent."
          : "Nothing has been recorded as intended behaviour, and nothing has run, so there is nothing yet to compare.",
      href: `${base}/requirements`,
      count: 1,
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

  if (totalAttempts === 0) {
    findings.push({
      severity: "BLOCKER",
      code: "evidence_missing",
      title: "No execution evidence exists",
      detail:
        livePageRuns > 0
          ? `No run has been recorded against an approved version, so there is no basis on which to judge this release. ${
              livePageRuns === 1 ? "One test has" : `${livePageRuns} tests have`
            } passed on the live page here, which proves the code and not the release: evidence counts once the approved automation runs in your pipeline and reports back, or a Test Run is recorded here.`
          : "Nothing has ever been run for this project, so there is no basis on which to judge this release. Approved documents describe intended behaviour; they do not demonstrate it.",
      href: `${base}/test-runs`,
      count: 1,
    });
  } else if (quality.evidence.freshness === "STALE") {
    // Daily checks re-run the approved automation every day, so a project with
    // them on cannot drift into this. Where they are off, naming the switch is
    // more use than naming the problem again.
    const couldRunDaily = !projectSettings?.liveChecksEnabled;
    findings.push({
      severity: "CAUTION",
      code: "evidence_stale",
      title: "Execution evidence is stale",
      detail: couldRunDaily
        ? `The most recent evidence is ${quality.evidence.ageDays} days old and may not reflect the current application. Daily checks would run the approved automation every day and keep it current${projectSettings?.liveUrl ? "" : ", once this project says where it runs"}.`
        : `The most recent evidence is ${quality.evidence.ageDays} days old and may not reflect the current application. Daily checks are on, so this is automation that is not covering what changed.`,
      href: couldRunDaily ? `${base}/overview#live-checks` : `${base}/test-runs`,
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
      // "on one revision" was accurate while flakiness could only be seen when
      // a pass and a failure shared a commit. It is now also reported when the
      // same approved version has produced both outcomes with no revision
      // recorded at all, which is what a daily live check produces, so the
      // title names the version rather than the revision.
      title: "Tests producing both outcomes on the same approved version",
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
      hasExecution: totalAttempts > 0,
      attemptCount: totalAttempts,
    },
    findings,
    releasable: !findings.some((finding) => finding.severity === "BLOCKER"),
  };
}
