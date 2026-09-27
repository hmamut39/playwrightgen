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
 *
 * On track is not the same as recently checked. A project whose only run was
 * six months ago has nothing failing and nothing blocking, and would read as a
 * plain green "on track" on the screen people glance at from a phone. The
 * verdict stays on track -- old evidence is still evidence, and calling it a
 * problem would cry wolf -- but it carries how long ago it was, so nobody
 * reads green as "checked lately".
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
  // Nothing is wrong, but the screen must not imply it was checked lately.
  if (input.readiness.evidence.freshness === "STALE" && input.readiness.evidence.ageDays !== null) {
    return {
      verdict: "on-track",
      reasons: [`nothing failing, but the last evidence is ${input.readiness.evidence.ageDays} days old`],
    };
  }
  return { verdict: "on-track", reasons: [] };
}
