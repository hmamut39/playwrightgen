import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";

import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";

/**
 * Distinguishes a flaky test from a real regression from changed intent.
 *
 * Most tools only know that "a test named X failed", so they cannot tell whether
 * the application broke, the test is unreliable, or the approved intent itself
 * changed. PlaywrightGen can, because every attempt is pinned to an immutable
 * Test Case version and records the exact revision it ran against:
 *
 * - same version, same commit, both outcomes seen  -> the test is unreliable
 * - same version, passed on an earlier commit      -> the application regressed
 * - passing evidence only on an older version      -> the intent changed, and
 *                                                     the comparison is invalid
 *
 * The last case matters most. Calling it a regression when the team deliberately
 * changed what the test should do would be a false accusation, so it is reported
 * as changed intent instead.
 */
export type RunSignal =
  | "STABLE"
  | "PASSING"
  | "FLAKY"
  | "REGRESSION"
  | "INTENT_CHANGED"
  | "NEW_FAILURE"
  | "INSUFFICIENT";

export type AttemptFact = {
  testRunId: string;
  testCaseId: string;
  testCaseVersionId: string;
  attemptNumber: number;
  result: "PASSED" | "FAILED" | "BLOCKED";
  commitSha: string | null;
  executedAt: Date;
};

export type RunSignalResult = {
  signal: RunSignal;
  detail: string;
};

const isPassing = (result: AttemptFact["result"]) => result === "PASSED";

/**
 * Pure classification so the rules can be tested exhaustively without a
 * database, and so the same facts always produce the same verdict.
 */
