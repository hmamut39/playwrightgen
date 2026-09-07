import "server-only";

import { analyzeAttempt } from "@/lib/services/failure-intelligence";
import type { IngestSummary } from "@/lib/services/test-run-ingest";

/**
 * Analyzes failures the moment CI reports them.
 *
 * Failure analysis existed but waited behind a button, so its findings only
 * appeared for someone who already knew a run had failed, had opened the right
 * attempt, and thought to ask. That is the wrong way round: the value of
 * reading a failure is highest before anyone has started guessing, and an
 * overnight regression should have an explanation waiting in the morning rather
 * than after somebody remembers to request one.
 *
 * Two limits keep an automatic call from becoming a liability.
 *
 * At most a few attempts per delivery. A suite that turns entirely red would
 * otherwise bill for one analysis per test, and the first few failures in a
 * broken run almost always share a cause; the rest can be analyzed by hand if
 * they turn out not to.
 *
 * Every failure is swallowed. This runs after a signed webhook has already been
 * answered, so there is no caller left to inform, and the ingested evidence is
 * complete and correct with or without an analysis attached to it. A missing
 * analysis is a smaller problem than an ingest that appears to have failed.
 */

/** Analyses attempted per delivery. Bounded because each one costs money. */
export const AUTO_ANALYSIS_LIMIT = 3;

export async function analyzeReportedFailures(
  summary: Pick<IngestSummary, "failures" | "organizationId" | "actorUserId">,
  projectId: string,
  analyze: typeof analyzeAttempt = analyzeAttempt,
): Promise<{ attempted: number; succeeded: number }> {
  const targets = summary.failures.slice(0, AUTO_ANALYSIS_LIMIT);
  let succeeded = 0;

  for (const target of targets) {
    try {
      await analyze(
        {
          organizationId: summary.organizationId,
          projectId,
          actorUserId: summary.actorUserId,
          // Recorded as the system, never as the person who connected the
          // repository. They did not ask for this analysis, and an audit trail
          // that credits people with actions they did not take is worthless.
          source: "SYSTEM",
        },
        {
          testRunId: target.testRunId,
          testRunAttemptId: target.testRunAttemptId,
        },
      );
      succeeded += 1;
    } catch {
      // Rate limits, provider outages and refusals all land here. The attempt
      // is already stored; anyone can still analyze it by hand.
    }
  }

  return { attempted: targets.length, succeeded };
}
