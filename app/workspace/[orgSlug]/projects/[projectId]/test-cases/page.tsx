import Link from "next/link";

import {
  ListEmptyState,
  ListPagination,
  ListSearch,
} from "@/components/workspace/list-controls";
import { ProjectNavigation } from "@/components/workspace/project-navigation";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { getProject } from "@/lib/services/projects";
import { listTestCases } from "@/lib/services/test-cases";

const statusStyle = {
  DRAFT: "bg-slate-100 text-slate-700",
  IN_REVIEW: "bg-amber-50 text-amber-800",
  APPROVED: "bg-emerald-50 text-emerald-700",
  ARCHIVED: "bg-slate-100 text-slate-500",
} as const;

export default async function TestCasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const { q, page } = await searchParams;
  const basePath = `/workspace/${orgSlug}/projects/${projectId}/test-cases`;
  const [context, project, testCases] = await Promise.all([
    requireWorkspaceContext({ orgSlug, projectId }),
    getProject({ orgSlug, projectId }),
    listTestCases({ orgSlug, projectId, includeArchived: true, search: q, page: page ? Number(page) : undefined }),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <ProjectNavigation organizationSlug={orgSlug} projectId={projectId} />
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">
            {project.name}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Test Cases</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Versioned, reviewable test intent with direct Requirement traceability.
          </p>
        </div>
        {context.can("testcase:create") ? (
          <Link
            href={`/workspace/${orgSlug}/projects/${projectId}/test-cases/new`}
            className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            New test case
          </Link>
        ) : null}
      </header>

      <div className="mt-6">
        <ListSearch basePath={basePath} meta={testCases} placeholder="Search test case titles" />
      </div>

      {testCases.items.length === 0 ? (
        <ListEmptyState
          meta={testCases}
          basePath={basePath}
          emptyTitle="No test cases yet"
          emptyDescription="Design the first reviewable test for this project."
        />
      ) : (
        <section className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-200">
            {testCases.items.map((testCase) => (
              <Link
                key={testCase.id}
                href={`/workspace/${orgSlug}/projects/${projectId}/test-cases/${testCase.id}`}
                className="block px-5 py-5 transition hover:bg-slate-50 sm:px-6"
              >
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-slate-950">{testCase.title}</h2>
                      <span className="rounded bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                        {testCase.type.replaceAll("_", " ")}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
                      {testCase.objective || "Draft objective not added yet."}
                    </p>
                  </div>
                  <span className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle[testCase.status]}`}>
                    {testCase.status.replace("_", " ")}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400">
                  <span>Version {testCase.currentVersionNumber}</span>
                  <span>{testCase.priority} priority</span>
                  <span>{testCase._count.requirementLinks} linked requirements</span>
                  <span>Automation: {testCase.automationStatus}</span>
                  <span>Updated {testCase.updatedAt.toLocaleString()}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <ListPagination basePath={basePath} meta={testCases} noun="test cases" />
    </div>
  );
}