export function classifyRuns(
  attempts: readonly AttemptFact[],
): Map<string, RunSignalResult> {
  const byRun = new Map<string, AttemptFact[]>();
  for (const attempt of attempts) {
    const bucket = byRun.get(attempt.testRunId);
    if (bucket) bucket.push(attempt);
    else byRun.set(attempt.testRunId, [attempt]);
  }

  // Passing evidence for a Test Case, grouped by the version it exercised, so a
  // failure can be compared against the right history.
  const passingByTestCase = new Map<string, AttemptFact[]>();
  for (const attempt of attempts) {
    if (!isPassing(attempt.result)) continue;
    const bucket = passingByTestCase.get(attempt.testCaseId);
    if (bucket) bucket.push(attempt);
    else passingByTestCase.set(attempt.testCaseId, [attempt]);
  }

  /**
   * Failing evidence for a Test Case, so a green run can be asked whether this
   * version has ever been red.
   *
   * Flakiness used to be reachable only from the failing branch: a test was
   * called unreliable when its latest run failed and an earlier run of the
   * same version had passed. A test that fails and then passes -- which is
   * what flakiness usually looks like by the time anybody notices -- took the
   * passing branch and was reported "Passing", or "Stable" once two revisions
   * had gone green. The record held both results and the page showed one.
   */
  const failingByTestCase = new Map<string, AttemptFact[]>();
  for (const attempt of attempts) {
    if (isPassing(attempt.result)) continue;
    const bucket = failingByTestCase.get(attempt.testCaseId);
    if (bucket) bucket.push(attempt);
    else failingByTestCase.set(attempt.testCaseId, [attempt]);
  }

  const results = new Map<string, RunSignalResult>();

  for (const [testRunId, runAttempts] of byRun) {
    const ordered = [...runAttempts].sort((a, b) => a.attemptNumber - b.attemptNumber);
    const latest = ordered[ordered.length - 1];
    if (!latest) {
      results.set(testRunId, {
        signal: "INSUFFICIENT",
        detail: "No attempts have been recorded for this run.",
      });
      continue;
    }

    if (isPassing(latest.result)) {
      /**
       * Green now, red before, on the same approved version.
       *
       * The version is immutable, so the test did not change between the two.
       * Whether the application did is not something these records can say --
       * a daily live check runs against an address rather than a revision --
       * so this does not accuse anybody. It reports the one thing that is
       * certain: the result is not reproducible, which is what a team needs
       * before they trust the green.
       *
       * Checked before stability, because "stable" is the strongest claim on
       * this list and a version that has failed has not earned it.
       */
      const earlierFailure = (failingByTestCase.get(latest.testCaseId) ?? [])
        .filter(
          (attempt) =>
            attempt.testCaseVersionId === latest.testCaseVersionId &&
            attempt.executedAt.getTime() < latest.executedAt.getTime(),
        )
        .sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime())[0];

      if (earlierFailure) {
        results.set(testRunId, {
          signal: "FLAKY",
          detail: `The same approved version failed on ${earlierFailure.executedAt.toISOString().slice(0, 10)} and passes now, so the result is not reproducible. The test did not change between them; whether the application did is not recorded.`,
        });
        continue;
      }

      // "Stable" is a claim about behaviour holding over time, so it requires
      // the approved version to have passed on more than one revision. A single
      // green attempt is one observation, and reporting it as stability inflates
      // thin evidence into a reliability claim the data does not support --
      // which is the same overstatement as calling an unexecuted project
      // releasable. Manual runs that record no revision stay "Passing" for the
      // same reason: without a revision there is nothing to hold across.
      const passedRevisions = new Set(
        (passingByTestCase.get(latest.testCaseId) ?? [])
          .filter(
            (attempt) =>
              attempt.testCaseVersionId === latest.testCaseVersionId &&
              attempt.commitSha !== null,
          )
          .map((attempt) => attempt.commitSha as string),
      );

      results.set(
        testRunId,
        passedRevisions.size >= 2
          ? {
              signal: "STABLE",
              detail: `The same approved version passed on ${passedRevisions.size} revisions, most recently ${latest.commitSha ? latest.commitSha.slice(0, 8) : "an unrecorded revision"}.`,
            }
          : {
              signal: "PASSING",
              detail: `Latest attempt passed on ${latest.commitSha ? latest.commitSha.slice(0, 8) : "an unrecorded revision"}. Only one revision has passed for this version, which does not yet show the behaviour holding.`,
            },
      );
      continue;
    }

    const sameVersionPasses = ordered.filter(
      (attempt) =>
        isPassing(attempt.result) && attempt.testCaseVersionId === latest.testCaseVersionId,
    );

    const sameCommitPass =
      latest.commitSha !== null &&
      sameVersionPasses.find((attempt) => attempt.commitSha === latest.commitSha);

    if (sameCommitPass) {
      results.set(testRunId, {
        signal: "FLAKY",
        detail: `The same approved version both passed and failed on commit ${latest.commitSha!.slice(0, 8)}, so the result is not reproducible.`,
      });
      continue;
    }

    const earlierCommitPass = sameVersionPasses
      .filter(
        (attempt) =>
          attempt.commitSha !== null &&
          latest.commitSha !== null &&
          attempt.commitSha !== latest.commitSha &&
          attempt.executedAt.getTime() < latest.executedAt.getTime(),
      )
      .sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime())[0];

    if (earlierCommitPass) {
      results.set(testRunId, {
        signal: "REGRESSION",
        detail: `The same approved version passed on ${earlierCommitPass.commitSha!.slice(0, 8)} and fails on ${latest.commitSha!.slice(0, 8)}, so the change is in the application.`,
      });
      continue;
    }

    const otherVersionPass = (passingByTestCase.get(latest.testCaseId) ?? []).find(
      (attempt) => attempt.testCaseVersionId !== latest.testCaseVersionId,
    );

    if (otherVersionPass) {
      results.set(testRunId, {
        signal: "INTENT_CHANGED",
        detail:
          "The only passing evidence is on a different approved version, so this failure cannot be compared as a regression.",
      });
      continue;
    }

    /**
     * A failure after an earlier pass that cannot be attributed, because the
     * runs carry no revision to compare.
     *
     * Everything above this point asks who is at fault, and every answer
     * needs a commit on both sides. A daily live check runs against an
     * address rather than a revision and records none, so a test that passed
     * this morning and fails this afternoon fell through to "there is no
     * earlier passing evidence for this test case" -- which was false, and
     * was the one sentence in this file a reader would quote.
     *
     * It was quoted. On 2026-10-19 the failure analysis cited it back as
     * EXECUTION HISTORY while reasoning about a test that had demonstrably
     * passed four hours earlier on the same approved version.
     *
     * The signal stays NEW_FAILURE: newly failing is exactly what it is, and
     * promoting it to REGRESSION would claim the attribution this branch
     * exists because we do not have.
     */
    const earlierSameVersionPass = sameVersionPasses
      .filter((attempt) => attempt.executedAt.getTime() < latest.executedAt.getTime())
      .sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime())[0];

    if (earlierSameVersionPass) {
      results.set(testRunId, {
        signal: "NEW_FAILURE",
        detail: `The same approved version passed on ${earlierSameVersionPass.executedAt.toISOString().slice(0, 10)} and fails now. Neither run records a revision, so this cannot be compared as a regression.`,
      });
      continue;
    }

    results.set(testRunId, {
      signal: "NEW_FAILURE",
      detail: "There is no earlier passing evidence for this test case to compare against.",
    });
  }

  return results;
}

