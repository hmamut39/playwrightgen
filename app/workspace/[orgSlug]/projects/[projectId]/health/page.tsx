import Link from "next/link";

import { HEALTH_VERDICT_STYLE } from "@/components/workspace/health-verdict";
import { LocalTime } from "@/components/workspace/local-time";
import { ProjectNavigation } from "@/components/workspace/project-navigation";
import { readLiveChecksSummary } from "@/lib/services/live-checks";
import { projectHealthVerdict } from "@/lib/services/project-health";
import { getProjectOverview } from "@/lib/services/projects";
import { getReleaseReadiness } from "@/lib/services/release-readiness";
import { getReviewQueue } from "@/lib/services/review-queue";

/**
 * A project at a glance, built for a phone first: one verdict, then one card
 * per question someone checking in actually asks -- is it still passing, can
 * it ship, what is waiting on me, when did anything last run. Each card links
 * to the page with the detail. It reads the same records as those pages and
 * adds no judgement of its own beyond the verdict's plain rules.
 */

function Card({ href, title, children }: { href: string; title: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">{title}</h2>
        <span aria-hidden className="text-slate-400">&rarr;</span>
      </div>
      <div className="mt-2 text-sm leading-6 text-slate-700">{children}</div>
    </Link>
  );
}

function Big({ children, tone = "text-slate-950" }: { children: React.ReactNode; tone?: string }) {
  return <p className={`text-2xl font-semibold tracking-tight ${tone}`}>{children}</p>;
}

export default async function ProjectHealthPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const [overview, readiness, reviews] = await Promise.all([
    getProjectOverview({ orgSlug, projectId, allowArchived: true }),
    getReleaseReadiness({ orgSlug, projectId }),
    getReviewQueue({ orgSlug, projectId }),
  ]);
  const { project } = overview;
  const base = `/workspace/${orgSlug}/projects/${projectId}`;
  const live = project.liveChecksEnabled ? readLiveChecksSummary(project.liveChecksLastSummary) : null;
  const health = projectHealthVerdict({ readiness, live });
  const style = HEALTH_VERDICT_STYLE[health.verdict];
  const blockers = readiness.findings.filter((finding) => finding.severity === "BLOCKER");
  const waiting = reviews.yours.length + reviews.others.length;
  const { counts } = readiness;

  return (
    <div className="mx-auto max-w-3xl">
      <ProjectNavigation organizationSlug={orgSlug} projectId={projectId} />

      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Health</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{project.name}</h1>
      </header>

      <section aria-label="Verdict" className={`mt-5 rounded-2xl border p-5 ${style.box}`}>
        <p className={`flex items-center gap-2 text-xl font-semibold ${style.text}`}>
          <span aria-hidden className={`inline-block h-3 w-3 rounded-full ${style.dot}`} />
          {style.label}
        </p>
        {health.reasons.length ? (
          <p className={`mt-1 text-sm ${style.text}`}>{health.reasons.join(" · ")}</p>
        ) : (
          <p className="mt-1 text-sm text-emerald-900">Tests have run, nothing is failing, and nothing blocks a release.</p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Measured <LocalTime value={readiness.measuredAt} />
        </p>
      </section>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Card href={`${base}/overview#live-checks`} title="Daily live checks">
          {!project.liveChecksEnabled ? (
            <p>{project.liveUrl ? "Off. Turn them on to check approved tests on the live site every day." : "Off. Add where the project runs to check it every day."}</p>
          ) : !live ? (
            <p>On. The first round has not finished yet.</p>
          ) : (
            <>
              <Big tone={live.failed ? "text-red-700" : "text-slate-950"}>
                {live.passed} passed{live.failed ? ` · ${live.failed} failing` : ""}
              </Big>
              <p className="text-xs text-slate-500">
                Last checked <LocalTime value={new Date(live.ranAt)} />
              </p>
              {live.failing.slice(0, 3).map((entry) => (
                <p key={entry.testCaseId} className="mt-1 break-words text-red-800">
                  {entry.newToday ? "Started failing: " : "Failing: "}
                  {entry.title}
                </p>
              ))}
              {live.notChecked.length ? <p className="mt-1 text-xs text-slate-500">{live.notChecked.length} not checked</p> : null}
            </>
          )}
        </Card>

        <Card href={`${base}/release`} title="Release">
          <Big tone={readiness.releasable ? "text-emerald-800" : "text-red-700"}>
            {readiness.releasable ? "No blockers" : `${blockers.length} blocker${blockers.length === 1 ? "" : "s"}`}
          </Big>
          {blockers.slice(0, 3).map((finding) => (
            <p key={finding.code} className="mt-1 break-words">
              {finding.title}
            </p>
          ))}
        </Card>

        <Card href={`${base}/reviews`} title="Waiting for review">
          <Big>{waiting === 0 ? "Nothing waiting" : `${reviews.yours.length} for you`}</Big>
          {waiting ? (
            <p className="text-xs text-slate-500">
              {reviews.others.length} more waiting on someone else
            </p>
          ) : null}
          {reviews.yours.slice(0, 3).map((item) => (
            <p key={item.kind + item.id} className="mt-1 break-words">
              {item.title}
              {item.waitingDays ? <span className="text-slate-500"> &middot; {item.waitingDays}d</span> : null}
            </p>
          ))}
        </Card>

        <Card href={`${base}/test-runs`} title="Evidence">
          <Big tone={counts.regressions ? "text-red-700" : "text-slate-950"}>
            {counts.regressions
              ? `${counts.regressions} regression${counts.regressions === 1 ? "" : "s"}`
              : readiness.evidence.hasExecution
                ? "No regressions"
                : "No runs yet"}
          </Big>
          <p className="text-xs text-slate-500">
            {readiness.evidence.lastEvidenceAt ? (
              <>
                Last change <LocalTime value={readiness.evidence.lastEvidenceAt} /> &middot; {readiness.evidence.attemptCount} run
                {readiness.evidence.attemptCount === 1 ? "" : "s"} recorded
              </>
            ) : (
              "Nothing recorded yet"
            )}
            {counts.flaky ? ` · ${counts.flaky} flaky` : ""}
          </p>
        </Card>

        <Card href={`${base}/quality`} title="Coverage">
          <p>
            <span className="text-lg font-semibold text-slate-950">{counts.testCasesWithCurrentAutomation}</span>
            <span className="text-slate-500"> of {counts.approvedTestCases}</span> approved test cases have current automation
          </p>
          <p className="mt-1">
            <span className="text-lg font-semibold text-slate-950">{counts.requirementsWithApprovedTests}</span>
            <span className="text-slate-500"> of {counts.approvedRequirements}</span> approved requirements have an approved test
          </p>
        </Card>
      </div>
    </div>
  );
}
