import Link from "next/link";
import { redirect } from "next/navigation";

import { ResultActions } from "@/components/free-tools/result-actions";
import { AutoRefresh } from "@/components/workspace/auto-refresh";
import { PageCoverageDriver } from "@/components/workspace/page-coverage-driver";
import { PendingButton } from "@/components/workspace/pending-button";
import { ProjectNavigation } from "@/components/workspace/project-navigation";
import { humanLabel } from "@/lib/format/label";
import {
  approvePageCoverage,
  getPageCoverage,
  resumePageCoverage,
} from "@/lib/services/page-coverage";

const ITEM_BADGE: Record<string, { text: string; tone: string }> = {
  PROPOSED: { text: "Proposed", tone: "bg-slate-100 text-slate-700" },
  SKIPPED: { text: "Left out", tone: "bg-slate-100 text-slate-500" },
  QUEUED: { text: "Waiting", tone: "bg-slate-100 text-slate-700" },
  PROVING: { text: "Proving…", tone: "bg-cyan-50 text-cyan-800" },
  PASSED: { text: "Passed", tone: "bg-emerald-600 text-white" },
  PARTIAL: { text: "Partly run", tone: "bg-amber-50 text-amber-800" },
  FAILED: { text: "Not passing yet", tone: "bg-red-50 text-red-700" },
  ERROR: { text: "Could not run", tone: "bg-red-50 text-red-700" },
};

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * One "cover this page" plan: approve it, watch it being proven, and read what
 * it covered. The coverage line is computed from the page's own controls and
 * the proven code, not asked of the model.
 */