/**
 * Loads the attempt facts for one project and classifies every run.
 *
 * Scoped by organization and project like every other tenant-sensitive lookup;
 * the signal is derived from records the caller can already read.
 */
export async function getProjectRunSignals(
  input: { orgSlug?: string; projectId: string },
  dependencies?: WorkspaceContextDependencies,
): Promise<Map<string, RunSignalResult>> {
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId: input.projectId, permission: "testrun:read" },
    dependencies,
  );
  const prisma = dependencies?.prisma ?? getPrismaClient();

  return classifyRuns(
    await loadAttemptFacts(prisma, {
      organizationId: workspace.organization.id,
      projectId: input.projectId,
    }),
  );
}

/**
 * Attempts grow without limit once CI reports on every push, so the rows behind
 * a verdict have to be bounded or every page that shows a signal gets slower
 * every day.
 *
 * A time window rather than a bare row cap, because a cap drops arbitrary rows
 * and would make verdicts depend on which ones happened to survive. Ninety days
 * keeps the comparison meaningful — evidence older than that describes an
 * application that has usually moved on — and the count cap exists only as a
 * ceiling for pathological volumes.
 *
 * Both are deliberately visible here rather than hidden in each caller, so the
 * window a verdict rests on is one number in one place.
 */
export const SIGNAL_WINDOW_DAYS = 90;
export const SIGNAL_ATTEMPT_CAP = 20_000;

/**
 * Loads the bounded attempt history used for classification.
 *
 * Ordered newest-first so the cap keeps the most recent evidence, then reversed
 * because `classifyRuns` reasons about attempts in the order they happened.
 */
export async function loadAttemptFacts(
  prisma: PrismaClient,
  scope: { organizationId: string; projectId?: string; testCaseId?: string; now?: Date },
): Promise<Array<AttemptFact & { projectId: string }>> {
  const now = scope.now ?? new Date();
  const cutoff = new Date(now.getTime() - SIGNAL_WINDOW_DAYS * 86_400_000);

  const rows = await prisma.testRunAttempt.findMany({
    where: {
      organizationId: scope.organizationId,
      ...(scope.projectId ? { projectId: scope.projectId } : {}),
      ...(scope.testCaseId ? { testRun: { testCaseId: scope.testCaseId } } : {}),
      executedAt: { gte: cutoff },
    },
    select: {
      testRunId: true,
      projectId: true,
      attemptNumber: true,
      result: true,
      commitSha: true,
      executedAt: true,
      testRun: { select: { testCaseId: true, testCaseVersionId: true } },
    },
    orderBy: { executedAt: "desc" },
    take: SIGNAL_ATTEMPT_CAP,
  });

  return rows
    .map((row) => ({
      testRunId: row.testRunId,
      projectId: row.projectId,
      testCaseId: row.testRun.testCaseId,
      testCaseVersionId: row.testRun.testCaseVersionId,
      attemptNumber: row.attemptNumber,
      result: row.result,
      commitSha: row.commitSha,
      executedAt: row.executedAt,
    }))
    .reverse();
}

export const runSignalLabel: Record<RunSignal, string> = {
  STABLE: "Stable",
  PASSING: "Passing",
  FLAKY: "Flaky",
  REGRESSION: "Regression",
  INTENT_CHANGED: "Intent changed",
  NEW_FAILURE: "New failure",
  INSUFFICIENT: "No evidence",
};
