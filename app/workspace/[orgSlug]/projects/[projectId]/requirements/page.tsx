import Link from "next/link";

import {
  ListEmptyState,
  ListPagination,
  ListSearch,
} from "@/components/workspace/list-controls";
import { ProjectNavigation } from "@/components/workspace/project-navigation";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { getProject } from "@/lib/services/projects";
import { listRequirements } from "@/lib/services/requirements";

const statusStyle = {
  DRAFT: "bg-slate-100 text-slate-700",
  IN_REVIEW: "bg-amber-50 text-amber-800",
  APPROVED: "bg-emerald-50 text-emerald-700",
  ARCHIVED: "bg-slate-100 text-slate-500",
} as const;

export default async function ProjectRequirementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const { q, page } = await searchParams;
  const basePath = `/workspace/${orgSlug}/projects/${projectId}/requirements`;
  const [context, project, requirements] = await Promise.all([
    requireWorkspaceContext({ orgSlug, projectId }),
    getProject({ orgSlug, projectId }),
    listRequirements({
      orgSlug,
      projectId,
      includeArchived: true,
      search: q,
      page: page ? Number(page) : undefined,
    }),
  ]);
  const canCreate = context.can("requirement:create");

  return (
    <div className="mx-auto max-w-5xl">
      <ProjectNavigation organizationSlug={orgSlug} projectId={projectId} />
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
            {project.name}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Requirements</h1>
          <p className="mt-2 text-sm text-slate-600">
            Versioned product intent moving from draft through review and approval.
          </p>
        </div>
        {canCreate ? (
          <Link
            href={`/workspace/${orgSlug}/projects/${projectId}/requirements/new`}
            className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            New requirement
          </Link>
        ) : null}
      </header>

      <div className="mt-6">
        <ListSearch basePath={basePath} meta={requirements} placeholder="Search title or reference" />
      </div>

      {requirements.items.length === 0 ? (
        <ListEmptyState
          meta={requirements}
          basePath={basePath}
          emptyTitle="No requirements yet"
          emptyDescription="Capture the first testable outcome for this project."
        />
      ) : (
        <section className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-200">
            {requirements.items.map((requirement) => (
              <Link
                key={requirement.id}
                href={`/workspace/${orgSlug}/projects/${projectId}/requirements/${requirement.id}`}
                className="block px-5 py-5 transition hover:bg-slate-50 sm:px-6"
              >
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-slate-950">{requirement.title}</h2>
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
                      {requirement.description || "Draft description not added yet."}
                    </p>
                  </div>
                  <span
                    className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle[requirement.status]}`}
                  >
                    {requirement.status.replace("_", " ")}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400">
                  <span>Version {requirement.currentVersionNumber}</span>
                  <span>{requirement.owner.displayName || "Workspace member"}</span>
                  <span>Updated {requirement.updatedAt.toLocaleString()}</span>
                  {requirement.externalReference ? (
                    <span>{requirement.externalReference}</span>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <ListPagination basePath={basePath} meta={requirements} noun="requirements" />
    </div>
  );
}
