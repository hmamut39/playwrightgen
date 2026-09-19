import Link from "next/link";
import { redirect } from "next/navigation";

import { LocalTime } from "@/components/workspace/local-time";
import { PendingButton, PendingNotice } from "@/components/workspace/pending-button";
import { ProjectNavigation } from "@/components/workspace/project-navigation";
import { getProjectOverview } from "@/lib/services/projects";
import {
  listPageCoverages,
  PAGE_COVERAGE_MAX_ITEMS,
  PageCoverageError,
  planPageCoverageRun,
} from "@/lib/services/page-coverage";

const PLAN_ERRORS: Record<string, string> = {
  invalid_input: "Use a public web address (not localhost or a private network).",
  page_unreadable: "The page could not be opened. Check the address, or try again in a moment.",
  allowance_used: "This workspace has used today's AI allowance. It resets at midnight UTC.",
  plan_failed: "A plan could not be made for this page. Try again, or add what you want covered.",
};

/**
 * "Cover a page": one address in, a plan of the test cases that page needs out.
 * Nothing is spent beyond the plan until a person approves it on the next page.
 */
export default async function CoverPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const { error } = await searchParams;
  const [overview, runs] = await Promise.all([
    getProjectOverview({ orgSlug, projectId }),
    listPageCoverages({ orgSlug, projectId }),
  ]);
  const base = `/workspace/${orgSlug}/projects/${projectId}`;

  async function planAction(formData: FormData) {
    "use server";
    let coverageId: string;
    try {
      const run = await planPageCoverageRun({
        orgSlug,
        projectId,
        pageUrl: String(formData.get("pageUrl") ?? ""),
        focus: String(formData.get("focus") ?? ""),
      });
      coverageId = run.id;
    } catch (caught) {
      const code = caught instanceof PageCoverageError ? caught.code : "plan_failed";
      redirect(`${base}/cover?error=${code}`);
    }
    redirect(`${base}/cover/${coverageId}`);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <ProjectNavigation organizationSlug={orgSlug} projectId={projectId} />
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Cover a page</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Every test a page needs, proven on the page</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
        Give a page. PlaywrightGen reads it, plans up to {PAGE_COVERAGE_MAX_ITEMS} test cases for what a person can do
        there &mdash; skipping ones this project already has &mdash; and shows you the plan. Only what you keep is proven:
        each test is written from the real page, run, and fixed until it passes, then waits for review as a draft Test
        Case with its code and run evidence.
      </p>

      {error ? (
        <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {PLAN_ERRORS[error] ?? PLAN_ERRORS.plan_failed}
        </p>
      ) : null}

      <form action={planAction} className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <label className="block text-sm font-medium">
          Page
          <input
            name="pageUrl"
            type="url"
            required
            maxLength={2_000}
            defaultValue={overview.project.liveUrl ?? ""}
            placeholder="https://staging.our-app.example.com/checkout"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-cyan-600 focus-visible:ring-2 focus-visible:ring-cyan-500/60"
          />
        </label>
        <label className="block text-sm font-medium">
          What matters most <span className="font-normal text-slate-400">(optional)</span>
          <textarea
            name="focus"
            rows={3}
            maxLength={2_000}
            placeholder="For example: the promotion code rules, and what happens with an empty cart."
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-cyan-600 focus-visible:ring-2 focus-visible:ring-cyan-500/60"
          />
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <PendingButton pendingLabel="Reading the page and planning…" className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-700">
            Plan the tests for this page
          </PendingButton>
          <span className="text-xs text-slate-500">Planning uses one AI request. Nothing else is spent until you approve.</span>
        </div>
        <PendingNotice>Opening the page and planning. This usually takes 30&ndash;60 seconds.</PendingNotice>
      </form>

      {runs.length ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-slate-900">Earlier plans</h2>
          <ul className="mt-3 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
            {runs.map((run) => {
              const passed = run.items.filter((item) => item.status === "PASSED").length;
              const kept = run.items.filter((item) => item.status !== "SKIPPED" && item.status !== "PROPOSED").length;
              return (
                <li key={run.id}>
                  <Link href={`${base}/cover/${run.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0 truncate text-sm font-medium text-slate-900">{run.pageTitle}</span>
                    <span className="text-xs text-slate-500">
                      {run.status === "PLANNED" ? `${run.items.length} planned, waiting for approval` : `${passed} of ${kept} passed`} &middot;{" "}
                      <LocalTime value={run.createdAt} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
