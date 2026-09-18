import { revalidatePath } from "next/cache";

import { ProjectNavigation } from "@/components/workspace/project-navigation";
import { SetupChecklist } from "@/components/workspace/setup-checklist";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import {
  archiveProject,
  getProjectOverview,
  restoreProject,
  updateProject,
} from "@/lib/services/projects";
import { getProjectSetup } from "@/lib/services/project-setup";
import { personName } from "@/lib/format/person-name";
import { LocalTime } from "@/components/workspace/local-time";
import { PendingButton } from "@/components/workspace/pending-button";
import { humanLabel } from "@/lib/format/label";

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const [overview, setup, context] = await Promise.all([
    getProjectOverview({ orgSlug, projectId, allowArchived: true }),
    getProjectSetup({ orgSlug, projectId }),
    requireWorkspaceContext({ orgSlug, projectId }),
  ]);
  const { project } = overview;

  async function liveUrlAction(formData: FormData) {
    "use server";
    await updateProject({ orgSlug, projectId, liveUrl: String(formData.get("liveUrl") ?? "").trim() });
    revalidatePath(`/workspace/${orgSlug}/projects/${projectId}/overview`);
  }

  async function transitionAction(formData: FormData) {
    "use server";
    const intent = formData.get("intent");
    if (intent === "archive") {
      await archiveProject({ orgSlug, projectId });
    } else if (intent === "restore") {
      await restoreProject({ orgSlug, projectId });
    } else {
      throw new Error("Invalid project transition intent");
    }
    revalidatePath(`/workspace/${orgSlug}`);
    revalidatePath(`/workspace/${orgSlug}/projects/${projectId}/overview`);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <ProjectNavigation organizationSlug={orgSlug} projectId={projectId} />
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Project overview</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{project.name}</h1>
          <p className="mt-2 text-sm text-slate-500">{project.slug}</p>
        </div>
        {overview.canArchive ? (
          <form action={transitionAction}>
            <input
              name="intent"
              type="hidden"
              value={project.status === "ACTIVE" ? "archive" : "restore"}
            />
            <button className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50">
              {project.status === "ACTIVE" ? "Archive project" : "Restore project"}
            </button>
          </form>
        ) : null}
      </div>

      {/* The landing page for a project is where someone arrives immediately
          after creating one, so the chain belongs here rather than only on
          Quality, which a new user has no reason to open. It hides itself once
          every step is done, so an established project pays nothing for it. */}
      <SetupChecklist setup={setup} canAct={context.can("requirement:create")} />

      {/* Where this project runs. With it, automation generated for an approved
          Test Case is run and fixed before a person reviews it, so a reviewer
          reads code that was tried rather than only written. */}
      <section className="mt-8 rounded-2xl border border-cyan-200 bg-cyan-50/40 p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Proving</p>
        <h2 className="mt-2 text-lg font-semibold">Where this project runs</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
          Give a public address of this product and PlaywrightGen will run each newly generated test there, fix a failing
          step from what the page really showed, and record the result on the version &mdash; before anyone reviews it.
          Leave it empty and nothing is run.
        </p>
        {overview.canUpdate ? (
          <form action={liveUrlAction} className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              name="liveUrl"
              type="url"
              defaultValue={project.liveUrl ?? ""}
              maxLength={2_000}
              placeholder="https://staging.our-app.example.com/"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-cyan-600 focus-visible:ring-2 focus-visible:ring-cyan-500/60"
            />
            <PendingButton pendingLabel="Saving…" className="rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-800">
              {project.liveUrl ? "Update" : "Save"}
            </PendingButton>
          </form>
        ) : (
          <p className="mt-4 text-sm font-medium text-slate-700">{project.liveUrl || "Not set. A project lead can add it."}</p>
        )}
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <dl className="grid gap-6 sm:grid-cols-2">
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Status</dt><dd className="mt-2 text-sm font-medium">{humanLabel(project.status)}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Your role</dt><dd className="mt-2 text-sm font-medium">{humanLabel(overview.role)}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Creator</dt><dd className="mt-2 text-sm font-medium">{personName(project.createdBy.displayName)}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Created</dt><dd className="mt-2 text-sm"><LocalTime value={project.createdAt} /></dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Updated</dt><dd className="mt-2 text-sm"><LocalTime value={project.updatedAt} /></dd></div>
        </dl>
        <div className="mt-8 border-t border-slate-200 pt-6">
          <h2 className="text-sm font-semibold">Description</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-600">{project.description || "No description provided."}</p>
        </div>
      </section>
    </div>
  );
}
