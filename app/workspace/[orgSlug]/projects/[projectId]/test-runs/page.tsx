import Link from "next/link";

import { ProjectNavigation } from "@/components/workspace/project-navigation";
import { RunSignalBadge } from "@/components/workspace/run-signal-badge";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { getProject } from "@/lib/services/projects";
import { getProjectRunSignals } from "@/lib/services/run-signals";
import { listTestRuns } from "@/lib/services/test-runs";

const statusStyle = {
  NOT_STARTED: "bg-slate-100 text-slate-700",
  PASSED: "bg-emerald-50 text-emerald-700",
  FAILED: "bg-red-50 text-red-700",
  BLOCKED: "bg-amber-50 text-amber-800",
  CANCELED: "bg-slate-100 text-slate-500",
} as const;

export default async function TestRunsPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const [context, project, runs, signals] = await Promise.all([
    requireWorkspaceContext({ orgSlug, projectId }),
    getProject({ orgSlug, projectId }),
    listTestRuns({ orgSlug, projectId }),
    getProjectRunSignals({ orgSlug, projectId }),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <ProjectNavigation organizationSlug={orgSlug} projectId={projectId} />
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">{project.name}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Test Runs</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Immutable execution attempts pinned to an approved Test Case version.
            Because every attempt records both its approved version and the exact
            revision it ran against, a flaky test can be told apart from a real
            regression.
          </p>
        </div>
        {context.can("testrun:create") ? <Link href={`/workspace/${orgSlug}/projects/${projectId}/test-runs/new`} className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">New test run</Link> : null}
      </header>

      {runs.length === 0 ? (
        <section className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <h2 className="text-lg font-semibold">No execution history yet</h2>
          <p className="mt-2 text-sm text-slate-500">Approve a Test Case, then create its first run.</p>
        </section>
      ) : (
        <section className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-200">
            {runs.map((run) => {
              const signal = signals.get(run.id);
              return (
              <Link key={run.id} href={`/workspace/${orgSlug}/projects/${projectId}/test-runs/${run.id}`} className="block px-5 py-5 transition hover:bg-slate-50 sm:px-6">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-slate-950">{run.name}</h2>
                    <p className="mt-2 text-sm text-slate-600">{run.testCase.title} · pinned version {run.testCaseVersion.versionNumber}</p>
                  </div>
                  <div className="flex w-fit flex-wrap items-center gap-2">
                    {signal ? <RunSignalBadge signal={signal.signal} detail={signal.detail} /> : null}
                    <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle[run.status]}`}>{run.status.replace("_", " ")}</span>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400">
                  <span>{run.mode.replaceAll("_", " ")}</span><span>{run.environment}</span>
                  <span>{run.browser}</span><span>{run._count.attempts} attempts</span>
                  <span>Updated {run.updatedAt.toLocaleString()}</span>
                </div>
              </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
