import Link from "next/link";

import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { getOrganizationProjectRisk } from "@/lib/services/project-risk";
import { listProjects } from "@/lib/services/projects";

export default async function OrganizationWorkspacePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const [context, projects, risk] = await Promise.all([
    requireWorkspaceContext({ orgSlug }),
    listProjects({ orgSlug, includeArchived: true }),
    getOrganizationProjectRisk({ orgSlug }),
  ]);
  const canCreate = context.can("project:create");

  return (
    <>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Workspace</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-2 text-sm text-slate-600">Real project state for this organization.</p>
        </div>
        {canCreate ? (
          <Link href={`/workspace/${orgSlug}/projects/new`} className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
            New project
          </Link>
        ) : null}
      </header>

      {projects.length === 0 ? (
        <section className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <h2 className="text-lg font-semibold">No projects yet</h2>
          <p className="mt-2 text-sm text-slate-500">Create the first project when your role allows it.</p>
        </section>
      ) : (
        <section className="mt-8 grid gap-4 xl:grid-cols-2">
          {projects.map((project) => {
            const projectRisk = risk.get(project.id);
            return (
            <Link
              key={project.id}
              href={`/workspace/${orgSlug}/projects/${project.id}/quality`}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-slate-950">{project.name}</h2>
                  <p className="mt-1 text-xs text-slate-400">{project.slug}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${project.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                  {project.status}
                </span>
              </div>
              <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-600">
                {project.description || "No description"}
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {projectRisk && projectRisk.regressions > 0 ? (
                  <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                    {projectRisk.regressions} regression{projectRisk.regressions === 1 ? "" : "s"}
                  </span>
                ) : null}
                {projectRisk && projectRisk.flaky > 0 ? (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                    {projectRisk.flaky} flaky
                  </span>
                ) : null}
                {projectRisk && projectRisk.openFindings > 0 ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                    {projectRisk.openFindings} unreviewed finding{projectRisk.openFindings === 1 ? "" : "s"}
                  </span>
                ) : null}
                {projectRisk?.lastEvidenceAt ? null : (
                  <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-400">
                    No run evidence
                  </span>
                )}
              </div>
              <p className="mt-3 text-xs text-slate-400">
                {projectRisk?.lastEvidenceAt
                  ? `Last evidence ${projectRisk.lastEvidenceAt.toLocaleDateString()} · updated ${project.updatedAt.toLocaleDateString()}`
                  : `Updated ${project.updatedAt.toLocaleString()}`}
              </p>
            </Link>
            );
          })}
        </section>
      )}
    </>
  );
}
