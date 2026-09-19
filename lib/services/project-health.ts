import type { LiveChecksSummary } from "@/lib/services/live-checks";
import type { ReleaseReadiness } from "@/lib/services/release-readiness";

/**
 * One word for a project's state, for the Health page and anyone glancing at
 * it from a phone. Derived only from records that already exist -- readiness
 * findings and the last live-check round -- so it can never say more than the
 * evidence does:
 *
 * - "attention": something is failing now (a live check, a regression) or a
 *   release blocker is open.
 * - "no-evidence": nothing has ever run, so there is nothing to call healthy.
 * - "on-track": it has run, and nothing above is true.
 */
export type HealthVerdict = "attention" | "no-evidence" | "on-track";

export function projectHealthVerdict(input: {
  readiness: Pick<ReleaseReadiness, "counts" | "evidence" | "findings">;
  live: Pick<LiveChecksSummary, "failed" | "checked"> | null;
}): { verdict: HealthVerdict; reasons: string[] } {
  const reasons: string[] = [];
  if (input.live && input.live.failed > 0) {
    reasons.push(`${input.live.failed} failing in the last live check`);
  }
  if (input.readiness.counts.regressions > 0) {
    reasons.push(`${input.readiness.counts.regressions} regression${input.readiness.counts.regressions === 1 ? "" : "s"}`);
  }
  // "No run evidence" is itself a blocker on the Release page; here it is the
  // no-evidence verdict rather than a reason to call the project unhealthy.
  const blockers = input.readiness.findings.filter(
    (finding) => finding.severity === "BLOCKER" && finding.code !== "evidence_missing",
  ).length;
  if (blockers) reasons.push(`${blockers} release blocker${blockers === 1 ? "" : "s"}`);
  if (reasons.length) return { verdict: "attention", reasons };

  const ran = input.readiness.evidence.hasExecution || Boolean(input.live && input.live.checked > 0);
  if (!ran) return { verdict: "no-evidence", reasons: ["no test has run yet"] };
  return { verdict: "on-track", reasons: [] };
}
