import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { HEALTH_VERDICT_STYLE } from "@/components/workspace/health-verdict";
import { PendingButton } from "@/components/workspace/pending-button";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { PageCoverageError, startPageCoveragePlan } from "@/lib/services/page-coverage";
import { LocalTime } from "@/components/workspace/local-time";
import { ProjectNavigation } from "@/components/workspace/project-navigation";
import { readLiveChecksSummary, runLiveChecksForProject, setLiveChecks } from "@/lib/services/live-checks";
import { projectHealthVerdict } from "@/lib/services/project-health";
import { getProjectOverview, updateProject } from "@/lib/services/projects";
import { getReleaseReadiness } from "@/lib/services/release-readiness";
import { getReviewQueue } from "@/lib/services/review-queue";

/**
 * A project at a glance, built for a phone first: one verdict, then one card
 * per question someone checking in actually asks -- is it still passing, can
 * it ship, what is waiting on me, when did anything last run. Each card links
 * to the page with the detail. It reads the same records as those pages and
 * adds no judgement of its own beyond the verdict's plain rules.
 */

// Planning a first page finishes after the page has answered.
export const maxDuration = 300;

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
  const [overview, readiness, reviews, context] = await Promise.all([
    getProjectOverview({ orgSlug, projectId, allowArchived: true }),
    getReleaseReadiness({ orgSlug, projectId }),
    getReviewQueue({ orgSlug, projectId }),
    requireWorkspaceContext({ orgSlug, projectId }),
  ]);
  const { project } = overview;
  const base = `/workspace/${orgSlug}/projects/${projectId}`;
  const live = project.liveChecksEnabled ? readLiveChecksSummary(project.liveChecksLastSummary) : null;
  const health = projectHealthVerdict({ readiness, live });
  const style = HEALTH_VERDICT_STYLE[health.verdict];
  const blockers = readiness.findings.filter((finding) => finding.severity === "BLOCKER");
  const waiting = reviews.yours.length + reviews.others.length;
  const { counts } = readiness;
  const offerFirstRun =
    health.verdict === "no-evidence" && project.status === "ACTIVE" && context.can("testcase:create");

  // Approved automation and a live address, but nobody has found the setting.
  const offerLiveChecks =
    project.status === "ACTIVE" &&
    Boolean(project.liveUrl) &&
    !project.liveChecksEnabled &&
    overview.canUpdate &&
    counts.testCasesWithCurrentAutomation > 0;

  async function liveChecksAction() {
    "use server";
    await setLiveChecks({ orgSlug, projectId, enabled: true });
    after(async () => {
      await runLiveChecksForProject(projectId, { deadline: Date.now() + 240_000 }).catch((error: unknown) =>
        console.error("[health] first live check failed", error),
      );
    });
    revalidatePath(`${base}/health`);
  }

  /**
   * The shortest way from an empty project to evidence: plan the tests one page
   * needs (the same Cover a page flow), with the project's live address when it
   * has one. An address typed here also becomes the live address, for proving
   * and daily checks, when this person may set it.
   */
  async function firstRunAction(formData: FormData) {
    "use server";
    const pageUrl = String(formData.get("pageUrl") ?? project.liveUrl ?? "").trim();
    let coverageId: string;
    try {
      const run = await startPageCoveragePlan({ orgSlug, projectId, pageUrl }, after);
      coverageId = run.id;
    } catch (caught) {
      if (!(caught instanceof PageCoverageError)) console.error("[health] first plan failed unexpectedly", caught);
      redirect(`${base}/cover?error=${caught instanceof PageCoverageError ? caught.code : "plan_failed"}`);
    }
    if (!project.liveUrl && overview.canUpdate) {
      await updateProject({ orgSlug, projectId, liveUrl: pageUrl }).catch((error: unknown) =>
        console.error("[health] could not keep the live address", error),
      );
    }
    redirect(`${base}/cover/${coverageId}`);
  }

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

      {offerFirstRun ? (
        <section aria-labelledby="first-run-heading" className="mt-5 rounded-2xl border border-cyan-200 bg-cyan-50 p-5">
          <h2 id="first-run-heading" className="text-lg font-semibold text-slate-950">
            Get your first evidence
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-700">
            PlaywrightGen reads {project.liveUrl ? <span className="break-all font-medium">{project.liveUrl}</span> : "a page of your product"},
            plans the tests it needs, and &mdash; after you tick which ones &mdash; writes and proves each in a real browser.
            Planning takes about a minute.
          </p>
          <form action={firstRunAction} className="mt-4 flex flex-col gap-2 sm:flex-row">
            {project.liveUrl ? null : (
              <input
                name="pageUrl"
                type="url"
                required
                maxLength={2_000}
                aria-label="Page address"
                placeholder="https://your-app.example.com/"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-cyan-600 focus-visible:ring-2 focus-visible:ring-cyan-500/60"
              />
            )}
            <PendingButton pendingLabel="Starting…" className="rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-800">
              Plan tests for this page
            </PendingButton>
          </form>
          <p className="mt-2 text-xs text-slate-500">
            Behind a login? Use <Link href={`${base}/cover`} className="font-semibold underline">Cover a page</Link> with a test account.
          </p>
        </section>
      ) : null}

      {offerLiveChecks ? (
        <section aria-labelledby="live-offer-heading" className="mt-5 rounded-2xl border border-cyan-200 bg-cyan-50 p-5">
          <h2 id="live-offer-heading" className="text-lg font-semibold text-slate-950">
            Check it every day
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-700">
            {counts.testCasesWithCurrentAutomation} approved test{counts.testCasesWithCurrentAutomation === 1 ? "" : "s"} can run on{" "}
            <span className="break-all font-medium">{project.liveUrl}</span> every day, so you hear the day one starts
            failing. No CI needed, and no AI allowance used.
          </p>
          <form action={liveChecksAction} className="mt-4">
            <PendingButton pendingLabel="Turning on…" className="rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-800">
              Turn on daily checks and run now
            </PendingButton>
          </form>
        </section>
      ) : null}

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
              {live.flaky.length ? (
                <p className="mt-1 text-xs text-amber-800">
                  {live.flaky.length} flaky (failed once, passed when run again)
                </p>
              ) : null}
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
