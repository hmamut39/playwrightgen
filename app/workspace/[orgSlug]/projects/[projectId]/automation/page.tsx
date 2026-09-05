import Link from "next/link";

import {
  ListPagination,
  ListSearch,
} from "@/components/workspace/list-controls";
import { ProjectNavigation } from "@/components/workspace/project-navigation";
import { listAutomationArtifacts } from "@/lib/services/automation-artifacts";

const statusStyle = {
  DRAFT: "bg-slate-100 text-slate-700",
  IN_REVIEW: "bg-amber-50 text-amber-800",
  APPROVED: "bg-emerald-50 text-emerald-700",
  ARCHIVED: "bg-slate-100 text-slate-500",
} as const;

const validationStyle = {
  PASSED: "text-emerald-700",
  WARNINGS: "text-amber-700",
  BLOCKED: "text-red-700",
} as const;

export default async function AutomationPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const { q, page } = await searchParams;
  const basePath = `/workspace/${orgSlug}/projects/${projectId}/automation`;
  const artifacts = await listAutomationArtifacts({ orgSlug, projectId, search: q, page: page ? Number(page) : undefined });
  const base = `/workspace/${orgSlug}/projects/${projectId}`;

  return (
    <div className="mx-auto max-w-6xl">
      <ProjectNavigation organizationSlug={orgSlug} projectId={projectId} />
      <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
            Automation Studio
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Reviewable Playwright automation
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            Every artifact pins an approved Test Case version. Browser and API
            engines generate separate drafts that must pass local validation and
            human review before approval.
          </p>
        </div>
        <Link
          href={`${base}/test-cases`}
          className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white"
        >
          Choose a Test Case
        </Link>
      </header>

      <div className="mt-6">
        <ListSearch basePath={basePath} meta={artifacts} placeholder="Search artifacts or test cases" />
      </div>

      <section className="mt-8 grid gap-4">
        {artifacts.items.length ? (
          artifacts.items.map((artifact) => {
            const currentVersion = artifact.versions[0];
            return (
              <Link
                key={artifact.id}
                href={`${base}/automation/${artifact.id}`}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-cyan-300 hover:shadow-md sm:p-6"
              >
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle[artifact.status]}`}>
                        {artifact.status.replace("_", " ")}
                      </span>
                      <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-800">
                        {artifact.engine === "PLAYWRIGHT_BROWSER" ? "Playwright Browser" : "Playwright API"}
                      </span>
                    </div>
                    <h2 className="mt-3 truncate text-lg font-semibold">{artifact.name}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {artifact.testCase.title} · Test Case v{artifact.testCaseVersion.versionNumber}
                    </p>
                  </div>
                  <div className="shrink-0 text-left sm:text-right">
                    <p className="text-xs font-semibold text-slate-500">
                      Current v{artifact.currentVersionNumber || "—"}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Approved v{artifact.approvedVersionNumber ?? "—"}
                    </p>
                    {currentVersion ? (
                      <p className={`mt-2 text-xs font-semibold ${validationStyle[currentVersion.validationStatus]}`}>
                        {currentVersion.generationStatus === "FAILED"
                          ? "Generation failed safely"
                          : `Validation ${currentVersion.validationStatus.toLowerCase()}`}
                      </p>
                    ) : null}
                  </div>
                </div>
              </Link>
            );
          })
        ) : (
          <div className="rounded-2xl border border-dashed border-cyan-200 bg-cyan-50/40 p-8 text-center">
            <h2 className="text-lg font-semibold">No automation artifacts yet</h2>
            <p className="mt-2 text-sm text-slate-600">
              Open an approved Test Case and choose the Browser or API engine.
            </p>
          </div>
        )}
      </section>

      <ListPagination basePath={basePath} meta={artifacts} noun="artifacts" />
    </div>
  );
}