export default async function PageCoverageDetail({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string; coverageId: string }>;
}) {
  const { orgSlug, projectId, coverageId } = await params;
  const { run, coverage, suite, canAct, costPerItem } = await getPageCoverage({ orgSlug, projectId, coverageId });
  const base = `/workspace/${orgSlug}/projects/${projectId}`;
  const here = `${base}/cover/${coverageId}`;

  async function approveAction(formData: FormData) {
    "use server";
    await approvePageCoverage({
      orgSlug,
      projectId,
      coverageId,
      itemIds: formData.getAll("itemId").map(String),
    });
    redirect(here);
  }
  async function resumeAction() {
    "use server";
    await resumePageCoverage({ orgSlug, projectId, coverageId });
    redirect(here);
  }

  const kept = run.items.filter((item) => !["PROPOSED", "SKIPPED"].includes(item.status));
  const counts = {
    passed: kept.filter((item) => item.status === "PASSED").length,
    partial: kept.filter((item) => item.status === "PARTIAL").length,
    failing: kept.filter((item) => item.status === "FAILED" || item.status === "ERROR").length,
  };
  const [summary, ...leftOut] = (run.message ?? "").split("\n");

  return (
    <div className="mx-auto max-w-4xl">
      <ProjectNavigation organizationSlug={orgSlug} projectId={projectId} />
      <Link href={`${base}/cover`} className="text-sm font-medium text-cyan-700 hover:text-cyan-900">&larr; Cover a page</Link>
      <p className="mt-6 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
        {run.status === "PLANNING" ? "Planning" : run.status === "PLAN_FAILED" ? "No plan" : run.status === "PLANNED" ? "Plan" : run.status === "DONE" ? "Covered" : run.status === "PAUSED" ? "Paused" : "Proving"}
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{run.pageTitle}</h1>
      <p className="mt-1 break-all text-sm text-slate-500">{run.pageUrl}</p>

      {run.status === "PLANNING" ? (
        <div role="status" aria-live="polite" className="mt-6 rounded-2xl border border-cyan-200 bg-white p-6 shadow-sm">
          <AutoRefresh />
          <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-cyan-100">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-cyan-600 motion-reduce:animate-none" />
          </div>
          <p className="text-sm font-semibold text-slate-900">Reading the page and planning its tests&hellip;</p>
          <p className="mt-1 text-sm text-slate-600">
            This usually takes about a minute. You can leave this page; the plan will be here when you come back.
          </p>
        </div>
      ) : run.status === "PLAN_FAILED" ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
          <p>{run.message ?? "A plan could not be made for this page."}</p>
          <Link href={`${base}/cover`} className="mt-3 inline-block font-semibold text-red-900 underline">Try again</Link>
        </div>
      ) : run.status === "PLANNED" ? (
        <>
          {summary ? <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600">{summary}</p> : null}
          {canAct ? (
            <form action={approveAction} className="mt-6 space-y-3">
              {run.items.map((item) => (
                <label key={item.id} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <input type="checkbox" name="itemId" value={item.id} defaultChecked className="mt-1 h-4 w-4 accent-cyan-700" />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span className="font-semibold text-slate-950">{item.title}</span>
                      <span className="text-xs text-slate-500">{humanLabel(item.priority)} priority</span>
                    </span>
                    <span className="mt-1 block text-sm leading-6 text-slate-600">{item.objective}</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">Why: {item.rationale}</span>
                  </span>
                </label>
              ))}
              {leftOut.length ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                  <p className="font-semibold">Deliberately not planned</p>
                  <ul className="mt-1 list-disc pl-5">{leftOut.map((line) => <li key={line}>{line.replace(/^Left out: /, "")}</li>)}</ul>
                </div>
              ) : null}
              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center">
                <PendingButton pendingLabel="Starting…" className="rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-800">
                  Prove the ticked tests
                </PendingButton>
                <span className="text-xs text-slate-500">
                  Each test uses up to {costPerItem} of the workspace&rsquo;s daily AI requests: one to write it, and one per
                  automatic fix.
                </span>
              </div>
            </form>
          ) : (
            <p className="mt-6 text-sm text-slate-600">A project member can approve this plan.</p>
          )}
        </>
      ) : (
        <>
          {run.status === "PROVING" && canAct ? <PageCoverageDriver orgSlug={orgSlug} projectId={projectId} coverageId={coverageId} needsSignIn={run.needsSignIn} /> : null}
          {run.status === "PAUSED" ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p>{run.message ?? "Paused."}</p>
              {canAct ? (
                <form action={resumeAction} className="mt-2">
                  <PendingButton pendingLabel="Resuming…" className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white">Carry on</PendingButton>
                </form>
              ) : null}
            </div>
          ) : null}

          <section className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-2xl font-semibold text-emerald-800">{counts.passed}</p><p className="text-xs text-emerald-800">passed on the live page</p></div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-2xl font-semibold text-amber-800">{counts.partial}</p><p className="text-xs text-amber-800">partly run</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-2xl font-semibold text-slate-800">{counts.failing}</p><p className="text-xs text-slate-600">need a person to finish</p></div>
          </section>

          {coverage.total ? (
            <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-slate-900">
                The proven tests reach {coverage.reached.length} of the page&rsquo;s {coverage.total} named controls
              </p>
              <p className="mt-1 text-xs text-slate-500">Counted from the page itself and the tests&rsquo; locators, by name &mdash; not the AI&rsquo;s opinion.</p>
              {coverage.missed.length ? (
                <p className="mt-3 text-xs leading-5 text-slate-600">
                  Not reached: {coverage.missed.slice(0, 20).map((control) => `${control.role} "${control.name}"`).join(", ")}
                  {coverage.missed.length > 20 ? ` and ${coverage.missed.length - 20} more` : ""}
                </p>
              ) : null}
            </section>
          ) : null}

          <ul className="mt-6 space-y-3">
            {run.items.map((item) => {
              const badge = ITEM_BADGE[item.status] ?? ITEM_BADGE.QUEUED;
              return (
                <li key={item.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${item.status === "SKIPPED" ? "border-slate-100 opacity-60" : "border-slate-200"}`}>
                  <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                    <p className="font-semibold text-slate-950">{item.title}</p>
                    <span className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.tone}`}>
                      {badge.text}
                      {item.status === "PASSED" && item.checks ? ` · ${item.checks} checks` : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{item.detail ?? item.objective}</p>
                  {item.fixes ? <p className="mt-1 text-xs text-slate-500">{item.fixes} automatic fix{item.fixes === 1 ? "" : "es"} along the way.</p> : null}
                  {item.testCaseId ? (
                    <Link href={`${base}/test-cases/${item.testCaseId}`} className="mt-2 inline-block text-sm font-semibold text-cyan-800 hover:text-cyan-950">
                      Open the draft Test Case &rarr;
                    </Link>
                  ) : item.status === "SKIPPED" ? null : (
                    <p className="mt-1 text-xs text-slate-500">Steps: {list(item.steps).join(" → ")}</p>
                  )}
                </li>
              );
            })}
          </ul>
          {suite ? (
            <section className="mt-6 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
              <div className="flex flex-col justify-between gap-3 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center">
                <div>
                  <p className="text-sm font-semibold text-white">The proven suite, as one file</p>
                  <p className="mt-1 text-xs text-slate-400">Every test that ran on the page, each in its own describe block.</p>
                </div>
                <ResultActions content={suite} filename="page-coverage.spec.ts" tone="dark" />
              </div>
              <details>
                <summary className="cursor-pointer px-5 py-3 text-xs font-semibold text-cyan-300">Show the code</summary>
                <pre className="max-h-96 overflow-auto px-5 pb-5 text-xs leading-5 text-slate-100">{suite}</pre>
              </details>
            </section>
          ) : null}
          {run.status === "DONE" ? (
            <p className="mt-6 text-sm leading-6 text-slate-600">
              Each proven test is now a draft Test Case with its code and run evidence. Review and approve them as usual; after
              approval, &ldquo;Use this code as the automation&rdquo; makes the code the first automation version.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
